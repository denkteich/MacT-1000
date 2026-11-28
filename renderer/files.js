'use strict';
/* global S, activePane, setActivePane, toast, confirmDialog, openModal, field, inp, h, $, $$, uid, sessionTitle, sessionSubtitle, showContextMenu, saveSettings */
/**
 * Datei-Browser (SCP) für SSH-Panes – in der Seitenleiste, Tab „Dateien“.
 * Folgt automatisch dem aktiven SSH-Pane; jedes Pane merkt sich sein Verzeichnis.
 */
const FX = {
  pane: null,        // gebundenes SSH-Pane
  entries: [],
  cwd: '',
  sel: new Set(),
  anchor: null,
  loading: false,
  error: '',
  jobs: new Map(),   // jobId -> job
  defaults: null,
  typed: '',         // Direktsprung: bisher getippte Zeichen
  typedAt: 0,
  scrollTo: null,    // Eintrag, der nach dem Zeichnen sichtbar gemacht wird
  syncNote: '',      // Hinweis, wenn das Shell-Verzeichnis nicht gelesen werden kann
  dragCache: new Map(), // Herausziehen: bereits geladene lokale Kopien
  dragHeld: false,
  dragJob: null
};

const fmtSize = (n) => {
  if (n === null || n === undefined) return '';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n >= 100 ? n.toFixed(0) : n.toFixed(1)).replace('.', ',') + ' ' + u[i];
};
const rjoin = (dir, name) => (dir === '/' ? '' : dir.replace(/\/+$/, '')) + '/' + name;
const rparent = (dir) => { const d = dir.replace(/\/+$/, ''); const i = d.lastIndexOf('/'); return i <= 0 ? '/' : d.slice(0, i); };
const errMsg = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const isSsh = (p) => p && p.cfg && p.cfg.type === 'ssh' && S.panes.has(p.id);

