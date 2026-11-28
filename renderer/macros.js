'use strict';
/* global S, h, $, $$, uid, toast, openModal, field, inp, sel, chk, clone, activePane, broadcastTargets, saveSettings, sessionTitle, showContextMenu, confirmDialog */
/*
 * Makros: Abläufe „warte auf Ausgabe → sende Eingabe“, manuell erstellt oder aufgezeichnet,
 * sowie Auto-Antworten (Trigger), die bei bestimmten Terminal-Ausgaben automatisch antworten.
 *
 * Makro  = { id, name, steps: [ {t:'expect', pattern, regex, timeout, onTimeout}, {t:'send', text, enter}, {t:'pause', ms},
 *                                {t:'loop', var, mode:'num'|'list', values}, {t:'end'} ] }   (Schleifen: macro-loop.js)
 * Trigger = { id, name, pattern, regex, response, enter, enabled, scope }
 * Gespeichert in den Einstellungen (S.settings.macros / S.settings.triggers) → Teil des Konfig-Exports.
 */

/* ---------- Text-Helfer ---------- */
// ANSI-/Steuersequenzen entfernen, damit Muster auf dem sichtbaren Text arbeiten
function stripAnsi(s) {
  return String(s)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')       // OSC (Fenstertitel …)
    .replace(/\x1b[P^_][\s\S]*?\x1b\\/g, '')                 // DCS/PM/APC
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')                 // CSI (Farben, Cursor)
    .replace(/\x1b[()*+][0-9A-Za-z]/g, '')                   // Zeichensatz
    .replace(/\x1b[@-Z\\-_=>78]/g, '')                       // sonstige ESC x
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');       // übrige Steuerzeichen außer \t \n \r
}
// Sichtbare letzte Zeile (berücksichtigt \r-Überschreiben)
function lastLine(text) {
  const lines = String(text).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const segs = lines[i].split('\r').filter(x => x.trim() !== '');
    if (segs.length) return segs[segs.length - 1];
  }
  return '';
}
// Escape-Notation für Sende-Texte: \r \n \t \e \xHH \\
function encodeEsc(s) {
  return String(s).replace(/[\\\x00-\x1f\x7f]/g, (c) => {
    if (c === '\\') return '\\\\';
    if (c === '\t') return '\\t';
    if (c === '\r') return '\\r';
    if (c === '\n') return '\\n';
    if (c === '\x1b') return '\\e';
    return '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0');
  });
}
function decodeEsc(s) {
  return String(s).replace(/\\(x[0-9a-fA-F]{2}|[rnte\\])/g, (_m, c) => {
    if (c === 'r') return '\r'; if (c === 'n') return '\n'; if (c === 't') return '\t';
    if (c === 'e') return '\x1b'; if (c === '\\') return '\\';
    return String.fromCharCode(parseInt(c.slice(1), 16));
  });
}
const PASSWORD_PROMPT = /(pass(wor[dt])?|passphrase|kennwort|\bpin\b|secret)[^\n]*[:>]\s*$/i;
const VAR_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const isSecretVar = (n) => /pass|kennwort|secret|pin|token/i.test(n);

function macroList() { return Array.isArray(S.settings.macros) ? S.settings.macros : []; }
function triggerList() { return Array.isArray(S.settings.triggers) ? S.settings.triggers : []; }
function saveMacros(list) { return saveSettings({ macros: list }); }
function saveTriggers(list) { return saveSettings({ triggers: list }); }
function findMacro(id) { return macroList().find(m => m.id === id); }

function makeMatcher(pattern, regex) {
  if (!pattern) return null;
  if (regex) {
    try { const re = new RegExp(pattern, 'i'); return (buf) => { const m = re.exec(buf); return m ? m.index + m[0].length : -1; }; }
    catch (_) { return null; }
  }
  return (buf) => { const i = buf.indexOf(pattern); return i < 0 ? -1 : i + pattern.length; };
}

// Sichtbare Zeile an der Cursor-Position (damit ein schon angezeigter Prompt erkannt wird)
function currentScreenLine(pane) {
  try {
    const b = pane.term.buffer.active;
    const line = b.getLine(b.baseY + b.cursorY);
    return line ? line.translateToString(true) : '';
  } catch (_) { return ''; }
}

/* ---------- Variablen ({{Name}}) vor dem Start abfragen ---------- */
function macroVars(macro) {
  const names = [];
  const loopVars = loopVarNames(macro.steps);
  for (const st of macro.steps || []) {
    const src = st.t === 'send' ? st.text : st.t === 'expect' ? st.pattern : st.t === 'loop' ? st.values : '';
    for (const m of String(src || '').matchAll(VAR_RE)) if (!names.includes(m[1]) && !loopVars.has(m[1])) names.push(m[1]);
  }
  return names;
}
const escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function substVars(str, vars, regex) {
  return String(str || '').replace(VAR_RE, (_m, n) => { const v = vars[n] ?? ''; return regex ? escRe(v) : v; });
}
function askVars(macro, targetsLabel) {
  const names = macroVars(macro);
  if (!names.length) return Promise.resolve({});
  return new Promise((resolve) => {
    let result = null;
    const inputs = names.map(n => inp('v_' + n, '', { type: isSecretVar(n) ? 'password' : 'text', autocomplete: 'off' }));
    openModal({
      title: `Makro „${macro.name}“ – Eingaben`, width: 420,
      body: h('div', null,
        targetsLabel ? h('p', { class: 'hint' }, targetsLabel) : null,
        names.map((n, i) => field(n, inputs[i])),
        h('p', { class: 'hint' }, 'Die Werte werden nur für diesen Lauf verwendet und nicht gespeichert.')),
      buttons: [
        { label: 'Abbrechen', click: () => {} },
        { label: 'Starten', cls: 'primary', click: () => { result = {}; names.forEach((n, i) => { result[n] = inputs[i].value; }); } }
      ],
      onClose: () => resolve(result)
    });
  });
}

