const { app } = require('electron'); const fs = require('fs');
app.setPath('userData', '/tmp/macterm-asar');
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 1500));
    const r = await win.webContents.executeJavaScript(`({ xterm: typeof Terminal, fit: typeof FitAddon, tabs: S.tabs.length, txt: (()=>{const b=activePane().term.buffer.active;let t='';for(let i=0;i<5;i++)t+=b.getLine(i).translateToString(true)+'|';return t;})() })`);
    console.log('ASAR', JSON.stringify(r));
    fs.writeFileSync('/home/user/workspace/macterm/test/shots/asar.png', (await win.webContents.capturePage()).toPNG());
    app.exit(0);
  });
});
require(process.cwd() + '/dist/mac-arm64/MacT-1000.app/Contents/Resources/app.asar/src/main.js');
