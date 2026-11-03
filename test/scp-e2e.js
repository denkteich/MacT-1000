const electron = require('electron'); const { app, dialog } = electron;
const fs = require('fs'); const path = require('path'); const os = require('os');
const ud = '/tmp/macterm-scp'; fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
const sess = { id: 's1', type: 'ssh', name: 'testserver', folder: 'Labor', host: '127.0.0.1', port: 2222, username: 'scptest' };
fs.writeFileSync(path.join(ud, 'sessions.json'), JSON.stringify([sess]));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ sidebarWidth: 360, downloadDir: '/tmp/macterm-dl' }));
fs.rmSync('/tmp/macterm-dl', { recursive: true, force: true });
app.setPath('userData', ud);
const up = '/tmp/macterm-up'; fs.mkdirSync(up, { recursive: true }); fs.writeFileSync(path.join(up, 'config.yaml'), 'a: 1\n'); fs.writeFileSync(path.join(up, 'image.iso'), Buffer.alloc(40e6, 1));
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(up, 'config.yaml'), path.join(up, 'image.iso')] });
const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
app.on('browser-window-created', (_e, win) => {
  win.setSize(1400, 860);
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('CONSOLE', e.message); });
  win.webContents.on('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c); const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const shot = async (n) => fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG());
    const until = async (cond, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(cond)) return true; await wait(150); } return false; };
    try {
      await wait(1000);
      // SSH-Session öffnen, Passwort im Terminal eingeben
      await js(`openSaved(S.sessions[0], 'here')`);
      await until(`(activePane().term.buffer.active.getLine(activePane().term.buffer.active.cursorY + activePane().term.buffer.active.baseY)?.translateToString() || '').includes('password')`);
      await js(`activePane().sendRaw('Geheim123\\r')`);
      await until(`(() => { const b = activePane().term.buffer.active; return /scptest@\\S+:~\\$/.test(b.getLine(b.cursorY + b.baseY).translateToString()); })()`);
      // Datei-Browser über Pane-Button
      await js(`activePane().fxBtn.click()`);
      const ok = await until(`FX.cwd === '/home/scptest' && !FX.loading`);
      console.log('LIST', ok, await js(`JSON.stringify(FX.entries.map(e => e.name))`), 'modal:', await js(`!!document.querySelector('.modal')`));
      await js(`FX.sel.add('notizen.txt'); renderFiles(); 0`);
      await shot('f1-browser.png');
      // Upload über Button (Dialog gestubbt)
      await js(`document.getElementById('fx-upload').click()`);
      await until(`[...FX.jobs.values()].some(j => j.state === 'running' && j.percent > 0)`, 8000);
      await shot('f2-upload.png');
      await until(`[...FX.jobs.values()].every(j => j.state === 'done' || j.state === 'error')`, 30000);
      console.log('UPLOAD', await js(`JSON.stringify([...FX.jobs.values()].map(j => [j.direction, j.state, j.error || '']))`));
      await until(`FX.entries.some(e => e.name === 'image.iso')`);
      // Download: Ordner + Datei
      await js(`FX.sel.clear(); FX.sel.add('backup'); FX.sel.add('notizen.txt'); renderFiles(); document.getElementById('fx-download').click(); 0`);
      await until(`[...FX.jobs.values()].filter(j => j.direction === 'download').every(j => j.state === 'done' || j.state === 'error') && [...FX.jobs.values()].some(j => j.direction === 'download')`, 30000);
      console.log('DOWNLOAD', await js(`JSON.stringify([...FX.jobs.values()].filter(j => j.direction === 'download').map(j => [j.state, j.error || '']))`),
        fs.existsSync('/tmp/macterm-dl/backup/dump.sql.gz') && fs.statSync('/tmp/macterm-dl/backup/dump.sql.gz').size, fs.existsSync('/tmp/macterm-dl/notizen.txt'));
      // in Ordner wechseln, Kontextmenü
      await js(`fxList('/home/scptest/projekte')`); await until(`FX.cwd.endsWith('projekte') && !FX.loading`);
      await js(`(() => { const r = [...document.querySelectorAll('.fx-row')].find(x => x.textContent.includes('web')); const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 60, clientY: b.top + 8 })); })()`);
      await wait(300); await shot('f3-context.png');
      await js(`hideContextMenu()`);
      // cd im Terminal
      await js(`fxCdTerminal('/home/scptest/projekte'); activePane().sendRaw('pwd\\r')`); await wait(800);
      console.log('CD', await js(`(() => { const b = activePane().term.buffer.active; const l = []; for (let i = 0; i < b.length; i++) l.push(b.getLine(i).translateToString(true)); return l.filter(Boolean).slice(-2).join(' | '); })()`));
      // Passwortdialog: zweite Session ohne Terminal-Login (eigene Verbindung, andere Port-Schreibweise → gleicher Hash?)
      await js(`settingsDialog(S.settings, () => {})`); await wait(400); await shot('f4-settings.png'); await js(`document.querySelector('.modal .x').click()`);
      await js(`editSession(S.sessions[0])`); await wait(400); await shot('f5-session.png'); await js(`document.querySelector('.modal .x').click()`);
      // Askpass-Dialog direkt anzeigen
      await js(`fxAsk({ reqId: 999, kind: 'password', text: "scptest@127.0.0.1's password:", host: '127.0.0.1' })`); await wait(300); await shot('f6-ask.png');
      await js(`document.querySelector('.modal .x').click()`);
    } catch (e) { console.log('E2E ERROR', e); }
    app.exit(0);
  });
});
require('../src/main.js');
