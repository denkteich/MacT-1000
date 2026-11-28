'use strict';
/**
 * SFTP/SCP-Server (SSH) auf Basis von ssh2.
 * - SFTP-Subsystem mit dem gewählten Verzeichnis als „/“
 * - klassisches SCP-Protokoll (scp -t / scp -f), wie es Switches/Router und „scp -O“ verwenden
 * - Anmeldung mit Benutzer/Passwort und/oder öffentlichem Schlüssel (authorized_keys-Format)
 * - eigener Host-Schlüssel (ed25519), wird beim ersten Start erzeugt und gespeichert
 * Kein Shell-Zugang: interaktive Sitzungen und andere Befehle werden abgewiesen.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Server, utils } = require('ssh2');
const { Jail, BaseServer, bindError, checkPort, checkRoot, lsLine, safeEqual, tmpName, peerOf, fsError } = require('./srv-common');

const { STATUS_CODE: SC, OPEN_MODE: OM } = utils.sftp;

function hostKeyFingerprint(priv) {
  const k = utils.parseKey(priv);
  const pub = (Array.isArray(k) ? k[0] : k).getPublicSSH();
  return 'SHA256:' + crypto.createHash('sha256').update(pub).digest('base64').replace(/=+$/, '');
}
function loadHostKey(file) {
  try { const k = fs.readFileSync(file, 'utf8'); if (k.includes('PRIVATE KEY')) return k; } catch (_) {}
  const kp = utils.generateKeyPairSync('ed25519', { comment: 'MacT-1000 SFTP-Server' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, kp.private, { mode: 0o600 });
  return kp.private;
}
function parseAuthorizedKeys(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /((?:ssh|ecdsa|sk)-[\w@.-]+)\s+([A-Za-z0-9+/=]+)/.exec(line);
    if (!m) continue;
    const k = utils.parseKey(`${m[1]} ${m[2]}`);
    if (k && !(k instanceof Error)) out.push(Array.isArray(k) ? k[0] : k);
  }
  return out;
}

const toAttrs = (st) => ({ mode: st.mode, uid: 0, gid: 0, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) });
const statusOf = (e) => (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') ? SC.NO_SUCH_FILE : e && (e.code === 'EACCES' || e.code === 'EPERM' || e.denied) ? SC.PERMISSION_DENIED : SC.FAILURE);

/* ---------- SFTP ---------- */
class SftpSession {
  constructor(srv, sftp, ctx) {
    this.srv = srv; this.sftp = sftp; this.ctx = ctx; this.jail = srv.jail; this.handles = new Map(); this.nextH = 1;
    const on = (ev, fn) => sftp.on(ev, (id, ...a) => Promise.resolve(fn.call(this, id, ...a)).catch((e) => this.fail(id, e)));
    on('REALPATH', this.realpath); on('STAT', this.stat); on('LSTAT', this.stat); on('FSTAT', this.fstat);
    on('OPEN', this.open); on('READ', this.read); on('WRITE', this.write); on('CLOSE', this.close);
    on('OPENDIR', this.opendir); on('READDIR', this.readdir);
    on('MKDIR', this.mkdir); on('RMDIR', this.rmdir); on('REMOVE', this.remove); on('RENAME', this.rename);
    on('SETSTAT', this.setstat); on('FSETSTAT', this.fsetstat);
    on('READLINK', (id) => this.sftp.status(id, SC.OP_UNSUPPORTED)); on('SYMLINK', (id) => this.sftp.status(id, SC.OP_UNSUPPORTED));
    sftp.on('end', () => {
      this.cleanup();
      // Exit-Status 0 melden (sonst werten scp/sftp das Ende als Fehler), dann Kanal schließen
      try { if (sftp.outgoing && sftp.outgoing.state === 'open') sftp._protocol.exitStatus(sftp.outgoing.id, 0); } catch (_) {}
      try { sftp.end(); } catch (_) {}
    }); sftp.on('close', () => this.cleanup());
  }
  get o() { return this.srv.opts; }
  fail(id, e) { try { this.sftp.status(id, statusOf(e), fsError(e)); } catch (_) {} }
  deny(id, msg) { this.sftp.status(id, SC.PERMISSION_DENIED, msg); }
  newHandle(obj) { const n = this.nextH++; const b = Buffer.alloc(4); b.writeUInt32BE(n); this.handles.set(n, obj); return b; }
  getHandle(b) { return b && b.length === 4 ? this.handles.get(b.readUInt32BE(0)) : null; }
  async t(p) { const t = this.jail.resolve(p, '/'); await this.jail.safe(t.abs); return t; }

