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
  defaults: null
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
  const files = name === 'files';
  $('#side-sessions').hidden = files;
  $('#side-files').hidden = !files;
  $$('.side-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  localStorage.setItem('sideTab', name);
  if (files) {
    const p = activePane();
    if (isSsh(p) && p !== FX.pane) fxBind(p);
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
  FX.pane = p; FX.sel.clear(); FX.error = '';
  FX.entries = (p.fx && p.fx.entries) || [];
  FX.cwd = (p.fx && p.fx.cwd) || '';
  p.fx = p.fx || {};
  renderFiles();
  fxList(FX.cwd);
}

async function fxList(dir) {
  const p = FX.pane;
  if (!isSsh(p)) return;
  FX.loading = true; FX.error = ''; renderFiles();
  try {
    const r = await api.fx.list(p.cfg, dir);
    if (FX.pane !== p) return;
    if (r.cwd !== FX.cwd) FX.sel.clear();
    FX.cwd = r.cwd; FX.entries = r.entries;
    p.fx.cwd = r.cwd; p.fx.entries = r.entries;
  } catch (e) {
    if (FX.pane !== p) return;
    FX.error = errMsg(e);
  } finally {
    if (FX.pane === p) { FX.loading = false; renderFiles(); }
  }
}

/* ---------- Abfragen (Passwort, Hostkey) aus dem Hauptprozess ---------- */
function fxAsk(q) {
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
      h('p', { class: 'hint' }, 'Für die Dateiübertragung wird eine Verbindung aufgebaut. Sie wird mit der Terminal-Session geteilt und danach nicht erneut abgefragt.'),
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
}

function fxOnJob(ev) {
  const j = FX.jobs.get(ev.id);
  if (!j) return;
  if (ev.type === 'start') { j.state = 'running'; j.cmd = ev.cmd; }
  if (ev.type === 'progress') Object.assign(j, { percent: ev.percent, speed: ev.speed, eta: ev.eta, file: ev.file, size: ev.size });
  if (ev.type === 'done') {
    j.state = ev.ok ? 'done' : 'error'; j.error = ev.error; j.percent = ev.ok ? 100 : j.percent;
    if (ev.ok) {
      toast(`${j.direction === 'upload' ? 'Hochgeladen' : 'Heruntergeladen'}: ${j.label}`);
      if (j.open) api.fx.openLocal(j.open);
      if (j.direction === 'upload' && FX.pane && FX.pane.id === j.paneId && FX.cwd === j.dest) fxList(FX.cwd);
    } else if (ev.error !== 'Abgebrochen') toast('Übertragung fehlgeschlagen: ' + ev.error, 5000);
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
  head.textContent = sessionSubtitle(p.cfg);
  head.title = `Gebunden an: ${sessionTitle(p.cfg)} (${sessionSubtitle(p.cfg)})`;
  if (document.activeElement !== pathIn) pathIn.value = FX.cwd;
  list.textContent = '';
  if (FX.error) {
    list.appendChild(h('div', { class: 'fx-error' }, FX.error, h('br'), h('button', { class: 'btn small', onclick: () => fxList(FX.cwd) }, 'Erneut versuchen')));
    return;
  }
  if (FX.loading && !FX.entries.length) { list.appendChild(h('div', { class: 'side-empty' }, 'Lade…')); return; }
  const showHidden = !!S.settings.fxShowHidden;
  const items = FX.entries.filter(e => showHidden || !e.name.startsWith('.'));
  if (FX.cwd !== '/') {
    const up = h('div', { class: 'fx-row dir up', title: 'Übergeordnetes Verzeichnis' }, h('span', { class: 'fx-ic' }, '↰'), h('span', { class: 'fx-name' }, '..'), h('span', { class: 'fx-size' }), h('span', { class: 'fx-date' }));
    up.addEventListener('dblclick', () => fxList(rparent(FX.cwd)));
    list.appendChild(up);
  }
  items.forEach((e, idx) => {
    const row = h('div', { class: `fx-row ${e.type}${FX.sel.has(e.name) ? ' sel' : ''}`, draggable: 'false', title: `${e.name}\n${e.perms}  ${e.owner}:${e.group}  ${e.date}${e.type === 'file' ? '  ' + fmtSize(e.size) : ''}` },
      h('span', { class: 'fx-ic' }, e.type === 'dir' ? '▸' : e.type === 'file' ? '·' : '◦'),
      h('span', { class: 'fx-name' }, e.name),
      h('span', { class: 'fx-size' }, e.type === 'file' ? fmtSize(e.size) : ''),
      h('span', { class: 'fx-date' }, e.date));
    row.addEventListener('click', (ev) => {
      if (ev.metaKey) { if (FX.sel.has(e.name)) FX.sel.delete(e.name); else FX.sel.add(e.name); FX.anchor = idx; }
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
  $('#fx-count').textContent = `${items.length} Einträge${FX.sel.size ? ` · ${FX.sel.size} markiert` : ''}${FX.loading ? ' · lade…' : ''}`;
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
    box.appendChild(h('div', { class: `fx-job ${j.state}`, title: `${j.direction === 'upload' ? 'Hochladen nach' : 'Herunterladen nach'} ${j.dest}\n${j.host}${j.cmd ? '\n' + j.cmd : ''}${j.error ? '\n' + j.error : ''}` },
      h('div', { class: 'fx-job-top' },
        h('span', { class: 'fx-dir' }, j.direction === 'upload' ? '↑' : '↓'),
        h('span', { class: 'fx-job-name' }, j.label),
        active ? h('button', { class: 'p-btn', title: 'Abbrechen', onclick: () => api.fx.cancel(j.id) }, '×')
          : (j.state === 'done' && j.direction === 'download' && !j.open ? h('button', { class: 'p-btn', title: 'Im Finder zeigen', onclick: () => api.fx.reveal(j.dest + '/' + j.sources[0].split('/').filter(Boolean).pop()) }, 'Zeigen') : null)),
      h('div', { class: 'fx-bar' }, h('div', { style: { width: (j.state === 'error' ? 100 : j.percent) + '%' } })),
      h('div', { class: 'fx-job-status' }, (j.file && active && j.file !== j.label ? j.file + ' – ' : '') + status)));
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
  btn('#fx-mkdir', () => isSsh(FX.pane) && fxMkdir());
  btn('#fx-upload', async () => { if (!isSsh(FX.pane)) return; fxUpload(await api.fx.pickUpload()); });
  btn('#fx-download', () => { const s = selectedEntries(); if (!s.length) toast('Erst Dateien/Ordner markieren'); else fxDownload(s); });
  btn('#fx-more', (e) => showContextMenu(e.clientX, e.clientY, [
    { label: 'Markierte herunterladen nach…', click: () => { const s = selectedEntries(); if (s.length) fxDownload(s, { ask: true }); else toast('Erst Dateien/Ordner markieren'); } },
    { label: 'Löschen…', click: () => fxDelete(selectedEntries()), disabled: !FX.sel.size },
    { sep: true },
    { label: (S.settings.fxShowHidden ? '✓ ' : '') + 'Versteckte Dateien anzeigen', click: async () => { await saveSettings({ fxShowHidden: !S.settings.fxShowHidden }); renderFiles(); } },
    { label: 'Im Terminal hierhin wechseln (cd)', click: () => FX.cwd && fxCdTerminal(FX.cwd), disabled: !FX.cwd },
    { label: 'Terminal-Verzeichnis übernehmen', click: () => fxFollowTerminal(), disabled: !isSsh(FX.pane) || FX.pane.state !== 'running' },
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
    if ((e.key === 'Backspace' && e.metaKey) || e.key === 'Delete') fxDelete(selectedEntries());
    if (e.key === 'a' && e.metaKey) { e.preventDefault(); FX.entries.forEach(x => FX.sel.add(x.name)); renderFiles(); }
  });
  // Dateien, die außerhalb einer Ablagezone fallen gelassen werden, nicht als Seite öffnen
  document.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  api.fx.onAsk(fxAsk);
  api.fx.onJob(fxOnJob);
  setSideTab(localStorage.getItem('sideTab') === 'files' ? 'files' : 'sessions');
}

/** Ermittelt das aktuelle Verzeichnis der Shell im Terminal (per OSC-7-Titel oder "pwd"-Ausgabe ist zu unsicher) –
 *  daher: Verzeichnis aus dem Fenstertitel lesen, falls die Remote-Shell ihn setzt (user@host: /pfad). */
function fxFollowTerminal() {
  const t = FX.pane && FX.pane.termTitle || '';
  const m = t.match(/:\s*((?:~|\/)[^\s]*)\s*$/);
  if (m) fxList(m[1].startsWith('~') ? m[1].replace(/^~\/?/, '') : m[1]);
  else toast('Verzeichnis nicht erkennbar – die Remote-Shell setzt keinen Fenstertitel mit Pfad');
}
