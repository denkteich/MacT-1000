const { app, dialog } = require('electron'); const fs = require('fs'); const net = require('net');
const ud = '/tmp/mact-close'; fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
app.setPath('userData', ud);
const srv = net.createServer(s => { s.write('Hallo vom Testserver\r\n'); s.on('error', () => {}); }).listen(2323, '127.0.0.1');
let boxCalls = [], boxAnswer = 1;
dialog.showMessageBoxSync = (...a) => { const o = a[a.length - 1]; boxCalls.push(o.message + ' | ' + o.detail.split('\n')[0]); return boxAnswer; };
let quitting = false;
app.on('browser-window-created', (_e, win) => {
  win.setSize(1400, 860);
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('CONSOLE', e.message); });
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c); const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const key = async (k, mods) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods }); await wait(250); };
    const pos = () => js(`(() => { const all = []; S.tabs.forEach((t, ti) => Layout.leaves(t.root).forEach((id, pi) => all.push(id))); const t = S.tabs.findIndex(t => t.id === S.activeTabId); return t + ':' + Layout.leaves(activeTab().root).indexOf(activeTab().activePaneId) + (document.activeElement === activePane().term?.textarea ? ':fokus' : ':-'); })()`);
    try {
      await wait(1000);
      // Tab 1: 2 Panes, Tab 2: 3 Panes, Tab 3: 1 Pane
      await js(`splitPane(activePane(), 'row', { type: 'local' }); createTab({ type: 'local' }); splitPane(activePane(), 'row', { type: 'local' }); splitPane(activePane(), 'column', { type: 'local' }); createTab({ type: 'local' }); 0`);
      await wait(1500);
      await js(`activateTab(S.tabs[0].id); setActivePane(S.panes.get(Layout.leaves(S.tabs[0].root)[0])); 0`); await wait(300);
      const seq = [await pos()];
      for (let i = 0; i < 6; i++) { await key('Right', ['meta']); seq.push(await pos()); }
      console.log('CMD-RECHTS', seq.join(' → '));
      const back = [];
      for (let i = 0; i < 3; i++) { await key('Left', ['meta']); back.push(await pos()); }
      console.log('CMD-LINKS', back.join(' → '));
      // Terminal darf kein ^A/^E bekommen haben: Shift+Cmd+Right bleibt unverändert
      // Telnet-Verbindung in Tab 3
      await js(`activateTab(S.tabs[2].id); activePane().start({ type: 'telnet', host: '127.0.0.1', port: 2323, name: 'Testserver' }); 0`);
      await wait(1200);
      console.log('TELNET STATE', await js(`activePane().state`));
      await js(`runCommand('closePane'); 0`); await wait(400);
      console.log('MODAL PANE', await js(`document.querySelector('.modal-backdrop .confirm-text')?.textContent`));
      await js(`[...document.querySelectorAll('.modal-backdrop button')].find(b => b.textContent === 'Abbrechen').click(); 0`); await wait(300);
      console.log('NACH ABBRECHEN Panes', await js(`S.panes.size`), 'Tabs', await js(`S.tabs.length`));
      await js(`runCommand('closeTab'); 0`); await wait(400);
      console.log('MODAL TAB', await js(`document.querySelector('.modal-backdrop .confirm-text')?.textContent`));
      await js(`[...document.querySelectorAll('.modal-backdrop button')].find(b => b.textContent === 'Abbrechen').click(); 0`); await wait(300);
      // lokales Pane ohne Rückfrage
      await js(`activateTab(S.tabs[0].id); runCommand('closePane'); 0`); await wait(400);
      console.log('LOKAL OHNE MODAL', !(await js(`!!document.querySelector('.modal-backdrop')`)), 'Panes', await js(`S.panes.size`));
      // Programm beenden: Abbrechen
      app.quit(); await wait(500);
      console.log('QUIT ABBRECHEN läuft noch:', !win.isDestroyed(), boxCalls);
      win.close(); await wait(500);
      console.log('FENSTER SCHLIESSEN ABBRECHEN läuft noch:', !win.isDestroyed(), boxCalls.length);
      await win.webContents.capturePage().then(i => fs.writeFileSync(__dirname + '/shots/c1.png', i.toPNG()));
      // Pane schließen bestätigen
      await js(`activateTab(S.tabs[2].id); runCommand('closePane'); 0`); await wait(400);
      await js(`[...document.querySelectorAll('.modal-backdrop button')].find(b => b.textContent === 'Schließen').click(); 0`); await wait(500);
      console.log('NACH SCHLIESSEN Tabs', await js(`S.tabs.length`));
      // wieder verbinden, dann Beenden bestätigen
      await js(`activePane().start({ type: 'telnet', host: '127.0.0.1', port: 2323 }); 0`); await wait(1000);
      boxAnswer = 0; quitting = true; app.quit();
    } catch (e) { console.log('E2E ERROR', e); app.exit(1); }
  });
});
app.on('will-quit', () => { console.log('WILL-QUIT erreicht, Dialoge:', boxCalls.length, quitting ? 'OK' : 'FEHLER'); setTimeout(() => app.exit(0), 300); });
require('../src/main.js');
