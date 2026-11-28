'use strict';
const { app, BrowserWindow, ipcMain, Menu, shell, dialog, clipboard, nativeTheme, nativeImage, safeStorage } = require('electron');
const { randomUUID } = require('node:crypto');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const { SessionManager } = require('./sessions');
const i18n = require('../renderer/i18n.js');
const T = (x) => i18n.t(x);

let win = null;
const IS_WIN = process.platform === 'win32';
// Windows (portable EXE): Pfad der gestarteten .exe – nicht der entpackte Ordner im Temp-Verzeichnis
const winExe = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

// ---------- Sprache (Deutsch/Englisch) ----------
function systemLangs() {
  try { const l = app.getPreferredSystemLanguages(); if (l && l.length) return l; } catch (_) {}
  try { return [app.getLocale()]; } catch (_) { return []; }
}
/** Einstellung „language“ ('auto' | 'de' | 'en') auswerten; auto = Sprache des Systems */
function updateLanguage() {
  let setting = 'auto';
  try { setting = store.getSettings().language || 'auto'; } catch (_) {}
  return i18n.setLang(i18n.resolve(process.env.MACT_LANG || setting, systemLangs()));
}
ipcMain.on('i18n:get', (e) => { e.returnValue = i18n.lang; });
ipcMain.handle('i18n:system', () => i18n.resolve('auto', systemLangs()));
// native Dialoge (Meldungen, Öffnen/Sichern) in der eingestellten Sprache
(function translateDialogs() {
  const tr = (o) => {
    if (!o || typeof o !== 'object' || o instanceof BrowserWindow) return o;
    const r = { ...o };
    for (const k of ['title', 'message', 'detail', 'buttonLabel', 'checkboxLabel', 'nameFieldLabel']) if (typeof r[k] === 'string') r[k] = T(r[k]);
    if (Array.isArray(r.buttons)) r.buttons = r.buttons.map(T);
    if (Array.isArray(r.filters)) r.filters = r.filters.map(f => ({ ...f, name: T(f.name) }));
    return r;
  };
  for (const fn of ['showMessageBox', 'showMessageBoxSync', 'showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync']) {
    const orig = dialog[fn].bind(dialog);
    dialog[fn] = (a, b) => (b === undefined ? orig(tr(a)) : orig(a, tr(b)));
  }
})();
/** Menüvorlage rekursiv übersetzen */
function trMenu(items) {
  return items.map((it) => {
    const o = { ...it };
    if (typeof o.label === 'string') o.label = T(o.label);
    if (Array.isArray(o.submenu)) o.submenu = trMenu(o.submenu);
    return o;
  });
}

