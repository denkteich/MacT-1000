'use strict';
/**
 * TFTP-Server (RFC 1350) mit Optionen blksize/tsize/timeout (RFC 2347–2349).
 * Läuft im Hauptprozess, wird bei Bedarf in einem gewählten Verzeichnis gestartet.
 * Lesen (Gerät lädt herunter) immer erlaubt, Schreiben (Gerät lädt hoch) nur wenn freigegeben.
 */
const dgram = require('dgram');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const OP = { RRQ: 1, WRQ: 2, DATA: 3, ACK: 4, ERROR: 5, OACK: 6 };
const ERR = { UNDEF: 0, NOTFOUND: 1, ACCESS: 2, DISKFULL: 3, ILLEGAL: 4, TID: 5, EXISTS: 6, OPTION: 8 };
const MAX_BLK = 65464;
const MAX_LOG = 200;

function errPacket(code, msg) {
  const m = Buffer.from(String(msg || ''), 'utf8');
  const b = Buffer.alloc(5 + m.length);
  b.writeUInt16BE(OP.ERROR, 0); b.writeUInt16BE(code, 2); m.copy(b, 4); b[4 + m.length] = 0;
  return b;
}
function dataPacket(block, chunk) {
  const b = Buffer.alloc(4 + chunk.length);
  b.writeUInt16BE(OP.DATA, 0); b.writeUInt16BE(block & 0xffff, 2); chunk.copy(b, 4);
  return b;
}
function ackPacket(block) { const b = Buffer.alloc(4); b.writeUInt16BE(OP.ACK, 0); b.writeUInt16BE(block & 0xffff, 2); return b; }
function oackPacket(opts) {
  const parts = [Buffer.from([0, OP.OACK])];
  for (const [k, v] of Object.entries(opts)) parts.push(Buffer.from(k + '\0' + v + '\0', 'ascii'));
  return Buffer.concat(parts);
}

/** Anfrage zerlegen: Dateiname, Modus, Optionen */
function parseRequest(msg) {
  if (msg.length < 4) return null;
  const op = msg.readUInt16BE(0);
  if (op !== OP.RRQ && op !== OP.WRQ) return { op };
  const strs = [];
  let start = 2;
  for (let i = 2; i < msg.length; i++) if (msg[i] === 0) { strs.push(msg.toString('utf8', start, i)); start = i + 1; }
  if (strs.length < 2) return null;
  const options = {};
  for (let i = 2; i + 1 < strs.length; i += 2) options[strs[i].toLowerCase()] = strs[i + 1];
  return { op, file: strs[0], mode: strs[1].toLowerCase(), options };
}

/** Dateiname des Geräts sicher auf das Wurzelverzeichnis abbilden ('..' und absolute Pfade bleiben innerhalb). */
function mapPath(root, name) {
  let n = String(name || '').replace(/\\/g, '/').replace(/^[a-zA-Z]:/, '').replace(/\0/g, '');
  const rel = path.posix.normalize('/' + n).replace(/^\/+/, '');
  if (!rel || rel === '.' ) return null;
  return { rel, abs: path.join(root, ...rel.split('/')) };
}
const inside = (root, p) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

// netascii-Umwandlung (Text-Modus)
function toNetascii(buf) {
  const out = [];
  for (const c of buf) { if (c === 0x0a) out.push(0x0d, 0x0a); else if (c === 0x0d) out.push(0x0d, 0x00); else out.push(c); }
  return Buffer.from(out);
}
function fromNetascii(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === 0x0d && buf[i + 1] === 0x0a) { out.push(0x0a); i++; }
    else if (c === 0x0d && buf[i + 1] === 0x00) { out.push(0x0d); i++; }
    else out.push(c);
  }
  return Buffer.from(out);
}

