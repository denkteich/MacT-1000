const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
const ud = '/tmp/macterm-test'; fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'sessions.json'), JSON.stringify([
  { id: 's1', type: 'ssh', name: 'core-sw01', folder: 'Rechenzentrum', host: '10.10.0.1', username: 'admin' },
  { id: 's2', type: 'ssh', name: 'core-sw02', folder: 'Rechenzentrum', host: '10.10.0.2', username: 'admin' },
  { id: 's3', type: 'telnet', name: 'access-sw-3OG', folder: 'Rechenzentrum', host: '10.10.3.10', port: 23 },
  { id: 's4', type: 'serial', name: 'Cisco Konsole', folder: 'Labor', path: '/dev/cu.usbserial-A10K', baudRate: 9600 },
  { id: 's5', type: 'rdp', name: 'DC01', folder: 'Windows', host: 'dc01.lab.local', username: 'administrator' },
  { id: 's6', type: 'ssh', name: 'proxmox01', folder: 'Virtualisierung', host: 'pve01.lab', username: 'root', color: '#e5c07b' },
  { id: 's7', type: 'ssh', name: 'semaphore', folder: 'Virtualisierung', host: '192.168.10.20', username: 'harald' }
]));
app.setPath('userData', ud);
const out = process.argv[process.argv.length - 1].endsWith('.png') ? null : '/home/user/workspace/macterm/test/shots';
fs.mkdirSync(out, { recursive: true });
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const shot = async (n) => fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG());
    try {
      await wait(1500);
      await js(`activePane().handleInput("clear; echo Lokale Shell: $SHELL; uname -sr\\r")`);
      await js(`COMMANDS.splitV()`); await wait(300);
      await js(`activePane().start({type:'local'})`); await wait(800);
      await js(`COMMANDS.splitH()`); await wait(300);
      await js(`activePane().start({type:'local'})`); await wait(800);
      await js(`selectBroadcast('tab')`); await wait(200);
      await js(`activePane().handleInput("echo MULTI-INPUT-$((6*7))\\r")`); await wait(500);
      await js(`doMultiPaste({text:'echo pane-{{n}}', targets:[...S.panes.keys()], mode:'block', enter:true, bracketed:true})`); await wait(800);
      const res = await js(`[...S.panes.values()].map(p => { const b=p.term.buffer.active; let t=''; for(let i=0;i<b.length;i++) t+=b.getLine(i).translateToString(true)+'\\n'; return {state:p.state, multi:(t.match(/MULTI-INPUT-42/g)||[]).length, pane:(t.match(/pane-\\d/g)||[]).join(',') , cols:p.term.cols, rows:p.term.rows}; })`);
      console.log('RESULT', JSON.stringify(res));
      await shot('1-split-multi.png');
      await js(`openMultiPaste()`); await wait(600); await shot('2-multipaste.png');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await wait(200);
      await js(`selectBroadcast('none', false); setMultiInput(false)`);
      await js(`createTab(null)`); await wait(500); await shot('3-launcher.png');
      await js(`sessionDialog({cfg:{type:'serial'}, folders: folders(), onSubmit(){}})`); await wait(600); await shot('4-serial.png');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await wait(200);
      await js(`sessionDialog({cfg:{type:'ssh', host:'10.0.0.1', identityFile:'~/.ssh/id_ed25519'}, folders: folders(), onSubmit(){}})`); await wait(600); await shot('5-ssh.png');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await wait(200);
      // Telnet gegen lokalen Testserver + Grid aus Ordner
      await js(`openTiled([{type:'local',name:'A'},{type:'local',name:'B'},{type:'local',name:'C'},{type:'local',name:'D'}])`); await wait(1200);
      await js(`selectBroadcast('tab')`); await js(`activePane().handleInput("echo GRID\\r")`); await wait(500);
      await shot('6-grid.png');
      await js(`setMultiInput(false); createTab({type:'rdp', host:'dc01.lab.local'})`); await wait(800); await shot('7-rdp.png');
      const errs = await js(`window.__errs || []`); console.log('ERRS', JSON.stringify(errs));
    } catch (e) { console.log('E2E ERROR', e); }
    app.exit(0);
  });
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) console.log('CONSOLE', msg); });
});
require('../src/main.js');
