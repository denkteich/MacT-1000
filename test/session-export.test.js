'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { analyze, newSessions, IMPORT_FOLDER } = require('../src/sess-import');

const master = 'Local synthetic test master #916';
const password = ' synthetic-Über@example! ';
const second = 'synthetic-credentials #843';
const prefix = '_@ABCDEFGHIJKLMNOPQR';
const bookmark = (kind, endpoint, port, user) => `#109#${kind}%${endpoint}%${port}%${user}%#style#startup#comment`;
const key = crypto.createHash('sha512').update(master).digest().subarray(0, 32);
const encode = (secret, modern = false) => {
  const legacy = crypto.createCipheriv('aes-256-ecb', key, null);
  legacy.setAutoPadding(false);
  const iv = modern ? Buffer.from(prefix.slice(2, 18), 'ascii') : Buffer.concat([legacy.update(Buffer.alloc(16)), legacy.final()]);
  const c = crypto.createCipheriv('aes-256-cfb8', key, iv);
  return (modern ? prefix : '') + Buffer.concat([c.update(secret, 'utf8'), c.final()]).toString('base64').replace(/\+/g, '@').replace(/\//g, '_');
};
const text = [
  '[Bookmarks]', 'SubRep=', 'ImgNum=42', 'SSH=' + bookmark(0, 'host.example', 2222, 'CaseSensitive'),
  'Other port=' + bookmark(0, 'host.example', 2223, 'CaseSensitive'),
  'Telnet=' + bookmark(1, 'router.example', 23, '[My router]'),
  '[Bookmarks_1]', 'SubRep=Datacenter\\Lab', 'RDP=' + bookmark(4, 'desk.example', 3389, 'DOMAIN\\admin'),
  'Serial=' + bookmark(8, '115200', 'COM7', ''), 'VNC=' + bookmark(5, 'desktop.example', 5900, ''),
  'Invalid=' + bookmark(0, '--invalid', 22, ''), '[Passwords]', 'ssh2222:CaseSensitive@host.example=' + encode(password),
  '[Credentials]', 'My router=operator:' + encode(second, true)
].join('\r\n');

test('valid text-based export maps supported sessions under the import folder', () => {
  const r = analyze(text, master);
  assert.equal(r.recognized, true);
  assert.equal(r.failed, false);
  assert.equal(r.encrypted, 2);
  assert.equal(r.unmatched, 0);
  assert.equal(r.skipped, 2);
  assert.deepEqual(r.sessions.map(s => s.type), ['ssh', 'ssh', 'telnet', 'rdp', 'serial']);
  assert.deepEqual(r.sessions.map(s => s.password), [password, undefined, second, undefined, undefined]);
  assert.equal(r.sessions[0].folder, IMPORT_FOLDER);
  assert.equal(r.sessions[2].username, 'operator');
  assert.equal(r.sessions[2].autoLogin, true);
  assert.equal(r.sessions[3].folder, `${IMPORT_FOLDER}/Datacenter/Lab`);
  assert.equal(r.sessions[3].domain, 'DOMAIN');
  assert.equal(r.sessions[4].path, 'COM7');
  assert.equal(r.sessions[4].baudRate, 115200);
});

test('wrong or absent master never stores passwords in these fixtures', () => {
  assert.equal(analyze(text, 'incorrect-for-fixture').failed, true);
  assert.equal(analyze(text).failed, false);
  assert.equal(analyze(text).sessions.some(s => s.password), false);
  assert.equal(analyze(text + '\nBad=malformed', master).sessions.some(s => s.password), false);
});

test('no protocol, port or username fallback for ambiguous accounts', () => {
  const r = analyze(text.replace('ssh2222:CaseSensitive@host.example=', 'CaseSensitive@host.example='), master);
  assert.equal(r.unmatched, 1);
  assert.equal(r.sessions[0].password, undefined);
  const mismatch = analyze(text.replace('ssh2222:CaseSensitive@', 'ssh2222:casesensitive@'), master);
  assert.equal(mismatch.unmatched, 1);
  assert.equal(mismatch.sessions[0].password, undefined);
});

test('reimport skips the old entry, including one previously imported without passwords', () => {
  const before = analyze(text).sessions;
  const after = analyze(text, master).sessions;
  assert.equal(newSessions(after, before).length, 0);
  assert.equal(newSessions([...after, ...after], []).length, after.length);
  assert.equal(newSessions(after, before.map(s => ({ ...s, folder: 'Another folder' }))).length, after.length);
  assert.deepEqual(before.map(s => s.password), [undefined, undefined, undefined, undefined, undefined]);
});

test('registry, binary containers and unrelated files are not accepted', () => {
  for (const invalid of ['Windows Registry Editor Version 5.00\n' + text, 'PK\u0000' + text, '[Misc]\nsetting=1']) {
    assert.equal(analyze(invalid, master).recognized, false);
  }
});

module.exports = { text, master, password, second };