/* ---------- Seitenleisten-Tabs ---------- */
function setSideTab(name) {
  if (name === 'tftp') name = 'servers'; // ältere Versionen
  if (!['sessions', 'files', 'servers'].includes(name)) name = 'sessions';
  const files = name === 'files';
  $('#side-sessions').hidden = name !== 'sessions';
  $('#side-files').hidden = !files;
  $('#side-servers').hidden = name !== 'servers';
  if (name === 'servers' && typeof renderServers === 'function') renderServers();
  $$('.side-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  localStorage.setItem('sideTab', name);
  if (files) {
    const p = activePane();
    if (isSsh(p) && p !== FX.pane) fxBind(p);
    else if (isSsh(FX.pane) && FX.pane.fx && FX.pane.fx.syncPending !== undefined) { const d = FX.pane.fx.syncPending; delete FX.pane.fx.syncPending; fxList(d, { quiet: true }); }
    else renderFiles();
  }
}
const filesVisible = () => !$('#sidebar').hidden && !$('#side-files').hidden;

async function toggleFiles(pane) {
  if (filesVisible() && !pane) { setSideTab('sessions'); return; }
  if (S.settings.sidebarVisible === false) await saveSettings({ sidebarVisible: true });
  if (pane) fxBind(pane);
  setSideTab('files');
}

/* ---------- Bindung an Pane ---------- */
function fxOnActivePane(p) {
  if (!isSsh(p) || p === FX.pane) return;
  if (filesVisible()) fxBind(p);
}
function fxOnPaneClosed(p) {
  if (FX.pane === p) { FX.pane = null; FX.entries = []; FX.cwd = ''; FX.sel.clear(); renderFiles(); }
}
function fxBind(p) {
  if (FX.pane && FX.pane.fx) FX.pane.fx.cwd = FX.cwd;
  FX.pane = p; FX.sel.clear(); FX.error = ''; FX.syncNote = '';
  FX.entries = (p.fx && p.fx.entries) || [];
  FX.cwd = (p.fx && p.fx.cwd) || '';
  p.fx = p.fx || {};
  let dir = FX.cwd; let quiet = false;
  if (fxSyncOn()) fxDetectShellDir(p);
  if (p.fx.syncPending !== undefined) { dir = p.fx.syncPending; quiet = true; delete p.fx.syncPending; }
  renderFiles();
  fxList(dir, { quiet });
}

/**
 * quiet: Aufruf durch den Shell-Abgleich – ist das Verzeichnis nicht lesbar (z. B. nach „sudo -i“ oder
 * ssh auf einen weiteren Host), bleibt die bisherige Liste stehen und es erscheint nur ein Hinweis.
 */
async function fxList(dir, { quiet = false } = {}) {
  const p = FX.pane;
  if (!isSsh(p)) return;
  FX.loading = true; FX.error = ''; if (!quiet) FX.syncNote = ''; renderFiles();
  try {
    const r = await api.fx.list(p.cfg, dir);
    if (FX.pane !== p) return;
    if (r.cwd !== FX.cwd) { FX.sel.clear(); FX.typed = ''; }
    FX.cwd = r.cwd; FX.entries = r.entries; FX.syncNote = '';
    p.fx.cwd = r.cwd; p.fx.entries = r.entries;
  } catch (e) {
    if (FX.pane !== p) return;
    if (quiet && FX.entries.length) FX.syncNote = `Shell-Verzeichnis ${dir || '~'} nicht lesbar`;
    else if (quiet) { FX.loading = false; return fxList(FX.cwd); }
    else FX.error = errMsg(e);
  } finally {
    if (FX.pane === p) { FX.loading = false; renderFiles(); }
  }
}

/* ---------- Abgleich mit dem Verzeichnis der Shell ---------- */
const fxSyncOn = () => S.settings.fxSyncShell !== false;
// Prompt wie „user@host:~/pfad$ “, „root@host:/etc# “, „(venv) user@host /pfad % “ oder „[user@host:/pfad]$ “
const PROMPT_RE = /^\s*(?:\([^)]*\)\s*)?\[?[\w.+-]+@[\w.-]+(?::|\s+)\s*((?:~|\/)[^\s\]]*?)\]?\s*[$#%>]/;

/** Aktuelles Verzeichnis der Shell: OSC 7, sonst Prompt-Zeile am Cursor, sonst Fenstertitel. */
function fxShellDir(p) {
  if (p.osc7Dir) return p.osc7Dir;
  if (p.term) {
    try {
      const b = p.term.buffer.active;
      const line = b.getLine(b.baseY + b.cursorY);
      const m = line && line.translateToString(true).match(PROMPT_RE);
      if (m) return m[1];
    } catch (_) {}
  }
  const m = (p.termTitle || '').match(/:\s*((?:~|\/)[^\s]*)\s*$/);
  return m ? m[1] : null;
}
/** Pfad aus der Shell in einen Pfad für den Datei-Browser umwandeln (~ = Home, dort startet scp). */
function fxShellToList(raw) {
  if (!raw || /^~[^/]/.test(raw)) return null; // ~anderer_user: nicht auflösbar
  if (raw === '~') return '';
  return raw.startsWith('~/') ? raw.slice(2) : raw;
}
/** true, wenn sich das Shell-Verzeichnis seit dem letzten Abgleich geändert hat (Ziel in p.fx.syncPending). */
function fxDetectShellDir(p) {
  p.fx = p.fx || {};
  const raw = fxShellDir(p);
  const dir = fxShellToList(raw);
  if (dir === null || raw === p.fx.shellDir) return false;
  p.fx.shellDir = raw;
  p.fx.syncPending = dir;
  return true;
}
function fxScheduleSync(p) {
  if (!fxSyncOn() || !p.term) return;
  clearTimeout(p._fxSyncT);
  p._fxSyncT = setTimeout(() => {
    if (!isSsh(p) || !fxDetectShellDir(p)) return;
    // nur sofort nachladen, wenn der Browser sichtbar an dieses Pane gebunden ist – sonst beim nächsten Anzeigen
    if (FX.pane === p && filesVisible()) { const d = p.fx.syncPending; delete p.fx.syncPending; fxList(d, { quiet: true }); }
  }, 300);
}
async function fxToggleSync() {
  const on = !fxSyncOn();
  await saveSettings({ fxSyncShell: on });
  renderFiles();
  if (on && isSsh(FX.pane)) {
    FX.pane.fx.shellDir = undefined;
    if (fxDetectShellDir(FX.pane)) { const d = FX.pane.fx.syncPending; delete FX.pane.fx.syncPending; fxList(d, { quiet: true }); }
    else toast('Verzeichnis der Shell noch nicht erkennbar – ggf. „Pfad-Meldung in der Shell einrichten“ wählen', 4000);
  }
  toast(on ? 'Datei-Browser folgt dem Verzeichnis der Shell' : 'Datei-Browser unabhängig von der Shell');
}
/** Schaltet in der Remote-Shell (bash/zsh) die Pfad-Meldung per OSC 7 ein – zuverlässiger als Prompt/Titel. */
function fxSetupOsc7() {
  const p = FX.pane;
  if (!p || p.state !== 'running') { toast('Terminal-Session ist nicht verbunden'); return; }
  const cmd = ' if [ -n "$ZSH_VERSION" ]; then _mt_osc7(){ printf \'\\033]7;file://%s%s\\007\' "$HOST" "$PWD"; }; precmd_functions+=(_mt_osc7); _mt_osc7; '
    + 'else PROMPT_COMMAND=\'printf "\\033]7;file://%s%s\\007" "$HOSTNAME" "$PWD"\'"${PROMPT_COMMAND:+;$PROMPT_COMMAND}"; fi\r';
  p.sendRaw(cmd);
  toast('Pfad-Meldung für diese Shell eingerichtet (dauerhaft: Zeile in ~/.bashrc bzw. ~/.zshrc eintragen)', 4500);
}

/* ---------- Direktsprung per Tastatur ---------- */
const fxVisible = () => FX.entries.filter(e => S.settings.fxShowHidden || !e.name.startsWith('.'));
function fxSelectOnly(e) {
  const items = fxVisible();
  FX.sel.clear(); FX.sel.add(e.name); FX.anchor = items.indexOf(e); FX.scrollTo = e.name;
  renderFiles();
}
/** Tippen springt zum ersten Eintrag, der so beginnt (sonst: der den Text enthält); Pause > 1 s beginnt neu. */
function fxTypeAhead(ch) {
  const now = Date.now();
  FX.typed = (now - FX.typedAt > 1000 ? '' : FX.typed) + ch.toLowerCase();
  FX.typedAt = now;
  const q = FX.typed; const items = fxVisible();
  const lc = (e) => e.name.toLowerCase();
  let hit = items.find(e => lc(e).startsWith(q));
  if (!hit && q.length > 1 && [...q].every(c => c === q[0])) {
    // gleiche Taste mehrfach: reihum durch alle Einträge mit diesem Anfangsbuchstaben
    const starts = items.filter(e => lc(e).startsWith(q[0]));
    if (starts.length) hit = starts[(starts.findIndex(e => FX.sel.has(e.name)) + 1) % starts.length];
  }
  if (!hit) hit = items.find(e => lc(e).includes(q));
  if (hit) fxSelectOnly(hit); else renderFiles();
  clearTimeout(FX._typedT);
  FX._typedT = setTimeout(() => { FX.typed = ''; renderFiles(); }, 1100);
}
function fxMoveSel(delta, toEnd) {
  const items = fxVisible();
  if (!items.length) return;
  let i = (FX.anchor !== null && items[FX.anchor] && FX.sel.has(items[FX.anchor].name)) ? FX.anchor : items.findIndex(e => FX.sel.has(e.name));
  if (toEnd) i = delta < 0 ? 0 : items.length - 1;
  else i = i < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, i + delta));
  fxSelectOnly(items[i]);
}
function fxOpenEntry(e) {
  if (!e) return;
  if (e.type === 'dir' || e.type === 'link') fxList(rjoin(FX.cwd, e.name));
  else fxDownload([e], { open: true });
}