/* ---------- Bestätigung vor dem Start (Option „Vor dem Start bestätigen“) ---------- */
function stepSummary(st) {
  if (st.t === 'expect') return `Warten auf „${st.pattern}“${st.regex ? ' (Regex)' : ''}`;
  if (st.t === 'send') return `Senden: ${st.text || '(leer)'}${st.enter !== false ? ' ⏎' : ''}`;
  if (st.t === 'loop') {
    const dyn = /\{\{[^}]+\}\}/.test(st.values || '');
    const r = dyn ? null : parseLoopValues(st.values, st.mode);
    return `Schleife {{${st.var}}} = ${st.values || ''}${r && !r.error ? `  (${r.values.length} Durchläufe)` : ''}`;
  }
  if (st.t === 'end') return 'Schleifenende';
  if (st.t === 'close') return `Schließen nach ${(Number(st.ms) || 0) / 1000} s ohne Ausgabe`;
  return `Pause ${st.ms || 0} ms`;
}
function confirmMacro(macro, targetsLabel) {
  if (!macro.confirm) return Promise.resolve(true);
  return new Promise((resolve) => {
    let ok = false;
    const steps = macro.steps || [];
    openModal({
      title: `Makro „${macro.name}“ starten?`, width: 480,
      body: h('div', { class: 'macro-confirm' },
        macro.confirmText ? h('p', { class: 'confirm-text' }, macro.confirmText) : null,
        targetsLabel ? h('p', { class: 'hint' }, targetsLabel) : null,
        h('ol', { class: 'macro-preview' }, steps.slice(0, 12).map((st, i) => h('li', { class: st.t, style: { paddingLeft: (loopStructure(steps).depth[i] * 16) + 'px' } }, stepSummary(st)))),
        steps.length > 12 ? h('p', { class: 'hint' }, `… und ${steps.length - 12} weitere Schritte`) : null),
      buttons: [
        { label: 'Abbrechen', click: () => {} },
        { label: 'Ausführen', cls: 'primary', click: () => { ok = true; } }
      ],
      onClose: () => resolve(ok)
    });
  });
}

/* ---------- Ablauf ---------- */
class MacroRun {
  constructor(pane, macro, vars) {
    this.pane = pane; this.macro = clone(macro); this.vars = vars || {};
    this.idx = -1; this.buf = ''; this.timer = null; this.done = false;
    this.loops = loopStructure(this.macro.steps).pair; this.frames = []; this.hops = 0;
  }
  start(seedScreen) {
    if (this.pane.macroRun) this.pane.macroRun.stop('ersetzt', true);
    this.pane.macroRun = this;
    if (seedScreen && this.pane.term) this.buf = currentScreenLine(this.pane);
    this.pane.updateMacroUi();
    this.next();
  }
  get step() { return this.macro.steps[this.idx]; }
  next() {
    clearTimeout(this.timer);
    if (this.done) return;
    this.idx++;
    if (this.idx >= this.macro.steps.length) return this.finish();
    const st = this.step;
    if (st.t === 'loop' || st.t === 'end') return this.loopStep(st);
    this.hops = 0;
    this.pane.updateMacroUi();
    if (st.t === 'pause') { this.timer = setTimeout(() => this.next(), Math.max(0, Number(st.ms) || 0)); return; }
    if (st.t === 'close') return this.closeWhenQuiet(st);
    if (st.t === 'send') return this.send(st);
    if (st.t === 'expect') {
      this.match = makeMatcher(substVars(st.pattern, this.vars, st.regex), st.regex);
      if (!this.match) { toast(`Makro „${this.macro.name}“: ungültiges Muster in Schritt ${this.idx + 1}`); return this.stop('Fehler', true); }
      const to = Number(st.timeout); const ms = (Number.isFinite(to) ? to : 15) * 1000;
      if (ms > 0) this.timer = setTimeout(() => this.onTimeout(), ms);
      this.check();
    }
  }
  // Schleifenanfang/-ende: Variable setzen bzw. zurückspringen
  loopStep(st) {
    if (this.pendingVars) { this.idx--; this.timer = setTimeout(() => this.next(), 150); return; } // Werte können von Eingaben abhängen
    const end = this.loops[this.idx];
    if (end === undefined) { toast(`Makro „${this.macro.name}“: Schleife in Schritt ${this.idx + 1} ist nicht geschlossen`); return this.stop('Fehler', true); }
    if (st.t === 'loop') {
      const r = parseLoopValues(substVars(st.values, this.vars), st.mode);
      if (r.error) { toast(`Makro „${this.macro.name}“, Schritt ${this.idx + 1}: ${r.error}`, 4000); return this.stop('Fehler', true); }
      const fr = { start: this.idx, end, name: st.var, values: r.values, pos: 0, saved: [this.vars[st.var], this.vars[st.var + '#']] };
      this.frames.push(fr);
      this.setLoopVar(fr);
    } else {
      const fr = this.frames[this.frames.length - 1];
      if (!fr || fr.end !== this.idx) { toast(`Makro „${this.macro.name}“: Schleifenende in Schritt ${this.idx + 1} passt nicht`); return this.stop('Fehler', true); }
      fr.pos++;
      if (fr.pos < fr.values.length) { this.setLoopVar(fr); this.idx = fr.start; }
      else {
        this.frames.pop();
        // Variablen nach der Schleife wieder auf den vorherigen Stand (z.B. äußere Schleife gleichen Namens)
        if (fr.saved[0] === undefined) delete this.vars[fr.name]; else this.vars[fr.name] = fr.saved[0];
        if (fr.saved[1] === undefined) delete this.vars[fr.name + '#']; else this.vars[fr.name + '#'] = fr.saved[1];
      }
    }
    this.pane.updateMacroUi();
    // leere Schleifen nicht synchron endlos verschachteln
    if (++this.hops > 200) { this.hops = 0; this.timer = setTimeout(() => this.next(), 0); return; }
    this.next();
  }
  setLoopVar(fr) {
    if (!fr.values.length) { this.idx = fr.end; this.frames.pop(); return; }
    this.vars = Object.assign({}, this.vars, { [fr.name]: fr.values[fr.pos], [fr.name + '#']: String(fr.pos + 1) });
  }
  loopInfo() { return this.frames.map(f => `${f.name}=${f.values[f.pos]} (${f.pos + 1}/${f.values.length})`).join(' · '); }
  send(st) {
    const go = () => {
      if (this.done) return;
      if (this.pendingVars) { this.timer = setTimeout(go, 150); return; } // Eingaben werden noch abgefragt
      if (this.pane.state !== 'running') {
        if (this.pane.state === 'exited' || this.pane.state === 'launcher') return this.stop('Session beendet');
        this.timer = setTimeout(go, 150); return; // Verbindung wird noch aufgebaut
      }
      let text = decodeEsc(substVars(st.text, this.vars));
      if (st.enter !== false) text += '\r';
      this.buf = ''; // neue Ausgabe nach der Eingabe abwarten
      this.pane.sendRaw(text);
      this.timer = setTimeout(() => this.next(), 30);
    };
    go();
  }
  // Aufruf von außen mit --close: warten, bis st.ms lang keine Ausgabe mehr kam, dann Pane schließen
  closeWhenQuiet(st) {
    const ms = Math.max(0, Number(st.ms) || 0);
    const check = () => {
      if (this.done) return;
      const quiet = Date.now() - (this.pane._lastOut || 0);
      if (quiet < ms) { this.timer = setTimeout(check, ms - quiet + 20); return; }
      this.done = true;
      if (this.pane.macroRun === this) this.pane.macroRun = null;
      extClosePane(this.pane);
    };
    this.timer = setTimeout(check, ms);
  }
  feed(text) {
    if (this.done) return;
    this.buf = (this.buf + text).slice(-16000);
    if (this.step && this.step.t === 'expect') this.check();
  }
  check() {
    const end = this.match ? this.match(this.buf) : -1;
    if (end >= 0) { this.buf = this.buf.slice(end); this.next(); }
  }
  onTimeout() {
    const st = this.step;
    if (this.pendingVars) { this.timer = setTimeout(() => this.onTimeout(), 1000); return; }
    if (st && st.onTimeout === 'continue') { this.next(); return; }
    toast(`Makro „${this.macro.name}“: Zeitüberschreitung beim Warten auf „${st.pattern}“ (Schritt ${this.idx + 1})`, 4000);
    this.stop('Zeitüberschreitung');
  }
  finish() { this.done = true; clearTimeout(this.timer); if (this.pane.macroRun === this) this.pane.macroRun = null; this.pane.updateMacroUi(); if (this.macro.notify !== false) toast(`Makro „${this.macro.name}“ fertig`); }
  stop(reason, silent) {
    if (this.done) return;
    this.done = true; clearTimeout(this.timer);
    if (this.pane.macroRun === this) this.pane.macroRun = null;
    this.pane.updateMacroUi();
    if (!silent && reason && reason !== 'Zeitüberschreitung') toast(`Makro „${this.macro.name}“ gestoppt${reason ? ' – ' + reason : ''}`);
  }
}

