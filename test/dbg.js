const { app } = require('electron');
app.setPath('userData', '/tmp/macterm-dbg');
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 1500));
    const r = await win.webContents.executeJavaScript(`(() => {
      const w = document.querySelector('.term-wrap'); const rect = w.getBoundingClientRect();
      const out = []; const y = rect.bottom - 4;
      let el = document.elementFromPoint(rect.left + 100, y);
      while (el && el !== w) { const cs = getComputedStyle(el); out.push(el.tagName + '.' + el.className + ' bg=' + cs.backgroundColor + ' h=' + el.getBoundingClientRect().height + ' ovf=' + cs.overflow); el = el.parentElement; }
      const kids = [...w.querySelectorAll('.xterm > *, .xterm-scrollable-element > *')].map(e => e.className + ' ' + JSON.stringify(e.getBoundingClientRect()));
      return { wrap: rect.height, out, kids };
    })()`);
    console.log(JSON.stringify(r, null, 1)); app.exit(0);
  });
});
require('../src/main.js');