/* ---------- Herausziehen in Finder/Desktop (Download per Drag & Drop) ---------- */
document.addEventListener('mouseup', () => { FX.dragHeld = false; }, true);
window.addEventListener('blur', () => { FX.dragHeld = false; });
function fxDragKey(p, entries) {
  return p.cfg.host + '|' + (p.cfg.username || '') + '|' + entries.map(e => `${rjoin(FX.cwd, e.name)}:${e.size}:${e.date}`).join('|');
}
async function fxDragOut(entries) {
  const p = FX.pane;
  if (!isSsh(p) || !entries.length) return;
  const key = fxDragKey(p, entries);
  const c = FX.dragCache.get(key);
  if (c) {
    const ok = await api.fx.localExists(c.dest, c.names);
    if (ok.length === c.names.length) { api.fx.startDrag(c.names.map(n => c.dest + '/' + n)); return; }
    FX.dragCache.delete(key);
  }
  FX.dragHeld = true;
  FX.defaults = FX.defaults || await api.fx.defaults();
  const dest = FX.defaults.temp + '/' + uid('d');
  const id = startJob(p, { direction: 'download', sources: entries.map(e => rjoin(FX.cwd, e.name)), dest, drag: { key, names: entries.map(e => e.name) } });
  FX.dragJob = id;
  toast('Lade für Drag & Drop… Maustaste gedrückt halten', 2500);
}
function fxDragFinished(j) {
  const files = j.drag.names.map(n => j.dest + '/' + n);
  FX.dragCache.set(j.drag.key, { dest: j.dest, names: j.drag.names });
  j.dragFiles = files;
  if (FX.dragHeld && FX.dragJob === j.id) api.fx.startDrag(files);
  else toast('Fertig geladen – jetzt den Eintrag unter „Übertragungen“ an das Ziel ziehen', 4500);
  FX.dragJob = null;
}

