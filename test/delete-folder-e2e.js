'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'mact-delete-tree-'));
const read = name => JSON.parse(fs.readFileSync(path.join(ud, name + '.json'), 'utf8'));
const write = (name, data) => fs.writeFileSync(path.join(ud, name + '.json'), JSON.stringify(data));
const session = (id, folder) => ({ id, name: id, folder, type: 'ssh', host: 'test.example', passwordEnc: 'test-encrypted' });
const records = [session('direct', 'Lab'), session('nested', 'Lab/Deep/Nested'), session('keep', 'Lab2'), session('other', 'Move/Child')];
const folderPaths = ['Lab', 'Lab/Deep', 'Lab/Deep/Empty', 'Lab2', 'Move', 'Move/Child'];
write('sessions', records);
write('settings', { sessionFolders: folderPaths });
const passwords = { Lab: 'raw:b25l', 'Lab/Deep': 'locked-format', Lab2: 'raw:dHdv' };
write('folder-passwords', passwords);
app.setPath('userData', ud);
process.env.MACT_UPDATE_DELAY = '600000';
const noop = () => {};
const pty = require.resolve('node-pty');
require.cache[pty] = { id: pty, filename: pty, loaded: true, exports: { spawn: () => ({ onData: noop, onExit: noop, resize: noop, write: noop, kill: noop }) } };

const en = process.env.MACT_LANG === 'en';
const del = en ? 'Delete folder and contents' : 'Ordner samt Inhalt löschen';
const oldDel = en ? 'Delete folder' : 'Ordner löschen';
const option = label => `Array.from(document.querySelectorAll('#ctx-menu .ci-label')).find(e => e.textContent === ${JSON.stringify(label)})`;
const btn = label => `Array.from(document.querySelectorAll('.modal-foot button')).find(e => e.textContent === ${JSON.stringify(label)})`;
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async code => {
      for (let i = 0; i < 80; i++) {
        if (await js(code)) return;
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      throw new Error(code);
    };
    const menu = folder => js(`document.querySelector(${JSON.stringify(`[data-folder="${folder}"]`)}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})); 0`);
    try {
      await wait(`typeof S !== 'undefined' && S.tabs.length && document.querySelector('[data-folder="Lab"]')`);
      await menu('Sessions');
      assert.equal(await js(`${option(del + '…')}.closest('.item').classList.contains('disabled')`), true);
      await menu('Lab');
      assert.equal(await js(`!!${option(oldDel)}`), true);
      await js(`${option(del + '…')}.click(); 0`);
      assert.ok(await js(`document.querySelector('.modal-body').textContent.includes(${JSON.stringify(en ? '2 saved sessions · 3 subfolders' : '2 gespeicherte Sitzungen · 3 Unterordner')})`));
      assert.equal(await js(`document.activeElement === ${btn(en ? 'Cancel' : 'Abbrechen')}`), true);
      await js(`${btn(en ? 'Cancel' : 'Abbrechen')}.click(); 0`);
      await wait(`!document.querySelector('.modal')`);
      assert.deepEqual(read('sessions'), records);
      assert.deepEqual(read('folder-passwords'), passwords);

      const store = require('../src/store');
      assert.deepEqual(await store.deleteSessionFolder('Lab', ['direct'], folderPaths), { ok: false, changed: true });
      assert.deepEqual(await store.deleteSessionFolder('Sessions', [], []), { ok: false });
      await js(`[...document.querySelectorAll('#session-tree .s-name')].find(e => e.textContent === 'direct').closest('.sess').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); 0`);
      await wait(`S.tabs.length === 2`);
      await js(`S.collapsed.add('Lab/Deep'); S.collapsed.add('Lab2'); 0`);
      await menu('Lab');
      await js(`${option(del + '…')}.click(); 0`);
      await js(`${btn(del)}.click(); 0`);
      await wait(`!document.querySelector('.modal') && !document.querySelector('[data-folder="Lab"]')`);
      assert.deepEqual(read('sessions'), records.slice(2));
      assert.deepEqual(read('settings').sessionFolders, ['Lab2', 'Move', 'Move/Child']);
      assert.deepEqual(read('folder-passwords'), { Lab2: passwords.Lab2 });
      assert.equal(await js(`S.tabs.length === 2 && S.collapsed.has('Lab2') && !S.collapsed.has('Lab/Deep')`), true);
      assert.deepEqual(await js(`JSON.parse(localStorage.getItem('collapsedFolders'))`), ['Lab2']);

      await menu('Move');
      await js(`${option(oldDel)}.click(); 0`);
      await js(`${btn(oldDel)}.click(); 0`);
      await wait(`!document.querySelector('.modal') && document.querySelector('[data-folder="Child"]')`);
      assert.equal(read('sessions').find(s => s.id === 'other').folder, 'Child');

      // Use a local directory as a network-share stand-in, including encrypted team credentials.
      const { FILE, BACKUP_DIR } = require('../src/shared');
      const { decryptSecrets } = require('../src/config-io');
      const share = fs.mkdtempSync(path.join(ud, 'share-'));
      const teamPass = 'synthetic-passphrase';
      const sharedEntry = (id, folder) => ({ id, name: id, folder, type: 'ssh', host: 'test.example', password: id + '-password' });
      write('sessions', [sharedEntry('drop', 'Lab/Deep'), sharedEntry('stay', 'Lab2')]);
      write('settings', { sessionFolders: ['Lab', 'Lab/Deep', 'Lab/Empty', 'Lab2'] });
      write('folder-passwords', passwords);
      await store.sharedEnable({ dir: share, teamPass });
      const sharedConfig = () => JSON.parse(fs.readFileSync(path.join(share, FILE), 'utf8'));
      assert.deepEqual(decryptSecrets(sharedConfig().secrets, teamPass), { drop: 'drop-password', stay: 'stay-password' });
      const result = await store.deleteSessionFolder('Lab', ['drop'], ['Lab', 'Lab/Deep', 'Lab/Empty']);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.folderStillExists, false);
      assert.deepEqual(sharedConfig().sessions.map(s => s.id), ['stay']);
      assert.deepEqual(sharedConfig().settings.sessionFolders, ['Lab2']);
      assert.deepEqual(decryptSecrets(sharedConfig().secrets, teamPass), { stay: 'stay-password' });
      assert.deepEqual(Object.keys(read('passwords')), ['stay']);
      assert.ok(fs.readdirSync(path.join(share, BACKUP_DIR)).length);
      console.log('PASS folder menu, cancel, open tab, both delete modes, and shared-store deletion');
      app.exit(0);
    } catch (e) { console.error(e); app.exit(1); }
  });
});
require('../src/main');
