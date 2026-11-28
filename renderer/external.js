'use strict';
/* global S, api, h, $, toast, openModal, field, inp, chk, clone, uid, activePane, createTab, splitPane, selectBroadcast, isActiveConnection,
   parseQuick, sessionTitle, sessionSubtitle, normFolder, inFolderTree, ROOT_FOLDER, FOLDER_SEP, macroList, macroVars, askVars, encodeEsc,
   stepSummary, saveSettings, TYPE_META, closePane, stripAnsi, SRV, Layout, Pane, renderTab, saveLayoutSoon, activateTab, setActivePane */
/*
 * Aufrufe von außen (Kommandozeile, Automator, Kurzbefehle, mact1000://-Links).
 * Der Hauptprozess liefert die ausgewerteten Argumente (src/launch.js); hier werden daraus Sessions,
 * Tabs/Panes und Befehlsfolgen. Befehle, Makros, eigene Shells und zusätzliche ssh-Argumente laufen
 * erst nach Rückfrage – außer der Aufruf wurde ausdrücklich als vertrauenswürdig gespeichert.
 */

const EXT_PROMPT = '[$#>%\\]]\\s*$';
const EXT = { chain: Promise.resolve(), handled: 0, last: null };
const SRC_LABEL = { cli: IS_WIN ? 'Kommandozeile / Verknüpfung' : 'Kommandozeile / Automator', url: 'Link (mact1000://)' };

/* ---------- Hilfen ---------- */
function extFindSessions(ref) {
  const n = String(ref || '').trim(); const low = n.toLowerCase();
  const full = (s) => { const f = normFolder(s.folder); return (f && f !== ROOT_FOLDER ? f + FOLDER_SEP : '') + sessionTitle(s); };
  for (const test of [(s) => s.id === n, (s) => full(s) === n, (s) => full(s).toLowerCase() === low, (s) => sessionTitle(s).toLowerCase() === low]) {
    const m = S.sessions.filter(test);
    if (m.length) return m;
  }
  return [];
}
function extFolderSessions(ref) {
  const f = normFolder(ref).toLowerCase();
  return S.sessions.filter(s => { const sf = normFolder(s.folder).toLowerCase(); return sf && inFolderTree(sf, f); });
}
function extFindMacro(name) {
  const n = String(name || '').trim(); const low = n.toLowerCase();
  return macroList().find(m => m.id === n) || macroList().find(m => m.name === n) || macroList().find(m => String(m.name).toLowerCase() === low) || null;
}
const extSafeTarget = (v) => /^[^\s-][^\s]*$/.test(v);

// Einen Auftrag in Session-Konfigurationen übersetzen
function extResolve(r) {
  const out = { r, cfgs: [], problems: [], warn: [], label: '' };
  const k = r.kind;
  let cfg = null;
  if (k === 'local') {
    cfg = { type: 'local' };
    if (r.cwd) cfg.cwd = r.cwd;
    if (r.shell) { cfg.shell = r.shell; out.warn.push(`eigene Shell: ${r.shell}`); }
    out.label = 'Lokale Shell' + (r.cwd ? ` in ${r.cwd}` : '');
  } else if (['ssh', 'telnet', 'rdp', 'serial'].includes(k)) {
    if (!extSafeTarget(r.value)) out.problems.push(`--${k}: „${r.value}“ ist kein gültiges Ziel (für zusätzliche Optionen --connect verwenden)`);
    else {
      let line = `${k} ${r.value}`;
      if (k === 'serial') { const m = /^(.+?)(?:[:@](\d+))?$/.exec(r.value); line = `serial ${m[1]} ${m[2] || ''}`.trim(); }
      cfg = parseQuick(line);
      if (!cfg || (k !== 'serial' && !cfg.host)) out.problems.push(`--${k}: „${r.value}“ nicht erkannt`);
    }
  } else if (k === 'connect') {
    cfg = parseQuick(r.value);
    if (!cfg) out.problems.push(`--connect: „${r.value}“ nicht erkannt (Schreibweise wie im Quick-Connect-Feld)`);
  } else if (k === 'session') {
    const m = extFindSessions(r.value);
    if (!m.length) out.problems.push(`Gespeicherte Session „${r.value}“ nicht gefunden`);
    else if (m.length > 1) out.problems.push(`Session „${r.value}“ ist mehrdeutig (${m.slice(0, 5).map(s => (s.folder ? normFolder(s.folder) + '/' : '') + sessionTitle(s)).join(', ')}) – bitte mit Ordner angeben, z. B. „Ordner/Name“`);
    else { cfg = clone(m[0]); out.label = `Session ${(cfg.folder ? normFolder(cfg.folder) + '/' : '') + sessionTitle(cfg)} (${sessionSubtitle(cfg) || TYPE_META[cfg.type].label})`; }
  } else if (k === 'folder') {
    const list = extFolderSessions(r.value);
    if (!list.length) out.problems.push(`Ordner „${r.value}“ nicht gefunden oder leer`);
    out.cfgs = list.map(clone);
    out.label = `Ordner ${r.value}: ${list.length} Session${list.length === 1 ? '' : 's'}` + (list.length ? ` (${list.slice(0, 6).map(sessionTitle).join(', ')}${list.length > 6 ? ', …' : ''})` : '');
  }
  if (cfg) {
    out.cfgs = [cfg];
    if (!out.label) out.label = `${TYPE_META[cfg.type] ? TYPE_META[cfg.type].label : cfg.type} ${sessionSubtitle(cfg) || ''}`.trim();
  }
  for (const c of out.cfgs) {
    if (r.title && out.cfgs.length === 1) c.name = r.title;
    if (c.extraArgs && (k === 'connect')) out.warn.push(`zusätzliche ssh-Argumente: ${c.extraArgs}`);
  }
  if ((r.run.length || r.macro) && out.cfgs.some(c => c.type === 'rdp')) out.problems.push('RDP-Verbindungen können keine Befehle oder Makros ausführen');
  if (r.macro) {
    out.macro = extFindMacro(r.macro);
    if (!out.macro) out.problems.push(`Makro „${r.macro}“ nicht gefunden`);
  }
  const wantsClose = r.close !== undefined && r.close !== null;
  if ((wantsClose || r.log) && out.cfgs.some(c => c.type === 'rdp')) out.problems.push('RDP-Verbindungen laufen in einem eigenen Programm – --close und --log sind dort nicht möglich');
  if (r.share) {
    if (!S.settings.shareAllow) out.problems.push('--share: Freigaben sind auf diesem Rechner nicht erlaubt (Einstellungen → Freigaben). Ein Aufruf von außen schaltet das nicht selbst ein.');
    if (r.shareConfirm === false && !S.settings.shareExtNoConfirm) out.problems.push('--share-confirm nein: Freigaben ohne Rückfrage sind auf diesem Rechner nicht erlaubt (Einstellungen → Freigaben → „Aufrufe von außen dürfen ohne Rückfrage freigeben“).');
    const bad = out.cfgs.find(c => !SHAREABLE.includes(c.type));
    if (bad) out.problems.push(`--share: ${TYPE_META[bad.type] ? TYPE_META[bad.type].label : bad.type}-Sessions lassen sich nicht freigeben`);
  }
  if (r.prompt) { try { new RegExp(r.prompt); } catch (_) { out.problems.push(`--prompt: ungültiger regulärer Ausdruck „${r.prompt}“`); } }
  return out;
}