/* ---------- Abfragen (Passwort, Hostkey) aus dem Hauptprozess ---------- */
function fxAsk(q) {
  if (q.mode === 'share') { shareAsk(q); return; }
  if (q.kind === 'confirm') {
    confirmDialog('Unbekannter Host-Schlüssel', `${q.text}\n\nVerbindung zu ${q.host} trotzdem aufbauen und Schlüssel speichern?`, 'Verbinden')
      .then(ok => api.fx.answer(q.reqId, ok));
    return;
  }
  const input = inp('secret', '', { type: 'password', autofocus: true });
  let val = null;
  openModal({
    title: `Anmeldung – ${q.host}`, width: 420,
    body: h('div', { class: 'settings-form' },
      h('p', { class: 'hint' }, q.mode === 'scp' || q.mode === 'sftp'
        ? 'Für die Dateiübertragung (SCP) wird eine eigene SSH-Verbindung aufgebaut. Die Eingabe wird bis zum Beenden von MacT-1000 gemerkt.'
        : 'Für die Dateiübertragung wird eine Verbindung aufgebaut. Sie wird mit der Terminal-Session geteilt und danach nicht erneut abgefragt.'),
      field(q.text || 'Passwort:', input)),
    buttons: [{ label: 'Abbrechen', click: () => {} }, { label: 'Anmelden', cls: 'primary', click: () => { val = input.value; } }],
    onClose: () => api.fx.answer(q.reqId, val)
  });
}

/* ---------- Aktionen ---------- */
function selectedEntries() { return FX.entries.filter(e => FX.sel.has(e.name)); }

async function fxUpload(paths, destDir) {
  const p = FX.pane;
  if (!isSsh(p) || !paths.length) return;
  const dest = destDir || FX.cwd;
  if (!dest) { toast('Zielverzeichnis noch nicht geladen'); return; }
  if (dest === FX.cwd) {
    const names = paths.map(x => x.split('/').filter(Boolean).pop());
    const clash = names.filter(n => FX.entries.some(e => e.name === n));
    if (clash.length && !(await confirmDialog('Überschreiben?', `${clash.length === 1 ? `„${clash[0]}“ existiert` : `${clash.length} Einträge existieren`} bereits in ${dest}. Überschreiben?`, 'Überschreiben'))) return;
  }
  startJob(p, { direction: 'upload', sources: paths, dest });
}

async function fxDownload(entries, { ask = false, open = false } = {}) {
  const p = FX.pane;
  if (!isSsh(p) || !entries.length) return;
  FX.defaults = FX.defaults || await api.fx.defaults();
  let dest = S.settings.downloadDir || FX.defaults.downloads;
  if (open) dest = FX.defaults.temp + '/' + uid('o');
  else if (ask) { dest = await api.fx.pickDir(dest); if (!dest) return; }
  if (!open) {
    const clash = await api.fx.localExists(dest, entries.map(e => e.name));
    if (clash.length && !(await confirmDialog('Überschreiben?', `${clash.length === 1 ? `„${clash[0]}“` : `${clash.length} Einträge`} gibt es bereits in ${dest}. Überschreiben?`, 'Überschreiben'))) return;
  }
  startJob(p, { direction: 'download', sources: entries.map(e => rjoin(FX.cwd, e.name)), dest, open: open ? dest + '/' + entries[0].name : null });
}

function startJob(p, spec) {
  const id = uid('j');
  const names = spec.sources.map(s => s.split('/').filter(Boolean).pop());
  FX.jobs.set(id, { id, ...spec, label: names.length === 1 ? names[0] : `${names[0]} + ${names.length - 1} weitere`, host: sessionSubtitle(p.cfg),
    state: 'connecting', percent: 0, speed: '', eta: '', file: '', paneId: p.id });
  renderJobs();
  api.fx.transfer(id, p.cfg, { direction: spec.direction, sources: spec.sources, dest: spec.dest });
  return id;
}

function fxOnJob(ev) {
  const j = FX.jobs.get(ev.id);
  if (!j) return;
  if (ev.type === 'start') { j.state = 'running'; j.cmd = ev.cmd; }
  if (ev.type === 'progress') Object.assign(j, { percent: ev.percent, speed: ev.speed, eta: ev.eta, file: ev.file, size: ev.size });
  if (ev.type === 'done') {
    j.state = ev.ok ? 'done' : 'error'; j.error = ev.error; j.percent = ev.ok ? 100 : j.percent;
    if (ev.ok && j.drag) fxDragFinished(j);
    else if (ev.ok) {
      toast(`${j.direction === 'upload' ? 'Hochgeladen' : 'Heruntergeladen'}: ${j.label}`);
      if (j.open) api.fx.openLocal(j.open);
      if (j.direction === 'upload' && FX.pane && FX.pane.id === j.paneId && FX.cwd === j.dest) fxList(FX.cwd);
    } else if (!ev.ok && j.drag) FX.dragJob = null;
    if (!ev.ok && ev.error !== 'Abgebrochen') toast('Übertragung fehlgeschlagen: ' + ev.error, 5000);
  }
  renderJobs();
}