/* ---------- Optional: vor dem Start eine gespeicherte Verbindung aufbauen ---------- */
const CONNECT_WHERE = [['tab', 'in neuem Tab'], ['row', 'geteilt nebeneinander'], ['column', 'geteilt untereinander']];
function macroSession(m) { return m && m.connectId ? S.sessions.find(s => s.id === m.connectId) || null : null; }
function connectLabel(m) {
  const s = macroSession(m);
  if (!s) return 'gespeicherte Verbindung nicht gefunden';
  const w = (CONNECT_WHERE.find(x => x[0] === (m.connectWhere || 'tab')) || CONNECT_WHERE[0])[1];
  return `${sessionTitle(s)} (${sessionSubtitle(s)}), ${w}`;
}
async function runMacroWithConnect(macro) {
  const s = macroSession(macro);
  if (!s) { toast(`Makro „${macro.name}“: die gespeicherte Verbindung existiert nicht mehr – bitte im Makro neu wählen`, 4000); return false; }
  if (s.type === 'rdp') { toast('RDP-Verbindungen können nicht mit Makros gesteuert werden'); return false; }
  if (!macro.steps || !macro.steps.length) { toast('Das Makro hat keine Schritte'); return false; }
  const label = `Verbindet zu: ${connectLabel(macro)}`;
  if (!(await confirmMacro(macro, label))) return false;
  const vars = await askVars(macro, label);
  if (vars === null) return false;
  const cfg = clone(s);
  delete cfg.macroId; // eigenes Autostart-Makro der Session nicht zusätzlich starten
  cfg._pendingMacro = { macro: clone(macro), vars };
  openSaved(cfg, macro.connectWhere || 'tab');
  return true;
}

async function runMacro(macro, panes, { askLabel } = {}) {
  if (macro && macro.connectId) return runMacroWithConnect(macro);
  panes = (panes || []).filter(p => p && p.term && (p.state === 'running' || p.state === 'connecting'));
  if (!panes.length) { toast('Kein verbundenes Pane für das Makro'); return false; }
  if (!macro.steps || !macro.steps.length) { toast('Das Makro hat keine Schritte'); return false; }
  const label = askLabel || (panes.length > 1 ? `Ziel: ${panes.length} Panes` : `Ziel: ${panes[0].title}`);
  if (!(await confirmMacro(macro, label))) return false;
  const vars = await askVars(macro, label);
  if (vars === null) return false;
  for (const p of panes) new MacroRun(p, macro, vars).start(true);
  return true;
}
function stopAllMacros() {
  let n = 0;
  for (const p of S.panes.values()) if (p.macroRun) { p.macroRun.stop('', true); n++; }
  toast(n ? `${n} Makro${n === 1 ? '' : 's'} gestoppt` : 'Kein Makro aktiv');
}