  async realpath(id, p) {
    const t = this.jail.resolve(p || '.', '/');
    this.sftp.name(id, [{ filename: t.virt, longname: t.virt, attrs: {} }]);
  }
  async stat(id, p) { const t = await this.t(p); this.sftp.attrs(id, toAttrs(await fsp.stat(t.abs))); }
  async fstat(id, h) {
    const o = this.getHandle(h); if (!o) return this.sftp.status(id, SC.FAILURE, 'Ungültiges Handle');
    this.sftp.attrs(id, toAttrs(o.fd ? await o.fd.stat() : await fsp.stat(o.abs)));
  }
  async open(id, p, flags) {
    const t = await this.t(p);
    const wr = !!(flags & (OM.WRITE | OM.APPEND | OM.CREAT | OM.TRUNC));
    if (!wr) {
      const st = await fsp.stat(t.abs);
      if (!st.isFile()) return this.sftp.status(id, SC.FAILURE, 'Keine Datei');
      const fd = await fsp.open(t.abs, 'r');
      const tr = this.srv.transfer({ kind: 'get', peer: this.ctx.peer, file: t.virt.slice(1), size: st.size, user: this.ctx.user });
      return this.sftp.handle(id, this.newHandle({ type: 'file', fd, abs: t.abs, tr, max: 0, size: st.size }));
    }
    if (!this.o.allowWrite) return this.deny(id, 'Hochladen ist auf diesem Server nicht erlaubt');
    let exists = false;
    try { const st = await fsp.stat(t.abs); if (st.isDirectory()) return this.sftp.status(id, SC.FAILURE, 'Ist ein Verzeichnis'); exists = true; } catch (_) {}
    if (exists && (flags & OM.EXCL)) return this.sftp.status(id, SC.FAILURE, 'Datei existiert bereits');
    if (exists && !this.o.overwrite) return this.deny(id, 'Datei existiert bereits (Überschreiben ist nicht erlaubt)');
    // neue oder abgeschnittene Datei → erst als Teildatei schreiben, beim Schließen umbenennen
    const useTmp = !exists || (flags & OM.TRUNC);
    const target = useTmp ? tmpName(t.abs) : t.abs;
    const fd = await fsp.open(target, useTmp ? 'wx' : (flags & OM.APPEND ? 'a' : 'r+'));
    const tr = this.srv.transfer({ kind: 'put', peer: this.ctx.peer, file: t.virt.slice(1), user: this.ctx.user });
    this.sftp.handle(id, this.newHandle({ type: 'file', fd, abs: t.abs, tmp: useTmp ? target : null, tr, max: 0, write: true }));
  }
  async read(id, h, offset, length) {
    const o = this.getHandle(h); if (!o || o.type !== 'file') return this.sftp.status(id, SC.FAILURE, 'Ungültiges Handle');
    const buf = Buffer.alloc(Math.min(length, 256 * 1024));
    const { bytesRead } = await o.fd.read(buf, 0, buf.length, offset);
    if (!bytesRead) return this.sftp.status(id, SC.EOF);
    if (offset + bytesRead > o.max) { o.max = offset + bytesRead; o.tr.set(o.max); }
    this.sftp.data(id, buf.subarray(0, bytesRead));
  }
  async write(id, h, offset, data) {
    const o = this.getHandle(h); if (!o || !o.write) return this.sftp.status(id, SC.FAILURE, 'Ungültiges Handle');
    await o.fd.write(data, 0, data.length, offset);
    if (offset + data.length > o.max) { o.max = offset + data.length; o.tr.set(o.max); }
    this.sftp.status(id, SC.OK);
  }
  async close(id, h) {
    const o = this.getHandle(h); if (!o) return this.sftp.status(id, SC.FAILURE, 'Ungültiges Handle');
    this.handles.delete(h.readUInt32BE(0));
    if (o.type === 'dir') return this.sftp.status(id, SC.OK);
    await o.fd.close().catch(() => {});
    o.closed = true;
    if (o.tmp) { try { await fsp.rename(o.tmp, o.abs); } catch (e) { o.tr.fail(fsError(e)); fsp.unlink(o.tmp).catch(() => {}); return this.fail(id, e); } }
    if (!o.write && o.size && o.max < o.size) o.tr.fail('abgebrochen (unvollständig gelesen)'); else o.tr.done();
    this.sftp.status(id, SC.OK);
  }
  async opendir(id, p) {
    const t = await this.t(p);
    const st = await fsp.stat(t.abs);
    if (!st.isDirectory()) return this.sftp.status(id, SC.FAILURE, 'Kein Verzeichnis');
    const names = ['.', '..', ...(await fsp.readdir(t.abs))];
    this.sftp.handle(id, this.newHandle({ type: 'dir', abs: t.abs, names, pos: 0 }));
  }
  async readdir(id, h) {
    const o = this.getHandle(h); if (!o || o.type !== 'dir') return this.sftp.status(id, SC.FAILURE, 'Ungültiges Handle');
    if (o.pos >= o.names.length) return this.sftp.status(id, SC.EOF);
    const list = [];
    while (o.pos < o.names.length && list.length < 100) {
      const n = o.names[o.pos++];
      try {
        const st = await fsp.stat(n === '..' ? path.dirname(o.abs) : path.join(o.abs, n));
        list.push({ filename: n, longname: lsLine(n, st), attrs: toAttrs(st) });
      } catch (_) {}
    }
    if (!list.length) return this.sftp.status(id, SC.EOF);
    this.sftp.name(id, list);
  }
  async mkdir(id, p) {
    if (!this.o.allowWrite) return this.deny(id, 'Anlegen ist auf diesem Server nicht erlaubt');
    const t = await this.t(p); await fsp.mkdir(t.abs); this.sftp.status(id, SC.OK);
  }
  async rmdir(id, p) {
    if (!this.o.allowDelete) return this.deny(id, 'Löschen ist auf diesem Server nicht erlaubt');
    const t = await this.t(p); if (t.virt === '/') return this.deny(id, 'Wurzelverzeichnis');
    await fsp.rmdir(t.abs); this.sftp.status(id, SC.OK);
  }
  async remove(id, p) {
    if (!this.o.allowDelete) return this.deny(id, 'Löschen ist auf diesem Server nicht erlaubt');
    const t = await this.t(p); await fsp.unlink(t.abs); this.sftp.status(id, SC.OK);
  }
  async rename(id, a, b) {
    if (!this.o.allowDelete) return this.deny(id, 'Umbenennen ist auf diesem Server nicht erlaubt');
    const f = await this.t(a), t = await this.t(b);
    let exists = false; try { await fsp.stat(t.abs); exists = true; } catch (_) {}
    if (exists && !this.o.overwrite) return this.sftp.status(id, SC.FAILURE, 'Ziel existiert bereits');
    await fsp.rename(f.abs, t.abs); this.sftp.status(id, SC.OK);
  }
  async setstat(id, p, attrs) {
    // Zeitstempel übernehmen (z. B. sftp -p), Rechte werden ignoriert
    const t = await this.t(p);
    if (this.o.allowWrite && attrs && attrs.mtime !== undefined) await fsp.utimes(t.abs, attrs.atime || attrs.mtime, attrs.mtime).catch(() => {});
    this.sftp.status(id, SC.OK);
  }
  async fsetstat(id, h, attrs) {
    const o = this.getHandle(h);
    if (o && o.fd && o.write && attrs && attrs.mtime !== undefined) { o.mtime = attrs; await o.fd.utimes(attrs.atime || attrs.mtime, attrs.mtime).catch(() => {}); }
    this.sftp.status(id, SC.OK);
  }
  cleanup() {
    for (const o of this.handles.values()) {
      if (o.fd && !o.closed) o.fd.close().catch(() => {});
      if (o.tr) o.tr.fail('Verbindung getrennt');
      if (o.tmp) fsp.unlink(o.tmp).catch(() => {});
    }
    this.handles.clear();
  }
}