async function fxMkdir() {
  const name = await promptText('Neuer Ordner', 'Name', '');
  if (!name) return;
  try { await api.fx.op(FX.pane.cfg, 'mkdir', [rjoin(FX.cwd, name)]); fxList(FX.cwd); } catch (e) { toast(errMsg(e), 5000); }
}
async function fxRename(e) {
  const name = await promptText('Umbenennen', 'Neuer Name', e.name);
  if (!name || name === e.name) return;
  try { await api.fx.op(FX.pane.cfg, 'rename', [rjoin(FX.cwd, e.name), rjoin(FX.cwd, name)]); fxList(FX.cwd); } catch (err) { toast(errMsg(err), 5000); }
}
async function fxDelete(list) {
  if (!list.length) return;
  const txt = list.length === 1 ? `„${list[0].name}“${list[0].type === 'dir' ? ' (inkl. Inhalt)' : ''}` : `${list.length} Einträge`;
  if (!(await confirmDialog('Löschen', `${txt} auf ${FX.pane.cfg.host} endgültig löschen?`, 'Löschen'))) return;
  try { await api.fx.op(FX.pane.cfg, 'delete', list.map(e => rjoin(FX.cwd, e.name))); FX.sel.clear(); fxList(FX.cwd); } catch (err) { toast(errMsg(err), 5000); }
}
function fxCdTerminal(dir) {
  const p = FX.pane;
  if (!p || p.state !== 'running') { toast('Terminal-Session ist nicht verbunden'); return; }
  p.sendRaw(`cd '${dir.replace(/'/g, "'\\''")}'\r`);
  setActivePane(p);
}

function promptText(title, label, value) {
  return new Promise((resolve) => {
    const input = inp('v', value, { autofocus: true });
    let out = null;
    openModal({ title, width: 400, body: field(label, input),
      buttons: [{ label: 'Abbrechen', click: () => {} }, { label: 'OK', cls: 'primary', click: () => { out = input.value.trim(); } }],
      onClose: () => resolve(out) });
    setTimeout(() => { const i = value.lastIndexOf('.'); input.setSelectionRange(0, i > 0 ? i : value.length); }, 40);
  });
}