// Autostart nach dem Verbinden (Session-Option „Makro nach dem Verbinden“)
async function autoStartMacro(pane, cfg) {
  const m = cfg && cfg.macroId && findMacro(cfg.macroId);
  if (!m) return;
  return startGated(pane, m, `Automatisch nach dem Verbinden: ${sessionTitle(cfg)}`);
}
// Lauf sofort starten, damit keine Ausgabe (z.B. Login-Prompt) verpasst wird;
// Bestätigung und Eingaben werden parallel abgefragt, bis dahin wird nichts gesendet.
async function startGated(pane, m, label, seedText = '') {
  const run = new MacroRun(pane, m, {});
  run.buf = seedText || '';
  const needVars = macroVars(m).length > 0;
  run.pendingVars = needVars || !!m.confirm;
  run.start(false);
  if (!run.pendingVars) return;
  if (!(await confirmMacro(m, label))) { run.stop('nicht bestätigt'); return; }
  if (needVars) {
    const vars = await askVars(m, label);
    if (vars === null) { run.stop('abgebrochen'); return; }
    run.vars = vars;
  }
  run.pendingVars = false;
}

/* ---------- Auto-Antworten (Trigger) ---------- */
function triggerApplies(t, pane) {
  if (!t.enabled || !t.pattern || !pane.cfg) return false;
  if (!t.scope) return true;
  const hay = (sessionTitle(pane.cfg) + ' ' + (pane.cfg.host || '') + ' ' + (pane.cfg.path || '') + ' ' + (pane.cfg.folder || '')).toLowerCase();
  return String(t.scope).toLowerCase().split(',').map(x => x.trim()).filter(Boolean).some(x => hay.includes(x));
}
function runTriggers(pane, text) {
  const list = triggerList();
  if (!list.length) return;
  pane._trigBuf = ((pane._trigBuf || '') + text).slice(-2000);
  const now = Date.now();
  pane._trigState = pane._trigState || {};
  for (const t of list) {
    if (!triggerApplies(t, pane)) continue;
    const m = makeMatcher(t.pattern, t.regex);
    if (!m) continue;
    const end = m(pane._trigBuf);
    if (end < 0) continue;
    pane._trigBuf = pane._trigBuf.slice(end);
    const st = pane._trigState[t.id] || (pane._trigState[t.id] = { hits: [] });
    if (st.blocked) continue;
    st.hits = st.hits.filter(x => now - x < 10000); st.hits.push(now);
    if (st.hits.length > 25) { st.blocked = true; toast(`Auto-Antwort „${t.name || t.pattern}“ für dieses Pane pausiert (zu häufig ausgelöst)`, 4000); continue; }
    if (t.runMacro) { const mac = findMacro(t.runMacro); if (mac && !pane.macroRun) startGated(pane, mac, `Ausgelöst durch Auto-Antwort „${t.name || t.pattern}“ in ${pane.title}`, pane._trigBuf); continue; }
    let resp = decodeEsc(t.response || '');
    if (t.enter) resp += '\r';
    if (resp) setTimeout(() => pane.sendRaw(resp), 20);
  }
}

/* ---------- Aufzeichnung ---------- */
const REC = { pane: null, steps: [], out: '', line: '', prompt: null };
function isRecording(p) { return REC.pane && (!p || REC.pane === p); }

function startRecording(pane) {
  pane = pane || activePane();
  if (!pane || !pane.term || pane.state !== 'running') { toast('Zum Aufzeichnen zuerst ein verbundenes Pane wählen'); return; }
  if (REC.pane) return stopRecording();
  Object.assign(REC, { pane, steps: [], out: currentScreenLine(pane), line: '', prompt: null, started: Date.now() });
  document.body.classList.add('recording');
  pane.updateMacroUi();
  updateMacroToolbar();
  toast('Aufzeichnung läuft – Eingaben und Prompts werden erfasst. Stoppen mit ⇧⌘R', 3500);
}
function recOutput(pane, text) { if (REC.pane === pane) REC.out = (REC.out + text).slice(-8000); }
function recCommit(enter, extra) {
  const line = REC.line + (extra || '');
  const prompt = REC.prompt;
  if (prompt) {
    REC.steps.push({ t: 'expect', pattern: prompt, regex: false, timeout: 15, onTimeout: 'abort' });
  }
  const secret = prompt && PASSWORD_PROMPT.test(prompt);
  if (secret && enter) REC.steps.push({ t: 'send', text: '{{' + tx('Passwort') + '}}', enter: true });
  else if (line || enter) REC.steps.push({ t: 'send', text: encodeEsc(line), enter: !!enter });
  REC.line = ''; REC.prompt = null; REC.out = '';
}
function recInput(pane, data) {
  if (REC.pane !== pane) return;
  const toks = String(data).match(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1bO.|\x1b[\s\S]?|[\s\S]/g) || [];
  for (const tk of toks) {
    if (tk === '\x1b[200~' || tk === '\x1b[201~') continue; // Bracketed-Paste-Marker
    if (!REC.line && REC.prompt === null) {
      const p = lastLine(stripAnsi(REC.out)).replace(/\s+$/, '');
      REC.prompt = p ? (p.length > 40 ? p.slice(-40) : p) : '';
    }
    if (tk === '\r' || tk === '\n') recCommit(true);
    else if (tk === '\x7f' || tk === '\b') REC.line = REC.line.slice(0, -1);
    else if (tk === '\t' || tk.length > 1 || tk >= ' ') REC.line += tk;
    else recCommit(false, tk); // Ctrl+C, Ctrl+D … sofort senden
  }
}
function stopRecording(discard) {
  if (!REC.pane) return;
  const pane = REC.pane;
  if (REC.line) recCommit(false);
  const steps = REC.steps;
  REC.pane = null;
  document.body.classList.remove('recording');
  pane.updateMacroUi && pane.updateMacroUi();
  updateMacroToolbar();
  if (discard) { toast('Aufzeichnung verworfen'); return; }
  if (!steps.length) { toast('Aufzeichnung beendet – keine Eingaben erfasst'); return; }
  const name = `${tx('Aufzeichnung')} ${pane.cfg ? sessionTitle(pane.cfg) : ''} ${new Date().toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' })}`.replace(/\s+/g, ' ').trim();
  macroEditor({ id: uid('mac'), name, steps }, { isNew: true, recorded: true });
}