/* ---------- SCP (klassisches Protokoll) ---------- */
class Reader {
  constructor(stream) { this.buf = Buffer.alloc(0); this.waiters = []; this.ended = false;
    stream.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.kick(); });
    stream.on('end', () => { this.ended = true; this.kick(); }); stream.on('close', () => { this.ended = true; this.kick(); }); }
  kick() { const w = this.waiters.splice(0); w.forEach(f => f()); }
  wait() { return new Promise(r => this.waiters.push(r)); }
  async byte() { while (!this.buf.length) { if (this.ended) return null; await this.wait(); } const b = this.buf[0]; this.buf = this.buf.subarray(1); return b; }
  async line() {
    for (;;) {
      const i = this.buf.indexOf(0x0a);
      if (i >= 0) { const l = this.buf.subarray(0, i).toString('utf8'); this.buf = this.buf.subarray(i + 1); return l; }
      if (this.ended) return null;
      if (this.buf.length > 8192) throw new Error('SCP: Kopfzeile zu lang');
      await this.wait();
    }
  }
  async chunk(max) { while (!this.buf.length) { if (this.ended) return null; await this.wait(); } const n = Math.min(max, this.buf.length); const c = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return c; }
}
function parseScp(cmd) {
  const toks = [];
  const re = /'((?:[^']|'\\'')*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g; let m;
  while ((m = re.exec(cmd))) toks.push(m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]);
  if (path.basename(toks[0] || '') !== 'scp') return null;
  const f = { r: false, p: false, d: false, mode: '', target: '' };
  let i = 1;
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t === '--') { i++; break; }
    if (!t.startsWith('-')) break;
    for (const c of t.slice(1)) { if (c === 'r') f.r = true; else if (c === 'p') f.p = true; else if (c === 'd') f.d = true; else if (c === 't' || c === 'f') f.mode = c; }
  }
  f.target = toks.slice(i).join(' ') || '.';
  return f.mode ? f : null;
}