/* ---------- Darstellung ---------- */
function renderFiles() {
  const root = $('#side-files');
  if (!root || root.hidden) return;
  const head = $('#fx-target'); const list = $('#fx-list'); const pathIn = $('#fx-path');
  const p = FX.pane;
  root.classList.toggle('unbound', !isSsh(p));
  if (!isSsh(p)) {
    head.textContent = 'Kein SSH-Pane';
    pathIn.value = '';
    list.textContent = '';
    const ssh = [...S.panes.values()].filter(isSsh);
    list.appendChild(h('div', { class: 'side-empty fx-empty' },
      'Der Datei-Browser zeigt die Dateien der aktiven SSH-Session und überträgt sie per scp.',
      ssh.length ? h('div', { class: 'fx-pick' }, ...ssh.map(sp => h('button', { class: 'btn small', onclick: () => fxBind(sp) }, sessionTitle(sp.cfg)))) : h('div', null, 'Öffne zuerst eine SSH-Session.')));
    return;
  }
  const syncBtn = $('#fx-sync');
  if (syncBtn) syncBtn.classList.toggle('on', fxSyncOn());
  head.textContent = sessionSubtitle(p.cfg);
  head.title = `Gebunden an: ${sessionTitle(p.cfg)} (${sessionSubtitle(p.cfg)})`;
  if (document.activeElement !== pathIn) pathIn.value = FX.cwd;
  list.textContent = '';
  if (FX.error) {
    list.appendChild(h('div', { class: 'fx-error' }, FX.error, h('br'), h('button', { class: 'btn small', onclick: () => fxList(FX.cwd) }, 'Erneut versuchen')));
    return;
  }
  if (FX.loading && !FX.entries.length) { list.appendChild(h('div', { class: 'side-empty' }, 'Lade…')); return; }
  const items = fxVisible();
  let scrollRow = null;
  if (FX.cwd !== '/') {
    const up = h('div', { class: 'fx-row dir up', title: 'Übergeordnetes Verzeichnis' }, h('span', { class: 'fx-ic' }, '↰'), h('span', { class: 'fx-name' }, '..'), h('span', { class: 'fx-size' }), h('span', { class: 'fx-date' }));
    up.addEventListener('dblclick', () => fxList(rparent(FX.cwd)));
    list.appendChild(up);
  }
  items.forEach((e, idx) => {
    const row = h('div', { class: `fx-row ${e.type}${FX.sel.has(e.name) ? ' sel' : ''}`, draggable: 'true', title: `${e.name}\n${e.perms}  ${e.owner}:${e.group}  ${e.date}${e.type === 'file' ? '  ' + fmtSize(e.size) : ''}` },
      h('span', { class: 'fx-ic' }, e.type === 'dir' ? '▸' : e.type === 'file' ? '·' : '◦'),
      h('span', { class: 'fx-name' }, e.name),
      h('span', { class: 'fx-size' }, e.type === 'file' ? fmtSize(e.size) : ''),
      h('span', { class: 'fx-date' }, e.date));
    if (FX.scrollTo === e.name) scrollRow = row;
    // Herausziehen: Eintrag (bzw. alle markierten) in Finder/Desktop ziehen = herunterladen
    row.addEventListener('dragstart', (ev) => {
      ev.preventDefault();
      if (!FX.sel.has(e.name)) { FX.sel.clear(); FX.sel.add(e.name); FX.anchor = idx; renderFiles(); }
      fxDragOut(selectedEntries());
    });
    row.addEventListener('click', (ev) => {
      if (ev.metaKey || (IS_WIN && ev.ctrlKey)) { if (FX.sel.has(e.name)) FX.sel.delete(e.name); else FX.sel.add(e.name); FX.anchor = idx; }
      else if (ev.shiftKey && FX.anchor !== null) {
        FX.sel.clear();
        const [a, b] = [Math.min(FX.anchor, idx), Math.max(FX.anchor, idx)];
        for (let i = a; i <= b; i++) FX.sel.add(items[i].name);
      } else { FX.sel.clear(); FX.sel.add(e.name); FX.anchor = idx; }
      renderFiles();
    });
    row.addEventListener('dblclick', () => { if (e.type === 'dir') fxList(rjoin(FX.cwd, e.name)); else fxDownload([e], { open: true }); });
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (!FX.sel.has(e.name)) { FX.sel.clear(); FX.sel.add(e.name); FX.anchor = idx; renderFiles(); }
      const sel = selectedEntries();
      showContextMenu(ev.clientX, ev.clientY, [
        e.type === 'dir' ? { label: 'Öffnen', click: () => fxList(rjoin(FX.cwd, e.name)) } : { label: 'Öffnen (lokale Kopie)', click: () => fxDownload([e], { open: true }) },
        { label: sel.length > 1 ? `${sel.length} Einträge herunterladen` : 'Herunterladen', click: () => fxDownload(sel) },
        { label: 'Herunterladen nach…', click: () => fxDownload(sel, { ask: true }) },
        e.type === 'dir' ? { label: 'Hierhin hochladen…', click: async () => fxUpload(await api.fx.pickUpload(), rjoin(FX.cwd, e.name)) } : null,
        { sep: true },
        { label: 'Umbenennen…', click: () => fxRename(e), disabled: sel.length > 1 },
        { label: 'Löschen…', click: () => fxDelete(sel) },
        { sep: true },
        { label: 'Pfad kopieren', click: () => { api.writeClipboard(sel.map(x => rjoin(FX.cwd, x.name)).join('\n')); toast('Pfad kopiert'); } },
        e.type === 'dir' ? { label: 'Im Terminal hierhin wechseln (cd)', click: () => fxCdTerminal(rjoin(FX.cwd, e.name)) } : null
      ].filter(Boolean));
    });
    // Dateien aus dem Finder direkt in einen Unterordner ziehen
    if (e.type === 'dir') {
      row.addEventListener('dragover', (ev) => { if (ev.dataTransfer.types.includes('Files')) { ev.preventDefault(); ev.stopPropagation(); row.classList.add('drop'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', (ev) => { ev.preventDefault(); ev.stopPropagation(); row.classList.remove('drop'); $('#side-files').classList.remove('drop'); fxUpload(droppedPaths(ev), rjoin(FX.cwd, e.name)); });
    }
    list.appendChild(row);
  });
  if (!items.length) list.appendChild(h('div', { class: 'side-empty' }, FX.entries.length ? 'Nur versteckte Einträge' : 'Leeres Verzeichnis'));
  const cnt = $('#fx-count');
  cnt.textContent = FX.typed ? `Springe zu: ${FX.typed}${FX.sel.size ? '' : ' – kein Treffer'}`
    : `${items.length} Einträge${FX.sel.size ? ` · ${FX.sel.size} markiert` : ''}${FX.loading ? ' · lade…' : ''}${FX.syncNote ? ' · ' + FX.syncNote : ''}`;
  cnt.classList.toggle('typing', !!FX.typed);
  if (scrollRow) { FX.scrollTo = null; scrollRow.scrollIntoView({ block: 'nearest' }); }
}

function renderJobs() {
  const box = $('#fx-jobs');
  if (!box) return;
  box.textContent = '';
  const jobs = [...FX.jobs.values()].slice(-30).reverse();
  box.hidden = !jobs.length;
  if (!jobs.length) return;
  const anyDone = jobs.some(j => j.state === 'done' || j.state === 'error');
  box.appendChild(h('div', { class: 'fx-jobs-head' }, h('span', null, 'Übertragungen'), h('span', { class: 'grow' }),
    anyDone ? h('button', { class: 'p-btn', title: 'Abgeschlossene entfernen', onclick: () => { for (const j of [...FX.jobs.values()]) if (j.state === 'done' || j.state === 'error') FX.jobs.delete(j.id); renderJobs(); } }, 'Leeren') : null));
  for (const j of jobs) {
    const active = j.state === 'running' || j.state === 'connecting';
    const status = j.state === 'connecting' ? 'verbinde…' : j.state === 'running' ? `${j.percent}%${j.speed ? ' · ' + j.speed : ''}${j.eta && j.percent < 100 ? ' · ' + j.eta : ''}`
      : j.state === 'done' ? 'fertig' : (j.error || 'Fehler');
    const jobEl = h('div', { class: `fx-job ${j.state}${j.dragFiles ? ' dragout' : ''}`, draggable: j.dragFiles ? 'true' : null, title: `${j.direction === 'upload' ? 'Hochladen nach' : 'Herunterladen nach'} ${j.dest}\n${j.host}${j.cmd ? '\n' + j.cmd : ''}${j.error ? '\n' + j.error : ''}` },
      h('div', { class: 'fx-job-top' },
        h('span', { class: 'fx-dir' }, j.direction === 'upload' ? '↑' : '↓'),
        h('span', { class: 'fx-job-name' }, j.label),
        active ? h('button', { class: 'p-btn', title: 'Abbrechen', onclick: () => api.fx.cancel(j.id) }, '×')
          : (j.state === 'done' && j.direction === 'download' && !j.open && !j.dragFiles ? h('button', { class: 'p-btn', title: 'Im Finder zeigen', onclick: () => api.fx.reveal(j.dest + '/' + j.sources[0].split('/').filter(Boolean).pop()) }, 'Zeigen') : null)),
      h('div', { class: 'fx-bar' }, h('div', { style: { width: (j.state === 'error' ? 100 : j.percent) + '%' } })),
      h('div', { class: 'fx-job-status' }, (j.file && active && j.file !== j.label ? j.file + ' – ' : '') + (j.dragFiles ? 'fertig – an das Ziel ziehen' : status)));
    if (j.dragFiles) jobEl.addEventListener('dragstart', (ev) => { ev.preventDefault(); api.fx.startDrag(j.dragFiles); });
    box.appendChild(jobEl);
  }
}

function droppedPaths(ev) {
  return [...(ev.dataTransfer.files || [])].map(f => api.fx.pathForFile(f)).filter(Boolean);
}

/* ---------- Initialisierung ---------- */
function initFiles() {
  $$('.side-tab').forEach(b => b.addEventListener('click', () => setSideTab(b.dataset.tab)));
  const btn = (id, fn) => $(id).addEventListener('click', fn);
  btn('#fx-up', () => FX.cwd && fxList(rparent(FX.cwd)));
  btn('#fx-home', () => fxList(''));
  btn('#fx-refresh', () => fxList(FX.cwd));
  btn('#fx-sync', () => fxToggleSync());
  btn('#fx-mkdir', () => isSsh(FX.pane) && fxMkdir());
  btn('#fx-upload', async () => { if (!isSsh(FX.pane)) return; fxUpload(await api.fx.pickUpload()); });
  btn('#fx-download', () => { const s = selectedEntries(); if (!s.length) toast('Erst Dateien/Ordner markieren'); else fxDownload(s); });
  btn('#fx-more', (e) => showContextMenu(e.clientX, e.clientY, [
    { label: 'Markierte herunterladen nach…', click: () => { const s = selectedEntries(); if (s.length) fxDownload(s, { ask: true }); else toast('Erst Dateien/Ordner markieren'); } },
    { label: 'Löschen…', click: () => fxDelete(selectedEntries()), disabled: !FX.sel.size },
    { sep: true },
    { label: (S.settings.fxShowHidden ? '✓ ' : '') + 'Versteckte Dateien anzeigen', click: async () => { await saveSettings({ fxShowHidden: !S.settings.fxShowHidden }); renderFiles(); } },
    { label: 'Im Terminal hierhin wechseln (cd)', click: () => FX.cwd && fxCdTerminal(FX.cwd), disabled: !FX.cwd },
    { label: (fxSyncOn() ? '✓ ' : '') + 'Mit dem Verzeichnis der Shell synchron halten', click: () => fxToggleSync() },
    { label: 'Terminal-Verzeichnis übernehmen', click: () => fxFollowTerminal(), disabled: !isSsh(FX.pane) || FX.pane.state !== 'running' },
    { label: 'Pfad-Meldung in der Shell einrichten (bash/zsh)', click: () => fxSetupOsc7(), disabled: !isSsh(FX.pane) || FX.pane.state !== 'running' },
    { label: 'Pfad kopieren', click: () => { api.writeClipboard(FX.cwd); toast('Pfad kopiert'); }, disabled: !FX.cwd },
    { sep: true },
    { label: 'Download-Ordner festlegen…', click: async () => { const d = await api.fx.pickDir(S.settings.downloadDir); if (d) { await saveSettings({ downloadDir: d }); toast('Download-Ordner: ' + d); } } }
  ]));
  const pathIn = $('#fx-path');
  pathIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fxList(pathIn.value.trim()); pathIn.blur(); } if (e.key === 'Escape') { pathIn.value = FX.cwd; pathIn.blur(); } });
  const root = $('#side-files');
  root.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files') && isSsh(FX.pane)) { e.preventDefault(); root.classList.add('drop'); } });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('drop'); });
  root.addEventListener('drop', (e) => { e.preventDefault(); root.classList.remove('drop'); fxUpload(droppedPaths(e)); });
  $('#fx-list').addEventListener('click', (e) => { if (e.target.id === 'fx-list') { FX.sel.clear(); renderFiles(); } });
  $('#fx-list').addEventListener('keydown', (e) => {
    if (!isSsh(FX.pane)) return;
    const k = e.key;
    if (k.length === 1 && !e.metaKey && !(e.ctrlKey && !e.altKey) && (k !== ' ' || FX.typed)) { e.preventDefault(); e.stopPropagation(); fxTypeAhead(k); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); if ((e.metaKey || (IS_WIN && e.ctrlKey) || e.altKey) && k === 'ArrowUp') { if (FX.cwd) fxList(rparent(FX.cwd)); } else fxMoveSel(k === 'ArrowDown' ? 1 : -1); return; }
    if (k === 'Home' || k === 'End') { e.preventDefault(); fxMoveSel(k === 'End' ? 1 : -1, true); return; }
    if (k === 'Enter' || (e.metaKey && k === 'ArrowDown')) { e.preventDefault(); const s = selectedEntries(); if (s.length === 1) fxOpenEntry(s[0]); return; }
    if (k === 'Escape') { FX.typed = ''; FX.sel.clear(); renderFiles(); return; }
    if (k === 'Backspace' && !e.metaKey) { e.preventDefault(); if (FX.typed) { FX.typed = FX.typed.slice(0, -1); FX.typedAt = Date.now(); renderFiles(); } else if (FX.cwd) fxList(rparent(FX.cwd)); return; }
    if ((k === 'Backspace' && e.metaKey) || k === 'Delete') fxDelete(selectedEntries());
    if (e.key === 'a' && (e.metaKey || (IS_WIN && e.ctrlKey))) { e.preventDefault(); FX.entries.forEach(x => FX.sel.add(x.name)); renderFiles(); }
  });
  // Dateien, die außerhalb einer Ablagezone fallen gelassen werden, nicht als Seite öffnen
  document.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  api.fx.onAsk(fxAsk);
  api.fx.onJob(fxOnJob);
  setSideTab(localStorage.getItem('sideTab') || 'sessions');
}

/** Einmalig das aktuelle Verzeichnis der Shell übernehmen (OSC 7, Prompt-Zeile oder Fenstertitel). */
function fxFollowTerminal() {
  const dir = FX.pane ? fxShellToList(fxShellDir(FX.pane)) : null;
  if (dir !== null) fxList(dir);
  else toast('Verzeichnis nicht erkennbar – „Pfad-Meldung in der Shell einrichten“ hilft');
}