/* ---------- Oberfläche ---------- */
function updateMacroToolbar() {
  const b = $('#btn-macros');
  if (!b) return;
  b.classList.toggle('rec', !!REC.pane);
  b.querySelector('.lbl').textContent = REC.pane ? 'Aufnahme ■' : 'Makros';
  b.title = REC.pane ? 'Aufzeichnung läuft – klicken zum Stoppen (⇧⌘R)' : 'Makros ausführen, aufzeichnen und verwalten';
}

function macroTargets() {
  const bc = S.multiInput ? broadcastTargets() : [];
  return bc.length > 1 ? bc : [activePane()].filter(Boolean);
}

function showMacroMenu(x, y) {
  if (REC.pane) {
    showContextMenu(x, y, [
      { label: 'Aufzeichnung stoppen und speichern…', key: '⇧⌘R', click: () => stopRecording() },
      { label: 'Aufzeichnung verwerfen', click: () => stopRecording(true) }
    ]);
    return;
  }
  const targets = macroTargets();
  const where = targets.length > 1 ? ` (${targets.length} Multi-Input-Panes)` : '';
  const ms = macroList();
  const running = [...S.panes.values()].some(p => p.macroRun);
  showContextMenu(x, y, [
    ...(ms.length ? ms.map(m => ({ label: `▶ ${m.name}${m.connectId ? ` (verbindet zu ${macroSession(m) ? sessionTitle(macroSession(m)) : '?'})` : where}`, click: () => runMacro(m, targets) })) : [{ label: 'Noch keine Makros', disabled: true }]),
    { sep: true },
    { label: 'Aufzeichnung starten', key: '⇧⌘R', click: () => startRecording(), disabled: !(activePane() && activePane().state === 'running') },
    { label: 'Neues Makro…', click: () => macroEditor(null, { isNew: true }) },
    { label: 'Makros verwalten…', click: () => macroManager() },
    { label: 'Auto-Antworten…', click: () => triggerManager() },
    { sep: true },
    { label: 'Laufende Makros stoppen', key: '⌘.', click: () => stopAllMacros(), disabled: !running }
  ]);
}

function pickAndRunMacro() {
  const ms = macroList();
  if (!ms.length) { toast('Noch keine Makros – neu anlegen oder aufzeichnen'); macroManager(); return; }
  const targets = macroTargets();
  const s = h('select', { size: Math.min(10, Math.max(3, ms.length)), style: { width: '100%' } }, ms.map((m, i) => h('option', { value: m.id, selected: i === 0 }, m.connectId ? `${m.name}  →  verbindet zu ${macroSession(m) ? sessionTitle(macroSession(m)) : '?'}` : m.name)));
  s.addEventListener('dblclick', () => { const b = $$('.modal .btn.primary').pop(); b && b.click(); });
  openModal({ title: 'Makro ausführen', width: 420,
    body: h('div', null, field(targets.length > 1 ? `Ziel: ${targets.length} Multi-Input-Panes` : `Ziel: ${targets[0] ? targets[0].title : '–'}`, s)),
    buttons: [{ label: 'Abbrechen', click: () => {} }, { label: 'Ausführen', cls: 'primary', click: () => { const m = findMacro(s.value); if (m) setTimeout(() => runMacro(m, targets), 30); } }] });
}

const STEP_TYPES = [['expect', 'Warten auf Ausgabe'], ['send', 'Senden'], ['pause', 'Pause'], ['loop', 'Schleife'], ['end', 'Schleifenende']];
const LOOP_MODES = [['num', 'Zahlen'], ['list', 'Texte']];

function macroLoopName(steps) {
  const used = new Set(steps.filter(x => x.t === 'loop').map(x => x.var));
  for (const n of ['i', 'j', 'k', 'n', 'x']) if (!used.has(n)) return n;
  let k = 2; while (used.has('i' + k)) k++; return 'i' + k;
}