function localAddresses() {
  const r = [];
  for (const [ifname, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' || a.family === 4) { if (!a.internal) r.push({ ifname, address: a.address }); }
  }
  return r;
}

class Transfer {
  constructor(server, req, rinfo) {
    this.server = server; this.req = req; this.peer = rinfo;
    this.id = crypto.randomBytes(5).toString('hex');
    this.kind = req.op === OP.RRQ ? 'get' : 'put';
    this.blksize = 512; this.timeoutMs = server.opts.timeoutMs; this.retries = server.opts.retries;
    this.bytes = 0; this.size = null; this.tries = 0; this.timer = null; this.done = false;
    this.info = { id: this.id, kind: this.kind, peer: `${rinfo.address}:${rinfo.port}`, file: req.file, size: null, bytes: 0,
      state: 'running', error: '', started: Date.now(), ended: 0, mode: req.mode };
  }

  update(extra = {}, force = false) {
    Object.assign(this.info, extra, { bytes: this.bytes, size: this.size });
    const now = Date.now();
    if (force || now - (this.lastEmit || 0) > 250) { this.lastEmit = now; this.server.emitTransfer(this.info); }
  }

  async run() {
    const s = this.server;
    const family = s.sock.type;
    this.sock = dgram.createSocket(family);
    this.sock.on('error', (e) => this.fail(e.message, null));
    this.sock.on('message', (m, ri) => this.onMessage(m, ri));
    await new Promise((res, rej) => { this.sock.once('error', rej); this.sock.bind(0, s.opts.host, () => { this.sock.removeListener('error', rej); res(); }); });
    try {
      if (this.req.mode !== 'octet' && this.req.mode !== 'netascii') return this.reject(ERR.ILLEGAL, 'Modus nicht unterstützt: ' + this.req.mode);
      const m = mapPath(s.root, this.req.file);
      if (!m) return this.reject(ERR.ACCESS, 'Ungültiger Dateiname');
      this.rel = m.rel; this.abs = m.abs; this.info.file = m.rel;
      if (this.kind === 'get') await this.startRead(); else await this.startWrite();
    } catch (e) {
      this.reject(e.code === 'ENOENT' ? ERR.NOTFOUND : e.code === 'EACCES' || e.code === 'EPERM' ? ERR.ACCESS : e.code === 'ENOSPC' ? ERR.DISKFULL : ERR.UNDEF,
        e.code === 'ENOENT' ? 'Datei nicht gefunden' : e.message);
    }
  }

  negotiate(isWrite) {
    const o = this.req.options, ack = {};
    if (o.blksize !== undefined) {
      const n = parseInt(o.blksize, 10);
      if (n >= 8) { this.blksize = Math.min(n, MAX_BLK); ack.blksize = String(this.blksize); }
    }
    if (o.timeout !== undefined) {
      const n = parseInt(o.timeout, 10);
      if (n >= 1 && n <= 255) { this.timeoutMs = n * 1000; ack.timeout = String(n); }
    }
    if (o.tsize !== undefined) {
      if (isWrite) { const n = parseInt(o.tsize, 10); if (n >= 0) { this.size = n; ack.tsize = String(n); } }
      else if (this.size !== null) ack.tsize = String(this.size);
    }
    return Object.keys(ack).length ? ack : null;
  }

  // ---------- Gerät lädt herunter ----------
  async startRead() {
    const s = this.server;
    const real = await fsp.realpath(this.abs);
    if (!inside(s.rootReal, real)) return this.reject(ERR.ACCESS, 'Zugriff außerhalb des TFTP-Verzeichnisses');
    const st = await fsp.stat(real);
    if (!st.isFile()) return this.reject(ERR.NOTFOUND, 'Keine Datei');
    if (this.req.mode === 'netascii') { this.buf = toNetascii(await fsp.readFile(real)); this.size = this.buf.length; }
    else { this.fd = await fsp.open(real, 'r'); this.size = st.size; }
    const oack = this.negotiate(false);
    this.block = 0;
    this.update({}, true);
    if (oack) this.sendPacket(oackPacket(oack)); // wartet auf ACK 0
    else await this.sendNextBlock();
  }

  async readChunk(blockNo) {
    const pos = (blockNo - 1) * this.blksize;
    if (this.buf) return this.buf.subarray(pos, pos + this.blksize);
    const b = Buffer.alloc(Math.max(0, Math.min(this.blksize, this.size - pos)));
    if (b.length) await this.fd.read(b, 0, b.length, pos);
    return b;
  }

  async sendNextBlock() {
    this.block += 1;
    const chunk = await this.readChunk(this.block);
    this.lastLen = chunk.length;
    this.sendPacket(dataPacket(this.block, chunk));
  }

  // ---------- Gerät lädt hoch ----------
  async startWrite() {
    const s = this.server;
    if (!s.opts.allowWrite) return this.reject(ERR.ACCESS, 'Hochladen ist am TFTP-Server nicht erlaubt');
    const dir = path.dirname(this.abs);
    await fsp.mkdir(dir, { recursive: true });
    const realDir = await fsp.realpath(dir);
    if (!inside(s.rootReal, realDir)) return this.reject(ERR.ACCESS, 'Zugriff außerhalb des TFTP-Verzeichnisses');
    this.dest = path.join(realDir, path.basename(this.abs));
    let exists = false;
    try { const st = await fsp.lstat(this.dest); exists = true; if (!st.isFile()) return this.reject(ERR.ACCESS, 'Ziel ist keine Datei'); } catch (_) {}
    if (exists && !s.opts.overwrite) return this.reject(ERR.EXISTS, 'Datei existiert bereits (Überschreiben nicht erlaubt)');
    this.tmp = path.join(realDir, `.${path.basename(this.abs)}.${this.id}.tftp-part`);
    this.fd = await fsp.open(this.tmp, 'w');
    if (this.req.mode === 'netascii') this.chunks = [];
    const oack = this.negotiate(true);
    this.expect = 1;
    this.update({}, true);
    this.sendPacket(oack ? oackPacket(oack) : ackPacket(0));
  }

  async finishWrite() {
    if (this.chunks) { const b = fromNetascii(Buffer.concat(this.chunks)); await this.fd.write(b, 0, b.length); this.bytes = b.length; }
    await this.fd.close(); this.fd = null;
    if (!this.server.opts.overwrite) { try { await fsp.lstat(this.dest); throw Object.assign(new Error('Datei existiert inzwischen'), { code: 'EEXIST' }); } catch (e) { if (e.code === 'EEXIST') throw e; } }
    await fsp.rename(this.tmp, this.dest); this.tmp = null;
  }

  // ---------- Protokoll ----------
  sendPacket(pkt) {
    this.last = pkt; this.tries = 0;
    this.transmit();
  }
  transmit() {
    if (this.done) return;
    clearTimeout(this.timer);
    this.sock.send(this.last, this.peer.port, this.peer.address);
    this.timer = setTimeout(() => {
      if (this.done) return;
      if (++this.tries > this.retries) return this.fail('Zeitüberschreitung – keine Antwort vom Gerät', ERR.UNDEF);
      this.transmit();
    }, this.timeoutMs);
  }

  async onMessage(msg, ri) {
    if (this.done && !this.linger) return;
    if (ri.address !== this.peer.address || ri.port !== this.peer.port) {
      this.sock.send(errPacket(ERR.TID, 'Unbekannte Transfer-ID'), ri.port, ri.address); return;
    }
    if (msg.length < 4) return;
    const op = msg.readUInt16BE(0), n = msg.readUInt16BE(2);
    if (op === OP.ERROR) {
      const text = msg.toString('utf8', 4, Math.max(4, msg.indexOf(0, 4) < 0 ? msg.length : msg.indexOf(0, 4)));
      return this.fail('Abbruch durch Gerät' + (text ? ': ' + text : ''), null);
    }
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.kind === 'get') {
        if (op !== OP.ACK) return this.fail('Unerwartetes Paket', ERR.ILLEGAL);
        if (n !== (this.block & 0xffff)) return; // altes/doppeltes ACK ignorieren
        if (this.block > 0) this.bytes = Math.min(this.size, this.bytes + this.lastLen);
        if (this.block > 0 && this.lastLen < this.blksize) return this.succeed();
        this.update();
        await this.sendNextBlock();
      } else {
        if (this.linger) { if (op === OP.DATA) this.sock.send(this.last, this.peer.port, this.peer.address); return; }
        if (op !== OP.DATA) return this.fail('Unerwartetes Paket', ERR.ILLEGAL);
        if (n === (this.expect & 0xffff)) {
          const data = msg.subarray(4);
          if (this.chunks) this.chunks.push(Buffer.from(data));
          else if (data.length) await this.fd.write(data, 0, data.length);
          if (!this.chunks) this.bytes += data.length; else this.bytes += data.length;
          const ack = ackPacket(this.expect);
          this.expect += 1;
          if (data.length < this.blksize) {
            await this.finishWrite();
            clearTimeout(this.timer);
            this.last = ack;
            this.sock.send(ack, this.peer.port, this.peer.address);
            // kurz offen bleiben, falls das letzte ACK verloren geht
            this.linger = true;
            this.succeed(this.timeoutMs);
          } else { this.update(); this.sendPacket(ack); }
        } else if (n === ((this.expect - 1) & 0xffff)) {
          this.sock.send(this.last, this.peer.port, this.peer.address); // doppeltes DATA → ACK wiederholen
        }
      }
    } catch (e) {
      this.fail(e.code === 'ENOSPC' ? 'Datenträger voll' : e.message, e.code === 'ENOSPC' ? ERR.DISKFULL : ERR.UNDEF);
    } finally { this.busy = false; }
  }

  reject(code, message) {
    try { this.sock.send(errPacket(code, message), this.peer.port, this.peer.address, () => this.cleanup()); } catch (_) { this.cleanup(); }
    this.finish('error', message, false);
  }
  fail(message, code) {
    if (this.done) return;
    if (code !== null && code !== undefined && this.sock) { try { this.sock.send(errPacket(code, message), this.peer.port, this.peer.address); } catch (_) {} }
    this.finish('error', message);
  }
  succeed(lingerMs = 0) { this.finish('done', '', true, lingerMs); }
  finish(state, error, close = true, lingerMs = 0) {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.timer);
    this.update({ state, error, ended: Date.now() }, true);
    this.server.transferEnded(this);
    if (close) { if (lingerMs) setTimeout(() => this.cleanup(), lingerMs); else this.cleanup(); }
  }
  cleanup() {
    this.linger = false;
    clearTimeout(this.timer);
    if (this.fd) { const fd = this.fd; this.fd = null; fd.close().catch(() => {}); }
    if (this.tmp) { const t = this.tmp; this.tmp = null; setTimeout(() => fsp.unlink(t).catch(() => {}), 50); }
    if (this.sock) { try { this.sock.close(); } catch (_) {} this.sock = null; }
  }
  abort() { this.fail('Server gestoppt', ERR.UNDEF); }
}

