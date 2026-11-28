'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'mact-search-create-'));
const sessionFile = path.join(ud, 'sessions.json');
const fixture = { id: 'existing', type: 'ssh', name: 'Core router', host: 'Core.Example', folder: 'Lab' };
fs.writeFileSync(sessionFile, JSON.stringify([fixture]));
const saved = () => JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
app.setPath('userData', ud);
process.env.MACT_UPDATE_DELAY = '600000';
const noop = () => {};
const pty = require.resolve('node-pty');
require.cache[pty] = { id: pty, filename: pty, loaded: true, exports: { spawn: () => ({ onData: noop, onExit: noop, resize: noop, write: noop, kill: noop }) } };

const en = process.env.MACT_LANG === 'en';
const newLabel = en ? 'Create new session…' : 'Neue Session erstellen…';
const emptyLabel = en ? 'No matching sessions.' : 'Keine passenden Sessions.';
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
    const search = value => js(`{ const el = document.querySelector('#side-filter'); el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); } 0`);
    const key = (key, flags = {}, selector = '#side-filter') => js(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key, bubbles: true, cancelable: true, ...flags })}))`);
    const countTabs = () => js(`S.tabs.length`);
    const readField = field => js(`document.querySelector('.modal [name="${field}"]').value`);
    const hidden = () => js(`document.querySelector('#side-search-create').hidden`);
    try {
      await wait(`typeof S !== 'undefined' && S.tabs.length && document.querySelector('#session-tree .sess')`);
      const initialTabs = await countTabs();
      assert.equal(await hidden(), true);
      await search('  ');
      await key('Enter');
      assert.equal(await hidden(), true);
      assert.equal(await js(`!!document.querySelector('.modal')`), false);
      assert.equal(await countTabs(), initialTabs);

      await search('  Core.Example  ');
      await wait(`document.querySelector('#side-search-create span').textContent === ${JSON.stringify(newLabel)}`);
      assert.equal(await hidden(), false);
      assert.equal(await js(`document.querySelectorAll('#session-tree .sess').length`), 1);
      await key('Enter', { isComposing: true });
      assert.equal(await js(`!!document.querySelector('.modal')`), false);
      await key('Enter');
      assert.equal(await readField('host'), 'Core.Example');
      await key('Enter', { repeat: true }, '.modal [name="host"]');
      assert.equal(await js(`document.querySelectorAll('.modal').length`), 1);
      assert.deepEqual(saved(), [fixture]);
      assert.equal(await countTabs(), initialTabs);
      await key('Escape', {}, '.modal [name="host"]');

      await search('New.Example');
      await wait(`document.querySelector('#session-tree .side-empty').textContent === ${JSON.stringify(emptyLabel)}`);
      assert.equal(await hidden(), false);
      await key('Enter');
      assert.equal(await readField('host'), 'New.Example');
      await key('Escape', {}, '.modal [name="host"]');
      await js(`document.querySelector('#side-search-create').click(); 0`);
      assert.equal(await readField('host'), 'New.Example');
      const saveLabel = en ? 'Save' : 'Speichern';
      await js(`[...document.querySelectorAll('.modal-foot button')].find(b => b.textContent === ${JSON.stringify(saveLabel)}).click(); 0`);
      await wait(`!document.querySelector('.modal') && document.querySelectorAll('#session-tree .sess').length === 1`);
      assert.equal(saved().length, 2);
      assert.equal(saved()[1].host, 'New.Example');
      assert.equal(await countTabs(), initialTabs);

      await search('New router');
      await key('Enter');
      assert.equal(await readField('name'), 'New router');
      assert.equal(await readField('host'), '');
      await key('Escape', {}, '.modal [name="host"]');
      await search('');
      assert.equal(await hidden(), true);
      const existing = `[...document.querySelectorAll('#session-tree .s-name')].find(el => el.textContent === 'Core router').closest('.sess')`;
      await js(`${existing}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 0`);
      await wait(`S.tabs.length === ${initialTabs + 1}`);
      console.log('PASS session search: matches and no results, click and Enter, prefill, save, no auto-connect, existing sessions still open');
      app.exit(0);
    } catch (e) { console.error(e); app.exit(1); }
  });
});
require('../src/main');