function macroEditor(macro, { isNew, recorded, onSaved } = {}) {
  const m = clone(macro || { id: uid('mac'), name: 'Neues Makro', steps: [{ t: 'expect', pattern: '$ ', regex: false, timeout: 15, onTimeout: 'abort' }, { t: 'send', text: '', enter: true }] });
  const nameIn = inp('name', m.name);
  const confirmChk = chk('confirm', m.confirm, 'Vor dem Start bestätigen (auch bei Autostart und Auto-Antworten)');
  const confirmText = inp('confirmText', m.confirmText, { placeholder: 'optionaler Hinweis im Bestätigungsdialog, z.B. „Achtung: lädt die Konfiguration neu“' });
  const syncConfirm = () => { confirmText.disabled = !confirmChk.querySelector('input').checked; };
  confirmChk.querySelector('input').addEventListener('change', syncConfirm);
  syncConfirm();
  const termSessions = S.sessions.filter(x => x.type !== 'rdp')
    .sort((a, b) => ((a.folder || '') + '\u0000' + sessionTitle(a)).localeCompare((b.folder || '') + '\u0000' + sessionTitle(b), 'de'));
  const connOpts = [['', '– keine, im aktiven Pane bzw. den Multi-Input-Panes ausführen –'],
    ...termSessions.map(x => [x.id, `${x.folder ? x.folder + ' / ' : ''}${sessionTitle(x)}  (${(TYPE_META[x.type] || {}).label || x.type}: ${sessionSubtitle(x)})`])];
  if (m.connectId && !termSessions.some(x => x.id === m.connectId)) connOpts.push([m.connectId, '(gelöschte Verbindung – bitte neu wählen)']);
  const connSel = sel('connectId', m.connectId || '', connOpts);
  const whereSel = sel('connectWhere', m.connectWhere || 'tab', CONNECT_WHERE.map(([v, l]) => [v, 'öffnen ' + l]));
  const syncConn = () => { whereSel.disabled = !connSel.value; };
  connSel.addEventListener('change', syncConn);
  syncConn();
  const list = h('div', { class: 'macro-steps' });
  const render = () => {
    list.textContent = '';
    if (!m.steps.length) list.appendChild(h('div', { class: 'hint' }, 'Noch keine Schritte.'));
    const struct = loopStructure(m.steps);
    m.steps.forEach((st, i) => {
      const typeSel = sel('t', st.t, STEP_TYPES);
      typeSel.addEventListener('change', () => { st.t = typeSel.value; if (st.t === 'expect') { st.timeout = st.timeout ?? 15; st.pattern = st.pattern || ''; } if (st.t === 'pause') st.ms = st.ms ?? 1000; if (st.t === 'send') st.enter = st.enter !== false; if (st.t === 'loop') { st.var = st.var || 'i'; st.mode = st.mode || 'num'; st.values = st.values ?? '1-3'; } render(); });
      let main, opts;
      if (st.t === 'expect') {
        main = h('input', { class: 'grow', value: st.pattern || '', spellcheck: 'false', placeholder: 'Text in der Ausgabe, z.B. Password:  oder  router#', oninput: (e) => { st.pattern = e.target.value; } });
        const re = h('input', { type: 'checkbox', onchange: (e) => { st.regex = e.target.checked; } }); re.checked = !!st.regex;
        const to = h('input', { type: 'number', min: 0, max: 3600, value: st.timeout ?? 15, class: 'num', title: 'Zeitlimit in Sekunden (0 = unbegrenzt)', oninput: (e) => { st.timeout = Number(e.target.value); } });
        const ot = sel('onTimeout', st.onTimeout || 'abort', [['abort', 'sonst abbrechen'], ['continue', 'sonst weiter']]);
        ot.addEventListener('change', () => { st.onTimeout = ot.value; });
        opts = h('span', { class: 'opts' }, h('label', { class: 'mini', title: 'Muster als regulären Ausdruck auswerten' }, re, 'Regex'), to, h('span', { class: 'mini' }, 's'), ot);
      } else if (st.t === 'send') {
        main = h('input', { class: 'grow mono', value: st.text || '', spellcheck: 'false', placeholder: 'Eingabe, z.B. show version  ·  {{Passwort}} wird beim Start abgefragt  ·  \\x03 = Ctrl+C', oninput: (e) => { st.text = e.target.value; } });
        const en = h('input', { type: 'checkbox', onchange: (e) => { st.enter = e.target.checked; } }); en.checked = st.enter !== false;
        opts = h('span', { class: 'opts' }, h('label', { class: 'mini', title: 'Nach dem Text Enter senden' }, en, 'Enter'));
      } else if (st.t === 'loop') {
        const info = h('span', { class: 'mini loop-info' });
        const upd = () => {
          if (/\{\{[^}]+\}\}/.test(st.values || '')) { info.textContent = 'Werte beim Start'; info.classList.remove('err'); info.title = 'Die Werte enthalten eine Variable und werden beim Start ausgewertet'; return; }
          const r = parseLoopValues(st.values, st.mode);
          info.classList.toggle('err', !!r.error);
          info.textContent = r.error ? 'Fehler' : `${r.values.length}×`;
          info.title = r.error || loopPreview(r.values, 12);
        };
        const varIn = h('input', { class: 'var mono', value: st.var || '', spellcheck: 'false', placeholder: 'Name', title: 'Variablenname – im Schleifenrumpf als {{Name}} verwenden, {{Name#}} = Durchlauf-Nummer', oninput: (e) => { st.var = e.target.value.trim(); } });
        const modeSel = sel('mode', st.mode || 'num', LOOP_MODES);
        const valIn = h('input', { class: 'grow mono', value: st.values || '', spellcheck: 'false', oninput: (e) => { st.values = e.target.value; upd(); } });
        const ph = () => { valIn.placeholder = (st.mode || 'num') === 'list' ? 'Texte mit Komma getrennt, z.B. Gi1/0/1, Gi1/0/5, uplink' : 'Zahlen und Bereiche, z.B. 1,2,3 7-10  ·  0-100/10  ·  01-12'; };
        modeSel.addEventListener('change', () => { st.mode = modeSel.value; ph(); upd(); });
        ph(); upd();
        main = h('span', { class: 'grow loop-main' }, h('span', { class: 'mini' }, 'für {{'), varIn, h('span', { class: 'mini' }, '}} in'), modeSel, valIn);
        opts = h('span', { class: 'opts' }, info);
      } else if (st.t === 'end') {
        const lp = struct.pair[i] !== undefined ? m.steps[struct.pair[i]] : null;
        main = h('span', { class: 'grow mini' }, lp ? `Ende der Schleife über {{${lp.var || '?'}}} (ab Schritt ${struct.pair[i] + 1})` : 'Schleifenende ohne passende Schleife');
        opts = h('span', { class: 'opts' });
      } else {
        main = h('span', { class: 'grow' }, h('input', { type: 'number', min: 0, max: 600000, step: 100, value: st.ms ?? 1000, class: 'num', oninput: (e) => { st.ms = Number(e.target.value); } }), h('span', { class: 'mini' }, ' ms warten'));
        opts = h('span', { class: 'opts' });
      }
      const mv = (d) => { const j = i + d; if (j < 0 || j >= m.steps.length) return; [m.steps[i], m.steps[j]] = [m.steps[j], m.steps[i]]; render(); };
      const del = () => {
        // Schleife entfernen → passendes Ende mit entfernen, Rumpf bleibt erhalten
        const j = st.t === 'loop' ? struct.pair[i] : undefined;
        if (j !== undefined) m.steps.splice(j, 1);
        m.steps.splice(i, 1); render();
      };
      list.appendChild(h('div', { class: 'macro-step ' + st.t + (struct.pair[i] === undefined && (st.t === 'loop' || st.t === 'end') ? ' bad' : ''), style: { marginLeft: (struct.depth[i] * 22) + 'px' } },
        h('span', { class: 'nr' }, String(i + 1)), typeSel, main, opts,
        h('button', { class: 'p-btn', type: 'button', title: 'Nach oben', onclick: () => mv(-1) }, '↑'),
        h('button', { class: 'p-btn', type: 'button', title: 'Nach unten', onclick: () => mv(1) }, '↓'),
        h('button', { class: 'p-btn', type: 'button', title: st.t === 'loop' ? 'Schleife entfernen (Schritte darin bleiben)' : 'Schritt entfernen', onclick: del }, '×')));
    });
  };
  render();
  const add = (st) => { m.steps.push(st); render(); setTimeout(() => { const ins = $$('.macro-step input.grow', list); ins.length && ins[ins.length - 1].focus(); }, 0); };
  const body = h('div', { class: 'macro-form' },
    recorded ? h('p', { class: 'hint' }, 'Aufgezeichnet: vor jeder Eingabe wird auf den zuletzt angezeigten Prompt gewartet. Passwort-Eingaben wurden nicht gespeichert, sondern durch {{Passwort}} ersetzt und beim Start abgefragt. Prüfe die Schritte und passe Muster bei Bedarf an.') : null,
    field('Name', nameIn),
    h('div', { class: 'macro-confirm-opt' }, confirmChk, confirmText),
    h('div', { class: 'macro-connect-opt' },
      h('span', { class: 'lbl' }, 'Vor dem Start verbinden'), connSel, whereSel),
    h('p', { class: 'hint macro-connect-hint' }, 'Mit gewählter Verbindung wird beim Start (Menü, ⇧⌘M, Verwaltung) zuerst diese gespeicherte Session geöffnet und das Makro darin ausgeführt – unabhängig vom aktiven Pane. Der erste Schritt sollte auf den Prompt warten (Zeitlimit großzügig wählen, es läuft ab Verbindungsbeginn). Beim Autostart einer Session und bei Auto-Antworten läuft das Makro wie bisher im auslösenden Pane.'),
    h('div', { class: 'lbl-row' }, h('span', { class: 'lbl' }, 'Schritte'), h('span', { class: 'hint' }, 'Werden der Reihe nach ausgeführt. „Warten auf Ausgabe“ hält an, bis der Text im Terminal erscheint.')),
    list,
    h('div', { class: 'macro-add' },
      h('button', { class: 'btn small', type: 'button', onclick: () => add({ t: 'expect', pattern: '', regex: false, timeout: 15, onTimeout: 'abort' }) }, '+ Warten auf Ausgabe'),
      h('button', { class: 'btn small', type: 'button', onclick: () => add({ t: 'send', text: '', enter: true }) }, '+ Senden'),
      h('button', { class: 'btn small', type: 'button', onclick: () => add({ t: 'pause', ms: 1000 }) }, '+ Pause'),
      h('button', { class: 'btn small', type: 'button', title: 'Schleife mit einem Senden-Schritt anlegen; weitere Schritte mit ↑/↓ in die Schleife verschieben', onclick: () => {
        const n = macroLoopName(m.steps);
        m.steps.push({ t: 'loop', var: n, mode: 'num', values: '1-3' }, { t: 'send', text: `echo {{${n}}}`, enter: true }, { t: 'end' });
        render(); setTimeout(() => { const ins = $$('.macro-step.loop input.grow', list); ins.length && ins[ins.length - 1].focus(); }, 0);
      } }, '+ Schleife')),
    h('p', { class: 'hint' }, 'Escape-Zeichen beim Senden: \\r \\n \\t \\e (Esc) \\xHH (z.B. \\x03 = Ctrl+C). Variablen wie {{Benutzer}} oder {{Passwort}} werden beim Start abgefragt und nicht gespeichert.'),
    h('p', { class: 'hint' }, 'Schleifen: alle Schritte zwischen „Schleife“ und „Schleifenende“ laufen einmal je Wert, verschachteln ist möglich. Zahlen: 1,2,3 7-10 · 10-1 · 0-100/10 · 01-12 (mit Nullen). Texte: mit Komma getrennt, \\, für ein Komma im Wert. Im Rumpf {{Name}} = aktueller Wert, {{Name#}} = Durchlauf 1, 2, 3 … – auch in „Warten auf“. Die Werte dürfen selbst eine Variable enthalten (z.B. {{Ports}}), die beim Start abgefragt wird.'));
  const save = async () => {
    m.name = nameIn.value.trim() || 'Makro';
    m.confirm = confirmChk.querySelector('input').checked;
    if (m.confirm && confirmText.value.trim()) m.confirmText = confirmText.value.trim(); else delete m.confirmText;
    if (!m.confirm) delete m.confirm;
    if (connSel.value && termSessions.some(x => x.id === connSel.value)) { m.connectId = connSel.value; m.connectWhere = whereSel.value || 'tab'; }
    else if (connSel.value && connSel.value === m.connectId) { toast('Die gewählte Verbindung existiert nicht mehr – bitte eine andere wählen oder „keine“'); return false; }
    else { delete m.connectId; delete m.connectWhere; }
    const loopErr = validateLoops(m.steps);
    if (loopErr.length) { toast(loopErr[0], 4000); return false; }
    for (const [i, st] of m.steps.entries()) {
      if (st.t === 'expect' && !st.pattern) { toast(`Schritt ${i + 1}: Bitte einen Text angeben, auf den gewartet wird`); return false; }
      if (st.t === 'expect' && st.regex && !makeMatcher(substVars(st.pattern, {}, true), true)) { toast(`Schritt ${i + 1}: Ungültiger regulärer Ausdruck`); return false; }
    }
    const all = macroList().slice();
    const idx = all.findIndex(x => x.id === m.id);
    if (idx >= 0) all[idx] = m; else all.push(m);
    await saveMacros(all);
    toast(`Makro „${m.name}“ gespeichert`);
    onSaved && onSaved(m);
  };
  openModal({ title: isNew ? (recorded ? 'Aufgezeichnetes Makro speichern' : 'Neues Makro') : 'Makro bearbeiten', width: 820, body, buttons: [
    { label: recorded ? 'Verwerfen' : 'Abbrechen', click: () => { onSaved && onSaved(null); } },
    { label: 'Speichern & ausführen', click: async () => { if (await save() === false) return false; setTimeout(() => runMacro(m, macroTargets()), 50); } },
    { label: 'Speichern', cls: 'primary', click: save }
  ]});
}

