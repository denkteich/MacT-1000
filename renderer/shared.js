'use strict';
/* global S, h, $, toast, openModal, field, inp, chk, confirmDialog, api, applySettings, renderSidebar */
/**
 * Gemeinsame Konfiguration auf einem Netzlaufwerk – Dialog, Statusanzeige, automatisches Neuladen.
 */
const SHARED = { status: { enabled: false } };

function errText(e) { return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
function fmtTime(d) { try { return d ? new Date(d).toLocaleString(LOC()) : ''; } catch (_) { return d || ''; } }

function sharedStateText(st) {
  if (!st || !st.enabled) return { cls: 'off', short: '', long: 'Nicht aktiv – Konfiguration liegt nur auf diesem Mac.' };
  if (st.pending) return { cls: 'warn', short: 'Netz: ausstehend', long: `Änderungen noch nicht auf dem Netzlaufwerk (${st.error || 'nicht erreichbar'}). Sie werden automatisch abgeglichen, sobald es wieder erreichbar ist.` };
  if (!st.online) return { cls: 'warn', short: 'Netz: offline', long: `${st.error || 'Netzlaufwerk nicht erreichbar'} – es wird mit dem zuletzt bekannten Stand weitergearbeitet.` };
  if (st.error) return { cls: 'warn', short: 'Netz: Hinweis', long: st.error };
  if (st.newer) return { cls: 'warn', short: 'Netz: neuere Version', long: `Synchron · Revision ${st.rev} · Datei stammt von MacT-1000 ${st.newestAppVersion} – hier läuft ${st.appVersion}` };
  return { cls: 'ok', short: 'Netz: synchron', long: `Synchron · Revision ${st.rev}` + (st.updatedBy ? ` · zuletzt geändert von ${st.updatedBy}, ${fmtTime(st.updatedAt)}` : '') };
}

function renderSharedIndicator() {
  const el = $('#shared-ind');
  if (!el) return;
  const t = sharedStateText(SHARED.status);
  el.hidden = !SHARED.status.enabled;
  el.className = 'shared-ind ' + t.cls;
  el.textContent = t.short;
  el.title = (SHARED.status.file ? SHARED.status.file + '\n' : '') + t.long + '\nKlick: Netzwerk-Konfiguration';
}

async function refreshSharedStatus() {
  try { SHARED.status = await api.shared.status(); } catch (_) {}
  renderSharedIndicator();
  return SHARED.status;
}

/** Andere Rechner haben etwas geändert → Adressbuch, Ordner, Makros und ggf. Einstellungen neu laden */
async function reloadFromShared(info = {}) {
  S.sessions = await api.getSessions();
  const st = await api.getSettings();
  S.settings = st;
  applySettings();
  renderSidebar();
  await refreshSharedStatus();
  if (!info.silent) {
    const who = info.by ? ` von ${info.by}` : '';
    toast(info.resynced ? 'Netzwerk-Konfiguration wieder erreichbar – lokale Änderungen abgeglichen' : `Konfiguration${who} aktualisiert`, 3200);
  }
}

/** Rückgabe von saveSessions/saveSettings prüfen */
function checkSaveResult(r) {
  if (r && r.pending) {
    toast('Netzlaufwerk: ' + (r.error || 'nicht erreichbar') + ' – Änderung lokal gespeichert, wird später abgeglichen', 4200);
    refreshSharedStatus();
  }
  return r;
}

function initShared() {
  api.shared.onChanged((info) => reloadFromShared(info || {}));
  api.shared.onStatus((st) => { SHARED.status = { ...SHARED.status, ...st }; renderSharedIndicator(); });
  const el = $('#shared-ind');
  if (el) el.addEventListener('click', () => sharedConfigDialog());
  refreshSharedStatus();
  setInterval(refreshSharedStatus, 15000);
}

/* ---------- Versionskontrolle der Konfiguration ---------- */
const VERSION = { info: null, update: null, later: false };
const updAvail = () => { const u = VERSION.update; return u && u.ok && u.newer ? u : null; };
const openRelease = (u) => api.openExternal((u && (u.url || u.releasesUrl)) || 'https://github.com/denkteich/MacT-1000/releases');
const verText = (v) => v || 'unbekannt (vor 1.5.14)';

function versionWarnings(vi) {
  const w = [];
  if (!vi) return w;
  if (vi.shared && vi.shared.newer) w.push({ scope: 'shared', newest: vi.shared.newestAppVersion,
    text: `Die Netzwerk-Konfiguration wurde mit MacT-1000 ${vi.shared.newestAppVersion} bearbeitet – hier läuft ${vi.app}.` });
  if (!vi.shared && vi.local && vi.local.newer) w.push({ scope: 'local', newest: vi.local.loadedNewest,
    text: `Die Konfiguration wurde mit MacT-1000 ${vi.local.loadedNewest} geschrieben – hier läuft ${vi.app}.` });
  return w;
}

async function checkConfigVersion() {
  let vi;
  try { vi = await api.versionInfo(); } catch (_) { return; }
  VERSION.info = vi;
  const bar = $('#version-banner');
  const w = versionWarnings(vi).filter(x => localStorage.getItem('verWarnOff') !== `${x.scope}:${x.newest}:${vi.app}`);
  if (!w.length) { bar.hidden = true; return; }
  const u = updAvail();
  $('#version-text').textContent = w.map(x => x.text).join(' ') + ' Bitte MacT-1000 aktualisieren – Einstellungen neuerer Versionen werden evtl. nicht erkannt.';
  const dl = $('#version-download');
  dl.hidden = !u; if (u) { dl.textContent = `Version ${u.latest} laden`; dl.title = u.url; }
  bar.dataset.key = `${w[0].scope}:${w[0].newest}:${vi.app}`;
  bar.hidden = false;
}

async function configVersionDialog({ checkNow } = {}) {
  await checkConfigVersion();
  if (checkNow || !VERSION.update) { try { await applyUpdate(await api.update.check()); } catch (_) {} }
  const vi = VERSION.info || { app: '', local: {} };
  const L = vi.local || {};
  const row = (k, v, warn) => h('tr', { class: warn ? 'ver-bad' : '' }, h('td', null, k), h('td', null, v));
  const rows = [
    row('Diese MacT-1000-Version', vi.app),
    row('Geladene Konfiguration geschrieben mit', L.hasConfig ? verText(L.loadedWith) + (L.loadedAt ? ` · ${fmtTime(L.loadedAt)}` : '') : 'neu angelegt', L.newer),
    L.loadedNewest && L.loadedNewest !== L.loadedWith ? row('Neueste Version, die sie bearbeitet hat', L.loadedNewest, L.newer) : null,
    row('Zuletzt gespeichert mit', L.writtenWith ? `${L.writtenWith} · ${fmtTime(L.writtenAt)}` : '–')
  ];
  if (vi.shared) {
    rows.push(row('Netzwerk-Konfiguration geschrieben mit', verText(vi.shared.writtenWith) + ` · Rev. ${vi.shared.rev}` + (vi.shared.updatedBy ? ` · ${vi.shared.updatedBy}, ${fmtTime(vi.shared.updatedAt)}` : ''), vi.shared.newer));
    if (vi.shared.newestAppVersion && vi.shared.newestAppVersion !== vi.shared.writtenWith) rows.push(row('Neueste beteiligte Version (Netzwerk)', vi.shared.newestAppVersion, vi.shared.newer));
  }
  rows.push(...updateRows());
  const w = versionWarnings(vi);
  const upd = updAvail();
  const body = h('div', { class: 'settings-form' },
    h('table', { class: 'ver-table' }, rows),
    upd ? h('p', { class: 'ver-warn' }, `Neue Version verfügbar: MacT-1000 ${upd.latest}. `, h('a', { href: '#', onclick: (e) => { e.preventDefault(); openRelease(upd); } }, 'Zur Release-Seite auf GitHub'),
      !(DL.st && DL.st.canInstall === false) && !(DL.st && (dlBusy(DL.st) || DL.st.phase === 'installing')) ? h('button', { class: 'btn small primary', style: { marginLeft: '10px' }, type: 'button',
        onclick: (e) => { e.target.closest('.modal').querySelector('.modal-head .x').click(); VERSION.later = false; onUpdateAction(); } }, DL.st && DL.st.phase === 'ready' ? 'Neu starten und installieren' : DL.st && DL.st.manual ? 'Herunterladen' : 'Jetzt aktualisieren') : null) : null,
    w.length ? h('p', { class: 'ver-warn' }, w.map(x => x.text).join(' ') + ' Bitte MacT-1000 aktualisieren. Unbekannte Einstellungen werden von dieser Version nicht angezeigt.')
      : h('p', { class: 'hint' }, 'Die Konfiguration ist nicht neuer als diese Version.'),
    h('p', { class: 'hint' }, 'Jede gespeicherte Konfiguration (lokal, Netzwerk und Export) enthält die Version, mit der sie geschrieben wurde. Ist sie neuer als die laufende Version, erscheint beim Laden ein Hinweis.'));
  openModal({ title: 'Version und Konfiguration', body, width: 640, buttons: [
    { label: 'Jetzt auf Updates prüfen', click: () => { setTimeout(() => configVersionDialog({ checkNow: true }), 30); } },
    { label: 'OK', cls: 'primary', click: () => true }], enterConfirms: true });
}

function releaseLink(u, label) {
  return h('a', { href: '#', title: u.url, onclick: (e) => { e.preventDefault(); openRelease(u); } }, label);
}
function updateRows() {
  const u = VERSION.update;
  const row = (k, v, cls) => h('tr', { class: cls || '' }, h('td', null, k), h('td', null, v));
  const out = [h('tr', { class: 'ver-head' }, h('td', { colspan: 2 }, 'Neueste Version auf GitHub'))];
  if (!u) { out.push(row('Status', 'noch nicht geprüft')); return out; }
  const ok = u.ok ? u : u.lastOk;
  if (ok) {
    out.push(row('Neuestes Release', h('span', null, releaseLink(ok, ok.name || ok.tag), ok.publishedAt ? ` · ${fmtTime(ok.publishedAt)}` : '')));
    out.push(row('Vergleich mit dieser Version (' + ok.current + ')',
      ok.newer ? `Neue Version ${ok.latest} verfügbar` : ok.ahead ? `Diese Version ist neuer als das letzte Release (${ok.latest})` : 'Aktuell – das ist die neueste Version',
      ok.newer ? 'ver-bad' : 'ver-new'));
    const vi = VERSION.info;
    const cfgNewest = vi && (vi.shared ? vi.shared.newestAppVersion : vi.local && vi.local.loadedNewest);
    if (cfgNewest && cmpVerR(cfgNewest, ok.latest) > 0) out.push(row('Konfiguration', `stammt von ${cfgNewest} – neuer als das letzte Release (Vorab-/Entwicklerversion)`, 'ver-bad'));
  }
  if (!u.ok) out.push(row('Letzte Prüfung', `fehlgeschlagen: ${u.error || 'unbekannt'}`, 'ver-bad'));
  const st = DL.st;
  if (st && st.notifyOnly) {
    out.push(row('Update', st.phase === 'opened' ? (st.fallback ? 'Release-Seite im Browser geöffnet' : `Download von ${st.asset} im Browser gestartet`) : 'Hinweis mit Download im Browser (keine automatische Installation)', st.phase === 'opened' ? 'ver-new' : ''));
  } else if (st && st.phase !== 'idle') {
    const t = { downloading: `wird geladen (${st.total ? Math.floor(st.bytes * 100 / st.total) : 0} %)`, verifying: 'Prüfsumme wird kontrolliert', extracting: 'wird entpackt',
      ready: `${st.version} bereit – wird beim Neustart installiert` + (st.digestChecked ? ' (SHA-256 geprüft)' : ''), installing: 'wird installiert', error: `fehlgeschlagen: ${st.error}` }[st.phase] || st.phase;
    out.push(row('Automatisches Update', t, st.phase === 'error' ? 'ver-bad' : st.phase === 'ready' ? 'ver-new' : ''));
  } else if (st && st.canInstall === false) out.push(row('Automatisches Update', st.reason, 'ver-bad'));
  else if (st && st.needsAdmin) out.push(row('Automatisches Update', (IS_WIN ? `möglich – für ${st.target} fragt Windows nach Administratorrechten` : `möglich – für ${st.target} wird das Administrator-Passwort abgefragt`)));
  out.push(row('Geprüft', fmtTime(u.checkedAt) + (u.source === 'page' ? ' (über die Release-Seite)' : '')));
  return out;
}
// Versionsvergleich wie src/version.js (Renderer hat kein require)
function cmpVerR(a, b) {
  const p = (v) => (String(v || '').replace(/^v/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/) || []).slice(1, 4).map(x => Number(x || 0));
  const A = p(a), B = p(b);
  if (!A.length || !B.length) return A.length ? 1 : (B.length ? -1 : 0);
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1;
  return 0;
}

/* ---------- Hinweis auf neue Version (Start + alle 6 h) ---------- */
function applyUpdate(u) {
  if (!u) return;
  VERSION.update = u;
  renderUpdateBanner();
  checkConfigVersion();
  maybeAutoDownload();
}
const DL = { st: null, asked: {}, prompted: {}, auto: true, result: null, remind: {} };
const mb = (n) => (n / 1048576).toLocaleString(LOC(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dlBusy = (st) => st && ['downloading', 'verifying', 'extracting'].includes(st.phase);
function renderUpdateBanner() {
  const bar = $('#update-banner');
  const u = updAvail();
  const st = DL.st;
  const show = (id, on) => { $(id).hidden = !on; };
  bar.classList.remove('upd-error', 'upd-ready');
  // Bereits laufender/fertiger Download bleibt sichtbar, auch wenn „Später“ gewählt wurde
  const active = st && (dlBusy(st) || st.phase === 'installing' || (st.phase === 'ready' && !VERSION.later));
  if (!active && (!u || VERSION.later || localStorage.getItem('updSkip') === u.latest)) { bar.hidden = true; return; }
  const ver = (st && st.version) || (u && u.latest);
  const a = $('#update-link');
  if (u) { a.textContent = `Release-Seite`; a.title = u.url; a.href = u.url; }
  show('#update-link', !!u); show('#update-notes', !!(u && u.notes));
  show('#update-prog', false); show('#update-cancel', false); show('#update-skip', true); show('#update-later', true);
  const act = $('#update-action'); act.hidden = true;
  let text;
  if (st && dlBusy(st)) {
    const pct = st.total ? Math.floor(st.bytes * 100 / st.total) : 0;
    text = st.phase === 'downloading'
      ? `MacT-1000 ${ver} wird geladen … ${pct} %` + (st.total ? ` (${mb(st.bytes)} von ${mb(st.total)} MB)` : ` (${mb(st.bytes)} MB)`)
      : st.phase === 'verifying' ? `MacT-1000 ${ver}: Prüfsumme wird kontrolliert …` : `MacT-1000 ${ver} wird entpackt …`;
    show('#update-prog', true); $('#update-prog-bar').style.width = (st.phase === 'downloading' ? pct : 100) + '%';
    show('#update-cancel', st.phase === 'downloading'); show('#update-skip', false); show('#update-later', false);
  } else if (st && st.phase === 'ready') {
    bar.classList.add('upd-ready');
    text = `MacT-1000 ${ver} ist heruntergeladen und geprüft` + (st.digestChecked ? ' (SHA-256 korrekt).' : '.') + ' Installation beim Neustart.';
    act.textContent = 'Neu starten und installieren'; act.hidden = false; show('#update-skip', false);
  } else if (st && st.phase === 'installing') {
    bar.classList.add('upd-ready');
    text = `MacT-1000 ${ver} wird installiert …`;
    show('#update-skip', false); show('#update-later', false);
  } else if (st && st.notifyOnly && st.phase === 'opened' && st.version === ver) {
    bar.classList.add('upd-ready');
    text = st.fallback ? `MacT-1000 ${ver}: Die Datei war im Release nicht zu finden – die Release-Seite wurde im Browser geöffnet.`
      : st.kind === 'portable' ? `Der Download von MacT-1000 ${ver} wurde im Browser gestartet. Danach MacT-1000 beenden und die alte EXE durch die neue ersetzen.`
        : `Der Download von MacT-1000 ${ver} wurde im Browser gestartet. Danach MacT-1000 beenden und den Installer starten.`;
    act.textContent = 'Erneut herunterladen'; act.hidden = false;
  } else if (st && st.phase === 'error' && st.version === ver) {
    bar.classList.add('upd-error');
    text = `Update auf ${ver} nicht möglich: ${st.error}`;
    if (st.canInstall !== false) { act.textContent = 'Erneut versuchen'; act.hidden = false; }
  } else {
    text = `Neue Version verfügbar: MacT-1000 ${u.latest} (hier läuft ${u.current}).`;
    if (!st || st.canInstall !== false) { act.textContent = st && st.manual ? 'Herunterladen' : 'Jetzt aktualisieren'; act.hidden = false; }
    else text += ' ' + st.reason;
  }
  $('#update-text').textContent = text;
  bar.hidden = false;
}
async function startUpdateDownload() {
  try { DL.st = await api.update.download(); } catch (e) { toast('Update: ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 4000); }
  if (DL.st && DL.st.notifyOnly && DL.st.phase === 'opened') toast(DL.st.fallback ? 'Die Release-Seite wurde im Browser geöffnet.' : `Download von ${DL.st.asset} im Browser gestartet.`, 4000);
  renderUpdateBanner();
}
function onUpdateAction() {
  const st = DL.st;
  if (st && st.phase === 'ready') return askInstallUpdate(true);
  VERSION.later = false;
  startUpdateDownload();
}
function activeConnectionCount() {
  try { return [...S.panes.values()].filter(isActiveConnection).length; } catch (_) { return 0; }
}
function askInstallUpdate(fromButton) {
  const st = DL.st;
  if (!st || st.phase !== 'ready') return;
  if (!fromButton && DL.asked[st.version]) return;
  DL.asked[st.version] = true;
  if (document.querySelector('#modal-root .upd-ask')) return;
  const n = activeConnectionCount();
  const body = h('div', { class: 'upd-ask' },
    h('p', null, `MacT-1000 ${st.version} ist heruntergeladen und geprüft` + (st.digestChecked ? ' (SHA-256-Prüfsumme von GitHub stimmt).' : '.') + ` Jetzt installieren und MacT-1000 neu starten?`),
    n ? h('p', { class: 'ver-warn' }, n === 1 ? 'Es besteht noch eine aktive Verbindung – sie wird beim Neustart getrennt.' : `Es bestehen noch ${n} aktive Verbindungen – sie werden beim Neustart getrennt.`) : null,
    st.needsAdmin ? h('p', { class: 'hint' }, IS_WIN ? `Für ${st.target} sind Administratorrechte nötig – Windows fragt bei der Installation nach (Benutzerkontensteuerung).` : `Für ${st.target} sind Administratorrechte nötig – macOS fragt nach dem Passwort.`) : null,
    h('p', { class: 'hint' }, 'Bei „Später“ wird das Update beim nächsten Beenden von MacT-1000 installiert' + (S.settings && S.settings.autoUpdate === false ? ' (abgeschaltet in den Einstellungen – dann nur über diesen Hinweis).' : '.')));
  openModal({ title: `Update auf MacT-1000 ${st.version}`, body, width: 540, enterConfirms: true, buttons: [
    { label: 'Später', click: () => { VERSION.later = true; renderUpdateBanner(); toast('Update wird beim Beenden installiert.', 3000); } },
    { label: 'Jetzt neu starten', cls: 'primary', click: async () => {
      try { DL.st = await api.update.install({ relaunch: true }); renderUpdateBanner(); }
      catch (e) { toast('Installation nicht möglich: ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 6000); }
    } }] });
}
function showUpdateResult(r) {
  if (!r || DL.result) return;
  DL.result = r;
  if (r.ok) { toast(`MacT-1000 wurde von ${r.from} auf ${r.to} aktualisiert.`, 6000); return; }
  openModal({ title: 'Update fehlgeschlagen', width: 600, body: h('div', null,
    h('p', null, `Die Installation von MacT-1000 ${r.to} hat nicht geklappt – es läuft weiterhin ${r.current || r.from}.`),
    r.log ? h('pre', { class: 'update-notes' }, r.log) : null,
    h('p', { class: 'hint' }, 'Protokoll: ' + (r.logFile || '~/Library/Application Support/MacT-1000/updates/install.log'))),
    buttons: [{ label: 'Release-Seite', click: () => { openRelease(null); } }, { label: 'OK', cls: 'primary', click: () => true }] });
}
function onDlState(st) {
  const prev = DL.st && DL.st.phase;
  DL.st = st;
  renderUpdateBanner();
  if (st.phase === 'ready' && prev !== 'ready') askInstallUpdate(false);
}
// Erinnerung nach „Später“: beim nächsten Start bzw. nach 24 Stunden erneut fragen
const REMIND_MS = 24 * 3600 * 1000;
function remindLater(v) {
  VERSION.later = true;
  DL.remind[v] = Date.now() + REMIND_MS;
  delete DL.prompted[v];
  renderUpdateBanner();
}
function skipVersion(v) {
  localStorage.setItem('updSkip', v);
  renderUpdateBanner();
}
function canDownload(st) { return !(st && (dlBusy(st) || st.phase === 'installing' || st.canInstall === false)); }
async function maybeAutoDownload() {
  const u = updAvail();
  try { DL.auto = await api.update.autoEnabled(); } catch (_) {}
  if (!u || !DL.auto || localStorage.getItem('updSkip') === u.latest) return;
  const st = DL.st;
  // Schon geladen (z. B. aus der letzten Sitzung) – dann nur noch die Neustart-Frage
  if (st && st.phase === 'ready' && st.version === u.latest) { askInstallUpdate(false); return; }
  if (!canDownload(st) && !(st && st.manual)) return;
  if (DL.remind[u.latest] && Date.now() < DL.remind[u.latest]) return;
  if (DL.prompted[u.latest]) return;
  askUpdateAvailable(u);
}
// Hinweis vor dem Laden: jetzt installieren, später erinnern oder überspringen
function askUpdateAvailable(u) {
  if (document.querySelector('#modal-root .upd-new')) return;
  DL.prompted[u.latest] = true;
  VERSION.later = false; renderUpdateBanner();
  const st = DL.st;
  const manual = !!(st && st.manual);
  const notes = String(u.notes || '').trim();
  const body = h('div', { class: 'upd-new' },
    h('p', null, `Eine neue Version von MacT-1000 ist verfügbar: ${u.latest} (hier läuft ${u.current}).`),
    notes ? h('pre', { class: 'update-notes upd-new-notes' }, notes.length > 1500 ? notes.slice(0, 1500) + ' …' : notes) : null,
    h('p', null, releaseLink(u, 'Release-Seite auf GitHub')),
    st && st.needsAdmin ? h('p', { class: 'hint' }, IS_WIN ? `Für ${st.target} sind Administratorrechte nötig – Windows fragt bei der Installation nach (Benutzerkontensteuerung).` : `Für ${st.target} sind Administratorrechte nötig – macOS fragt bei der Installation nach dem Passwort.`) : null,
    h('p', { class: 'hint' }, (manual ? (st.kind === 'portable' ? '„Herunterladen“ startet den Download der neuen portable EXE im Browser – danach MacT-1000 beenden und die alte EXE ersetzen. ' : '„Herunterladen“ startet den Download des neuen Installers im Browser – danach MacT-1000 beenden und den Installer starten. ') : '„Jetzt installieren“ lädt das Update (SHA-256 geprüft); vor dem Neustart wird noch einmal gefragt. ') + '„Später erinnern“ fragt beim nächsten Start bzw. nach 24 Stunden erneut. „Diese Version überspringen“ fragt erst bei der nächsten neueren Version wieder.'));
  openModal({ title: `Neue Version: MacT-1000 ${u.latest}`, body, width: 600, enterConfirms: true, buttons: [
    { label: 'Diese Version überspringen', click: () => { skipVersion(u.latest); toast(`Version ${u.latest} wird übersprungen.`, 3000); } },
    { label: 'Später erinnern', click: () => { remindLater(u.latest); toast('Erinnerung beim nächsten Start bzw. in 24 Stunden.', 3000); } },
    manual ? { label: 'Herunterladen', cls: 'primary', click: () => { VERSION.later = false; delete DL.remind[u.latest]; startUpdateDownload(); } }
      : { label: 'Jetzt installieren', cls: 'primary', click: () => { VERSION.later = false; delete DL.remind[u.latest]; startUpdateDownload(); } }] });
}
function releaseNotesDialog(u) {
  openModal({ title: `MacT-1000 ${u.latest} – Was ist neu?`, width: 620,
    body: h('div', null, h('pre', { class: 'update-notes' }, u.notes || '(keine Beschreibung)'),
      h('p', { class: 'hint' }, 'Quelle: ', releaseLink(u, u.url))),
    buttons: [{ label: 'Schließen', click: () => true }, { label: 'Zur Release-Seite', cls: 'primary', click: () => { openRelease(u); } }] });
}
function initUpdateCheck() {
  $('#update-link').addEventListener('click', (e) => { e.preventDefault(); openRelease(updAvail()); });
  $('#version-download').addEventListener('click', (e) => { e.preventDefault(); openRelease(updAvail()); });
  $('#update-notes').addEventListener('click', () => { const u = updAvail(); if (u) releaseNotesDialog(u); });
  $('#update-later').addEventListener('click', () => { const u = updAvail(); if (u) remindLater(u.latest); else { VERSION.later = true; renderUpdateBanner(); } });
  $('#update-skip').addEventListener('click', () => { const u = updAvail(); if (u) skipVersion(u.latest); });
  $('#update-action').addEventListener('click', onUpdateAction);
  $('#update-cancel').addEventListener('click', async () => { DL.st = await api.update.cancel(); renderUpdateBanner(); });
  api.update.onDl(onDlState);
  api.update.onResult(showUpdateResult);
  api.update.onStatus((u) => applyUpdate(u));
  (async () => {
    try { DL.auto = await api.update.autoEnabled(); } catch (_) {}
    try { DL.st = await api.update.dlStatus(); } catch (_) {}
    try { const r = await api.update.result(); if (r) showUpdateResult(r); } catch (_) {}
    try { const u = await api.update.status(); if (u) applyUpdate(u); } catch (_) {}
  })();
}

function configVersionShort(vi) {
  const w = versionWarnings(vi);
  if (w.length) return 'Achtung: neuer als diese Version (' + w[0].newest + ')';
  const v = vi.shared ? vi.shared.writtenWith : (vi.local.loadedWith || vi.local.writtenWith);
  return 'Geschrieben mit MacT-1000 ' + verText(v);
}

function initVersionCheck() {
  $('#version-details').addEventListener('click', () => configVersionDialog());
  $('#version-hide').addEventListener('click', () => { const b = $('#version-banner'); localStorage.setItem('verWarnOff', b.dataset.key || ''); b.hidden = true; });
  checkConfigVersion();
  initUpdateCheck();
  // Netzwerk-Datei kann sich jederzeit ändern (anderer Rechner mit neuerer Version)
  api.shared.onChanged(() => checkConfigVersion());
  api.shared.onStatus(() => checkConfigVersion());
}

async function sharedConfigDialog() {
  const st = await refreshSharedStatus();
  const dirInp = inp('dir', st.dir || '', { placeholder: '/Volumes/Team/MacT-1000', spellcheck: 'false' });
  const pick = h('button', { class: 'btn small', type: 'button', onclick: async () => { const d = await api.shared.pickDir(dirInp.value || ''); if (d) { dirInp.value = d; probe(); } } }, 'Auswählen…');
  const allL = chk('allSettings', !!st.allSettings, 'Auch allgemeine Einstellungen teilen (Schrift, Farbschema, Cursor, Verhalten …)');
  const tpL = chk('useTeamPass', !!st.teamPassSet, 'Passwörter im Team teilen (verschlüsselt mit gemeinsamer Team-Passphrase)');
  const tpChk = tpL.querySelector('input');
  const tp = inp('teamPass', '', { type: 'password', placeholder: st.teamPassSet ? 'gesetzt – leer lassen = unverändert' : 'mind. 8 Zeichen, auf allen Rechnern gleich', disabled: !st.teamPassSet });
  tpChk.addEventListener('change', () => { tp.disabled = !tpChk.checked; if (tpChk.checked) tp.focus(); });
  const info = h('div', { class: 'shared-probe hint' });
  const keepInp = inp('backupKeep', st.backupKeep ?? 15, { type: 'number', min: 0, max: 500, step: 1, style: { flex: '0 0 90px' } });
  const fmtB = (b) => { const [y, mo, d] = b.date.split('-'); return `${d}.${mo}.${y} ${b.time}`; };
  const bl = st.backups || [];
  const backupInfo = h('span', { class: 'hint' }, st.enabled
    ? (bl.length ? `${bl.length} vorhanden · neuestes: ${fmtB(bl[0])} (Rev. ${bl[0].rev})` + (bl.length > 1 ? ` · ältestes: ${fmtB(bl[bl.length - 1])}` : '') : 'noch keine Backups')
    : 'Gilt für alle Rechner, die den Ordner verwenden. 0 = keine Backups.');
  const backupRow = h('div', { class: 'row-inp' }, keepInp, backupInfo,
    st.enabled ? h('button', { class: 'btn small', type: 'button', style: { marginLeft: 'auto', whiteSpace: 'nowrap', flex: '0 0 auto' }, onclick: () => api.shared.revealBackups() }, 'Im Finder zeigen') : null);
  const modeSel = h('select', { name: 'mode' },
    h('option', { value: 'merge' }, 'Zusammenführen (lokales Adressbuch + Datei)'),
    h('option', { value: 'use' }, 'Datei übernehmen (lokales Adressbuch wird ersetzt)'),
    h('option', { value: 'upload' }, 'Lokale Konfiguration hochladen (Datei wird überschrieben)'));
  const modeField = field('Vorhandene Datei', modeSel);
  modeField.hidden = true;
  const err = h('p', { class: 'hint', style: { color: 'var(--danger)', minHeight: '1em' } }, '');
  const t = sharedStateText(st);
  const statusBox = h('div', { class: 'shared-status ' + t.cls },
    h('b', null, st.enabled ? 'Aktiv' : 'Nicht aktiv'), st.enabled ? h('div', null, st.file) : null, h('div', null, t.long),
    st.enabled ? h('div', null, 'Geschrieben mit MacT-1000 ' + (st.writtenWith || 'unbekannt (vor 1.5.14)')
      + (st.newestAppVersion && st.newestAppVersion !== st.writtenWith ? ` · neueste beteiligte Version: ${st.newestAppVersion}` : '')
      + ` · diese Version: ${st.appVersion || ''}`) : null,
    st.enabled && st.newer ? h('div', { class: 'ver-warn' }, `Die Datei wurde mit einer neueren Version (${st.newestAppVersion}) bearbeitet. Bitte MacT-1000 auf diesem Mac aktualisieren – Einstellungen, die diese Version noch nicht kennt, werden hier nicht angezeigt.`) : null,
    st.enabled && st.secretsState === 'nopass' ? h('div', null, 'Die Datei enthält Team-Passwörter – zum Verwenden Team-Passphrase eintragen.') : null,
    st.enabled && st.secretsState === 'mismatch' ? h('div', null, 'Team-Passphrase passt nicht zur Datei – Passwörter bleiben nur lokal.') : null);

  let probeSeq = 0;
  async function probe() {
    const d = dirInp.value.trim();
    const my = ++probeSeq;
    info.textContent = ''; modeField.hidden = true;
    if (!d || (st.enabled && d === st.dir)) return null;
    info.textContent = 'Prüfe Ordner …';
    const r = await api.shared.probe(d).catch(e => ({ ok: false, error: errText(e) }));
    if (my !== probeSeq) return null;
    if (!r.ok) { info.textContent = '✕ ' + r.error; return r; }
    if (r.exists) {
      info.textContent = `Vorhandene Konfiguration: ${r.sessions} Sessions, ${r.folders} Ordner, ${r.macros} Makros · Revision ${r.rev}`
        + (r.updatedBy ? ` · zuletzt ${r.updatedBy}, ${fmtTime(r.updatedAt)}` : '') + (r.hasSecrets ? ' · enthält Team-Passwörter' : '')
        + ` · geschrieben mit MacT-1000 ${r.writtenWith || 'unbekannt (vor 1.5.14)'}`
        + (r.newer ? ` – ACHTUNG: neuer als diese Version (${r.newestAppVersion}). Bitte zuerst MacT-1000 aktualisieren.` : '');
      modeField.hidden = false;
    } else info.textContent = 'Noch keine Konfiguration im Ordner – die lokale Konfiguration wird dort angelegt.';
    return r;
  }
  dirInp.addEventListener('change', probe);

  const body = h('div', { class: 'settings-form' },
    h('p', { class: 'hint' }, 'Adressbuch, Session-Ordner, Makros und Trigger werden in einer Datei auf einem Netzlaufwerk (SMB/NFS) gespeichert. '
      + 'Alle Rechner mit demselben Ordner arbeiten mit derselben Konfiguration. Gesperrt wird nur kurz während ein Rechner speichert; '
      + 'Änderungen anderer Rechner werden automatisch übernommen (Prüfung alle 2 s).'),
    statusBox,
    field('Ordner auf dem Netzlaufwerk', h('div', { class: 'row-inp' }, dirInp, pick)),
    info, modeField,
    h('div', { class: 'checks' }, allL, tpL),
    field('Team-Passphrase', tp),
    field('Backups behalten (vor jeder Änderung, mit Datum und Uhrzeit)', backupRow),
    h('p', { class: 'hint' }, 'Ohne Team-Passphrase bleiben gespeicherte Passwörter auf jedem Mac lokal (Schlüsselbund-verschlüsselt). '
      + 'Fenstergröße, Seitenleiste, Standard-Shell und Download-Ordner bleiben immer lokal.'),
    err);

  const buttons = [{ label: 'Abbrechen', click: () => {} }];
  if (st.enabled) {
    buttons.unshift({ label: 'Trennen', cls: 'danger', click: async () => {
      if (!(await confirmDialog('Netzwerk-Konfiguration trennen', 'Der aktuelle gemeinsame Stand wird als lokale Konfiguration dieses Macs übernommen. Weitere Änderungen werden nicht mehr geteilt. Fortfahren?', 'Trennen'))) return false;
      try { await api.shared.disable(); await reloadFromShared({ silent: true }); toast('Netzwerk-Konfiguration getrennt – lokale Kopie aktiv'); }
      catch (e) { err.textContent = errText(e); return false; }
    } });
    buttons.splice(1, 0, { label: 'Jetzt abgleichen', click: async () => { await api.shared.syncNow(); await reloadFromShared({ silent: true }); toast(sharedStateText(SHARED.status).long, 3000); return false; } });
  }
  buttons.push({ label: st.enabled ? 'Übernehmen' : 'Aktivieren', cls: 'primary', click: async () => {
    err.textContent = '';
    const d = dirInp.value.trim();
    const wantTp = tpChk.checked;
    const tpVal = tp.value;
    if (wantTp && tpVal && tpVal.length < 8) { err.textContent = 'Team-Passphrase muss mindestens 8 Zeichen haben.'; tp.focus(); return false; }
    if (wantTp && !tpVal && !st.teamPassSet) { err.textContent = 'Bitte Team-Passphrase eingeben.'; tp.focus(); return false; }
    const all = !!allL.querySelector('input').checked;
    const keep = Number(keepInp.value);
    if (!Number.isInteger(keep) || keep < 0 || keep > 500) { err.textContent = 'Anzahl der Backups: ganze Zahl von 0 bis 500.'; keepInp.focus(); return false; }
    try {
      if (st.enabled && d === st.dir) {
        const o = { allSettings: all, backupKeep: keep };
        if (!wantTp && st.teamPassSet) o.teamPass = '';
        else if (wantTp && tpVal) o.teamPass = tpVal;
        await api.shared.update(o);
        await reloadFromShared({ silent: true });
        toast('Netzwerk-Konfiguration aktualisiert');
        return;
      }
      if (!d) { err.textContent = 'Bitte einen Ordner auf dem Netzlaufwerk wählen.'; return false; }
      const r = await probe();
      if (!r || !r.ok) { err.textContent = (r && r.error) || 'Ordner nicht nutzbar'; return false; }
      const mode = r.exists ? modeSel.value : 'upload';
      if (r.exists && mode !== 'merge' && !(await confirmDialog('Konfiguration ersetzen',
        mode === 'use' ? 'Das lokale Adressbuch und die Makros dieses Macs werden durch die Datei ersetzt. Fortfahren?' : 'Die Konfiguration auf dem Netzlaufwerk wird durch die dieses Macs ersetzt – auch für alle anderen Rechner. Fortfahren?', 'Ersetzen'))) return false;
      await api.shared.enable({ dir: d, mode, allSettings: all, teamPass: wantTp ? (tpVal || '') : '', backupKeep: keep });
      await reloadFromShared({ silent: true });
      toast('Netzwerk-Konfiguration aktiv: ' + d, 3200);
    } catch (e) { err.textContent = errText(e); return false; }
  } });
  openModal({ title: 'Netzwerk-Konfiguration', body, width: 640, buttons });
  if (!st.enabled) setTimeout(() => dirInp.focus(), 40);
}
