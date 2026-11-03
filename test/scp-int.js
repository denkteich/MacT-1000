'use strict';
// Integrationstest gegen lokalen sshd (Port 2222, Benutzer scptest / Passwort Geheim123)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileTransfer } = require('../src/scp');

const asks = [];
const events = [];
const fx = new FileTransfer(async (q) => { asks.push(q); return q.kind === 'confirm' ? true : 'Geheim123'; }, (_c, p) => events.push(p));
const cfg = { type: 'ssh', host: '127.0.0.1', port: 2222, username: 'scptest', legacy: false };
const waitJob = (id) => new Promise((res) => { const t = setInterval(() => { const d = events.find(e => e.id === id && e.type === 'done'); if (d) { clearInterval(t); res(d); } }, 50); });

(async () => {
  fx.masters.set('x', cfg); fx.closeAll(); // evtl. Reste eines früheren Laufs
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-'));
  fs.writeFileSync(path.join(tmp, 'klein datei.txt'), 'hallo welt\n');
  fs.writeFileSync(path.join(tmp, 'gross.bin'), Buffer.alloc(30 * 1024 * 1024, 7));
  fs.mkdirSync(path.join(tmp, 'ordner/sub'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'ordner/sub/x.txt'), 'x');

  let r = await fx.list(cfg, '');
  await fx.op(cfg, 'delete', ['/home/scptest/neu ordner']);
  console.log('Abfragen:', asks.map(a => a.kind + ': ' + a.text.split('\n').pop()));
  assert.ok(asks.some(a => a.kind === 'password'), 'Passwort wurde abgefragt');
  assert.strictEqual(r.cwd, '/home/scptest');
  const n = asks.length;
  await fx.op(cfg, 'mkdir', ['/home/scptest/neu ordner']);
  r = await fx.list(cfg, '/home/scptest');
  assert.ok(r.entries.some(e => e.name === 'neu ordner' && e.type === 'dir'));
  assert.strictEqual(asks.length, n, 'keine zweite Passwortabfrage dank ControlMaster');

  fx.transfer('u1', cfg, { direction: 'upload', sources: [path.join(tmp, 'klein datei.txt'), path.join(tmp, 'gross.bin'), path.join(tmp, 'ordner')], dest: '/home/scptest/neu ordner' });
  let d = await waitJob('u1');
  assert.ok(d.ok, 'Upload: ' + d.error);
  const prog = events.filter(e => e.id === 'u1' && e.type === 'progress');
  console.log('Fortschritt-Events:', prog.length, prog.slice(-1)[0]);
  r = await fx.list(cfg, '/home/scptest/neu ordner');
  assert.deepStrictEqual(r.entries.map(e => e.name), ['ordner', 'gross.bin', 'klein datei.txt']);
  assert.strictEqual(r.entries.find(e => e.name === 'gross.bin').size, 30 * 1024 * 1024);

  await fx.op(cfg, 'rename', ['/home/scptest/neu ordner/klein datei.txt', "/home/scptest/neu ordner/it's mine.txt"]);
  const dl = path.join(tmp, 'dl');
  fx.transfer('d1', cfg, { direction: 'download', sources: ["/home/scptest/neu ordner/it's mine.txt", '/home/scptest/neu ordner/ordner'], dest: dl });
  d = await waitJob('d1');
  assert.ok(d.ok, 'Download: ' + d.error);
  assert.strictEqual(fs.readFileSync(path.join(dl, "it's mine.txt"), 'utf8'), 'hallo welt\n');
  assert.strictEqual(fs.readFileSync(path.join(dl, 'ordner/sub/x.txt'), 'utf8'), 'x');

  // klassisches Protokoll (-O)
  const lcfg = { ...cfg, scpLegacy: true };
  fx.transfer('d2', lcfg, { direction: 'download', sources: ["/home/scptest/neu ordner/it's mine.txt"], dest: path.join(tmp, 'dl2') });
  d = await waitJob('d2');
  assert.ok(d.ok, 'Download -O: ' + d.error);
  assert.ok(fs.existsSync(path.join(tmp, "dl2/it's mine.txt")));

  // Abbrechen
  fx.transfer('c1', cfg, { direction: 'download', sources: ['/home/scptest/neu ordner/gross.bin'], dest: path.join(tmp, 'dl3') });
  await new Promise(res => { const t = setInterval(() => { if (events.some(e => e.id === 'c1' && e.type === 'start')) { clearInterval(t); fx.cancel('c1'); res(); } }, 1); });
  d = await waitJob('c1');
  assert.strictEqual(d.ok, false); assert.strictEqual(d.error, 'Abgebrochen');

  // Fehlerfall
  await assert.rejects(fx.list(cfg, '/gibtsnicht'), /nicht lesbar/);
  fx.transfer('e1', cfg, { direction: 'download', sources: ['/home/scptest/fehlt.txt'], dest: path.join(tmp, 'dl4') });
  d = await waitJob('e1');
  assert.strictEqual(d.ok, false); console.log('Fehlermeldung:', d.error);

  await fx.op(cfg, 'delete', ['/home/scptest/neu ordner']);
  r = await fx.list(cfg, '');
  assert.ok(!r.entries.some(e => e.name === 'neu ordner'));
  assert.strictEqual(asks.length, n, 'insgesamt nur eine Anmeldung');
  fx.closeAll();
  assert.strictEqual(await fx.check(cfg), false, 'Hintergrund-Verbindung geschlossen');
  // Terminal-Session meldet sich an → Datei-Browser nutzt deren Verbindung ohne Abfrage
  const { SessionManager } = require('../src/sessions');
  let out = ''; let exited = null;
  const sm = new SessionManager((ch, p) => { if (ch === 'session:data') out += p.data; if (ch === 'session:exit') exited = p; });
  sm.open('t1', cfg, { cols: 100, rows: 30 });
  for (let i = 0; i < 100 && !/password:/.test(out); i++) await new Promise(r => setTimeout(r, 100));
  sm.write('t1', 'Geheim123\r');
  for (let i = 0; i < 100 && !/scptest@/.test(out.split('password:').pop()); i++) await new Promise(r => setTimeout(r, 100));
  const before = asks.length;
  r = await fx.list(cfg, '/tmp');
  assert.strictEqual(r.cwd, '/tmp');
  assert.strictEqual(asks.length, before, 'Datei-Browser nutzt Terminal-Verbindung');
  sm.write('t1', 'exit\r');
  for (let i = 0; i < 50 && !exited; i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(exited, 'Terminal-Session endet sauber trotz ControlMaster');
  console.log('scp-Integration: alle Tests bestanden');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