function macroManager() {
  const box = h('div', { class: 'macro-manager' });
  let modal;
  const reopen = () => setTimeout(() => macroManager(), 60);
  const render = () => {
    box.textContent = '';
    const ms = macroList();
    if (!ms.length) box.appendChild(h('p', { class: 'hint' }, 'Noch keine Makros. Lege eines an oder zeichne eines auf (⇧⌘R in einem verbundenen Pane).'));
    for (const m of ms) {
      const auto = S.sessions.filter(s => s.macroId === m.id).length;
      box.appendChild(h('div', { class: 'macro-row' },
        h('span', { class: 'm-name' }, m.name),
        h('span', { class: 'm-sub' }, `${m.steps.length} Schritte${m.connectId ? ` · verbindet zu ${macroSession(m) ? sessionTitle(macroSession(m)) : '(fehlt)'}` : ''}${m.confirm ? ' · mit Bestätigung' : ''}${auto ? ` · Autostart in ${auto} Session${auto === 1 ? '' : 's'}` : ''}`),
        h('button', { class: 'btn small', onclick: () => { modal.close(); setTimeout(() => runMacro(m, macroTargets()), 40); } }, '▶ Ausführen'),
        h('button', { class: 'btn small', onclick: () => { modal.close(); setTimeout(() => macroEditor(m, { onSaved: reopen }), 40); } }, 'Bearbeiten'),
        h('button', { class: 'btn small', onclick: async () => { const c = clone(m); c.id = uid('mac'); c.name += ' (Kopie)'; await saveMacros([...macroList(), c]); render(); } }, 'Duplizieren'),
        h('button', { class: 'btn small', onclick: async () => {
          if (!(await confirmDialog('Makro löschen', `Makro „${m.name}“ wirklich löschen?`, 'Löschen'))) return;
          await saveMacros(macroList().filter(x => x.id !== m.id)); render();
        } }, 'Löschen')));
    }
  };
  render();
  modal = openModal({ title: 'Makros', width: 720, body: box, buttons: [
    { label: 'Auto-Antworten…', click: () => { setTimeout(() => triggerManager(), 40); } },
    { label: 'Aufzeichnen', click: () => { setTimeout(() => startRecording(), 40); } },
    { label: 'Neues Makro…', click: () => { setTimeout(() => macroEditor(null, { isNew: true, onSaved: reopen }), 40); } },
    { label: 'Schließen', cls: 'primary', click: () => {} }
  ]});
}