class ScpSession {
  constructor(srv, ch, ctx, f) { this.srv = srv; this.ch = ch; this.ctx = ctx; this.f = f; this.jail = srv.jail; this.rd = new Reader(ch); }
  get o() { return this.srv.opts; }
  ok() { this.ch.write(Buffer.from([0])); }
  err(msg, fatal) { this.ch.write(Buffer.concat([Buffer.from([fatal ? 2 : 1]), Buffer.from(`scp: ${msg}\n`, 'utf8')])); }
  async ack() { const b = await this.rd.byte(); if (b === 0) return true; if (b === null) throw new Error('Verbindung getrennt'); const msg = await this.rd.line(); throw new Error(msg || 'Fehler beim Client'); }
  finish(code) { try { this.ch.exit(code); } catch (_) {} try { this.ch.end(); } catch (_) {} }
  async run() {
    try { if (this.f.mode === 't') await this.sink(); else await this.source(); this.finish(0); }
    catch (e) { try { this.err(fsError(e), true); } catch (_) {} this.finish(1); }
  }
  // Gerät/Client lädt hoch
  async sink() {
    if (!this.o.allowWrite) { this.err('Hochladen ist auf diesem Server nicht erlaubt', true); throw Object.assign(new Error('Hochladen nicht erlaubt'), { quiet: true }); }
    const t = this.jail.resolve(this.f.target, '/'); await this.jail.safe(t.abs);
    let isDir = false; try { isDir = (await fsp.stat(t.abs)).isDirectory(); } catch (_) {}
    if (this.f.d && !isDir) { this.err('Zielverzeichnis existiert nicht', true); return; }
    const stack = [{ abs: t.abs, virt: t.virt, isDir }];
    let times = null;
    this.ok();
    for (;;) {
      const line = await this.rd.line();
      if (line === null || line === '') return;
      const c = line[0], rest = line.slice(1);
      if (c === 'T') { times = rest.split(' ').map(Number); this.ok(); continue; }
      if (c === 'E') { stack.pop(); this.ok(); if (!stack.length) return; continue; }
      if (c === '\x01' || c === '\x02') { if (c === '\x02') return; continue; }
      const m = /^(\d{4}) (\d+) (.+)$/.exec(rest);
      if (!m || (c !== 'C' && c !== 'D')) { this.err('Protokollfehler', true); return; }
      const name = m[3];
      if (name.includes('/') || name === '..' || name === '.') { this.err('Ungültiger Name: ' + name, true); return; }
      const cur = stack[stack.length - 1];
      const dest = cur.isDir ? { abs: path.join(cur.abs, name), virt: path.posix.join(cur.virt, name) } : { abs: cur.abs, virt: cur.virt };
      await this.jail.safe(dest.abs);
      if (c === 'D') {
        if (!this.f.r) { this.err('Verzeichnis ohne -r', true); return; }
        try { await fsp.mkdir(dest.abs); } catch (e) { if (e.code !== 'EEXIST') { this.err(fsError(e), true); return; } }
        stack.push({ ...dest, isDir: true }); times = null; this.ok(); continue;
      }
      const size = Number(m[2]);
      let exists = false; try { await fsp.stat(dest.abs); exists = true; } catch (_) {}
      if (exists && !this.o.overwrite) {
        // Daten verwerfen, dann Fehler melden
        this.ok(); await this.drain(size); await this.rd.byte();
        this.err(`${name}: Datei existiert bereits (Überschreiben ist nicht erlaubt)`, false); continue;
      }
      await fsp.mkdir(path.dirname(dest.abs), { recursive: true });
      const tmp = tmpName(dest.abs);
      const fd = await fsp.open(tmp, 'wx');
      const tr = this.srv.transfer({ kind: 'put', peer: this.ctx.peer, file: dest.virt.slice(1), size, user: this.ctx.user });
      this.ok();
      let left = size;
      try {
        while (left > 0) {
          const ch = await this.rd.chunk(Math.min(left, 256 * 1024));
          if (ch === null) throw new Error('Verbindung getrennt');
          await fd.write(ch); left -= ch.length; tr.add(ch.length);
        }
        await fd.close();
        // OpenSSH sendet danach ein Null-Byte; libssh2 (z. B. curl) beendet stattdessen den Kanal
        const b = await this.rd.byte();
        if (b !== 0 && b !== null) throw new Error('Übertragung vom Client abgebrochen');
        await fsp.rename(tmp, dest.abs);
        if (times && this.f.p) await fsp.utimes(dest.abs, times[2] || times[0], times[0]).catch(() => {});
        times = null; tr.done();
        if (b === null) return;
        this.ok();
      } catch (e) { await fd.close().catch(() => {}); fsp.unlink(tmp).catch(() => {}); tr.fail(fsError(e)); throw e; }
    }
  }
  async drain(n) { while (n > 0) { const c = await this.rd.chunk(Math.min(n, 65536)); if (c === null) return; n -= c.length; } }
  // Gerät/Client lädt herunter
  async source() {
    await this.ack();
    const t = this.jail.resolve(this.f.target, '/'); await this.jail.safe(t.abs);
    let st; try { st = await fsp.stat(t.abs); } catch (e) { this.err(`${this.f.target}: ${fsError(e)}`, false); return; }
    await this.sendEntry(t.abs, t.virt, st);
  }
  async sendEntry(abs, virt, st) {
    const name = path.basename(abs) || 'root';
    if (this.f.p) { this.ch.write(`T${Math.floor(st.mtimeMs / 1000)} 0 ${Math.floor(st.atimeMs / 1000)} 0\n`); await this.ack(); }
    if (st.isDirectory()) {
      if (!this.f.r) { this.err(`${name}: ist ein Verzeichnis (bitte -r)`, false); return; }
      this.ch.write(`D0755 0 ${name}\n`); await this.ack();
      for (const n of (await fsp.readdir(abs)).sort()) {
        const a = path.join(abs, n);
        if (this.closed) return;
        try { await this.jail.safe(a); const s2 = await fsp.stat(a); await this.sendEntry(a, path.posix.join(virt, n), s2); } catch (e) { if (/Verbindung/.test(e.message)) throw e; }
      }
      this.ch.write('E\n'); await this.ack(); return;
    }
    if (!st.isFile()) return;
    this.ch.write(`C0644 ${st.size} ${name}\n`); await this.ack();
    const tr = this.srv.transfer({ kind: 'get', peer: this.ctx.peer, file: virt.slice(1), size: st.size, user: this.ctx.user });
    try {
      const rs = fs.createReadStream(abs, { highWaterMark: 64 * 1024 });
      for await (const c of rs) { if (!this.ch.write(c)) await new Promise(r => this.ch.once('drain', r)); tr.add(c.length); }
      this.ok();
      // libssh2 (z. B. curl) schließt nach dem letzten Datenblock, ohne zu bestätigen
      const b = await this.rd.byte();
      if (b === null) { tr.done(); this.closed = true; return; }
      if (b !== 0) throw new Error((await this.rd.line()) || 'Fehler beim Client');
      tr.done();
    } catch (e) { tr.fail(fsError(e)); throw e; }
  }
}

