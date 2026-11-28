'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { app, dialog, Menu, safeStorage } = require('electron');
const { IMPORT_FOLDER } = require('../src/sess-import');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mact-session-export-'));
const extension = ['mo', 'baconf'].join('');
const file = path.join(tmp, `test.${extension}`);
const text = '[Bookmarks]\r\nSubRep=Team\\Lab\r\nImgNum=42\r\nExample=#109#0%host.example%2222%user%\r\n';
fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
app.setPath('userData', tmp);
// Für den Dialogtest werden der lokale PTY und der Schlüsselspeicher simuliert.
const pty = require.resolve('node-pty');
const noop = () => {};
require.cache[pty] = { id: pty, filename: pty, loaded: true, exports: {
  spawn: () => ({ onData: noop, onExit: noop, resize: noop, write: noop, kill: noop })
} };
const testKey = crypto.randomBytes(32);
safeStorage.isEncryptionAvailable = () => true;
safeStorage.getSelectedStorageBackend = () => 'test';
safeStorage.encryptString = value => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', testKey, iv);
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
};
safeStorage.decryptString = data => {
  const cipher = crypto.createDecipheriv('aes-256-gcm', testKey, data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
};
process.env.MACT_UPDATE_DELAY = '600000';
let pickerCalls = 0;
let pickerOptions;
let pickerCanceled = false;
dialog.showOpenDialog = async (_owner, options) => {
  pickerCalls++;
  pickerOptions = options;
  return pickerCanceled ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [file] };
};