// ---------- Aufrufe von außen (Kommandozeile, mact1000://-Links) ----------
const launch = require('./launch');
const extQueue = [];
let extReady = false;
function focusWin() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (process.platform === 'darwin') { try { app.focus({ steal: true }); } catch (_) {} }
}
function pushExternal(batch) {
  if (!batch) return;
  batch.at = Date.now();
  if (extReady && win && !win.isDestroyed()) { win.webContents.send('ext:open', batch); focusWin(); }
  else extQueue.push(batch);
}
// Nur eine Instanz: weitere Aufrufe (open -n … --args) geben ihre Argumente an die laufende ab
// Chromium sortiert die Kommandozeile der zweiten Instanz um – deshalb die Original-Argumente mitschicken
const gotLock = process.env.MACT_MULTI_INSTANCE ? true : app.requestSingleInstanceLock({ argv: process.argv.slice(1) });
if (!gotLock) app.quit();
app.on('second-instance', (_e, argv, _cwd, extra) => {
  const b = launch.parseArgs(extra && Array.isArray(extra.argv) ? extra.argv : argv.slice(1));
  if (b) pushExternal(b); else focusWin();
});
app.on('open-url', (e, url) => { e.preventDefault(); pushExternal(launch.parseUrl(url)); });
if (gotLock) { const b0 = launch.parseArgs(process.argv.slice(1)); if (b0) pushExternal(b0); }
ipcMain.handle('ext:ready', () => { extReady = true; return extQueue.splice(0); });
ipcMain.handle('ext:simulate', (_e, kind, x) => { // für den Hilfe-Dialog („Ausprobieren“) und Tests
  const b = kind === 'url' ? launch.parseUrl(String(x)) : launch.parseArgs(Array.isArray(x) ? x : [], 'cli');
  if (b) pushExternal(b);
  return !!b;
});
// --log: Ausgabe eines Panes an eine Datei anhängen (nur Pfade, die vorher über ext:logOpen geöffnet wurden)
const extLogs = new Set();
const extLogPath = (p) => path.resolve(String(p || '').replace(/^~(?=[\\/]|$)/, app.getPath('home')));
ipcMain.handle('ext:logOpen', (_e, p, header) => {
  const f = extLogPath(p);
  if (!path.isAbsolute(f) || f.endsWith(path.sep)) throw new Error('Ungültiger Pfad');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  try { if (fs.statSync(f).isDirectory()) throw new Error(`${f} ist ein Ordner`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  fs.appendFileSync(f, String(header || ''));
  extLogs.add(f);
  return f;
});
ipcMain.on('ext:logWrite', (_e, f, text) => {
  if (!extLogs.has(f)) return;
  try { fs.appendFileSync(f, String(text)); } catch (_) {}
});
// --share-info: Verbindungsdaten einer Freigabe als JSON schreiben (nur für den Benutzer lesbar)
ipcMain.handle('share:writeInfo', (_e, p, data) => {
  const f = extLogPath(p);
  if (!path.isAbsolute(f) || f.endsWith(path.sep)) throw new Error(T('Ungültiger Pfad'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  try { if (fs.statSync(f).isDirectory()) throw new Error(T(`${f} ist ein Ordner`)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(f, 0o600); } catch (_) {}
  return f;
});
// --quit: nur aufrufen, wenn keine anderen Sessions mehr laufen
ipcMain.handle('ext:quit', () => { setTimeout(() => app.quit(), 100); return true; });
const cliTool = () => {
  const p = app.isPackaged ? path.join(process.resourcesPath, 'bin', 'mact1000') : path.join(__dirname, '..', 'build', 'bin', 'mact1000');
  return p;
};
const CLI_LINK = '/usr/local/bin/mact1000';
ipcMain.handle('ext:info', () => {
  if (IS_WIN) {
    const exe = winExe();
    let registered = false;
    try { registered = app.isPackaged && app.isDefaultProtocolClient(launch.SCHEME, exe, []); } catch (_) {}
    return { win: true, tool: exe, exe, installed: registered, packaged: app.isPackaged, scheme: launch.SCHEME, version: app.getVersion(), portable: !!process.env.PORTABLE_EXECUTABLE_FILE };
  }
  let linked = '';
  try { linked = fs.realpathSync(CLI_LINK); } catch (_) {}
  const tool = cliTool();
  let toolReal = tool; try { toolReal = fs.realpathSync(tool); } catch (_) {}
  const bundle = app.isPackaged ? path.resolve(process.execPath, '..', '..', '..') : '';
  return { tool, link: CLI_LINK, installed: !!linked && linked === toolReal, linkedElsewhere: !!linked && linked !== toolReal,
    bundle, packaged: app.isPackaged, scheme: launch.SCHEME, version: app.getVersion() };
});
ipcMain.handle('ext:uninstallCli', () => {
  if (IS_WIN && app.isPackaged) {
    try { for (const sc of require('./compat').LEGACY_SCHEMES) app.removeAsDefaultProtocolClient(sc, winExe(), []); } catch (_) {}
    try { return app.removeAsDefaultProtocolClient(launch.SCHEME, winExe(), []); } catch (_) { return false; }
  }
  return false;
});
ipcMain.handle('ext:installCli', async () => {
  if (IS_WIN) {
    // Windows: mact1000://-Links für diese EXE registrieren (nur für den angemeldeten Benutzer, HKCU)
    if (!app.isPackaged) throw new Error('Nur in der fertigen EXE möglich');
    if (!app.setAsDefaultProtocolClient(launch.SCHEME, winExe(), [])) throw new Error('Registrierung abgelehnt');
    try { for (const sc of require('./compat').LEGACY_SCHEMES) app.setAsDefaultProtocolClient(sc, winExe(), []); } catch (_) {}
    return true;
  }
  if (process.platform !== 'darwin') throw new Error('Nur unter macOS');
  const tool = cliTool();
  if (!fs.existsSync(tool)) throw new Error('Werkzeug nicht gefunden: ' + tool);
  const q = (x) => "'" + String(x).replace(/'/g, "'\\''") + "'";
  const sh = `mkdir -p /usr/local/bin && ln -sf ${q(tool)} ${CLI_LINK}`;
  const { execFile } = require('child_process');
  // erst ohne Administratorrechte, sonst mit Passwortabfrage von macOS
  const run = (file, args) => new Promise((res, rej) => execFile(file, args, { timeout: 120000 }, (e, _o, er) => e ? rej(new Error(String(er || e.message).trim())) : res()));
  try { await run('/bin/sh', ['-c', sh]); }
  catch (_) { await run('/usr/bin/osascript', ['-e', `do shell script ${JSON.stringify(sh)} with administrator privileges`]); }
  return true;
});
const sessions = new SessionManager((channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
});

// ---------- Pane-Freigabe (andere MacT-1000 schauen zu oder schreiben mit) ----------
const shareMod = require('./share');
const toWin = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const snapWaiters = new Map();
let snapSeq = 0;
const shareHost = new shareMod.ShareHost({
  hostKeyFile: () => path.join(app.getPath('userData'), 'share-hostkey'),
  settings: () => store.getSettings(),
  emit: toWin,
  write: (sid, d) => sessions.write(sid, d),
  snapshot: (sid) => new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve(null);
    const reqId = ++snapSeq;
    const t = setTimeout(() => { snapWaiters.delete(reqId); resolve(null); }, 5000);
    snapWaiters.set(reqId, (v) => { clearTimeout(t); resolve(v); });
    win.webContents.send('share:snapReq', { reqId, sid });
  })
});
sessions.tap = (kind, id, a, b) => {
  if (kind === 'data') shareHost.onData(id, a, b);
  else if (kind === 'exit') shareHost.onExit(id);
  else if (kind === 'resize') shareHost.onResize(id, a, b);
};
const shareDefaultName = () => { const st = store.getSettings(); return st.shareViewerName || `${require('os').userInfo().username}@${require('os').hostname()}`; };
const shareGuard = (s) => { if (!store.getSettings().shareAllow) throw new Error(T('Freigaben sind auf diesem Rechner nicht erlaubt (Einstellungen → Freigaben).')); return s; };
ipcMain.on('share:snapReply', (_e, reqId, v) => { const r = snapWaiters.get(reqId); if (r) { snapWaiters.delete(reqId); r(v); } });
ipcMain.handle('share:info', () => ({ ...shareHost.info(), shares: shareHost.list(), viewerName: shareDefaultName() }));
ipcMain.handle('share:genPassword', () => shareMod.generatePassword());
ipcMain.handle('share:start', async (_e, sid, o) => { try { shareGuard(); return { ok: true, share: await shareHost.add({ ...o, sid }) }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } });
ipcMain.handle('share:update', (_e, id, patch) => { try { return { ok: true, share: shareHost.update(id, patch) }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } });
ipcMain.handle('share:stop', (_e, id) => shareHost.stop(id).then(() => true));
ipcMain.handle('share:setWrite', (_e, id, vid, on) => shareHost.setWrite(id, vid, on));
ipcMain.handle('share:deny', (_e, id, vid) => shareHost.deny(id, vid));
ipcMain.handle('share:kick', (_e, id, vid) => shareHost.kick(id, vid));
ipcMain.handle('share:rebind', (_e, id, sid) => shareHost.rebind(id, sid));
ipcMain.handle('share:known', () => shareMod.readKnown(shareMod.knownFile()));
ipcMain.handle('share:forget', (_e, key) => { const m = shareMod.readKnown(shareMod.knownFile()); delete m[key]; shareMod.writeKnown(shareMod.knownFile(), m); return m; });

// Electron-Apps aus dem Finder starten mit minimalem PATH – Login-Shell-PATH übernehmen
function fixPath() {
  if (process.platform !== 'darwin') return;
  try {
    const { execFileSync } = require('child_process');
    const sh = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(sh, ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'], { encoding: 'utf8', timeout: 4000 });
    const m = out.match(/__PATH__(.*)__PATH__/);
    if (m && m[1]) process.env.PATH = m[1];
  } catch (_) {
    process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin', process.env.PATH].join(':');
  }
}

// Im Schlüsselbund gespeicherte Schlüssel in den ssh-agent laden (z.B. für Jump-Hosts / Agent-Forwarding)
function loadKeychainKeys() {
  if (process.platform !== 'darwin' || store.getSettings().loadKeychainKeys === false) return;
  try { require('child_process').execFile('/usr/bin/ssh-add', ['--apple-load-keychain'], { timeout: 8000 }, () => {}); } catch (_) {}
}

function createWindow() {
  const st = store.getSettings();
  win = new BrowserWindow({
    width: st.windowWidth || 1400,
    height: st.windowHeight || 900,
    minWidth: 700,
    minHeight: 400,
    ...(IS_WIN ? { icon: path.join(__dirname, '..', 'renderer', 'icon.png'), autoHideMenuBar: false } : { titleBarStyle: 'hiddenInset' }),
    backgroundColor: '#1b1d23',
    title: 'MacT-1000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // kurz nach dem Start auf neue Version prüfen (blockiert den Start nicht)
  win.webContents.once('did-finish-load', () => setTimeout(() => runUpdateCheck(false).catch(() => {}), Number(process.env.MACT_UPDATE_DELAY || 2500)));
  win.on('resize', () => {
    const [w, h] = win.getSize();
    store.saveSettings({ ...store.getSettings(), windowWidth: w, windowHeight: h });
  });
  win.on('close', (e) => { if (!confirmQuit()) e.preventDefault(); });
  win.on('closed', () => { win = null; });
  // Links aus dem Terminal im Standardbrowser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

// Rückfrage beim Schließen des Fensters / Beenden, solange Verbindungen aktiv sind
let quitConfirmed = false;
function confirmQuit() {
  if (quitConfirmed) return true;
  if (store.getSettings().confirmCloseActive === false) return true;
  const list = sessions.activeConnections();
  for (const sh of shareHost.list()) if (sh.viewers.length) list.push(T(`Freigabe „${sh.name}“: ${sh.viewers.length} Zuschauer`));
  if (!list.length) return true;
  const n = list.length;
  const opts = {
    type: 'warning',
    buttons: ['Beenden', 'Abbrechen'],
    defaultId: 0, cancelId: 1, // Enter = Beenden (Verbindungen trennen), Esc = Abbrechen
    message: n === 1 ? 'Es besteht noch eine aktive Verbindung.' : `Es bestehen noch ${n} aktive Verbindungen.`,
    detail: list.slice(0, 12).join('\n') + (n > 12 ? '\n…' : '') + '\n\nMacT-1000 trotzdem beenden? Alle Verbindungen werden getrennt.'
  };
  const r = win ? dialog.showMessageBoxSync(win, opts) : dialog.showMessageBoxSync(opts);
  if (r === 0) { quitConfirmed = true; return true; }
  return false;
}

function send(cmd) { if (win) win.webContents.send('menu', cmd); }

function buildMenu() {
  const tpl = [
    { role: 'appMenu', submenu: [
      { role: 'about', label: 'Über MacT-1000' },
      { label: 'Nach Updates suchen…', click: () => send('checkUpdates') },
      { label: 'Konfigurationsversion…', click: () => send('configVersion') },
      { label: 'Aufruf von außen (Automator, Terminal)…', click: () => send('externalHelp') },
      { type: 'separator' },
      { label: 'Einstellungen…', accelerator: 'Cmd+,', click: () => send('settings') },
      { type: 'separator' },
      { role: 'hide', label: 'MacT-1000 ausblenden' },
      { role: 'hideOthers', label: 'Andere ausblenden' },
      { type: 'separator' },
      { role: 'quit', label: 'MacT-1000 beenden' }
    ]},
    { label: 'Ablage', submenu: [
      { label: 'Neuer Tab (lokale Shell)', accelerator: 'Cmd+T', click: () => send('newTab') },
      { label: 'Neue Session…', accelerator: 'Cmd+N', click: () => send('newSession') },
      { label: 'Quick Connect', accelerator: 'Cmd+K', click: () => send('quickConnect') },
      { type: 'separator' },
      { label: 'Pane schließen', accelerator: 'Cmd+W', click: () => send('closePane') },
      { label: 'Tab schließen', accelerator: 'Cmd+Shift+W', click: () => send('closeTab') },
      { type: 'separator' },
      { label: 'SSH-Schlüssel im Schlüsselbund hinterlegen…', click: () => send('keychainKey') },
      { label: 'Standard-SSH-Schlüssel im Schlüsselbund hinterlegen', click: () => send('keychainDefault') },
      { type: 'separator' },
      { label: 'Gesamte Konfiguration exportieren…', accelerator: 'Cmd+Shift+E', click: () => send('exportConfig') },
      { label: 'Konfiguration importieren…', click: () => send('importConfig') },
      { label: 'Sessions aus CSV importieren…', click: () => send('importCsv') },
      { id: 'importSessionExport', label: `Sitzungsexport importieren (.${SESSION_EXPORT_EXTENSION})…`, click: () => send('importSessionExport') },
      { label: 'Netzwerk-Konfiguration (gemeinsam nutzen)…', click: () => send('sharedConfig') },
      { label: 'Nur Adressbuch exportieren (ohne Passwörter)…', click: exportSessions }
    ]},
    { label: 'Bearbeiten', submenu: [
      { role: 'undo', label: 'Widerrufen' },
      { role: 'redo', label: 'Wiederholen' },
      { type: 'separator' },
      { role: 'cut', label: 'Ausschneiden' },
      { role: 'copy', label: 'Kopieren' },
      { role: 'paste', label: 'Einfügen' },
      { label: 'Alles auswählen', accelerator: 'Cmd+A', click: () => send('selectAll') },
      { type: 'separator' },
      { label: 'Suchen…', accelerator: 'Cmd+F', click: () => send('find') },
      { label: 'Terminal leeren', accelerator: 'Cmd+L', click: () => send('clear') },
      { type: 'separator' },
      { label: 'Multi-Paste…', accelerator: 'Cmd+Shift+V', click: () => send('multiPaste') },
      { label: 'Multi-Input ein/aus', accelerator: 'Cmd+Shift+I', click: () => send('toggleMultiInput') },
      { label: 'Alle Panes im Tab für Multi-Input wählen', accelerator: 'Cmd+Shift+A', click: () => send('broadcastSelectTab') }
    ]},
    { label: 'Makros', submenu: [
      { label: 'Makro ausführen…', accelerator: 'Cmd+Shift+M', click: () => send('macroRun') },
      { label: 'Aufzeichnung starten/stoppen', accelerator: 'Cmd+Shift+R', click: () => send('macroRecord') },
      { label: 'Laufende Makros stoppen', accelerator: 'Cmd+.', click: () => send('macroStop') },
      { type: 'separator' },
      { label: 'Makros verwalten…', click: () => send('macroManage') },
      { label: 'Auto-Antworten…', click: () => send('macroTriggers') }
    ]},
    { label: 'Ansicht', submenu: [
      { label: 'Vertikal teilen (nebeneinander)', accelerator: 'Cmd+D', click: () => send('splitV') },
      { label: 'Horizontal teilen (untereinander)', accelerator: 'Cmd+Shift+D', click: () => send('splitH') },
      { label: 'Session in neuem Pane duplizieren', accelerator: 'Cmd+Alt+D', click: () => send('duplicate') },
      { label: 'Neu verbinden / Verbindung duplizieren', accelerator: 'Cmd+R', click: () => send('reconnectOrDuplicate') },
      { label: 'Tab duplizieren', accelerator: 'Cmd+Alt+Shift+D', click: () => send('duplicateTab') },
      { type: 'separator' },
      { label: 'Nächstes Pane', accelerator: 'Cmd+]', click: () => send('nextPane') },
      { label: 'Vorheriges Pane', accelerator: 'Cmd+[', click: () => send('prevPane') },
      { label: 'Nächstes Pane (alle Tabs)', accelerator: 'Cmd+Right', registerAccelerator: false, click: () => send('nextPaneGlobal') },
      { label: 'Vorheriges Pane (alle Tabs)', accelerator: 'Cmd+Left', registerAccelerator: false, click: () => send('prevPaneGlobal') },
      { label: 'Pane maximieren ein/aus', accelerator: 'Cmd+Shift+Enter', click: () => send('zoomPane') },
      { label: 'Panes gleichmäßig verteilen', accelerator: 'Cmd+Alt+=', click: () => send('equalize') },
      { type: 'separator' },
      { label: 'Nächster Tab', accelerator: 'Cmd+Shift+]', click: () => send('nextTab') },
      { label: 'Vorheriger Tab', accelerator: 'Cmd+Shift+[', click: () => send('prevTab') },
      { type: 'separator' },
      { label: 'Seitenleiste ein/aus', accelerator: 'Cmd+B', click: () => send('toggleSidebar') },
      { label: 'Datei-Browser (SCP) ein/aus', accelerator: 'Cmd+Shift+F', click: () => send('toggleFiles') },
      { label: 'Server anzeigen (TFTP, FTP, HTTP, SFTP)', accelerator: 'Cmd+Alt+T', click: () => send('toggleServers') },
      { label: 'Schrift größer', accelerator: 'Cmd+Plus', click: () => send('fontInc') },
      { label: 'Schrift kleiner', accelerator: 'Cmd+-', click: () => send('fontDec') },
      { label: 'Schrift zurücksetzen', accelerator: 'Cmd+0', click: () => send('fontReset') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Vollbild' },
      { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' }
    ]},
    { role: 'windowMenu', label: 'Fenster' }
  ];
  // Tab 1..9
  const tabMenu = tpl.find(m => m.label === 'Ansicht').submenu;
  for (let i = 1; i <= 9; i++) {
    tabMenu.push({ label: `Tab ${i}`, accelerator: `Cmd+${i}`, visible: false, click: () => send('tab' + i) });
  }
  const useWindowsMenu = (process.env.MACT_TEST_PLATFORM || process.platform) === 'win32';
  Menu.setApplicationMenu(Menu.buildFromTemplate(trMenu(useWindowsMenu ? winMenu(tpl) : tpl)));
}

/**
 * Windows-Menü aus dem macOS-Menü ableiten. Tastenkürzel mit Strg+Umschalt bzw. Alt+Umschalt
 * (wie Windows Terminal), damit Strg+C, Strg+D, Strg+W usw. im Terminal frei bleiben. Strg+Alt wird gemieden (= AltGr).
 */
const WIN_ACC = {
  'Cmd+,': 'Ctrl+,', 'Cmd+T': 'Ctrl+Shift+T', 'Cmd+N': 'Ctrl+Shift+S', 'Cmd+K': 'Ctrl+Shift+K',
  'Cmd+W': 'Ctrl+Shift+W', 'Cmd+Shift+W': 'Ctrl+Shift+Q', 'Cmd+Shift+E': null,
  'Cmd+A': 'Ctrl+Shift+A', 'Cmd+F': 'Ctrl+Shift+F', 'Cmd+L': 'Ctrl+Shift+L',
  'Cmd+Shift+V': 'Ctrl+Shift+M', 'Cmd+Shift+I': 'Ctrl+Shift+I', 'Cmd+Shift+A': 'Alt+Shift+A',
  'Cmd+Shift+M': 'Alt+Shift+M', 'Cmd+Shift+R': 'Alt+Shift+R', 'Cmd+.': 'Ctrl+.',
  'Cmd+D': 'Ctrl+Shift+E', 'Cmd+Shift+D': 'Ctrl+Shift+O', 'Cmd+Alt+D': 'Alt+Shift+D', 'Cmd+R': 'Ctrl+Shift+R',
  'Cmd+Alt+Shift+D': 'Alt+Shift+T', 'Cmd+]': 'Ctrl+Shift+N', 'Cmd+[': 'Ctrl+Shift+P',
  'Cmd+Right': 'Alt+Shift+Right', 'Cmd+Left': 'Alt+Shift+Left', 'Cmd+Shift+Enter': 'Ctrl+Shift+X', 'Cmd+Alt+=': 'Ctrl+Shift+G',
  'Cmd+Shift+]': 'Ctrl+PageDown', 'Cmd+Shift+[': 'Ctrl+PageUp', 'Cmd+B': 'Ctrl+Shift+B', 'Cmd+Shift+F': 'Ctrl+Shift+D',
  'Cmd+Alt+T': 'Alt+Shift+S', 'Cmd+Plus': 'Ctrl+Plus', 'Cmd+-': 'Ctrl+-', 'Cmd+0': 'Ctrl+0'
};
for (let i = 1; i <= 9; i++) WIN_ACC[`Cmd+${i}`] = `Alt+${i}`;
function winMenu(tpl) {
  const mapItems = (items) => items.map((it) => {
    const o = { ...it };
    if (o.accelerator) { const a = WIN_ACC[o.accelerator]; if (a) o.accelerator = a; else delete o.accelerator; }
    if (o.submenu) o.submenu = mapItems(o.submenu);
    return o;
  });
  const appItems = tpl[0].submenu;
  const pick = (label) => appItems.find(i => i.label === label);
  const out = [];
  for (const m of tpl.slice(1)) {
    if (m.role === 'windowMenu') continue;
    let sub = m.submenu.filter(i => !/Schlüsselbund/.test(i.label || ''));
    sub = sub.filter((i, k, arr) => !(i.type === 'separator' && (k === 0 || arr[k - 1].type === 'separator')));
    if (m.label === 'Ablage') {
      out.push({ label: 'Datei', submenu: mapItems([...sub, { type: 'separator' }, pick('Einstellungen…'), { type: 'separator' }, { role: 'quit', label: 'Beenden', accelerator: 'Alt+F4' }]) });
    } else if (m.label === 'Bearbeiten') {
      const rest = sub.filter(i => !['undo', 'redo', 'cut', 'copy', 'paste'].includes(i.role)).filter((i, k) => !(k === 0 && i.type === 'separator'));
      out.push({ label: 'Bearbeiten', submenu: mapItems([
        { label: 'Kopieren', accelerator: 'Ctrl+Shift+C', click: () => send('copy') },
        { label: 'Einfügen', accelerator: 'Ctrl+Shift+V', click: () => send('paste') }, ...rest]) });
    } else if (m.label === 'Ansicht') {
      const v = mapItems(sub).map(i => i.role === 'togglefullscreen' ? { ...i, accelerator: 'F11' } : i.role === 'toggleDevTools' ? { ...i, accelerator: 'F12' } : i);
      v.push({ label: 'Nächster Tab', accelerator: 'Ctrl+Tab', visible: false, click: () => send('nextTab') });
      v.push({ label: 'Vorheriger Tab', accelerator: 'Ctrl+Shift+Tab', visible: false, click: () => send('prevTab') });
      v.push({ label: 'Schrift größer', accelerator: 'Ctrl+=', visible: false, click: () => send('fontInc') });
      out.push({ label: 'Ansicht', submenu: v });
    } else out.push({ ...m, submenu: mapItems(sub) });
  }
  out.push({ label: 'Hilfe', submenu: [
    pick('Nach Updates suchen…'), pick('Konfigurationsversion…'),
    { label: 'Aufruf von außen (Kommandozeile, Verknüpfungen, Links)…', click: () => send('externalHelp') },
    { type: 'separator' }, { label: 'Über MacT-1000', click: showAbout }] });
  return out;
}
const ABOUT_CREDITS = 'Der Name spielt auf den T-1000 aus „Terminator 2“ an – den Terminator aus Flüssigmetall, '
  + 'der sich teilen und wieder zu einem Ganzen zusammenfließen kann. Genau das tun auch die Fenster '
  + 'von MacT-1000: Sessions lassen sich beliebig horizontal und vertikal teilen, '
  + 'per Drag & Drop neu anordnen und wieder zusammenführen.\n\n„Mac“ steht für die Plattform, '
  + 'auf der MacT-1000 entstanden ist, „T“ zugleich für Terminal. Inzwischen gibt es MacT-1000 auch für Windows.\n\nVeröffentlicht unter der MIT-Lizenz.';
function setAboutPanel() {
  if (IS_WIN) return;
  app.setAboutPanelOptions({
    applicationName: 'MacT-1000',
    applicationVersion: app.getVersion(),
    version: '',
    copyright: 'Copyright © 2026 Harald Thomas',
    credits: T(ABOUT_CREDITS)
  });
}
function showAbout() {
  dialog.showMessageBox(win, {
    type: 'none', title: 'Über MacT-1000', message: `MacT-1000 ${app.getVersion()}`,
    detail: `Copyright © 2026 Harald Thomas\n\n${ABOUT_CREDITS}`,
    icon: require('electron').nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'icon.png')),
    buttons: ['OK']
  });
}

async function exportSessions() {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'mact1000-sessions.json' });
  if (r.canceled || !r.filePath) return;
  // Passwörter nicht exportieren
  const list = store.getSessions().map(({ password, passwordEnc, ...rest }) => rest);
  fs.writeFileSync(r.filePath, JSON.stringify(list, null, 2));
}
// ---------- Gesamte Konfiguration ----------
const configIO = require('./config-io');
let pendingImport = null;
ipcMain.handle('config:export', async (_e, { includePasswords, passphrase, ui } = {}) => {
  const data = configIO.buildExport({
    sessions: store.getSessions(), settings: Object.fromEntries(Object.entries(store.getSettings()).filter(([k]) => !k.startsWith('shared'))), ui,
    includePasswords: !!includePasswords, passphrase, appVersion: store.appVersion(),
    folderPasswords: includePasswords ? store.getFolderPasswords() : {}
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(win, {
    title: 'Konfiguration exportieren',
    defaultPath: path.join(app.getPath('documents'), `mact1000-konfiguration-${stamp}.json`),
    filters: [{ name: 'MacT-1000-Konfiguration', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  return { path: r.filePath, sessions: data.sessions.length, passwords: data.secretsCount || 0 };
});
ipcMain.handle('config:pickImport', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Konfiguration importieren', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  pendingImport = configIO.parseImport(fs.readFileSync(r.filePaths[0], 'utf8'));
  const sum = configIO.summary(pendingImport);
  return { file: path.basename(r.filePaths[0]), ...sum, appCurrent: store.appVersion(), newer: require('./version').isNewer(sum.appVersion, store.appVersion()) };
});
ipcMain.handle('config:applyImport', async (_e, { mode = 'merge', sessions = true, settings = true, ui = true, passphrase = '' } = {}) => {
  const p = pendingImport;
  if (!p) throw new Error('Keine Datei gewählt');
  const passwords = p.secrets && passphrase ? configIO.decryptSecrets(p.secrets, passphrase) : {};
  const res = { added: 0, updated: 0, passwords: Object.keys(passwords).length, settings: false };
  const fpw = configIO.folderSecrets(passwords);
  if (sessions && Object.keys(fpw).length) store.saveFolderPasswords(mode === 'replace' ? fpw : { ...store.getFolderPasswords(), ...fpw });
  res.folderPasswords = Object.keys(fpw).length;
  if (sessions) {
    const m = configIO.mergeSessions(store.getSessions(), p.sessions, { mode, passwords });
    await store.saveSessions(m.list);
    res.added = m.added; res.updated = m.updated;
  }
  if (settings && p.settings) { await store.saveSettings({ ...store.getSettings(), ...p.settings }, { patch: p.settings }); res.settings = true; }
  res.ui = ui && p.ui ? p.ui : null;
  pendingImport = null;
  return res;
});

// ---------- CSV-Import (Sessions/Lesezeichen mit Ordnern) ----------
function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le'), encoding: 'UTF-16' };
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return { text: b.toString('utf16le'), encoding: 'UTF-16' }; }
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' }; }
  catch (_) { return { text: new TextDecoder('windows-1252').decode(buf), encoding: 'Windows-1252' }; }
}
ipcMain.handle('csv:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Sessions aus CSV importieren', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv', 'txt', 'tsv'] }, { name: 'Alle Dateien', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const st = fs.statSync(r.filePaths[0]);
  if (st.size > 20 * 1024 * 1024) return { error: 'Die Datei ist zu groß (max. 20 MB)' };
  const d = decodeText(fs.readFileSync(r.filePaths[0]));
  return { name: path.basename(r.filePaths[0]), ...d };
});
// ---------- Import von Sitzungsexporten ----------
const sessImport = require('./sess-import');
let pendingSessionImport = null;
let sessionImportBusy = false;
const SESSION_EXPORT_EXTENSION = ['mo', 'baconf'].join('');
ipcMain.handle('xi:pick', async () => {
  pendingSessionImport = null;
  try {
    const r = await dialog.showOpenDialog(win, {
      title: 'Sitzungsexport importieren', properties: ['openFile'],
      filters: [
        { name: 'Konfigurationsexport', extensions: [SESSION_EXPORT_EXTENSION] },
        { name: 'Sitzungsexport', extensions: ['mxtsessions', 'ini'] },
        { name: 'Alle Dateien', extensions: ['*'] }
      ]
    });
    const fp = r.filePaths[0];
    if (r.canceled || !fp) return { canceled: true };
    const st = fs.statSync(fp);
    if (!st.isFile() || st.size > 10 * 1024 * 1024) return { error: 'Datei nicht lesbar oder größer als 10 MB.' };
    const { text } = decodeText(fs.readFileSync(fp));
    pendingSessionImport = { text, sessions: null };
    return { name: path.basename(fp), folder: sessImport.IMPORT_FOLDER };
  } catch (_) { return { error: 'Sitzungsexport konnte nicht gelesen werden.' }; }
});
ipcMain.handle('xi:analyze', (_e, master = '') => {
  const p = pendingSessionImport;
  if (!p || typeof master !== 'string' || master.length > 4096) return { error: 'Sitzungsexport konnte nicht gelesen werden.' };
  const r = sessImport.analyze(p.text, master);
  p.sessions = r.recognized && !r.failed ? r.sessions : null;
  const fresh = sessImport.newSessions(r.sessions, store.getSessions());
  let encryptedStorage = false;
  try {
    encryptedStorage = safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  } catch (_) { /* ohne sicheren Speicher nur Sitzungen importieren */ }
  return {
    recognized: r.recognized, failed: r.failed, encrypted: r.encrypted, unmatched: r.unmatched,
    skipped: r.skipped, duplicates: r.sessions.length - fresh.length, count: fresh.length,
    passwords: fresh.filter(s => !!s.password).length, encryptedStorage,
    preview: fresh.slice(0, 60).map(s => ({ name: s.name, folder: s.folder, type: s.type, target: s.host || s.path, hasPassword: !!s.password }))
  };
});
ipcMain.handle('xi:cancel', () => { pendingSessionImport = null; });
ipcMain.handle('xi:apply', async () => {
  const p = pendingSessionImport;
  if (sessionImportBusy || !p?.sessions) return { error: 'Bitte zuerst die Importvorschau prüfen.' };
  pendingSessionImport = null;
  sessionImportBusy = true;
  try {
    const existing = store.getSessions();
    const fresh = sessImport.newSessions(p.sessions, existing).map(s => ({ ...s, id: randomUUID() }));
    if (!fresh.length) return { count: 0, folders: [] };
    const protect = new Set(fresh.filter(s => s.password).map(s => s.id));
    if (protect.size && (!safeStorage.isEncryptionAvailable() ||
        (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'))) {
      return { error: 'Verschlüsselter Passwortspeicher nicht verfügbar.' };
    }
    const r = await store.saveSessions([...existing, ...fresh], { protect });
    if (!r.ok && !r.pending) return { error: 'Import konnte nicht gespeichert werden.' };
    return { count: fresh.length, folders: [...new Set(fresh.map(s => s.folder))], pending: !!r.pending };
  } catch (e) {
    return { error: e?.message === 'IMPORT_SECURE_STORAGE' ? 'Verschlüsselter Passwortspeicher nicht verfügbar.' : 'Import konnte nicht gespeichert werden.' };
  } finally {
    sessionImportBusy = false;
  }
});
ipcMain.handle('csv:saveTemplate', async (_e, text) => {
  const r = await dialog.showSaveDialog(win, { title: 'CSV-Vorlage speichern', defaultPath: path.join(app.getPath('documents'), 'mact1000-sessions-vorlage.csv'), filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.writeFileSync(r.filePath, '\uFEFF' + String(text || ''), 'utf8'); // BOM, damit Excel die Umlaute erkennt
  return { path: r.filePath };
});

async function importSessions() {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return;
  try {
    const list = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!Array.isArray(list)) throw new Error('Ungültiges Format');
    const existing = store.getSessions();
    const ids = new Set(existing.map(s => s.id));
    for (const s of list) if (!ids.has(s.id)) existing.push(s);
    await store.saveSessions(existing);
    send('sessionsChanged');
  } catch (e) {
    dialog.showErrorBox('Import fehlgeschlagen', String(e.message || e));
  }
}

// ---------- Dateiübertragung (scp) ----------
// Windows-OpenSSH kennt kein ControlMaster → dort eigene SSH-Verbindung (ssh2) mit SCP-Übertragung.
// MACT_FX_BACKEND=sftp bzw. =scpwin wählt das Verfahren ausdrücklich (Tests, Rückfalloption).
const FX_MODE = process.env.MACT_FX_BACKEND || (IS_WIN ? 'scpwin' : 'scp');
const FxBackend = FX_MODE === 'sftp' ? require('./sftp').SftpTransfer : FX_MODE === 'scpwin' ? require('./scp-win').ScpTransfer : require('./scp').FileTransfer;
const askWaiters = new Map();
let askSeq = 0;
const askRenderer = (q) => new Promise((resolve) => {
  if (!win || win.isDestroyed()) return resolve(null);
  const reqId = ++askSeq;
  askWaiters.set(reqId, resolve);
  win.webContents.send('fx:ask', { reqId, ...q });
});
sessions.shareEnv = { ask: askRenderer, get defaultName() { return shareDefaultName(); } };
const fx = new FxBackend(
  askRenderer,
  (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }
);
ipcMain.on('fx:answer', (_e, reqId, value) => { const r = askWaiters.get(reqId); if (r) { askWaiters.delete(reqId); r(value); } });
const fxErr = (e) => { throw new Error(String(e && e.message || e)); };
ipcMain.handle('fx:list', (_e, cfg, dir) => fx.list(cfg, dir).catch(fxErr));
ipcMain.handle('fx:op', (_e, cfg, name, args) => fx.op(cfg, name, args).catch(fxErr));
ipcMain.on('fx:transfer', (_e, jobId, cfg, spec) => { fx.transfer(jobId, cfg, spec); });
ipcMain.on('fx:cancel', (_e, jobId) => fx.cancel(jobId));
ipcMain.handle('fx:pickUpload', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Dateien hochladen', buttonLabel: 'Hochladen', properties: ['openFile', 'openDirectory', 'multiSelections', 'showHiddenFiles'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('fx:pickDir', async (_e, def) => {
  const r = await dialog.showOpenDialog(win, { title: 'Zielordner wählen', buttonLabel: 'Hierhin herunterladen', defaultPath: def || app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('fx:defaults', () => ({ downloads: app.getPath('downloads'), temp: path.join(app.getPath('temp'), 'mact1000-open') }));
ipcMain.handle('fx:localExists', (_e, dir, names) => names.filter(n => { try { fs.accessSync(path.join(dir.replace(/^~/, app.getPath('home')), n)); return true; } catch (_) { return false; } }));
ipcMain.on('fx:reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('fx:openLocal', (_e, p) => shell.openPath(p));
// Herausziehen aus dem Datei-Browser: lokal bereitliegende Kopien als echte Dateien an Finder/Desktop übergeben
let dragIcon = null;
ipcMain.on('fx:startDrag', (e, files) => {
  try {
    const list = (Array.isArray(files) ? files : []).filter(f => typeof f === 'string' && path.resolve(f).startsWith(path.join(app.getPath('temp'), 'mact1000-open') + path.sep) && fs.existsSync(f)).map(f => path.resolve(f));
    if (!list.length) return;
    if (!dragIcon || dragIcon.isEmpty()) dragIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'drag-file.png'));
    e.sender.startDrag(list.length === 1 ? { file: list[0], icon: dragIcon } : { file: list[0], files: list, icon: dragIcon });
  } catch (err) { console.error('startDrag', err); }
});

// ---------- IPC ----------
ipcMain.handle('store:getSessions', () => store.getSessions({ trackView: true }));
ipcMain.handle('store:saveSessions', (_e, list) => store.saveSessions(list, { fromView: true }));
ipcMain.handle('store:deleteSessionFolder', (_e, folder, ids, folders) => store.deleteSessionFolder(folder, ids, folders));
ipcMain.handle('store:getFolderPasswords', () => store.getFolderPasswords());
ipcMain.handle('store:saveFolderPasswords', (_e, map) => store.saveFolderPasswords(map));
ipcMain.handle('store:getSettings', () => store.getSettings({ trackView: true }));
ipcMain.handle('store:saveSettings', async (_e, s, patch) => {
  const r = await store.saveSettings(s, { patch: patch || null, fromView: true });
  const before = i18n.lang;
  if (updateLanguage() !== before) {
    buildMenu(); setAboutPanel();
    if (win && !win.isDestroyed()) win.webContents.send('i18n:changed', i18n.lang);
  }
  return r;
});
// Gemeinsame Konfiguration auf Netzlaufwerk
ipcMain.handle('shared:status', () => store.sharedStatus());
ipcMain.handle('shared:probe', (_e, d) => store.sharedProbe(d));
ipcMain.handle('shared:enable', (_e, o) => store.sharedEnable(o || {}));
ipcMain.handle('shared:update', (_e, o) => store.sharedUpdate(o || {}));
ipcMain.handle('shared:disable', () => store.sharedDisable());
ipcMain.handle('shared:syncNow', () => store.sharedSyncNow());
ipcMain.handle('shared:revealBackups', async () => { const st = await store.sharedStatus(); if (st.backupDir) { fs.mkdirSync(st.backupDir, { recursive: true }); shell.openPath(st.backupDir); } return !!st.backupDir; });
ipcMain.handle('shared:pickDir', async (_e, def) => {
  const r = await dialog.showOpenDialog(win, { title: 'Ordner für die gemeinsame Konfiguration (Netzlaufwerk)', defaultPath: def || '/Volumes',
    properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Ordner wählen' });
  return r.canceled ? '' : (r.filePaths[0] || '');
});

ipcMain.handle('session:open', async (_e, id, cfg, size) => sessions.open(id, cfg, size));
ipcMain.on('session:write', (_e, id, data) => sessions.write(id, data));
ipcMain.on('session:resize', (_e, id, cols, rows) => sessions.resize(id, cols, rows));
ipcMain.on('session:kill', (_e, id) => sessions.kill(id));
ipcMain.handle('session:action', (_e, id, action, arg) => sessions.action(id, action, arg));

ipcMain.handle('serial:list', async () => {
  try {
    const { SerialPort } = require('serialport');
    return await SerialPort.list();
  } catch (e) {
    // Fallback: /dev/cu.* auflisten
    try { return fs.readdirSync('/dev').filter(f => f.startsWith('cu.')).map(f => ({ path: '/dev/' + f })); }
    catch (_) { return []; }
  }
});
ipcMain.handle('rdp:clients', () => require('./rdp').detectClients());
ipcMain.handle('dialog:openFile', async (_e, opts) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'showHiddenFiles'], ...(opts || {}) });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.on('clipboard:write', (_e, t) => clipboard.writeText(String(t)));
ipcMain.on('shell:openExternal', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('config:versionInfo', () => store.versionInfo());

// ---------- Update-Prüfung (neuestes Release auf GitHub) ----------
const update = require('./update');
let updateState = null; let updateRunning = null;
async function runUpdateCheck(force) {
  if (!force && store.getSettings().updateCheck === false) return updateState;
  if (updateRunning) return updateRunning;
  updateRunning = update.checkLatest(store.appVersion()).then((r) => {
    // bei Fehler den letzten erfolgreichen Stand behalten, aber den Fehler melden
    updateState = r.ok ? r : { ...(updateState || {}), ok: false, error: r.error, checkedAt: r.checkedAt, current: r.current, releasesUrl: r.releasesUrl, lastOk: updateState && updateState.ok ? updateState : (updateState && updateState.lastOk) };
    toWinU('update:status', updateState);
    return updateState;
  }).finally(() => { updateRunning = null; });
  return updateRunning;
}
const toWinU = (ch, p) => { if (win && !win.isDestroyed()) win.webContents.send(ch, p); };
// ---------- Automatisches Update (Download, Prüfung, Austausch nach dem Beenden) ----------
const { Updater } = require('./updater');
const IS_PORTABLE = !!process.env.PORTABLE_EXECUTABLE_FILE;
const updater = new Updater({
  dir: () => path.join(app.getPath('userData'), 'updates'),
  current: store.appVersion(),
  allowAnyHost: !!process.env.MACT_UPDATE_API,
  // macOS: passendes Paket je Architektur, Austausch des .app-Bundles
  arch: (process.arch === 'arm64' || app.runningUnderARM64Translation) ? 'arm64' : 'x64',
  bundlePath: () => {
    if (process.env.MACT_UPDATE_TARGET) return process.env.MACT_UPDATE_TARGET;
    if (!app.isPackaged || process.platform !== 'darwin') return null;
    const p = path.resolve(process.execPath, '..', '..', '..');
    return /\.app$/.test(p) ? p : null;
  },
  // Windows – portable EXE: nur Hinweis; installierte Version (Setup): Installer laden und still installieren
  manualOnly: IS_PORTABLE && !process.env.MACT_UPDATE_TARGET,
  // Windows: Download der neuen Version im Standard-Browser (Tests: nur protokollieren)
  openUrl: (u) => {
    if (process.env.MACT_OPEN_LOG) { fs.appendFileSync(process.env.MACT_OPEN_LOG, u + '\n'); return; }
    return shell.openExternal(u);
  },
  installDir: () => {
    if (process.env.MACT_UPDATE_TARGET) return process.env.MACT_UPDATE_TARGET;
    if (!app.isPackaged || IS_PORTABLE) return null;
    return path.dirname(process.execPath);
  }
});
let updateResult = null;
updater.on('state', (st) => toWinU('update:dl', st));
ipcMain.handle('update:dlStatus', () => updater.status());
ipcMain.handle('update:download', async () => {
  const info = updateState && updateState.ok ? updateState : await runUpdateCheck(true);
  if (!info || !info.ok || !info.newer) throw new Error('Keine neuere Version gefunden');
  return updater.prepare(info);
});
ipcMain.handle('update:cancel', () => { updater.cancel(); return updater.status(); });
ipcMain.handle('update:install', async (_e, o = {}) => {
  const st = updater.install({ relaunch: o.relaunch !== false });
  // Rückfrage ist bereits im Fenster erfolgt → ohne weitere Abfrage beenden
  quitConfirmed = true;
  setTimeout(() => app.quit(), 150);
  return st;
});
ipcMain.handle('update:result', () => { const r = updateResult; updateResult = null; return r; });
ipcMain.handle('update:autoEnabled', () => store.getSettings().autoUpdate !== false && store.getSettings().updateCheck !== false);
// Bereitgestelltes Update beim normalen Beenden installieren (ohne Neustart)
let updateOnQuitDone = false;
function installOnQuit() {
  if (updateOnQuitDone || updater.state.phase !== 'ready' || store.getSettings().autoUpdate === false) return;
  updateOnQuitDone = true;
  try { updater.install({ relaunch: false }); } catch (_) {}
}
ipcMain.handle('update:status', () => updateState);
ipcMain.handle('update:check', () => runUpdateCheck(true));
ipcMain.handle('update:enabled', () => store.getSettings().updateCheck !== false);
setInterval(() => { runUpdateCheck(false).catch(() => {}); }, 6 * 3600 * 1000).unref();

// ---------- Server (TFTP, FTP, HTTP, SFTP/SCP) ----------
const { TftpServer } = require('./tftp');
const { FtpServer } = require('./ftp-server');
const { HttpFileServer } = require('./http-server');
const { SshFileServer } = require('./ssh-server');
const SRV_NAMES = { tftp: 'TFTP', ftp: 'FTP', http: 'HTTP', ssh: 'SFTP/SCP' };
const SRV_PORTS = { tftp: 69, ftp: 21, http: 8080, ssh: 2222 };
const servers = {
  tftp: new TftpServer(),
  ftp: new FtpServer(),
  http: new HttpFileServer(),
  ssh: new SshFileServer({ hostKeyFile: () => path.join(app.getPath('userData'), 'server-hostkey') })
};
const srvStatus = (k) => ({ ...servers[k].status(), kind: k, name: SRV_NAMES[k] });
for (const k of Object.keys(servers)) {
  servers[k].on('transfer', (info) => toWin('srv:transfer', { kind: k, info }));
  servers[k].on('status', (st) => toWin('srv:status', { kind: k, status: { ...st, kind: k, name: SRV_NAMES[k] } }));
}
const srvKind = (k) => { if (!servers[k]) throw new Error('Unbekannter Server: ' + k); return k; };
// gespeicherte Einstellungen eines Servers (ohne Passwort), TFTP übernimmt die alten Einstellungen
function srvConfig(k) {
  const s = store.getSettings();
  let c = (s.servers && s.servers[k]) || null;
  if (!c && k === 'tftp') c = { root: s.tftpDir || '', port: s.tftpPort || 69, host: s.tftpHost || '0.0.0.0', allowWrite: !!s.tftpAllowWrite, overwrite: !!s.tftpOverwrite };
  c = { port: SRV_PORTS[k], host: '0.0.0.0', ...(c || {}) };
  const { passwordEnc, ...rest } = c;
  return { ...rest, hasPassword: !!passwordEnc };
}
ipcMain.handle('srv:all', () => Object.fromEntries(Object.keys(servers).map(k => [k, { status: srvStatus(k), config: srvConfig(k) }])));
ipcMain.handle('srv:status', (_e, k) => srvStatus(srvKind(k)));
ipcMain.handle('srv:start', async (_e, k, o = {}) => {
  srvKind(k);
  const s = store.getSettings();
  const saved = (s.servers && s.servers[k]) || {};
  let password = o.password || '';
  if (!password && saved.passwordEnc && o.user && o.user === saved.user) { try { password = store.decLocal(saved.passwordEnc); } catch (_) {} }
  const opts = {
    root: o.root, port: o.port, host: o.host, allowWrite: !!o.allowWrite, overwrite: !!o.allowWrite && !!o.overwrite, allowDelete: !!o.allowDelete,
    user: String(o.user || '').trim(), password, anonymous: !!o.anonymous, listing: o.listing !== false, authorizedKeys: o.authorizedKeys || ''
  };
  await servers[k].start(opts);
  const cfg = { root: opts.root, port: Number(opts.port) || SRV_PORTS[k], host: opts.host || '0.0.0.0', allowWrite: opts.allowWrite, overwrite: opts.overwrite };
  if (k !== 'tftp') Object.assign(cfg, { allowDelete: opts.allowDelete, user: opts.user, passwordEnc: password ? store.encLocal(password) : undefined });
  if (k === 'ftp') cfg.anonymous = opts.anonymous;
  if (k === 'http') cfg.listing = opts.listing;
  if (k === 'ssh') cfg.authorizedKeys = opts.authorizedKeys;
  const cur = store.getSettings();
  await store.saveSettings({ ...cur, servers: { ...(cur.servers || {}), [k]: cfg } });
  return srvStatus(k);
});
ipcMain.handle('srv:stop', async (_e, k) => { await servers[srvKind(k)].stop(); return srvStatus(k); });
ipcMain.handle('srv:clearLog', (_e, k) => { servers[srvKind(k)].clearLog(); return srvStatus(k); });
ipcMain.handle('srv:pickDir', async (_e, def) => {
  const r = await dialog.showOpenDialog(win, { title: 'Verzeichnis für den Server wählen', defaultPath: def || app.getPath('home'), properties: ['openDirectory', 'createDirectory', 'showHiddenFiles'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('srv:reveal', (_e, p) => { if (p && fs.existsSync(p)) shell.openPath(p); return true; });

ipcMain.handle('app:info', () => ({ home: app.getPath('home'), platform: process.platform, version: app.getVersion(), dark: nativeTheme.shouldUseDarkColors }));

// ---------- Lifecycle ----------
app.setName('MacT-1000');
// Einmalige Übernahme der Daten aus früheren Versionen (anderer Datenordner):
//  macOS: „MacTerm“ – nur, wenn hier noch nichts liegt
//  Windows: „WinT-1000“ (1.5.21–1.5.23) – hat Vorrang vor älteren Daten der Windows-Ausgabe 1.5.20,
//  die ggf. schon in diesem Ordner liegen; diese werden vorher in einen Unterordner gesichert.
(function migrateLegacyData() {
  try {
    const ud = app.getPath('userData');
    const plat = process.env.MACT_MIGRATE_PLATFORM || process.platform;
    const legacy = require('./compat').LEGACY_DATA_DIRS[plat];
    if (!legacy) return;
    const old = path.join(path.dirname(ud), legacy);
    if (!fs.existsSync(old) || path.resolve(old) === path.resolve(ud)) return;
    const marker = path.join(ud, 'migrated-from-' + legacy.toLowerCase() + '.json');
    if (fs.existsSync(marker)) return;
    const hasOwn = fs.existsSync(path.join(ud, 'sessions.json')) || fs.existsSync(path.join(ud, 'settings.json'));
    const oldHas = fs.existsSync(path.join(old, 'sessions.json')) || fs.existsSync(path.join(old, 'settings.json'));
    if (!oldHas) return;
    const skip = /[\\/](Singleton\w*|Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|Crashpad|lockfile)$/;
    if (hasOwn) {
      if (plat !== 'win32') return;
      const bak = path.join(ud, 'Sicherung-vor-1.6.0');
      fs.mkdirSync(bak, { recursive: true });
      for (const f of fs.readdirSync(ud)) {
        if (f === 'Sicherung-vor-1.6.0' || skip.test(path.sep + f)) continue;
        try { fs.renameSync(path.join(ud, f), path.join(bak, f)); } catch (_) {}
      }
    }
    fs.mkdirSync(ud, { recursive: true });
    fs.cpSync(old, ud, { recursive: true, force: true, errorOnExist: false, filter: (src) => !skip.test(src) });
    fs.writeFileSync(marker, JSON.stringify({ from: old, at: new Date().toISOString(), backup: hasOwn ? 'Sicherung-vor-1.6.0' : null }, null, 2));
  } catch (_) {}
})();
app.whenReady().then(() => {
  if (!gotLock) return;
  if (app.isPackaged && process.platform === 'darwin') { try { app.setAsDefaultProtocolClient(launch.SCHEME); } catch (_) {} }
  updateLanguage();
  setAboutPanel();
  fixPath();
  updater.takeResult().then((r) => { updateResult = r; if (r) toWinU('update:result', r); }).catch(() => {});
  store.initShared((type, payload) => { if (win && !win.isDestroyed()) win.webContents.send('shared:' + type, payload || {}); }, store.appVersion());
  loadKeychainKeys();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', (e) => { if (!confirmQuit()) e.preventDefault(); });
app.on('will-quit', () => { installOnQuit(); shareHost.stopAll().catch(() => {}); sessions.killAll(); fx.closeAll(); for (const sv of Object.values(servers)) sv.stop().catch(() => {}); });
app.on('window-all-closed', () => { sessions.killAll(); app.quit(); });