// Befehle (+ Makro) als Ablauf: auf Prompt warten → Befehl senden
const EXT_CLOSE_WAIT = 600; // so lange höchstens auf den Prompt nach dem letzten Befehl warten (Sekunden)
const extHasClose = (r) => r.close !== undefined && r.close !== null;
function extBuildMacro(res) {
  const r = res.r;
  const close = extHasClose(r);
  if (!r.run.length && !res.macro && !close) return null;
  const steps = [];
  for (const c of r.run) {
    steps.push({ t: 'expect', pattern: r.prompt || EXT_PROMPT, regex: true, timeout: 20, onTimeout: 'continue' });
    steps.push({ t: 'send', text: encodeEsc(c), enter: true });
  }
  if (res.macro) steps.push(...clone(res.macro.steps || []));
  if (close) {
    // nach dem letzten Befehl (bzw. ohne Befehle: nach der Anmeldung) auf den Prompt warten, dann Ruhe abwarten und schließen
    steps.push({ t: 'expect', pattern: r.prompt || EXT_PROMPT, regex: true, timeout: EXT_CLOSE_WAIT, onTimeout: 'continue' });
    steps.push({ t: 'close', ms: Math.round(Number(r.close) * 1000) });
  }
  return { id: uid('ext'), name: res.macro ? res.macro.name : 'Aufruf von außen', steps, notify: close ? false : undefined };
}

/* ---------- --log / --close / --quit ---------- */
function extLogStart(pane, file) {
  const L = pane._log = { file, path: null, buf: '', timer: null, failed: false };
  const head = `\n===== MacT-1000 ${new Date().toLocaleString(LOC())} · ${sessionTitle(pane.cfg) || pane.cfg.type} =====\n`;
  api.ext.logOpen(file, head).then((p) => { L.path = p; extLogFlush(pane, L); })
    .catch((e) => { L.failed = true; L.buf = ''; toast(`Protokoll ${file} nicht möglich: ` + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 6000); });
}
function extLogData(pane, data) {
  const L = pane._log;
  if (!L || L.failed) return;
  L.buf += stripAnsi(data).replace(/\r\n/g, '\n').replace(/\r/g, '');
  if (L.buf.length > 4000000) L.buf = L.buf.slice(-4000000);
  if (L.path && !L.timer) L.timer = setTimeout(() => { L.timer = null; extLogFlush(pane, L); }, 300);
}
function extLogFlush(pane, L) {
  if (!L.path || !L.buf) return;
  api.ext.logWrite(L.path, L.buf); L.buf = '';
}
function extLogEnd(pane) {
  const L = pane._log;
  if (!L) return;
  pane._log = null;
  clearTimeout(L.timer);
  if (L.path) extLogFlush(pane, L);
  else if (!L.failed) { // Datei noch nicht offen: Rest nachreichen, sobald sie es ist
    const rest = L.buf;
    api.ext.logOpen(L.file, '').then((p) => { if (rest) api.ext.logWrite(p, rest); }).catch(() => {});
  }
}
function extClosePane(pane) {
  if (!pane || !S.panes.has(pane.id)) return;
  const quit = !!(pane._ext && pane._ext.quit);
  extLogEnd(pane);
  closePane(pane);
  if (quit) setTimeout(extMaybeQuit, 400);
}
const extBusy = (p) => p.state === 'running' || p.state === 'connecting';
function extMaybeQuit() {
  const busy = [...S.panes.values()].filter(extBusy);
  if (busy.some(p => p._ext && p._ext.quit)) return; // der letzte Pane dieses Aufrufs beendet dann
  const servers = typeof SRV !== 'undefined' && SRV.st ? Object.values(SRV.st).some(x => x && x.running) : false;
  if (busy.length || servers) { toast('MacT-1000 bleibt geöffnet – es laufen noch andere Sessions oder Server.', 5000); return; }
  api.ext.quit();
}

const extNeedsConfirm = (res) => res.r.run.length > 0 || !!res.macro || res.warn.length > 0 || !!res.r.log || (!!res.r.share && res.r.shareConfirm !== false);