class TftpServer extends EventEmitter {
  constructor() {
    super();
    this.sock = null; this.transfers = new Map(); this.log = []; this.opts = null;
  }

  get running() { return !!this.sock; }

  async start({ root, port = 69, host = '0.0.0.0', allowWrite = false, overwrite = false, timeoutMs = 3000, retries = 5 } = {}) {
    await this.stop();
    if (!root) throw new Error('Kein Verzeichnis gewählt');
    let st;
    try { st = await fsp.stat(root); } catch (_) { throw new Error('Verzeichnis nicht gefunden: ' + root); }
    if (!st.isDirectory()) throw new Error('Kein Verzeichnis: ' + root);
    port = parseInt(port, 10);
    if (!(port >= 1 && port <= 65535)) throw new Error('Ungültiger Port');
    host = String(host || '0.0.0.0').trim() || '0.0.0.0';
    this.root = path.resolve(root);
    this.rootReal = await fsp.realpath(this.root);
    this.opts = { port, host, allowWrite: !!allowWrite, overwrite: !!overwrite, timeoutMs, retries };
    const sock = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
    try {
      await new Promise((res, rej) => { sock.once('error', rej); sock.bind(port, host, () => { sock.removeListener('error', rej); res(); }); });
    } catch (e) {
      try { sock.close(); } catch (_) {}
      if (e.code === 'EADDRINUSE') throw new Error(`Port ${port} ist bereits belegt – läuft schon ein anderer TFTP-Server (z. B. der macOS-eigene tftpd)?`);
      if (e.code === 'EACCES') throw new Error(`Keine Berechtigung für Port ${port}. Bitte einen Port über 1024 wählen (z. B. 6969).`);
      if (e.code === 'EADDRNOTAVAIL') throw new Error(`Adresse ${host} gibt es auf diesem Mac nicht`);
      throw e;
    }
    sock.on('error', (e) => { this.emit('status', { ...this.status(), error: e.message }); });
    sock.on('message', (m, ri) => this.onRequest(m, ri));
    this.sock = sock;
    this.emit('status', this.status());
    return this.status();
  }

