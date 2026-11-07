const { app } = require('electron'); const fs = require('fs');
const ud = '/tmp/mact-macro'; fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(ud + '/settings.json', JSON.stringify({ defaultShell: '/bin/bash' }));
process.env.PS1 = 'testuser@mac:~$ ';
app.setPath('userData', ud);
app.on('browser-window-created', (_e, win) => {
  win.setSize(1400, 860);
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('CONSOLE', e.message); });
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c); const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const screen = (sel = 'activePane()') => js(`(() => { const b = ${sel}.term.buffer.active; let o = []; for (let i = 0; i < b.length; i++) o.push(b.getLine(i).translateToString(true)); return o.join('\\n').trim(); })()`);
    const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(150); } return false; };
    const type = async (txt) => { for (const ch of txt) { await js(`activePane().handleInput(${JSON.stringify(ch)}); 0`); await wait(15); } };
    const res = {};
    try {
      await wait(1500);
      await js(`activePane().start({ type: 'local', shell: '/bin/bash', loginShell: false }); 0`);
      await until(async () => (await screen()).includes('$'));
      // 1) manuelles Makro
      await js(`saveMacros([{ id: 'm1', name: 'Rechnen', steps: [
        { t: 'expect', pattern: '$', timeout: 5 }, { t: 'send', text: 'echo MAKRO-$((6*7))', enter: true },
        { t: 'expect', pattern: 'MAKRO-42', timeout: 5 }, { t: 'pause', ms: 200 }, { t: 'send', text: 'echo FERTIG-\\\\x41', enter: true } ] }]); 0`);
      await wait(300);
      await js(`runMacro(findMacro('m1'), [activePane()]); 0`);
      res.manuell = await until(async () => /FERTIG-A/.test(await screen()));
      await wait(300);
      res.manuellUiAus = await js(`activePane().macroEl.hidden`);
      // 2) Variablen
      await js(`saveMacros([...macroList(), { id: 'm2', name: 'Variablen', steps: [{ t: 'send', text: 'echo HALLO-{{Name}}', enter: true }] }]); 0`); await wait(200);
      await js(`runMacro(findMacro('m2'), [activePane()]); 0`); await wait(400);
      res.varModal = await js(`document.querySelector('.modal-head span')?.textContent`);
      await js(`document.querySelector('.modal input').value = 'Harald'; [...document.querySelectorAll('.modal .btn')].find(b => b.textContent === 'Starten').click(); 0`);
      res.variablen = await until(async () => /HALLO-Harald/.test(await screen()));
      // 3) Timeout
      await js(`saveMacros([...macroList(), { id: 'm3', name: 'Timeout', steps: [{ t: 'expect', pattern: 'NIEMALS', timeout: 1 }, { t: 'send', text: 'echo DARF-NICHT' }] }]); 0`); await wait(200);
      await js(`runMacro(findMacro('m3'), [activePane()]); 0`); await wait(1800);
      res.timeoutToast = await js(`document.querySelector('#toast').textContent`);
      res.timeoutKeinSend = !/DARF-NICHT/.test(await screen());
      // 4) Aufzeichnung
      await js(`activePane().term.clear(); 0`);
      await js(`runCommand('macroRecord'); 0`); await wait(300);
      res.recUi = await js(`activePane().macroEl.textContent + ' / ' + document.querySelector('#btn-macros .lbl').textContent`);
      await type('echo eins\r'); await wait(500);
      await type('read -s -p "Password: " pw; echo; echo PW-LAENGE=${#pw}\r'); await wait(500);
      await type('geheim\r'); await wait(500);
      await type('echo zwei\r'); await wait(500);
      await js(`runCommand('macroRecord'); 0`); await wait(500);
      res.recEditor = await js(`document.querySelector('.modal-head span')?.textContent`);
      res.recSteps = await js(`[...document.querySelectorAll('.macro-step')].map(r => r.querySelector('select').value + ':' + (r.querySelector('input.grow')?.value || '')).join(' | ')`);
      await win.webContents.capturePage().then(i => fs.writeFileSync(__dirname + '/shots/m1-aufzeichnung.png', i.toPNG()));
      await js(`document.querySelector('.modal input[name=name]').value = 'Aufgezeichnet'; [...document.querySelectorAll('.modal .btn')].find(b => b.textContent === 'Speichern').click(); 0`); await wait(400);
      const rec = await js(`JSON.stringify(macroList().find(m => m.name === 'Aufgezeichnet'))`);
      res.recGespeichertOhnePasswort = !!rec && !rec.includes('geheim');
      // abspielen in neuem Pane
      await js(`splitPane(activePane(), 'row', { type: 'local', shell: '/bin/bash', loginShell: false }); 0`);
      await until(async () => (await screen()).includes('$'));
      await js(`runMacro(macroList().find(m => m.name === 'Aufgezeichnet'), [activePane()]); 0`); await wait(400);
      res.pwAbfrage = await js(`[...document.querySelectorAll('.modal .field')].map(f => f.querySelector('.lbl').textContent + '=' + f.querySelector('input').type).join(',')`);
      await js(`document.querySelector('.modal input').value = 'xyz12'; [...document.querySelectorAll('.modal .btn')].find(b => b.textContent === 'Starten').click(); 0`);
      res.abspielen = await until(async () => { const s = await screen(); return /eins/.test(s) && /PW-LAENGE=5/.test(s) && /\nzwei/.test(s); }, 10000);
      // 5) Auto-Antwort
      await js(`saveTriggers([{ id: 't1', name: 'Frage', pattern: 'Weiter? (j/n)', response: 'j', enter: true, enabled: true }]); 0`); await wait(300);
      await js(`activePane().sendRaw('read -p "Weiter? (j/n) " a; echo ANTWORT=$a\\r'); 0`);
      res.autoAntwort = await until(async () => /ANTWORT=j/.test(await screen()));
      // Scope greift nicht
      await js(`saveTriggers([{ id: 't2', pattern: 'Nochmal? (j/n)', response: 'j', enter: true, enabled: true, scope: 'router' }]); 0`); await wait(300);
      await js(`activePane().sendRaw('read -t 2 -p "Nochmal? (j/n) " b; echo ANTWORT2=$b\\r'); 0`);
      await wait(3000);
      res.scopeNichtAusgeloest = /ANTWORT2=\s*$/m.test(await screen());
      // 6) Autostart nach dem Verbinden
      await js(`createTab({ type: 'local', shell: '/bin/bash', loginShell: false, name: 'Auto', macroId: 'm1' }); 0`);
      res.autostart = await until(async () => /FERTIG-A/.test(await screen()), 10000);
      // 7) mehrere Panes (Multi-Input)
      await js(`splitPane(activePane(), 'column', { type: 'local', shell: '/bin/bash', loginShell: false }); 0`); await wait(1500);
      await js(`selectBroadcast('tab'); 0`); await wait(200);
      res.ziele = await js(`macroTargets().length`);
      await js(`activeTab() && Layout.leaves(activeTab().root).forEach(id => S.panes.get(id).term.clear()); runMacro(findMacro('m1'), macroTargets()); 0`);
      await wait(2500);
      res.multi = await js(`Layout.leaves(activeTab().root).map(id => { const b = S.panes.get(id).term.buffer.active; let o=''; for (let i=0;i<b.length;i++) o += b.getLine(i).translateToString(true)+'\\n'; return /FERTIG-A/.test(o); }).join(',')`);
      await js(`selectBroadcast('none', false); 0`);
      // Menü / Session-Dialog
      await js(`runCommand('macroMenu'); 0`); await wait(200);
      res.menu = await js(`document.querySelector('#ctx-menu').innerText.replace(/\\n+/g, ' | ')`);
      await js(`hideContextMenu(); newSessionDialog(); 0`); await wait(400);
      res.sessionFeld = await js(`[...document.querySelectorAll('.modal select[name=macroId] option')].map(o => o.textContent).join(',')`);
      await js(`document.querySelector('.modal .x').click(); triggerManager(); 0`); await wait(300);
      await win.webContents.capturePage().then(i => fs.writeFileSync(__dirname + '/shots/m2-auto-antworten.png', i.toPNG()));
      await js(`document.querySelector('.modal .x').click(); macroEditor(findMacro('m1')); 0`); await wait(300);
      await win.webContents.capturePage().then(i => fs.writeFileSync(__dirname + '/shots/m3-editor.png', i.toPNG()));
      await js(`document.querySelector('.modal .x').click(); macroManager(); 0`); await wait(300);
      await win.webContents.capturePage().then(i => fs.writeFileSync(__dirname + '/shots/m4-verwaltung.png', i.toPNG()));
      const st = JSON.parse(fs.readFileSync(ud + '/settings.json'));
      res.gespeichert = `${st.macros.length} Makros, ${st.triggers.length} Trigger`;
      for (const [k, v] of Object.entries(res)) console.log('RES', k, '=>', v);
      app.exit(0);
    } catch (e) { console.log('E2E ERROR', e); for (const [k, v] of Object.entries(res)) console.log('RES', k, '=>', v); app.exit(1); }
  });
});
require('../src/main.js');