async function extFingerprint(batch) {
  const norm = { r: batch.requests.map(r => ({ k: r.kind, v: r.value, run: r.run, m: r.macro || '', vars: r.vars, s: r.split || '', cwd: r.cwd || '', sh: r.shell || '', t: r.title || '', p: r.prompt || '', c: extHasClose(r) ? Number(r.close) : null, l: r.log || '',
    // Platz-Angaben nur, wenn vorhanden – so bleiben vor 1.5.22 gespeicherte vertraute Aufrufe gültig
    ...(r.layout || r.slot ? { ly: r.layout || '', sl: r.slot || '', g: r.grid || '', bz: r.busy || '' } : {}),
    // Freigabe nur, wenn angegeben – ältere vertraute Aufrufe bleiben gültig
    ...(r.share ? { sh: [r.shareMode || 'ro', r.sharePassword || '', r.shareName || '', r.shareExpires ?? '', r.shareInfo || ''] } : {}),
    ...(r.share && r.shareConfirm === false ? { nc: 1 } : {}) })),
    tile: !!batch.tile, multi: !!batch.multi, tabs: !!batch.tabs, quit: !!batch.quit };
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(norm)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const extTrusted = () => (Array.isArray(S.settings.extTrusted) ? S.settings.extTrusted : []);

/* ---------- Rückfrage ---------- */
function extConfirm(batch, resolved) {
  return new Promise((resolve) => {
    let ok = false;
    const trust = h('input', { type: 'checkbox', id: 'ext-trust' });
    const items = resolved.map((res) => {
      return h('div', { class: 'ext-item' },
        h('div', { class: 'ext-target' }, res.label + (res.r.split === 'row' ? ' · nebeneinander' : res.r.split === 'column' ? ' · untereinander' : '') + extSlotLabel(res.r)),
        res.warn.map(w => h('div', { class: 'ext-warn' }, 'Achtung: ' + w)),
        res.r.run.length ? h('pre', { class: 'ext-cmds' }, res.r.run.join('\n')) : null,
        res.macro ? h('div', { class: 'ext-macro' }, `Makro „${res.macro.name}“: ` + (res.macro.steps || []).slice(0, 8).map(stepSummary).join(' → ') + ((res.macro.steps || []).length > 8 ? ' → …' : '')) : null,
        res.r.log ? h('div', { class: 'ext-warn' }, `Ausgabe wird an die Datei ${res.r.log} angehängt`) : null,
        res.r.share ? extShareLines(res) : null,
        extHasClose(res.r) ? h('div', { class: 'hint' }, `Danach schließen, sobald ${res.r.close} s keine Ausgabe mehr kommt` + (batch.quit ? ' – anschließend MacT-1000 beenden, wenn keine anderen Sessions laufen' : '')) : null,
        Object.keys(res.r.vars).length ? h('div', { class: 'hint' }, 'Eingaben: ' + Object.entries(res.r.vars).map(([k, v]) => `${k}=${/pass|kennwort|secret|pin|token/i.test(k) ? '•••' : v}`).join(', ')) : null);
    });
    openModal({ title: 'Aufruf von außen bestätigen', width: 620,
      body: h('div', { class: 'ext-confirm' },
        h('p', null, `Ein anderes Programm (${SRC_LABEL[batch.source] || batch.source}) möchte in MacT-1000 Folgendes ausführen:`),
        items,
        batch.multi ? h('p', { class: 'hint' }, 'Danach wird Multi-Input für den Tab eingeschaltet.') : null,
        h('label', { class: 'chk' }, trust, ' Genau diesen Aufruf künftig ohne Rückfrage ausführen'),
        h('p', { class: 'hint' }, IS_WIN ? 'Nur bestätigen, wenn der Aufruf von dir stammt (z. B. aus deiner Verknüpfung oder Batch-Datei). Vertraute Aufrufe lassen sich unter Hilfe → Aufruf von außen… wieder entfernen.' : 'Nur bestätigen, wenn der Aufruf von dir stammt (z. B. aus deinem Automator-Ablauf). Vertraute Aufrufe lassen sich unter MacT-1000 → Aufruf von außen… wieder entfernen.')),
      buttons: [
        { label: 'Abbrechen', click: () => {} },
        { label: 'Ausführen', cls: 'primary', click: () => { ok = true; } }],
      onClose: () => resolve({ ok, trust: ok && trust.checked }) });
  });
}

// Rückfrage: was bei --share passiert
function extShareLabel(r) {
  const mode = tx(shareModeLabel(r.shareMode || 'ro'));
  const exp = r.shareExpires ? tx(`gültig ${r.shareExpires} Minuten`) : tx('bis zum Beenden');
  return tx(`Wird freigegeben (${mode}, ${exp})`);
}
function extShareLines(res) {
  const r = res.r;
  const local = res.cfgs.some(c => c.type === 'local');
  return h('div', null,
    h('div', { class: 'ext-warn' }, extShareLabel(r) + (r.shareName ? ' ' + tx(`als „${r.shareName}“`) : '')),
    h('div', { class: 'hint' }, r.sharePassword ? 'Passwort ist im Aufruf vorgegeben.' : 'Passwort wird automatisch erzeugt und in die Zwischenablage kopiert.'),
    r.shareInfo ? h('div', { class: 'hint' }, tx(`Adresse, Passwort und Fingerprint werden in ${r.shareInfo} geschrieben.`)) : null,
    r.shareConfirm === false ? h('div', { class: 'hint' }, 'Weitere Rückfragen zur Freigabe entfallen (--share-confirm nein).') : null,
    local && (r.shareMode || 'ro') !== 'ro' ? h('div', { class: 'ext-warn' }, 'Achtung: Zuschauer mit Schreibrecht arbeiten in einer Shell auf diesem Rechner – mit deinen Rechten.') : null);
}

function extErrors(batch, list) {
  openModal({ title: 'Aufruf von außen nicht ausgeführt', width: 560,
    body: h('div', null, h('p', null, `Aufruf über ${SRC_LABEL[batch.source] || batch.source}:`), h('ul', { class: 'ext-errors' }, list.map(e => h('li', null, e))),
      h('p', { class: 'hint' }, IS_WIN ? 'Es wurde nichts geöffnet. Hilfe: Hilfe → Aufruf von außen… oder MacT-1000.exe --help' : 'Es wurde nichts geöffnet. Hilfe: MacT-1000 → Aufruf von außen… oder mact1000 --help')),
    buttons: [{ label: 'Hilfe', click: () => { setTimeout(extHelpDialog, 30); } }, { label: 'OK', cls: 'primary', click: () => true }] });
}

/* ---------- Feste Plätze (--layout / --slot) ---------- */
const EXT_GRIDS = {
  '2h': { label: 'oben/unten', slots: ['oben', 'unten'], pos: [[0, 0], [1, 0]] },
  '2v': { label: 'links/rechts', slots: ['links', 'rechts'], pos: [[0, 0], [0, 1]] },
  '4': { label: '2×2', slots: ['oben-links', 'oben-rechts', 'unten-links', 'unten-rechts'], pos: [[0, 0], [0, 1], [1, 0], [1, 1]] }
};
const EXT_DEFAULT_LAYOUT = 'Aufrufe';
function extSlotLabel(r) {
  if (!r.slot) return '';
  return ` · Layout „${r.layout}“ · ${r.slot === 'next' ? 'nächster freier Platz' : 'Platz ' + r.slot}`;
}
// Einstellung „Aufrufe ohne Platzangabe verteilen“
function extApplyDistribute(batch) {
  const g = S.settings.extDistribute;
  if (!EXT_GRIDS[g] || batch.tile) return;
  for (const r of batch.requests) {
    if (r.kind === 'folder' || r.split || r.slot || r.layout) continue;
    r.layout = EXT_DEFAULT_LAYOUT; r.slot = 'next'; r.grid = g;
  }
}
const extFindLayoutTab = (name) => S.tabs.find(t => t.extLayout && t.extLayout.name.toLowerCase() === String(name).toLowerCase()) || null;
const extSlotPanes = (tab) => Layout.leaves(tab.root).map(id => S.panes.get(id)).filter(p => p && p.slot && p.slotTab === tab.id);
const extSlotFree = (p) => p.state === 'launcher' || p.state === 'exited';
function extSlotIndex(grid, slot) {
  const g = EXT_GRIDS[grid];
  if (/^[1-4]$/.test(slot)) { const i = Number(slot) - 1; return i < g.slots.length ? i : -1; }
  return g.slots.indexOf(slot);
}
function extMarkSlot(p, tab, slot) { p.slot = slot; p.slotTab = tab.id; if (p.state === 'launcher') p.showLauncher(); else p.updateHeader(); }

// Neuen Layout-Tab mit leeren Plätzen anlegen
function extCreateLayoutTab(name, grid) {
  const g = EXT_GRIDS[grid];
  const tab = createTab(null);
  const panes = [S.panes.get(Layout.leaves(tab.root)[0])];
  while (panes.length < g.slots.length) panes.push(new Pane(tab, null));
  const ids = panes.map(p => p.id);
  tab.root = grid === '2h' ? { type: 'split', dir: 'column', ratio: 0.5, a: Layout.leaf(ids[0]), b: Layout.leaf(ids[1]) }
    : grid === '2v' ? { type: 'split', dir: 'row', ratio: 0.5, a: Layout.leaf(ids[0]), b: Layout.leaf(ids[1]) }
      : Layout.grid(ids);
  tab.extLayout = { name, grid };
  tab.customTitle = name;
  panes.forEach((p, i) => extMarkSlot(p, tab, g.slots[i]));
  tab.activePaneId = ids[0];
  renderTab(tab);
  saveLayoutSoon();
  return tab;
}

// Geschlossenen Platz wieder einfügen – neben einem Nachbarn in derselben Zeile bzw. Spalte
function extRecreateSlot(tab, idx) {
  const g = EXT_GRIDS[tab.extLayout.grid];
  const [r, c] = g.pos[idx];
  const have = extSlotPanes(tab).map(p => ({ p, pos: g.pos[g.slots.indexOf(p.slot)] })).filter(x => x.pos);
  const row = have.find(x => x.pos[0] === r);
  const col = have.find(x => x.pos[1] === c);
  const any = have[0];
  let np;
  if (row) np = splitPane(row.p, 'row', null, c < row.pos[1]);
  else if (col) np = splitPane(col.p, 'column', null, r < col.pos[0]);
  else if (any) np = splitPane(any.p, 'column', null, r < any.pos[0]);
  else np = splitPane(S.panes.get(tab.activePaneId) || S.panes.get(Layout.leaves(tab.root)[0]), tab.extLayout.grid === '2v' ? 'row' : 'column', null, idx === 0);
  if (np) extMarkSlot(np, tab, g.slots[idx]);
  return np;
}

// Rückfrage bei belegtem Platz: 'ersetzen' | 'neu' | 'abbrechen'
function extAskBusy(tab, p, cfg) {
  return new Promise((resolve) => {
    let ans = 'abbrechen';
    openModal({ title: 'Platz ist belegt', width: 520,
      body: h('div', null,
        h('p', { class: 'confirm-text' }, `Platz „${p.slot}“ im Layout „${tab.extLayout.name}“ ist belegt: ${p.title}${p.state === 'connecting' ? ' (verbindet gerade)' : ''}.`),
        h('p', { class: 'confirm-text' }, `Neuer Aufruf: ${sessionTitle(cfg) || TYPE_META[cfg.type].label}`),
        h('p', { class: 'hint' }, '„Ersetzen“ beendet die bisherige Session in diesem Platz. „Zusätzlich teilen“ teilt den Platz und lässt die bisherige Session weiterlaufen. Mit --busy ersetzen|neu|abbrechen entfällt diese Frage.')),
      buttons: [
        { label: 'Abbrechen', click: () => {} },
        { label: 'Zusätzlich teilen', click: () => { ans = 'neu'; } },
        { label: 'Ersetzen', cls: 'primary', click: () => { ans = 'ersetzen'; } }],
      onClose: () => resolve(ans) });
  });
}

function extStartIn(p, cfg) {
  if (p.state === 'exited' && p.term) p.term.write(tx('\r\n\x1b[90m── Neuer Aufruf von außen ──\x1b[0m\r\n'));
  p.start(cfg);
  if (p.tab && p.tab.id === S.activeTabId) setActivePane(p);
  else if (p.tab) { p.tab.activePaneId = p.id; }
}

/** Auftrag mit --slot in seinen Platz bringen; liefert den Tab (oder null, wenn nichts geöffnet wurde) */
async function extPlaceInSlot(r, cfg) {
  let tab = extFindLayoutTab(r.layout);
  if (!tab) tab = extCreateLayoutTab(r.layout, EXT_GRIDS[r.grid] ? r.grid : (EXT_GRIDS[S.settings.extDistribute] ? S.settings.extDistribute : '2h'));
  const grid = tab.extLayout.grid; const g = EXT_GRIDS[grid];
  if (tab.zoomed) { tab.zoomed = null; renderTab(tab); }
  const panes = extSlotPanes(tab);
  const bySlot = (s) => panes.find(p => p.slot === s) || null;
  let idx;
  if (r.slot === 'next') {
    idx = g.slots.findIndex(s => bySlot(s) && bySlot(s).state === 'launcher');
    if (idx < 0) idx = g.slots.findIndex(s => bySlot(s) && bySlot(s).state === 'exited');
    if (idx < 0) idx = g.slots.findIndex(s => !bySlot(s));
    if (idx < 0) {
      toast(`Alle Plätze im Layout „${tab.extLayout.name}“ sind belegt – der Aufruf öffnet einen neuen Tab.`, 5000);
      return createTab(cfg);
    }
  } else {
    idx = extSlotIndex(grid, r.slot);
    if (idx < 0) { toast(`Platz „${r.slot}“ gibt es im Layout „${tab.extLayout.name}“ (${g.label}) nicht – Aufruf übersprungen.`, 6000); return null; }
  }
  const slot = g.slots[idx];
  let p = bySlot(slot);
  if (!p) p = extRecreateSlot(tab, idx);
  if (!p) return null;
  if (!extSlotFree(p)) {
    const what = r.busy && r.busy !== 'fragen' ? r.busy : await extAskBusy(tab, p, cfg);
    if (!S.panes.has(p.id)) { p = extRecreateSlot(tab, idx); if (!p) return null; } // inzwischen geschlossen
    else if (extSlotFree(p)) { /* inzwischen frei geworden */ }
    else if (what === 'abbrechen') { toast(`Platz „${slot}“ im Layout „${tab.extLayout.name}“ ist belegt – Aufruf übersprungen.`, 5000); return null; }
    else if (what === 'neu') {
      const rect = p.el.getBoundingClientRect();
      const dir = grid === '2h' ? 'column' : grid === '2v' ? 'row' : (rect.width / 2.1 > rect.height ? 'row' : 'column');
      const np = splitPane(p, dir, cfg);
      return np ? np.tab : tab;
    }
  }
  extStartIn(p, cfg);
  return tab;
}

/* ---------- Ausführen ---------- */
async function extOpen(batch, resolved) {
  extApplyDistribute(batch);
  const prepared = [];
  for (const res of resolved) {
    const mac = extBuildMacro(res);
    const ext = (extHasClose(res.r) || res.r.log) ? { close: extHasClose(res.r) ? Number(res.r.close) : null, quit: !!batch.quit, log: res.r.log || '' } : null;
    const sh = res.r.share ? { noConfirm: res.r.shareConfirm === false, mode: res.r.shareMode || 'ro', password: res.r.sharePassword || '', name: res.r.shareName || res.r.title || '', expiresIn: Number(res.r.shareExpires) || 0, info: res.r.shareInfo || '', source: batch.source } : null;
    for (const c of res.cfgs) {
      if (sh) c._share = { ...sh };
      if (mac) { delete c.macroId; c._pendingMacro = { macro: clone(mac), vars: { ...res.vars } }; }
      if (ext) c._ext = { ...ext };
    }
    prepared.push(res);
  }
  const all = prepared.flatMap(p => p.cfgs);
  let lastTab = null;
  if (batch.tile && all.length > 1) lastTab = createTab(all);
  else {
    for (const res of prepared) {
      if (res.r.kind === 'folder') {
        if (batch.tabs) for (const c of res.cfgs) lastTab = createTab(c);
        else lastTab = createTab(res.cfgs.length === 1 ? res.cfgs[0] : res.cfgs);
        continue;
      }
      const c = res.cfgs[0];
      if (res.r.slot) { const t = await extPlaceInSlot(res.r, c); if (t) lastTab = t; continue; }
      const where = res.r.split || 'tab';
      const p = activePane();
      if ((where === 'row' || where === 'column') && p) { const np = splitPane(p, where, c); lastTab = np ? np.tab : lastTab; }
      else if (where === 'here' && p && !isActiveConnection(p)) { p.start(c); lastTab = p.tab; }
      else lastTab = createTab(c);
    }
  }
  if (lastTab && S.tabs.includes(lastTab) && lastTab.id !== S.activeTabId) activateTab(lastTab.id);
  if (batch.multi) setTimeout(() => selectBroadcast('tab'), 300);
  return lastTab;
}

async function extHandle(batch) {
  if (!batch) return;
  EXT.last = { at: Date.now(), batch, result: 'läuft' };
  const done = (result) => { EXT.handled++; EXT.last.result = result; };
  if (S.settings.extAllow === false) { toast('Aufrufe von außen sind in den Einstellungen abgeschaltet.', 4000); return done('abgeschaltet'); }
  if (batch.help) { extHelpDialog(); if (!batch.requests.length && !batch.errors.length) return done('hilfe'); }
  if (batch.errors.length) { extErrors(batch, batch.errors); return done('fehler'); }
  if (!batch.requests.length) return done('leer');
  if (batch.quit) for (const r of batch.requests) if (!extHasClose(r) && r.kind !== 'rdp') r.close = 3; // --quit schließt alle Ziele
  const resolved = batch.requests.map(extResolve);
  const problems = resolved.flatMap(x => x.problems);
  if (problems.length) { extErrors(batch, problems); return done('fehler'); }
  // fehlende Makro-Eingaben abfragen
  for (const res of resolved) {
    res.vars = { ...res.r.vars };
    if (!res.macro) continue;
    const missing = macroVars(res.macro).filter(n => !(n in res.vars));
    if (missing.length) {
      const got = await askVars({ name: res.macro.name, steps: [{ t: 'send', text: missing.map(n => `{{${n}}}`).join(' ') }] }, res.label);
      if (got === null) return done('abgebrochen');
      Object.assign(res.vars, got);
    }
  }
  if (resolved.some(extNeedsConfirm)) {
    const fp = await extFingerprint(batch);
    if (!extTrusted().some(t => t.h === fp)) {
      const a = await extConfirm(batch, resolved);
      if (!a.ok) return done('abgebrochen');
      if (a.trust) {
        const label = batch.requests.map(r => require_describe(r) + (r.run.length ? ` · ${r.run.length} Befehl${r.run.length > 1 ? 'e' : ''}` : '') + (r.macro ? ` · Makro ${r.macro}` : '')).join(' + ');
        await saveSettings({ extTrusted: [...extTrusted().filter(t => t.h !== fp), { h: fp, label, at: new Date().toISOString(), cmds: batch.requests.flatMap(r => r.run).slice(0, 10) }].slice(-100) });
      }
    }
  }
  // lokale Shell mit Schreibrecht: immer ausdrücklich bestätigen, auch bei vertrauten Aufrufen
  for (const res of resolved) {
    if (!res.r.share || (res.r.shareMode || 'ro') === 'ro' || !res.cfgs.some(c => c.type === 'local')) continue;
    if (res.r.shareConfirm === false) continue; // ausdrücklich erlaubt (Einstellung + --share-confirm nein, nur Kommandozeile)
    const ok = await confirmDialog('Schreibrecht auf die lokale Shell', 'Ein Aufruf von außen möchte eine lokale Shell dieses Rechners mit Schreibrecht freigeben. Zuschauer können damit Befehle mit deinen Rechten ausführen. Trotzdem freigeben?', 'Freigeben');
    if (!ok) return done('abgebrochen');
  }
  await extOpen(batch, resolved);
  done('ok');
}
function require_describe(r) {
  const k = { local: 'Lokale Shell', ssh: 'SSH', telnet: 'Telnet', serial: 'Seriell', rdp: 'RDP', session: 'Session', folder: 'Ordner', connect: 'Verbindung' }[r.kind] || r.kind;
  return k + (r.value ? ' ' + r.value : '');
}

function extQueue(batch) { EXT.chain = EXT.chain.then(() => extHandle(batch)).catch((e) => { console.warn('Aufruf von außen', e); }); return EXT.chain; }

/* ---------- Hilfe ---------- */
const EXT_EXAMPLES = [
  ['Lokale Shell mit Befehlen', ['--local', '--run', IS_WIN ? 'cd ~\\Projekte' : 'cd ~/Projekte', '--run', 'git status']],
  ['Lokale Shell in einem Ordner', ['--local', '--cwd', '~/Downloads']],
  ['SSH mit Befehl, nebeneinander', ['--ssh', 'admin@10.0.0.1', '--run', 'show version', '--split', 'right']],
  ['Gespeicherte Session + Makro', ['--session', 'Rechenzentrum/core-sw01', '--macro', 'Backup', '--var', 'ziel=10.0.0.5']],
  ['Ganzen Ordner als Kacheln + Multi-Input', ['--folder', 'Rechenzentrum', '--multi']],
  ['Seriell mit 115200 Baud', ['--serial', IS_WIN ? 'COM3:115200' : '/dev/cu.usbserial-1410:115200']],
  ['Zwei Ziele in einem Tab', ['--ssh', 'admin@10.0.0.1', '--ssh', 'admin@10.0.0.2', '--tile']],
  ['Befehl, Ausgabe in Datei, danach schließen', ['--ssh', 'admin@10.0.0.1', '--run', 'show running-config', '--log', IS_WIN ? '~\\Logs\\core-sw01.log' : '~/Logs/core-sw01.log', '--close', '3']],
  ['Ausführen und MacT-1000 danach beenden', ['--local', '--run', IS_WIN ? 'ipconfig' : 'brew update', '--quit']],
  ['Erster Aufruf: oben im Layout „core“', ['--ssh', 'admin@10.0.0.1', '--layout', 'core', '--slot', 'oben']],
  ['Zweiter Aufruf: unten im selben Layout', ['--ssh', 'admin@10.0.0.2', '--layout', 'core', '--slot', 'unten']],
  ['Nächster freier Platz in einem 2×2-Layout', ['--ssh', 'admin@10.0.0.3', '--layout', 'lab', '--grid', '4', '--slot', 'next', '--busy', 'neu']]
];
function extCopy(text) { navigator.clipboard.writeText(text).then(() => toast('Kopiert')).catch(() => toast('Kopieren nicht möglich')); }
const shqMac = (s) => /^[A-Za-z0-9_@%+=:,./~-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;
// Windows (cmd/Verknüpfung): doppelte Anführungszeichen
const shq = (s) => !IS_WIN ? shqMac(s) : (/^[A-Za-z0-9_@%+=:,./\\~-]+$/.test(s) ? s : `"${String(s).replace(/"/g, '\\"')}"`);
function extToUrl(args) {
  // einfache Übersetzung für die Beispiele (ein Ziel)
  const p = new URLSearchParams(); let kind = 'local', value = '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i].slice(2);
    if (['local'].includes(a)) { kind = a; continue; }
    if (['ssh', 'telnet', 'serial', 'rdp', 'session', 'folder', 'connect'].includes(a)) { kind = a; value = args[++i]; continue; }
    if (['multi', 'tile', 'tabs', 'quit'].includes(a)) { p.append(a, '1'); continue; }
    p.append(a, args[++i]);
  }
  const v = value ? '/' + value.split('/').map(encodeURIComponent).join('/').replace(/%40/g, '@').replace(/%3A/gi, ':') : '';
  const qs = p.toString().replace(/\+/g, '%20');
  return `mact1000://${kind}${v}${qs ? '?' + qs : ''}`;
}

async function extHelpDialog() {
  let info = {};
  try { info = await api.ext.info(); } catch (_) {}
  const cli = info.win ? `"${info.packaged ? info.exe : 'C:\\Tools\\MacT-1000.exe'}"` : info.installed ? 'mact1000' : (info.bundle ? `"${info.bundle}/Contents/Resources/bin/mact1000"` : 'mact1000');
  const statusRow = info.win ? h('div', { class: 'ext-cli' },
    h('div', null, info.installed ? 'mact1000://-Links öffnen diese EXE.' : info.packaged ? 'mact1000://-Links sind für diese EXE noch nicht eingerichtet.' : 'Links lassen sich nur in der fertigen EXE einrichten.'),
    info.packaged ? h('button', { class: 'btn small', type: 'button', onclick: async (e) => {
      e.target.disabled = true;
      try {
        if (info.installed) { await api.ext.uninstallCli(); toast('Links-Registrierung entfernt'); }
        else { await api.ext.installCli(); toast('mact1000://-Links eingerichtet (nur für dieses Benutzerkonto)'); }
        m.close(); setTimeout(extHelpDialog, 50);
      } catch (err) { e.target.disabled = false; toast('Nicht möglich: ' + String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 6000); }
    } }, info.installed ? 'Registrierung entfernen' : 'Links für diese EXE einrichten') : null) : h('div', { class: 'ext-cli' },
    h('div', null, info.installed ? `Befehl „mact1000“ ist installiert (${info.link}).`
      : info.linkedElsewhere ? `${info.link} zeigt auf eine andere MacT-1000-Installation.` : 'Der Befehl „mact1000“ ist noch nicht im Terminal verfügbar.'),
    !info.installed ? h('button', { class: 'btn small', type: 'button', onclick: async (e) => {
      e.target.disabled = true;
      try { await api.ext.installCli(); toast('mact1000 installiert (/usr/local/bin)'); m.close(); setTimeout(extHelpDialog, 50); }
      catch (err) { e.target.disabled = false; toast('Installation fehlgeschlagen: ' + String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 6000); }
    } }, 'Befehl „mact1000“ installieren…') : null);
  const EN_ARGS = { oben: 'top', unten: 'bottom', neu: 'new', Projekte: 'Projects' };
  const rows = EXT_EXAMPLES.map(([title, args0]) => {
    const args = IS_EN() ? args0.map(a => EN_ARGS[a] || a.replace('Projekte', 'Projects')) : args0;
    const line = `${cli} ` + args.map(shq).join(' ');
    const url = extToUrl(args);
    const single = args.filter(a => ['--local', '--ssh', '--telnet', '--serial', '--rdp', '--session', '--folder', '--connect'].includes(a)).length <= 1;
    return h('tr', null, h('td', null, title),
      h('td', null, h('code', { class: 'ext-code' }, line), single ? h('code', { class: 'ext-code ext-url' }, url) : null),
      h('td', { class: 'ext-copy' }, h('button', { class: 'btn small', type: 'button', onclick: () => extCopy(line) }, 'Befehl'),
        single ? h('button', { class: 'btn small', type: 'button', onclick: () => extCopy(url) }, 'Link') : null));
  });
  const trusted = extTrusted();
  const trustBox = h('div', { class: 'ext-trusted' },
    trusted.length ? trusted.slice().reverse().map(t => h('div', { class: 'ext-trow' }, h('span', null, t.label + (t.cmds && t.cmds.length ? ': ' + t.cmds.join(' ; ') : '')),
      h('button', { class: 'btn small', type: 'button', onclick: async (e) => { await saveSettings({ extTrusted: extTrusted().filter(x => x.h !== t.h) }); e.target.closest('.ext-trow').remove(); } }, 'Entfernen')))
      : h('p', { class: 'hint' }, 'Keine – Aufrufe mit Befehlen oder Makros werden jedes Mal bestätigt.'));
  const body = h('div', { class: 'ext-help' },
    h('p', null, IS_WIN ? 'MacT-1000 lässt sich aus der Eingabeaufforderung, PowerShell, Batch-Dateien, Verknüpfungen oder der Aufgabenplanung aufrufen. Läuft es schon, öffnet sich ein neuer Tab im vorhandenen Fenster.'
      : 'MacT-1000 lässt sich aus Automator, Kurzbefehlen, AppleScript oder dem Terminal aufrufen. Läuft es schon, öffnet sich ein neuer Tab im vorhandenen Fenster.'),
    statusRow,
    h('table', { class: 'ext-table' }, rows),
    h('h4', null, 'Optionen'),
    h('pre', { class: 'ext-opts' }, [
      'Ziele (mehrere möglich, Optionen gelten für das Ziel davor):',
      '  --local [BEFEHL]   --shell PFAD   --ssh [user@]host[:port]   --telnet host[:port]',
      IS_WIN ? '  --serial COM3[:baud]   --rdp [user@]host   --connect "Quick-Connect-Zeile"' : '  --serial /dev/…[:baud]   --rdp [user@]host   --connect "Quick-Connect-Zeile"',
      '  --session "Ordner/Name"   --folder "Ordner"',
      'Je Ziel:  --run BEFEHL (mehrfach)  --macro NAME  --var Name=Wert  --cwd ORDNER',
      '          --title NAME  --split right|down|tab|here  --prompt REGEX',
      '          --close [SEK]  nach dem letzten Befehl schließen, sobald SEK Sekunden (Standard 3) keine Ausgabe kommt',
      '          --log DATEI    Ausgabe ohne Farbcodes an DATEI anhängen (z. B. ~\\Logs\\sw.log)',
      'Plätze:   --layout NAME  Tab mit festen Plätzen (beim ersten Aufruf angelegt, danach per Name gefunden)',
      '          --slot oben|unten|links|rechts|oben-links|oben-rechts|unten-links|unten-rechts|1–4|next',
      '          --grid 2h (oben/unten) | 2v (links/rechts) | 4 (2×2)  – ohne Angabe aus dem Platz abgeleitet',
      '          --busy fragen|ersetzen|neu|abbrechen  wenn der Platz schon belegt ist (Standard: fragen)',
      'Freigabe: --share  Pane nach dem Verbinden freigeben (Einstellungen → Freigaben muss erlaubt sein)',
      '          --share-mode ro / ask / rw  nur lesen (Standard) / Schreiben nach Bestätigung / Lesen und Schreiben',
      '          --share-password PW  --share-name NAME  --share-expires MINUTEN (0 = bis zum Beenden)',
      '          --share-info DATEI  Adresse, Port, Passwort und Fingerprint als JSON in DATEI schreiben',
      '          --share-confirm nein  ohne Rückfrage freigeben, auch mit Schreibrecht (nur Kommandozeile, Einstellungen → Freigaben muss es erlauben)',
      'Gesamt:   --tile (alle in einen Tab)  --multi (Multi-Input an)  --tabs (Ordner als einzelne Tabs)',
      '          --quit (alle Ziele schließen, danach MacT-1000 beenden, wenn sonst nichts mehr läuft)',
      'Links:    mact1000://ssh/admin@10.0.0.1?run=show%20version&split=right',
      '          mact1000://ssh/admin@10.0.0.2?layout=core&slot=unten',
      '          mact1000://ssh/admin@10.0.0.2?share=1&share-mode=ask&share-expires=60'].join('\n')),
    ...(IS_WIN ? [
      h('h4', null, 'Als Verknüpfung oder Batch-Datei'),
      h('ol', { class: 'ext-steps' },
        h('li', null, 'Verknüpfung: Rechtsklick auf den Desktop → Neu → Verknüpfung → als Ziel einen der Befehle oben einfügen (Knopf „Befehl“).'),
        h('li', null, 'Batch-Datei (.cmd): start "" ' + cli + ' --local --run "ipconfig"'),
        h('li', null, 'PowerShell: & ' + cli + ' --ssh admin@10.0.0.1 --run "show version"'),
        h('li', null, 'Beim ersten Ausführen fragt MacT-1000 nach; mit „künftig ohne Rückfrage“ läuft der Aufruf danach direkt.')),
      h('p', { class: 'hint' }, 'Wird die EXE verschoben oder durch eine neue Version ersetzt, die Pfade in Verknüpfungen anpassen und die Links ggf. neu einrichten. Beispiele liegen im Ordner „beispiele“ des Download-Pakets (MacT-1000-…-Windows.zip).')
    ] : [
      h('h4', null, 'In Automator'),
      h('ol', { class: 'ext-steps' },
        h('li', null, 'Automator öffnen → „Arbeitsablauf“ oder „Schnellaktion“ → Aktion „Shell-Skript ausführen“.'),
        h('li', null, 'Einen der Befehle oben einfügen (Knopf „Befehl“).'),
        h('li', null, 'Beim ersten Ausführen fragt MacT-1000 nach; mit „künftig ohne Rückfrage“ läuft der Ablauf danach direkt.')),
      h('p', { class: 'hint' }, 'AppleScript: do shell script "mact1000 --local --run uptime"  ·  oder: open location "mact1000://local?run=uptime"')]),
    h('h4', null, 'Vertraute Aufrufe (ohne Rückfrage)'),
    trustBox);
  const m = openModal({ title: IS_WIN ? 'Aufruf von außen (Kommandozeile, Verknüpfungen, Links)' : 'Aufruf von außen (Automator, Terminal, Links)', body, width: 860, buttons: [{ label: 'Schließen', cls: 'primary', click: () => true }] });
}

async function initExternal() {
  api.ext.onOpen((b) => extQueue(b));
  let pending = [];
  try { pending = await api.ext.ready(); } catch (_) {}
  return pending || [];
}