/* ---------- Server ---------- */
class SshFileServer extends BaseServer {
  constructor({ hostKeyFile } = {}) { super('ssh'); this.server = null; this.defaultPort = 2222; this.clients = new Set(); this.hostKeyFile = hostKeyFile; }
  get running() { return !!this.server; }
  // Pfad erst bei Bedarf ermitteln (userData steht erst nach app.setName fest)
  keyFile() { return typeof this.hostKeyFile === 'function' ? this.hostKeyFile() : this.hostKeyFile; }

  async start({ root, port = 2222, host = '0.0.0.0', allowWrite = false, overwrite = false, allowDelete = false, user = '', password = '', authorizedKeys = '' } = {}) {
    await this.stop();
    const r = await checkRoot(root);
    port = checkPort(port);
    host = String(host || '0.0.0.0').trim() || '0.0.0.0';
    if (!user) throw new Error('Bitte einen Benutzernamen angeben');
    const keys = parseAuthorizedKeys(authorizedKeys);
    if (String(authorizedKeys || '').trim() && !keys.length) throw new Error('Keiner der öffentlichen Schlüssel konnte gelesen werden');
    if (!password && !keys.length) throw new Error('Bitte ein Passwort oder einen öffentlichen Schlüssel angeben');
    const hostKey = loadHostKey(this.keyFile());
    this.fingerprint = hostKeyFingerprint(hostKey);
    this.rootDir = r.root; this.jail = new Jail(r.root, r.real);
    this.opts = { port, host, allowWrite: !!allowWrite, overwrite: !!allowWrite && !!overwrite, allowDelete: !!allowDelete, user, password: password || '', keys, keyCount: keys.length };
    const srv = new Server({ hostKeys: [hostKey], ident: 'MacT-1000' }, (client, info) => this.onClient(client, info));
    try { await new Promise((res, rej) => { srv.once('error', rej); srv.listen(port, host, () => { srv.removeListener('error', rej); res(); }); }); }
    catch (e) { try { srv.close(); } catch (_) {} throw bindError(e, port, host, 'SFTP'); }
    srv.on('error', (e) => this.emit('status', { ...this.status(), error: e.message }));
    this.server = srv;
    this.emit('status', this.status());
    return this.status();
  }