app.on('browser-window-created', (_event, win) => {
  const timer = setTimeout(() => { console.error('Timeout'); app.exit(1); }, 20000);
  win.webContents.once('did-finish-load', async () => {
    const js = s => win.webContents.executeJavaScript(s);
    const wait = async s => {
      for (let i = 0; i < 80; i++) {
        if (await js(s)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Condition not reached: ' + s);
    };
    const preview = 'document.querySelectorAll(".modal-foot button")[1]';
    const apply = 'document.querySelectorAll(".modal-foot button")[2]';
    try {
      await wait(`typeof S !== 'undefined' && S.tabs.length`);
      const menu = Menu.getApplicationMenu();
      const menuItem = menu.getMenuItemById('importSessionExport');
      assert.ok(menuItem, 'Import item is present in the actual application menu');
      const en = process.env.MACT_LANG === 'en';
      const fileMenu = menu.items.find(i => i.label === (en ? 'File' : process.env.MACT_TEST_PLATFORM === 'win32' ? 'Datei' : 'Ablage'));
      assert.ok(fileMenu?.submenu.items.includes(menuItem), 'Import item is in the File menu');
      assert.equal(menuItem.label, `${en ? 'Import session export' : 'Sitzungsexport importieren'} (.${extension})…`);
      pickerCanceled = true;
      menuItem.click(menuItem, win);
      await wait(`document.querySelector('.modal') === null`);
      for (let i = 0; !pickerCalls && i < 30; i++) await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(pickerCalls, 1, 'Menu click requests the native picker');
      assert.deepEqual(pickerOptions.filters[0].extensions, [extension]);
      assert.deepEqual(pickerOptions.filters[1].extensions, ['mxtsessions', 'ini']);
      assert.deepEqual(pickerOptions.filters[2].extensions, ['*']);
      assert.equal(pickerOptions.filters[0].name, en ? 'Configuration export' : 'Konfigurationsexport');
      pickerCanceled = false;
      menuItem.click(menuItem, win);
      await wait(`!!document.querySelector('.modal')`);
      assert.equal(pickerCalls, 2);
      assert.equal(await js(`document.querySelector('.modal').textContent.includes(${JSON.stringify(`test.${extension}`)})`), true);
      assert.equal(await js(`${apply}.disabled`), true);
      await js(`${preview}.click(); 0`);
      await wait(`!${apply}.disabled`);
      assert.equal(await js(`document.querySelector('.modal').textContent.includes(${JSON.stringify(IMPORT_FOLDER + '/Team/Lab')})`), true);
      const expected = process.env.MACT_LANG === 'en' ? 'Preview import' : 'Importvorschau prüfen';
      assert.equal(await js(`${preview}.textContent`), expected);
      await js(`${apply}.click(); 0`);
      await wait(`!document.querySelector('.modal') && S.sessions.some(s => s.name === 'Example')`);
      const first = JSON.parse(fs.readFileSync(path.join(tmp, 'sessions.json')));
      assert.equal(first[0].folder, IMPORT_FOLDER + '/Team/Lab');
      assert.equal(first[0].port, 2222);
      assert.equal(await js(`!![...document.querySelectorAll('button, span')].find(e => e.textContent === 'Example')`), true);
      const settingsImportLabel = en ? 'Import session export…' : 'Sitzungsexport importieren…';
      await js(`runCommand('settings'); 0`);
      await wait(`!![...document.querySelectorAll('.modal-body button')].find(b => b.textContent === ${JSON.stringify(settingsImportLabel)})`);
      await js(`[...document.querySelectorAll('.modal-body button')].find(b => b.textContent === ${JSON.stringify(settingsImportLabel)}).click(); 0`);
      await wait(`!!document.querySelector('.modal')`);
      assert.equal(pickerCalls, 3, 'Settings requests the same native picker');
      await js(`${preview}.click(); 0`);
      const duplicate = process.env.MACT_LANG === 'en' ? '1 already present' : '1 vorhanden';
      await wait(`document.querySelector('.modal').textContent.includes(${JSON.stringify(duplicate)})`);
      assert.equal(await js(`${apply}.disabled`), true);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'sessions.json'))), first);
      await js(`document.querySelector('.modal-head button').click(); 0`);

      const master = 'Fixture password for local import dialog';
      const secret = 'Fictitious login password from the fixture';
      // Unabhängiger feststehender Testvektor; erzeugt mit Node/OpenSSL.
      const encrypted = 'MO1+Gktln1+rYBA2NudwxrJvQbzkYqJcG9g21tFT0mxd7cg8VY0dqwFK';
      fs.writeFileSync(file, text.replace('Example=', 'Encrypted=').replace('host.example', 'other.example') +
        '[Passwords]\r\nssh2222:user@other.example=' + encrypted + '\r\n');
      await js(`sessionExportDialog(); 0`);
      await wait(`!!document.querySelector('.modal')`);
      safeStorage.isEncryptionAvailable = () => false;
      await js(`document.querySelector('.modal input[type=password]').value = ${JSON.stringify(master)}; ${preview}.click(); 0`);
      const storageWarning = process.env.MACT_LANG === 'en' ? 'Encrypted password storage is not available.' : 'Verschlüsselter Passwortspeicher nicht verfügbar.';
      await wait(`document.querySelector('.modal').textContent.includes(${JSON.stringify(storageWarning)})`);
      assert.equal(await js(`${apply}.disabled`), true);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'sessions.json'))), first);
      safeStorage.isEncryptionAvailable = () => true;
      await js(`document.querySelector('.modal input[type=password]').value = ${JSON.stringify(master)}; ${preview}.click(); 0`);
      await wait(`!${apply}.disabled`);
      assert.equal(await js(`document.querySelector('.modal input[type=password]').value`), '');
      assert.equal(await js(`document.querySelector('.modal').textContent.includes(${JSON.stringify(secret)})`), false);
      await js(`${apply}.click(); 0`);
      await wait(`!document.querySelector('.modal') && S.sessions.some(s => s.name === 'Encrypted')`);
      const raw = fs.readFileSync(path.join(tmp, 'sessions.json'), 'utf8');
      const saved = JSON.parse(raw).find(s => s.name === 'Encrypted');
      assert.equal(raw.includes(secret), false);
      assert.equal(typeof saved.password, 'undefined');
      assert.equal(safeStorage.decryptString(Buffer.from(saved.passwordEnc, 'base64')), secret);
      console.log('PASS session export dialog: preview, import, visible folder, duplicate handling and encrypted save');
      clearTimeout(timer);
      app.exit(0);
    } catch (e) { console.error(e); app.exit(1); }
  });
});

require('../src/main');
