const { app } = require('electron'); const fs = require('fs'); const path = require('path');
const ud = '/tmp/macterm-drag'; fs.rmSync(ud, { recursive: true, force: true }); fs.mkdirSync(ud, { recursive: true });
app.setPath('userData', ud);
const out = path.join(__dirname, 'shots');
app.on('browser-window-created', (_e, win) => {
  win.setSize(1400, 860);
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('CONSOLE', e.message); });
  win.webContents.on('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c); const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const shot = async (n) => fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG());
    try {
      await wait(1000);
      // Helfer im Renderer: Drag-Sequenz simulieren
      await js(`window.dnd = async (src, over, drop, at) => {
        const dt = new DataTransfer();
        const ev = (type, el, x, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        const c = (el, fx = .5, fy = .5) => { const r = el.getBoundingClientRect(); return [r.left + r.width * fx, r.top + r.height * fy]; };
        ev('dragstart', src, ...c(src));
        for (const [el, fx, fy, ms] of over) { ev('dragenter', el, ...c(el, fx, fy)); ev('dragover', el, ...c(el, fx, fy)); await new Promise(r => setTimeout(r, ms || 30)); }
        const [el, fx, fy] = drop; ev('dragover', el(), ...c(el(), fx, fy)); ev('drop', el(), ...c(el(), fx, fy)); ev('dragend', src, 0, 0);
      }; 0`);
      await js(`activePane().term.write('TAB-1 '); createTab({ type: 'local' }); splitPane(activePane(), 'column', { type: 'local' }); createTab({ type: 'local' }); 0`);
      await wait(1500);
      const state = () => js(`JSON.stringify({ tabs: S.tabs.map(t => Layout.leaves(t.root).length), active: S.tabs.findIndex(t => t.id === S.activeTabId), running: [...S.panes.values()].filter(p => p.state === 'running').length, panes: S.panes.size })`);
      console.log('START', await state());
      const sids = await js(`JSON.stringify([...S.panes.values()].map(p => p.sessionId).sort())`);
      // Tab 2 ziehen, über Tab 1 halten (öffnet ihn), rechts auf dessen Pane fallen lassen
      await js(`(async () => { const tabs = document.querySelectorAll('#tabs .tab'); await dnd(tabs[1], [[tabs[0], .5, .5, 600]], [() => document.querySelector('.workspace.visible .pane'), .9, .5]); })()`);
      await wait(800);
      console.log('NACH TAB-MERGE', await state(), 'Sessions unverändert:', sids === await js(`JSON.stringify([...S.panes.values()].map(p => p.sessionId).sort())`));
      await shot('d1-merged.png');
      // Overlay-Anzeige während des Ziehens fotografieren
      await js(`(() => { const dt = new DataTransfer(); const t = document.querySelectorAll('#tabs .tab')[1]; t.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); S._hoverTab = null; activateTab(S.tabs[0].id); const p = document.querySelector('.workspace.visible .pane'); const r = p.getBoundingClientRect(); p.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.top + r.height / 2 })); })()`);
      await wait(300); await shot('d2-overlay.png');
      await js(`endDrag(); 0`);
      // Pane per Kopfzeile auf freie Tab-Leiste → eigener Tab
      await js(`(async () => { const h = document.querySelectorAll('.workspace.visible .pane-header')[2]; await dnd(h, [], [() => document.getElementById('tabbar'), .9, .5]); })()`);
      await wait(600);
      console.log('PANE -> NEUER TAB', await state());
      // Pane aus Tab 3 per Kopfzeile in Tab 1 (unten) verschieben
      await js(`(async () => { activateTab(S.tabs[2].id); await new Promise(r => setTimeout(r, 200)); const h = document.querySelector('.workspace.visible .pane-header'); const tabs = document.querySelectorAll('#tabs .tab'); await dnd(h, [[tabs[0], .5, .5, 600]], [() => document.querySelector('.workspace.visible .pane'), .5, .95]); })()`);
      await wait(600);
      console.log('PANE -> TAB 1', await state());
      // Umsortieren: Tab 2 vor Tab 1
      await js(`(async () => { const tabs = document.querySelectorAll('#tabs .tab'); await dnd(tabs[1], [], [() => document.querySelectorAll('#tabs .tab')[0], .1, .5]); })()`);
      await wait(300);
      console.log('UMSORTIERT', await js(`JSON.stringify(S.tabs.map(t => Layout.leaves(t.root).length))`));
      await js(`activateTab(S.tabs[1].id)`); await wait(400);
      await shot('d3-final.png');
      console.log('ERRS', await js(`JSON.stringify(window.__errs || [])`));
    } catch (e) { console.log('E2E ERROR', e); }
    await js(`closeTab(S.tabs[0]); closeTab(S.tabs[0]); 0`); await wait(500);
    app.exit(0);
  });
});
require('../src/main.js');
