'use strict';
const { app, BrowserWindow, ipcMain, Menu, shell, dialog, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const { SessionManager } = require('./sessions');

let win = null;
const sessions = new SessionManager((channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
});

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
    titleBarStyle: 'hiddenInset',
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
  if (!list.length) return true;
  const n = list.length;
  const opts = {
    type: 'warning',
    buttons: ['Beenden', 'Abbrechen'],
    defaultId: 1, cancelId: 1,
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
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
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
    sessions: store.getSessions(), settings: store.getSettings(), ui,
    includePasswords: !!includePasswords, passphrase, appVersion: app.getVersion()
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
  return { file: path.basename(r.filePaths[0]), ...configIO.summary(pendingImport) };
});
ipcMain.handle('config:applyImport', (_e, { mode = 'merge', sessions = true, settings = true, ui = true, passphrase = '' } = {}) => {
  const p = pendingImport;
  if (!p) throw new Error('Keine Datei gewählt');
  const passwords = p.secrets && passphrase ? configIO.decryptSecrets(p.secrets, passphrase) : {};
  const res = { added: 0, updated: 0, passwords: Object.keys(passwords).length, settings: false };
  if (sessions) {
    const m = configIO.mergeSessions(store.getSessions(), p.sessions, { mode, passwords });
    store.saveSessions(m.list);
    res.added = m.added; res.updated = m.updated;
  }
  if (settings && p.settings) { store.saveSettings({ ...store.getSettings(), ...p.settings }); res.settings = true; }
  res.ui = ui && p.ui ? p.ui : null;
  pendingImport = null;
  return res;
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
    store.saveSessions(existing);
    send('sessionsChanged');
  } catch (e) {
    dialog.showErrorBox('Import fehlgeschlagen', String(e.message || e));
  }
}

// ---------- Dateiübertragung (scp) ----------
const { FileTransfer } = require('./scp');
const askWaiters = new Map();
let askSeq = 0;
const fx = new FileTransfer(
  (q) => new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve(null);
    const reqId = ++askSeq;
    askWaiters.set(reqId, resolve);
    win.webContents.send('fx:ask', { reqId, ...q });
  }),
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

// ---------- IPC ----------
ipcMain.handle('store:getSessions', () => store.getSessions());
ipcMain.handle('store:saveSessions', (_e, list) => { store.saveSessions(list); return true; });
ipcMain.handle('store:getSettings', () => store.getSettings());
ipcMain.handle('store:saveSettings', (_e, s) => { store.saveSettings(s); return true; });

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
ipcMain.handle('app:info', () => ({ home: app.getPath('home'), platform: process.platform, version: app.getVersion(), dark: nativeTheme.shouldUseDarkColors }));

// ---------- Lifecycle ----------
app.setName('MacT-1000');
// Einmalige Übernahme der Daten aus der Vorgängerversion „MacTerm“
(function migrateFromMacTerm() {
  try {
    const ud = app.getPath('userData');
    const old = path.join(path.dirname(ud), 'MacTerm');
    if (fs.existsSync(path.join(ud, 'sessions.json')) || fs.existsSync(path.join(ud, 'settings.json')) || !fs.existsSync(old)) return;
    fs.mkdirSync(ud, { recursive: true });
    fs.cpSync(old, ud, { recursive: true, force: false, errorOnExist: false,
      filter: (src) => !/[\\/](Singleton\w*|Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|Crashpad)$/.test(src) });
  } catch (_) {}
})();
app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: 'MacT-1000',
    applicationVersion: app.getVersion(),
    version: '',
    copyright: 'Copyright © 2026 Harald Thomas',
    credits: 'Der Name spielt auf den T-1000 aus „Terminator 2“ an – den Terminator aus Flüssigmetall, '
      + 'der sich teilen und wieder zu einem Ganzen zusammenfließen kann. Genau das tun auch die Fenster '
      + 'von MacT-1000: Sessions lassen sich beliebig horizontal und vertikal teilen, '
      + 'per Drag & Drop neu anordnen und wieder zusammenführen.\n\n„Mac“ steht für die Plattform, '
      + '„T“ zugleich für Terminal.'
  });
  fixPath();
  loadKeychainKeys();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', (e) => { if (!confirmQuit()) e.preventDefault(); });
app.on('will-quit', () => { sessions.killAll(); fx.closeAll(); });
app.on('window-all-closed', () => { sessions.killAll(); app.quit(); });
