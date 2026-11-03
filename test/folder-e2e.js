const { app } = require('electron'); const fs = require('fs'); const path = require('path');
const ud = '/tmp/mact-folder'; fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'sessions.json'), JSON.stringify([
  { id: 's1', type: 'ssh', name: 'web01', host: 'web01', user: 'root' },
  { id: 's2', type: 'ssh', name: 'web02', host: 'web02', user: 'root' },
  { id: 's3', type: 'telnet', name: 'switch-core', host: '10.0.0.1', folder: 'Netzwerk' }]));
app.setPath('userData', ud);
app.on('browser-window-created', (_e, win) => {
  win.setSize(1400, 860);
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('CONSOLE', e.message); });
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c); const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const tree = () => js(`[...document.querySelectorAll('#session-tree > *')].map(e => e.classList.contains('folder') ? '['+e.dataset.folder+' '+e.querySelector('.f-count').textContent+']' : e.classList.contains('sess') ? e.querySelector('.s-name').textContent : e.className==='folder-empty' ? '(leer)' : '?').join(' ')`);
    const menu = () => js(`[...document.querySelectorAll('.ctx-menu .ctx-item, .context-menu > *')].map(e => e.textContent).filter(Boolean).join(' | ')`);
    const rclick = (sel) => js(`(() => { const el = ${sel}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 5 })); })()`);
    const drag = (src, dst) => js(`(() => { const dt = new DataTransfer(); const a = ${src}, b = ${dst}; a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); const hl = b.classList.contains('drop-folder'); b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); return hl; })()`);
    const sessByName = (n) => `[...document.querySelectorAll('#session-tree .sess')].find(e => e.querySelector('.s-name').textContent === '${n}')`;
    const folderEl = (n) => `document.querySelector('#session-tree .folder[data-folder="${n}"]')`;
    try {
      await wait(1200);
      console.log('START', await tree());
      // Rechtsklick auf freie Fläche
      await js(`(() => { const t = document.querySelector('#session-tree'); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 600 })); })()`); await wait(200);
      console.log('MENU FREI', await js(`document.querySelector('.ctx-menu, .context-menu, #ctx-menu')?.innerText.replace(/\\n+/g,' | ')`));
      await js(`[...document.querySelectorAll('.ctx-menu *, .context-menu *, #ctx-menu *')].find(e => e.textContent === 'Neuer Ordner…').click(); 0`); await wait(300);
      await js(`document.querySelector('.modal input').value = 'Webserver'; document.querySelector('.modal input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); 0`); await wait(500);
      console.log('NACH ANLEGEN', await tree(), 'modal offen:', await js(`!!document.querySelector('.modal-backdrop')`));
      console.log('HIGHLIGHT', await drag(sessByName('web01'), folderEl('Webserver'))); await wait(500);
      await drag(sessByName('web02'), `document.querySelector('#session-tree .folder[data-folder="Webserver"]')`); await wait(500);
      console.log('NACH DRAG', await tree());
      await drag(sessByName('switch-core'), sessByName('web01')); await wait(500);
      console.log('AUF SESSION GEZOGEN', await tree());
      await drag(sessByName('switch-core'), folderEl('Sessions')); await wait(500);
      console.log('IN WURZEL', await tree());
      const saved = JSON.parse(fs.readFileSync(path.join(ud, 'sessions.json'))).map(s => s.name + '=' + (s.folder || '-')).join(', ');
      console.log('GESPEICHERT', saved, '| leere Ordner', JSON.stringify(JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'))).sessionFolders));
      // Ordner-Kontextmenü
      await rclick(folderEl('Webserver')); await wait(200);
      console.log('MENU ORDNER', await js(`document.querySelector('.ctx-menu, .context-menu, #ctx-menu')?.innerText.replace(/\\n+/g,' | ')`));
      await win.webContents.capturePage().then(i => fs.writeFileSync(__dirname + '/shots/f1.png', i.toPNG()));
      await js(`document.body.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0`);
      // Session-Kontextmenü
      await rclick(sessByName('web01')); await wait(200);
      console.log('MENU SESSION', await js(`document.querySelector('.ctx-menu, .context-menu, #ctx-menu')?.innerText.replace(/\\n+/g,' | ')`));
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0`);
      // Ordner Netzwerk ist jetzt leer, bleibt aber; löschen
      await js(`deleteFolder('Netzwerk'); 0`); await wait(500);
      console.log('NACH LÖSCHEN LEER', await tree());
      await js(`deleteFolder('Webserver'); 0`); await wait(300);
      console.log('CONFIRM', await js(`document.querySelector('.modal-backdrop')?.innerText.replace(/\\n+/g,' | ')`));
      await js(`[...document.querySelectorAll('.modal-backdrop button')].find(b => b.textContent === 'Ordner löschen').click(); 0`); await wait(500);
      console.log('NACH LÖSCHEN', await tree());
      app.exit(0);
    } catch (e) { console.log('E2E ERROR', e); app.exit(1); }
  });
});
require('../src/main.js');