  onClient(client, info) {
    const o = this.opts;
    const ctx = { peer: `${String(info.ip || '').replace(/^::ffff:/, '')}:${info.port || ''}`, user: '' };
    this.clients.add(client);
    let fails = 0;
    client.on('error', () => {});
    client.on('close', () => { this.clients.delete(client); this.emit('status', this.status()); });
    client.on('authentication', (a) => {
      const userOk = safeEqual(a.username, o.user);
      const methods = [...(o.password ? ['password', 'keyboard-interactive'] : []), ...(o.keys.length ? ['publickey'] : [])];
      const reject = (count = true) => { if (count) { fails++; this.authFailed(ctx.peer, a.username); } a.reject(methods); };
      if (a.method === 'password') { if (o.password && userOk && safeEqual(a.password, o.password)) { ctx.user = a.username; return a.accept(); } return reject(); }
      if (a.method === 'keyboard-interactive' && o.password) {
        return a.prompt([{ prompt: 'Passwort: ', echo: false }], 'MacT-1000', '', (answers) => {
          if (userOk && safeEqual((answers || [])[0], o.password)) { ctx.user = a.username; a.accept(); } else reject();
        });
      }
      if (a.method === 'publickey' && o.keys.length && userOk) {
        const k = o.keys.find(k2 => k2.type === a.key.algo && Buffer.compare(k2.getPublicSSH(), a.key.data) === 0);
        if (!k) return reject(!!a.signature);
        if (!a.signature) return a.accept(); // Client fragt nur, ob der Schlüssel passt
        if (k.verify(a.blob, a.signature, a.hashAlgo) === true) { ctx.user = a.username; return a.accept(); }
        return reject();
      }
      return reject(false);
    });
    client.on('ready', () => {
      this.emit('status', this.status());
      client.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (acc) => { new SftpSession(this, acc(), ctx); });
        session.on('exec', (acc, rej, i) => {
          const f = parseScp(i.command || '');
          const ch = acc();
          if (!f) { ch.stderr.write('Dieser Server erlaubt nur SFTP und SCP.\n'); ch.exit(1); ch.end(); return; }
          new ScpSession(this, ch, ctx, f).run();
        });
        session.on('pty', (acc) => acc && acc());
        session.on('env', (acc) => acc && acc());
        session.on('shell', (acc) => { const ch = acc(); ch.write('MacT-1000: Dieser Server erlaubt nur SFTP und SCP, keinen Shell-Zugang.\r\n'); ch.exit(1); ch.end(); });
      });
    });
    // nach zu vielen Fehlversuchen trennen
    const iv = setInterval(() => { if (fails >= 6) { try { client.end(); } catch (_) {} } }, 1000);
    client.on('close', () => clearInterval(iv));
  }

  async stop() {
    if (this.server) {
      const s = this.server; this.server = null;
      for (const t of [...this.active]) { t.state = 'error'; t.error = 'Server gestoppt'; t.ended = Date.now(); this.emit('transfer', { ...t }); }
      this.active.clear();
      for (const c of this.clients) { try { c.end(); } catch (_) {} }
      this.clients.clear();
      await new Promise(r => { try { s.close(() => r()); } catch (_) { r(); } setTimeout(r, 1500); });
      this.emit('status', this.status());
    }
    return this.status();
  }
  status() {
    let fp = this.fingerprint || '';
    if (!fp && this.hostKeyFile) { try { fp = hostKeyFingerprint(fs.readFileSync(this.keyFile(), 'utf8')); this.fingerprint = fp; } catch (_) {} }
    return { ...this.baseStatus(), fingerprint: fp, keyCount: this.opts ? this.opts.keyCount : 0, passwordAuth: !!(this.opts && this.opts.password), clients: this.clients.size };
  }
}

module.exports = { SshFileServer, parseScp, parseAuthorizedKeys, hostKeyFingerprint };