function triggerManager() {
  const list = clone(triggerList());
  const box = h('div', { class: 'macro-steps triggers' });
  const render = () => {
    box.textContent = '';
    if (!list.length) box.appendChild(h('div', { class: 'hint' }, 'Noch keine Auto-Antworten. Beispiel: Muster „--More--“ → Antwort „ “ (Leerzeichen, ohne Enter).'));
    list.forEach((t, i) => {
      const en = h('input', { type: 'checkbox', title: 'Aktiv', onchange: (e) => { t.enabled = e.target.checked; } }); en.checked = t.enabled !== false;
      const re = h('input', { type: 'checkbox', onchange: (e) => { t.regex = e.target.checked; } }); re.checked = !!t.regex;
      const ent = h('input', { type: 'checkbox', onchange: (e) => { t.enter = e.target.checked; } }); ent.checked = !!t.enter;
      const action = sel('runMacro', t.runMacro || '', [['', 'Text senden'], ...macroList().map(m => [m.id, 'Makro: ' + m.name])]);
      const resp = h('input', { class: 'grow mono', value: t.response || '', spellcheck: 'false', placeholder: 'Antwort, z.B. y  oder  \\x20', oninput: (e) => { t.response = e.target.value; } });
      action.addEventListener('change', () => { t.runMacro = action.value || undefined; resp.disabled = !!t.runMacro; });
      resp.disabled = !!t.runMacro;
      box.appendChild(h('div', { class: 'trigger-row' },
        h('div', { class: 'macro-step' }, en,
          h('input', { class: 'grow', value: t.pattern || '', spellcheck: 'false', placeholder: 'Wenn die Ausgabe enthält … z.B. (yes/no)?', oninput: (e) => { t.pattern = e.target.value; } }),
          h('label', { class: 'mini' }, re, 'Regex'),
          h('span', { class: 'mini' }, '→'), action, resp,
          h('label', { class: 'mini' }, ent, 'Enter'),
          h('button', { class: 'p-btn', type: 'button', title: 'Entfernen', onclick: () => { list.splice(i, 1); render(); } }, '×')),
        h('div', { class: 'macro-step sub' },
          h('span', { class: 'mini' }, 'Nur für Sessions:'),
          h('input', { class: 'grow', value: t.scope || '', spellcheck: 'false', placeholder: 'leer = alle · sonst Teil von Name/Host/Ordner, mehrere mit Komma', oninput: (e) => { t.scope = e.target.value; } }))));
    });
  };
  render();
  openModal({ title: 'Auto-Antworten', width: 860,
    body: h('div', null,
      h('p', { class: 'hint' }, 'Sobald ein Muster in der Ausgabe eines Panes erscheint, wird automatisch geantwortet. Das funktioniert dauerhaft in allen passenden Sessions, nicht nur während eines Makros. Zum Schutz vor Endlosschleifen wird eine Regel pausiert, wenn sie mehr als 25-mal in 10 Sekunden auslöst.'),
      box,
      h('div', { class: 'macro-add' }, h('button', { class: 'btn small', type: 'button', onclick: () => { list.push({ id: uid('trg'), pattern: '', response: '', enter: true, enabled: true }); render(); } }, '+ Auto-Antwort'))),
    buttons: [
      { label: 'Abbrechen', click: () => {} },
      { label: 'Speichern', cls: 'primary', click: async () => {
        for (const t of list) if (t.regex && t.pattern && !makeMatcher(t.pattern, true)) { toast(`Ungültiger regulärer Ausdruck: ${t.pattern}`); return false; }
        await saveTriggers(list.filter(t => t.pattern));
        for (const p of S.panes.values()) { p._trigState = {}; }
        toast('Auto-Antworten gespeichert');
      } }
    ] });
}
