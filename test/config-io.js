const assert = require('assert');
const C = require('../src/config-io.js');
const sessions = [
  { id: 'a', type: 'ssh', name: 'sw1', folder: 'RZ', host: '10.0.0.1', username: 'admin', password: 'geheim1', color: '#e5c07b' },
  { id: 'b', type: 'rdp', name: 'dc', folder: 'Windows', host: 'dc01', password: 'P@ss' },
  { id: 'c', type: 'serial', name: 'con', path: '/dev/cu.usbserial', baudRate: 9600 }
];
const layout = { tabs: [{ node: { type: 'split', dir: 'row', ratio: 0.5, a: { type: 'leaf', cfg: { type: 'ssh', host: 'x', password: 'leak' } }, b: { type: 'leaf', cfg: null } } }], active: 0 };
// ohne Passwörter
let e = C.buildExport({ sessions, settings: { theme: 'standard', fontSize: 14 }, ui: { layout, collapsedFolders: ['RZ'], mpHistory: ['show run'] }, appVersion: '1.1.1' });
let txt = JSON.stringify(e);
assert(!txt.includes('geheim1') && !txt.includes('P@ss') && !txt.includes('leak'), 'keine Passwörter im Klartext');
assert.strictEqual(e.sessions.length, 3); assert(!e.secrets);
// mit Passwörtern
e = C.buildExport({ sessions, settings: {}, ui: {}, includePasswords: true, passphrase: 'export-pw' });
txt = JSON.stringify(e);
assert(!txt.includes('geheim1') && !txt.includes('P@ss'), 'Passwörter verschlüsselt');
assert.strictEqual(e.secretsCount, 2);
assert.throws(() => C.buildExport({ sessions, includePasswords: true, passphrase: '123' }));
const p = C.parseImport(txt);
assert.strictEqual(p.kind, 'config');
const s = C.summary(p); assert.strictEqual(s.sessions, 3); assert.strictEqual(s.folders, 2); assert(s.hasSecrets);
assert.throws(() => C.decryptSecrets(p.secrets, 'falsch'), /falsch/);
const pw = C.decryptSecrets(p.secrets, 'export-pw');
assert.deepStrictEqual(pw, { a: 'geheim1', b: 'P@ss' });
// merge
const existing = [{ id: 'a', type: 'ssh', host: 'old', password: 'alt' }, { id: 'z', type: 'local', name: 'mein' }];
let m = C.mergeSessions(existing, p.sessions, { mode: 'merge', passwords: {} });
assert.strictEqual(m.added, 2); assert.strictEqual(m.updated, 1); assert.strictEqual(m.list.length, 4);
assert.strictEqual(m.list.find(x => x.id === 'a').host, '10.0.0.1');
assert.strictEqual(m.list.find(x => x.id === 'a').password, 'alt', 'lokales Passwort bleibt');
m = C.mergeSessions(existing, p.sessions, { mode: 'replace', passwords: pw });
assert.strictEqual(m.list.length, 3); assert.strictEqual(m.list.find(x => x.id === 'b').password, 'P@ss');
// altes Format
const l = C.parseImport(JSON.stringify([{ id: 'q', type: 'ssh', host: 'h' }]));
assert.strictEqual(l.kind, 'legacy'); assert.strictEqual(l.sessions.length, 1);
assert.throws(() => C.parseImport('{"foo":1}'), /Keine MacT-1000/);
console.log('config-io: alle Tests bestanden');
