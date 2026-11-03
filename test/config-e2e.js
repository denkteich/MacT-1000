const electron = require('electron'); const { app, dialog } = electron;
const fs = require('fs'); const path = require('path');
const ud = '/tmp/macterm-cfg'; fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'sessions.json'), JSON.stringify([
  { id: 's1', type: 'ssh', name: 'core-sw01', folder: 'Rechenzentrum', host: '10.10.0.1', username: 'admin', password: 'geheim' },
  { id: 's2', type: 'telnet', name: 'access-sw', folder: 'Rechenzentrum', host: '10.10.3.10' },
  { id: 's5', type: 'rdp', name: 'DC01', folder: 'Windows', host: 'dc01.lab.local', username: 'administrator', password: 'P@ss' }
]));
app.setPath('userData', ud);
const file = '/tmp/macterm-export-test.json'; fs.rmSync(file, { force: true });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('CONSOLE', e.message); });
  win.webContents.on('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c); const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const shot = async (n) => fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG());
    try {
      await wait(1200);
      await js(`runCommand('exportConfig')`); await wait(400);
      await js(`(() => { const b = document.querySelector('.modal'); const c = b.querySelector('input[name=includePasswords]'); c.checked = true; c.dispatchEvent(new Event('change')); b.querySelector('input[name=passphrase]').value='export123'; b.querySelector('input[name=passphrase2]').value='export123'; })()`);
      await shot('c1-export.png');
      await js(`document.querySelector('.modal .btn.primary').click()`); await wait(1500);
      const ex = JSON.parse(fs.readFileSync(file, 'utf8'));
      console.log('EXPORT', JSON.stringify({ sessions: ex.sessions.length, secrets: ex.secretsCount, plain: JSON.stringify(ex).includes('geheim'), settings: !!ex.settings, layoutTabs: ex.ui.layout.tabs.length, modalOpen: await js(`!!document.querySelector('.modal')`) }));
      // Adressbuch leeren und importieren
      await js(`S.sessions = []; persistSessions(); renderSidebar(); 0`); await wait(300);
      await js(`runCommand('importConfig')`); await wait(600);
      await js(`document.querySelector('.modal input[name=passphrase]').value='export123'`);
      await shot('c2-import.png');
      await js(`document.querySelector('.modal .btn.primary').click()`); await wait(1500);
      console.log('IMPORT', JSON.stringify(await js(`S.sessions.map(s => [s.id, s.folder, !!s.password])`)), 'modal:', await js(`!!document.querySelector('.modal')`));
      await shot('c3-after.png');
      // falsches Passwort
      await js(`runCommand('importConfig')`); await wait(600);
      await js(`document.querySelector('.modal input[name=passphrase]').value='falsch'; document.querySelector('.modal .btn.primary').click()`); await wait(1200);
      console.log('WRONGPW', await js(`document.querySelector('.modal') ? document.querySelector('.modal .settings-form').lastChild.textContent : 'kein Dialog'`));
      await js(`settingsDialog(S.settings, () => {})`); await wait(400); await shot('c4-settings.png');
    } catch (e) { console.log('E2E ERROR', e); }
    app.exit(0);
  });
});
require('../src/main.js');