  async stop() {
    for (const t of [...this.transfers.values()]) t.abort();
    this.transfers.clear();
    if (this.sock) { const s = this.sock; this.sock = null; await new Promise(r => { try { s.close(r); } catch (_) { r(); } }); this.emit('status', this.status()); }
    return this.status();
  }

  onRequest(msg, ri) {
    const req = parseRequest(msg);
    if (!req) return;
    if (req.op !== OP.RRQ && req.op !== OP.WRQ) { this.sock.send(errPacket(ERR.ILLEGAL, 'Unerwartetes Paket'), ri.port, ri.address); return; }
    // dieselbe Anfrage doppelt (Gerät hat wiederholt) → ignorieren
    for (const t of this.transfers.values()) if (t.peer.address === ri.address && t.peer.port === ri.port) return;
    const t = new Transfer(this, req, ri);
    this.transfers.set(t.id, t);
    this.log.unshift(t.info);
    if (this.log.length > MAX_LOG) this.log.length = MAX_LOG;
    t.run().catch((e) => t.fail(e.message, ERR.UNDEF));
  }

  transferEnded(t) { this.transfers.delete(t.id); }
  emitTransfer(info) { this.emit('transfer', { ...info }); }
  clearLog() { this.log = this.log.filter(i => i.state === 'running'); }

  status() {
    return {
      running: this.running, root: this.root || '', port: this.opts ? this.opts.port : 69, host: this.opts ? this.opts.host : '0.0.0.0',
      allowWrite: !!(this.opts && this.opts.allowWrite), overwrite: !!(this.opts && this.opts.overwrite),
      active: this.transfers.size, addresses: localAddresses(), log: this.log.slice(0, 100).map(i => ({ ...i }))
    };
  }
}

module.exports = { TftpServer, parseRequest, mapPath, toNetascii, fromNetascii, localAddresses, OP, ERR };
