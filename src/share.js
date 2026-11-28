'use strict';
/**
 * Pane-Freigabe: ein laufendes Pane (lokale Shell, SSH, Telnet, Seriell, Befehl) für andere
 * MacT-1000-Instanzen freigeben – nur lesen oder mit Schreibrecht nach Freigabe.
 *
 * Transport: SSH (Bibliothek ssh2) – verschlüsselt, eigener Host-Schlüssel (ed25519) mit
 * Fingerprint, den der Zuschauer beim ersten Verbinden bestätigt (wie known_hosts).
 * Anmeldung: Benutzername = Anzeigename des Zuschauers, Passwort = Passwort der Freigabe.
 * Danach nur zwei Befehle per „exec“: „list“ (passende Freigaben) und „attach <id>“.
 * Auf dem Kanal laufen zeilenweise JSON-Nachrichten:
 *   Host → Zuschauer: hello, snap, d (Daten), size, write, deny, exit, end, notice
 *   Zuschauer → Host: in (Eingabe), req (Schreibrecht anfordern), release
 * Kein Shell-Zugang, keine Port-Weiterleitungen.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Server, Client, utils } = require('ssh2');
const T = (x) => require('../renderer/i18n.js').t(x);

const DEFAULT_PORT = 7022;
const MAX_VIEWERS = 20;
const FAIL_LIMIT = 5;              // Fehlversuche pro Adresse …
const FAIL_WINDOW = 10 * 60000;    // … innerhalb von 10 Minuten
const BLOCK_TIME = 10 * 60000;     // → 10 Minuten gesperrt
const MAX_BACKLOG = 8 * 1024 * 1024;

function fingerprintOf(pubSSH) { return 'SHA256:' + crypto.createHash('sha256').update(pubSSH).digest('base64').replace(/=+$/, ''); }
function loadHostKey(file) {
  try { const k = fs.readFileSync(file, 'utf8'); if (k.includes('PRIVATE KEY')) return k; } catch (_) {}
  const kp = utils.generateKeyPairSync('ed25519', { comment: 'MacT-1000 Freigabe' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, kp.private, { mode: 0o600 });
  return kp.private;
}
function keyFingerprint(priv) {
  const k = utils.parseKey(priv);
  return fingerprintOf((Array.isArray(k) ? k[0] : k).getPublicSSH());
}
function hashPw(pw, salt) { return crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 }); }
const cleanName = (s) => String(s || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 60) || '?';
const peerIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

/** Zufälliges, gut lesbares Passwort (ohne 0/O/1/l/I) */
function generatePassword(len = 10) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += abc[b[i] % abc.length];
  return s;
}

function localAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.internal) continue;
      if (a.family === 'IPv4' || a.family === 4) out.push({ name, address: a.address, family: 'IPv4' });
      else if ((a.family === 'IPv6' || a.family === 6) && !/^fe80/i.test(a.address)) out.push({ name, address: a.address, family: 'IPv6' });
    }
  }
  return out;
}

/* =====================================================================
 * Freigebende Seite
 * ===================================================================== */
class ShareHost {
  /**
   * opts.hostKeyFile()        Pfad des Host-Schlüssels
   * opts.settings()           { sharePort, shareBind }
   * opts.emit(channel, data)  an das Fenster
   * opts.write(sid, data)     Eingabe an die Session
   * opts.snapshot(sid)        → Promise<{ data, seq, cols, rows }>
   */
  constructor(opts) {
    this.o = opts;
    this.shares = new Map();
    this.server = null;
    this.port = 0; this.bind = '';
    this.clients = new Set();
    this.fails = new Map();   // ip → { n, first, blockedUntil }
    this.vseq = 0;
    this.timer = setInterval(() => this.checkExpiry(), 15000);
    if (this.timer.unref) this.timer.unref();
  }

  keyFile() { return typeof this.o.hostKeyFile === 'function' ? this.o.hostKeyFile() : this.o.hostKeyFile; }
  fingerprint() {
    if (this._fp) return this._fp;
    try { this._fp = keyFingerprint(loadHostKey(this.keyFile())); } catch (_) { this._fp = ''; }
    return this._fp;
  }
  info() {
    const st = this.o.settings() || {};
    return {
      running: !!this.server, port: this.port || Number(st.sharePort) || DEFAULT_PORT, bind: this.bind || st.shareBind || '0.0.0.0',
      fingerprint: this.fingerprint(), addresses: localAddresses(), hostname: os.hostname(), error: this.lastError || ''
    };
  }

  /* ---------- Server ---------- */
  async ensureServer() {
    const st = this.o.settings() || {};
    const port = Number(st.sharePort) || DEFAULT_PORT;
    const bind = String(st.shareBind || '0.0.0.0').trim() || '0.0.0.0';
    if (this.server && this.port === port && this.bind === bind) return;
    await this.stopServer();
    const hostKey = loadHostKey(this.keyFile());
    this._fp = keyFingerprint(hostKey);
    const srv = new Server({ hostKeys: [hostKey], ident: 'MacT-1000-Share' }, (client, info) => this.onClient(client, info));
    try {
      await new Promise((res, rej) => { srv.once('error', rej); srv.listen(port, bind, () => { srv.removeListener('error', rej); res(); }); });
    } catch (e) {
      try { srv.close(); } catch (_) {}
      const msg = e && e.code === 'EADDRINUSE' ? T(`Port ${port} ist bereits belegt – in den Einstellungen einen anderen Port für Freigaben wählen.`)
        : e && e.code === 'EADDRNOTAVAIL' ? T(`Die Adresse ${bind} gibt es auf diesem Rechner nicht.`)
        : e && e.code === 'EACCES' ? T(`Keine Berechtigung für Port ${port}.`) : String(e && e.message || e);
      this.lastError = msg;
      throw new Error(msg);
    }
    srv.on('error', (e) => { this.lastError = e.message; this.changed(); });
    this.server = srv; this.port = port; this.bind = bind; this.lastError = '';
  }
  async stopServer() {
    if (!this.server) return;
    const s = this.server; this.server = null; this.port = 0; this.bind = '';
    for (const c of this.clients) { try { c.end(); } catch (_) {} }
    this.clients.clear();
    await new Promise(r => { try { s.close(() => r()); } catch (_) { r(); } setTimeout(r, 1000); });
  }

  blocked(ip) {
    const f = this.fails.get(ip);
    return !!(f && f.blockedUntil && f.blockedUntil > Date.now());
  }
  failed(ip, name) {
    const now = Date.now();
    let f = this.fails.get(ip);
    if (!f || now - f.first > FAIL_WINDOW) f = { n: 0, first: now, blockedUntil: 0 };
    f.n++;
    if (f.n >= FAIL_LIMIT) { f.blockedUntil = now + BLOCK_TIME; this.o.emit('share:event', { kind: 'blocked', ip, name }); }
    else this.o.emit('share:event', { kind: 'authFailed', ip, name });
    this.fails.set(ip, f);
  }

  onClient(client, info) {
    const ip = peerIp(info.ip);
    const ctx = { ip, name: '', allowed: [] };
    this.clients.add(client);
    client.on('error', () => {});
    client.on('close', () => this.clients.delete(client));
    if (this.blocked(ip) || this.clients.size > MAX_VIEWERS * 2) { try { client.end(); } catch (_) {} return; }
    client.on('authentication', (a) => {
      if (this.blocked(ip)) return a.reject([]);
      if (a.method !== 'password') return a.reject(['password']);
      const name = cleanName(a.username);
      const ok = [];
      for (const sh of this.shares.values()) {
        if (sh.expires && sh.expires < Date.now()) continue;
        const hsh = hashPw(a.password, sh.salt);
        if (crypto.timingSafeEqual(hsh, sh.hash)) ok.push(sh.id);
      }
      if (!ok.length) { this.failed(ip, name); return a.reject(['password']); }
      ctx.name = name; ctx.allowed = ok;
      const f = this.fails.get(ip); if (f && !f.blockedUntil) this.fails.delete(ip);
      a.accept();
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (acc, rej) => rej && rej());
        session.on('env', (acc) => acc && acc());
        session.on('shell', (acc, rej) => rej && rej());
        session.on('subsystem', (acc, rej) => rej && rej());
        session.on('exec', (acc, rej, i) => {
          const cmd = String(i.command || '').trim();
          if (cmd === 'list') {
            const ch = acc();
            const list = ctx.allowed.map(id => this.shares.get(id)).filter(Boolean).map(sh => ({ id: sh.id, name: sh.name, type: sh.type, mode: sh.mode }));
            ch.write(JSON.stringify({ t: 'list', shares: list, host: os.hostname() }) + '\n');
            ch.exit(0); ch.end();
            return;
          }
          const m = /^attach\s+(\S+)$/.exec(cmd);
          const sh = m && ctx.allowed.includes(m[1]) ? this.shares.get(m[1]) : null;
          if (!sh) return rej && rej();
          if (sh.viewers.size >= MAX_VIEWERS) { const ch = acc(); ch.write(JSON.stringify({ t: 'end', reason: 'full' }) + '\n'); ch.exit(1); ch.end(); return; }
          this.attach(sh, acc(), ctx, client);
        });
      });
      client.on('tcpip', (acc, rej) => rej && rej());
      client.on('request', (acc, rej) => rej && rej());
      client.on('openssh.streamlocal', (acc, rej) => rej && rej());
    });
  }

  /* ---------- Freigaben ---------- */
  async add({ sid, name, type, password, mode = 'ro', expiresIn = 0, cols = 80, rows = 24 }) {
    if (!password || String(password).length < 4) throw new Error(T('Das Passwort muss mindestens 4 Zeichen haben.'));
    await this.ensureServer();
    const id = crypto.randomBytes(6).toString('hex');
    const salt = crypto.randomBytes(16);
    const sh = {
      id, sid, name: cleanName(name), type: type || '', mode: ['ro', 'ask', 'rw'].includes(mode) ? mode : 'ro',
      salt, hash: hashPw(password, salt), password: String(password), created: Date.now(),
      expires: expiresIn > 0 ? Date.now() + expiresIn * 60000 : 0, viewers: new Map(), cols, rows, ended: false
    };
    this.shares.set(id, sh);
    this.changed();
    return this.summary(sh);
  }
  update(id, patch = {}) {
    const sh = this.shares.get(id); if (!sh) return null;
    if (patch.name) sh.name = cleanName(patch.name);
    if (patch.mode && ['ro', 'ask', 'rw'].includes(patch.mode) && patch.mode !== sh.mode) {
      sh.mode = patch.mode;
      for (const v of sh.viewers.values()) {
        if (sh.mode === 'ro' && v.write) this.setWrite(id, v.id, false, true);
        this.send(v, { t: 'mode', mode: sh.mode });
      }
    }
    if (patch.expiresIn !== undefined) sh.expires = patch.expiresIn > 0 ? Date.now() + patch.expiresIn * 60000 : 0;
    if (patch.password) {
      if (String(patch.password).length < 4) throw new Error(T('Das Passwort muss mindestens 4 Zeichen haben.'));
      sh.salt = crypto.randomBytes(16); sh.hash = hashPw(patch.password, sh.salt); sh.password = String(patch.password);
    }
    this.changed();
    return this.summary(sh);
  }
  async stop(id, reason = 'stopped') {
    const sh = this.shares.get(id); if (!sh) return;
    this.shares.delete(id);
    const had = sh.viewers.size;
    for (const v of [...sh.viewers.values()]) this.dropViewer(sh, v, reason);
    this.o.emit('share:event', { kind: 'stopped', shareId: id, name: sh.name, reason });
    this.changed();
    // kurz warten, damit die Abschlussnachricht die Zuschauer noch erreicht
    if (!this.shares.size) { if (had) await new Promise(r => setTimeout(r, 300)); if (!this.shares.size) await this.stopServer(); }
  }
  async stopAll() { for (const id of [...this.shares.keys()]) await this.stop(id); await this.stopServer(); }
  checkExpiry() {
    const now = Date.now();
    for (const sh of [...this.shares.values()]) if (sh.expires && sh.expires < now) this.stop(sh.id, 'expired');
  }
  bySid(sid) { return [...this.shares.values()].filter(s => s.sid === sid); }

  summary(sh) {
    return {
      id: sh.id, sid: sh.sid, name: sh.name, type: sh.type, mode: sh.mode, password: sh.password, created: sh.created, expires: sh.expires, ended: sh.ended,
      viewers: [...sh.viewers.values()].map(v => ({ id: v.id, name: v.name, ip: v.ip, since: v.since, write: v.write, requested: !!v.requested }))
    };
  }
  list() { return [...this.shares.values()].map(s => this.summary(s)); }
  changed() { this.o.emit('share:changed', { shares: this.list(), info: this.info() }); }

  /* ---------- Zuschauer ---------- */
  send(v, msg) {
    if (v.closed) return;
    try {
      v.ch.write(JSON.stringify(msg) + '\n');
      if (v.ch.writableLength > MAX_BACKLOG) { v.closed = true; try { v.ch.write(JSON.stringify({ t: 'end', reason: 'slow' }) + '\n'); v.ch.end(); } catch (_) {} }
    } catch (_) {}
  }
  attach(sh, ch, ctx, client) {
    const v = { id: 'v' + (++this.vseq), name: ctx.name, ip: ctx.ip, since: Date.now(), write: sh.mode === 'rw', ch, client, pending: true, queue: [], buf: '' };
    sh.viewers.set(v.id, v);
    this.send(v, { t: 'hello', name: sh.name, type: sh.type, mode: sh.mode, write: v.write, cols: sh.cols, rows: sh.rows, host: os.hostname(), ended: sh.ended });
    this.resync(sh, v);
    ch.on('data', (d) => {
      v.buf += d.toString('utf8');
      if (v.buf.length > 1024 * 1024) { v.buf = ''; return; }
      let i;
      while ((i = v.buf.indexOf('\n')) >= 0) {
        const line = v.buf.slice(0, i); v.buf = v.buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch (_) { continue; }
        this.onViewerMsg(sh, v, m);
      }
    });
    const gone = () => {
      if (!sh.viewers.has(v.id)) return;
      sh.viewers.delete(v.id); v.closed = true;
      this.o.emit('share:event', { kind: 'left', shareId: sh.id, sid: sh.sid, name: v.name, ip: v.ip });
      this.changed();
    };
    ch.on('close', gone); ch.on('error', gone);
    this.o.emit('share:event', { kind: 'joined', shareId: sh.id, sid: sh.sid, name: v.name, ip: v.ip, write: v.write });
    this.changed();
  }
  /** Bildschirminhalt neu übertragen (beim Verbinden und nach einem Neustart der Session) */
  resync(sh, v) {
    v.pending = true; v.queue = [];
    if (!sh.sid) { v.pending = false; return; }
    const sid = sh.sid;
    Promise.resolve(this.o.snapshot(sid)).then((snap) => {
      if (v.closed || sh.sid !== sid) return;
      snap = snap || { data: '', seq: 0 };
      if (snap.cols && snap.rows) { sh.cols = snap.cols; sh.rows = snap.rows; }
      this.send(v, { t: 'snap', d: snap.data || '', cols: sh.cols, rows: sh.rows });
      for (const q of v.queue) if (q.seq > (snap.seq || 0)) this.send(v, { t: 'd', d: q.data });
      v.queue = []; v.pending = false;
    }).catch(() => { v.pending = false; v.queue = []; });
  }
  onViewerMsg(sh, v, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'in') {
      if (v.write && sh.mode !== 'ro' && sh.sid && typeof m.d === 'string') this.o.write(sh.sid, m.d);
      else this.send(v, { t: 'notice', k: 'ro' });
    } else if (m.t === 'req') {
      if (v.write) return this.send(v, { t: 'write', on: true });
      if (sh.mode === 'ro') return this.send(v, { t: 'deny', reason: 'ro' });
      if (sh.mode === 'rw') return this.setWrite(sh.id, v.id, true);
      if (v.requested) return;
      v.requested = true;
      this.o.emit('share:request', { shareId: sh.id, sid: sh.sid, viewerId: v.id, name: v.name, ip: v.ip, shareName: sh.name });
      this.changed();
    } else if (m.t === 'release') {
      if (v.write) this.setWrite(sh.id, v.id, false);
    }
  }
  setWrite(shareId, viewerId, on, silent) {
    const sh = this.shares.get(shareId); if (!sh) return false;
    const v = sh.viewers.get(viewerId); if (!v) return false;
    if (on && sh.mode === 'ro') return false;
    v.requested = false;
    v.write = !!on;
    this.send(v, { t: 'write', on: v.write });
    if (!silent) this.changed();
    return true;
  }
  deny(shareId, viewerId) {
    const sh = this.shares.get(shareId); if (!sh) return;
    const v = sh.viewers.get(viewerId); if (!v) return;
    v.requested = false;
    this.send(v, { t: 'deny', reason: 'host' });
    this.changed();
  }
  kick(shareId, viewerId) {
    const sh = this.shares.get(shareId); if (!sh) return;
    const v = sh.viewers.get(viewerId); if (v) this.dropViewer(sh, v, 'kick');
    this.changed();
  }
  dropViewer(sh, v, reason) {
    this.send(v, { t: 'end', reason });
    sh.viewers.delete(v.id); v.closed = true;
    setTimeout(() => { try { v.ch.end(); } catch (_) {} try { v.client.end(); } catch (_) {} }, 200);
  }

  /* ---------- Ereignisse der Sessions ---------- */
  onData(sid, data, seq) {
    for (const sh of this.shares.values()) {
      if (sh.sid !== sid) continue;
      for (const v of sh.viewers.values()) {
        if (v.pending) v.queue.push({ seq, data });
        else this.send(v, { t: 'd', d: data });
      }
    }
  }
  onResize(sid, cols, rows) {
    for (const sh of this.bySid(sid)) {
      if (sh.cols === cols && sh.rows === rows) continue;
      sh.cols = cols; sh.rows = rows;
      for (const v of sh.viewers.values()) this.send(v, { t: 'size', cols, rows });
    }
  }
  onExit(sid) {
    for (const sh of this.bySid(sid)) {
      sh.ended = true;
      for (const v of sh.viewers.values()) this.send(v, { t: 'exit' });
    }
    if (this.bySid(sid).length) this.changed();
  }
  /** Session neu gestartet (⌘R) → Freigabe bleibt, Zuschauer bekommen den neuen Inhalt */
  rebind(shareId, sid) {
    const sh = this.shares.get(shareId); if (!sh) return false;
    sh.sid = sid; sh.ended = false;
    for (const v of sh.viewers.values()) { this.send(v, { t: 'restart' }); this.resync(sh, v); }
    this.changed();
    return true;
  }
}

/* =====================================================================
 * Zuschauer-Seite: verhält sich wie eine Session (write/resize/kill/action)
 * ===================================================================== */
const knownFile = () => path.join(require('electron').app.getPath('userData'), 'share-known-hosts.json');
function readKnown(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_) { return {}; } }
function writeKnown(file, map) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(map, null, 2)); } catch (_) {} }

class ShareClientSession {
  /**
   * cfg: { host, port, password, shareName, viewerName }
   * env: { ask(q) → Promise, knownFile?, defaultName }
   */
  constructor(cfg, opts, emit, env) {
    this.cfg = cfg; this.emit = emit; this.env = env || {};
    this.canWrite = false; this.mode = 'ro'; this.ch = null; this.closed = false; this._roHint = 0;
    this.host = String(cfg.host || '').trim(); this.port = Number(cfg.port) || DEFAULT_PORT;
    this.hostKey = `${this.host}:${this.port}`;
    this.start().catch((e) => this.fail(e && e.message || String(e)));
  }
  fail(msg) {
    if (this.closed) return;
    this.closed = true;
    try { this.client && this.client.end(); } catch (_) {}
    this.emit('exit', { message: msg });
  }
  status(p) { this.emit('status', { share: p }); }

  async start() {
    let password = this.cfg.password;
    const ask = this.env.ask || (async () => null);
    if (!password) {
      password = await ask({ kind: 'password', mode: 'share', host: this.hostKey, text: T(`Passwort der Freigabe auf ${this.hostKey}:`) });
      if (password === null || password === undefined || password === '') return this.fail(T('Abgebrochen'));
    }
    this.emit('data', T(`\x1b[90mVerbinde mit der Freigabe auf ${this.hostKey} …\x1b[0m\r\n`));
    const kf = this.env.knownFile || knownFile();
    let hostRejected = null;
    const verify = (key, cb) => {
      const fp = fingerprintOf(key);
      const known = readKnown(kf);
      const was = known[this.hostKey];
      if (was === fp) return cb(true);
      if (was && was !== fp) {
        hostRejected = T(`WARNUNG: Der Schlüssel der Freigabe auf ${this.hostKey} hat sich geändert (${fp}). Verbindung abgelehnt. Wurde MacT-1000 dort neu installiert, den alten Eintrag in den Einstellungen unter „Freigaben“ entfernen.`);
        return cb(false);
      }
      ask({ kind: 'confirm', mode: 'share', host: this.hostKey, text: T(`Die Freigabe auf „${this.hostKey}“ ist noch unbekannt.\nFingerprint: ${fp}\nVergleiche ihn mit dem Fingerprint im Freigabe-Dialog des anderen Rechners.`) })
        .then((ok) => {
          if (!ok) { hostRejected = T('Fingerprint nicht bestätigt – Verbindung abgebrochen.'); return cb(false); }
          const m = readKnown(kf); m[this.hostKey] = fp; writeKnown(kf, m); cb(true);
        }).catch(() => cb(false));
    };
    const client = this.client = new Client();
    await new Promise((resolve, reject) => {
      let ready = false;
      client.once('ready', () => { ready = true; resolve(); });
      // Server trennt vor der Anmeldung (z. B. Adresse gesperrt, zu viele Verbindungen)
      client.once('close', () => { if (!ready) reject(new Error(hostRejected || T('Die Gegenstelle hat die Verbindung abgelehnt (Adresse vorübergehend gesperrt oder zu viele Verbindungen).'))); });
      client.once('error', (e) => {
        if (hostRejected) return reject(new Error(hostRejected));
        if (e && e.level === 'client-authentication') return reject(new Error(T('Passwort falsch, Freigabe beendet oder Adresse vorübergehend gesperrt.')));
        if (e && e.code === 'ECONNREFUSED') return reject(new Error(T(`Keine Freigabe auf ${this.hostKey} erreichbar (Verbindung abgelehnt).`)));
        if (e && (e.code === 'ETIMEDOUT' || /timed out/i.test(e.message))) return reject(new Error(T(`Zeitüberschreitung beim Verbinden mit ${this.hostKey}.`)));
        reject(e);
      });
      client.connect({
        host: this.host, port: this.port, username: cleanName(this.cfg.viewerName || this.env.defaultName || os.userInfo().username + '@' + os.hostname()),
        password, readyTimeout: 15000, keepaliveInterval: 20000, hostVerifier: verify, tryKeyboard: false, agent: undefined
      });
    });
    client.on('close', () => { if (!this.closed) { this.closed = true; this.emit('exit', { message: this._endMsg || T('Verbindung zur Freigabe getrennt') }); } });
    client.on('error', () => {});
    // passende Freigaben holen
    const list = await this.exec('list');
    let shares = (list && list.shares) || [];
    if (!shares.length) throw new Error(T('Keine passende Freigabe gefunden.'));
    let pick = shares[0];
    if (shares.length > 1) {
      const want = String(this.cfg.shareName || '').toLowerCase();
      pick = want && shares.find(s => s.name.toLowerCase() === want);
      if (!pick) {
        const id = await ask({ kind: 'choose', mode: 'share', host: this.hostKey, text: T('Auf diesem Rechner gibt es mehrere Freigaben mit diesem Passwort. Welche öffnen?'), options: shares.map(s => ({ value: s.id, label: s.name })) });
        pick = shares.find(s => s.id === id);
        if (!pick) throw new Error(T('Abgebrochen'));
      }
    }
    this.attach(pick, list.host);
  }
  exec(cmd) {
    return new Promise((resolve, reject) => {
      this.client.exec(cmd, (err, ch) => {
        if (err) return reject(err);
        let buf = '';
        ch.on('data', (d) => { buf += d.toString('utf8'); });
        ch.on('close', () => { try { resolve(JSON.parse(buf.split('\n')[0])); } catch (_) { resolve(null); } });
      });
    });
  }
  attach(pick, hostName) {
    this.client.exec('attach ' + pick.id, (err, ch) => {
      if (err) return this.fail(T('Freigabe nicht mehr verfügbar.'));
      this.ch = ch;
      let buf = '';
      ch.on('data', (d) => {
        buf += d.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let m; try { m = JSON.parse(line); } catch (_) { continue; }
          this.onMsg(m, hostName);
        }
      });
      ch.on('close', () => { if (!this.closed) { this.closed = true; try { this.client.end(); } catch (_) {} this.emit('exit', { message: this._endMsg || T('Verbindung zur Freigabe getrennt') }); } });
    });
  }
  onMsg(m, hostName) {
    switch (m.t) {
      case 'hello':
        this.mode = m.mode; this.canWrite = !!m.write;
        this.info = { name: m.name, type: m.type, host: m.host || hostName, address: this.hostKey };
        this.status({ ...this.info, mode: this.mode, write: this.canWrite, cols: m.cols, rows: m.rows });
        break;
      case 'snap':
        this.status({ cols: m.cols, rows: m.rows });
        this.emit('data', '\x1bc' + (m.d || ''));
        break;
      case 'd': this.emit('data', m.d || ''); break;
      case 'size': this.status({ cols: m.cols, rows: m.rows }); break;
      case 'write': this.canWrite = !!m.on; this.status({ write: this.canWrite, event: m.on ? 'granted' : 'revoked' }); break;
      case 'deny': this.status({ event: m.reason === 'ro' ? 'denyRo' : 'denied' }); break;
      case 'mode': this.mode = m.mode; this.status({ mode: m.mode }); break;
      case 'notice': if (m.k === 'ro') this.roHint(); break;
      case 'exit': this.emit('data', T('\r\n\x1b[33m── Die freigegebene Session wurde beendet – warte auf einen Neustart ──\x1b[0m\r\n')); this.status({ ended: true }); break;
      case 'restart': this.status({ ended: false }); break;
      case 'end': {
        const r = { kick: T('Vom Freigebenden getrennt'), stopped: T('Freigabe beendet'), expired: T('Freigabe abgelaufen'), full: T('Zu viele Zuschauer'), slow: T('Verbindung zu langsam') };
        this._endMsg = r[m.reason] || T('Freigabe beendet');
        break;
      }
      default: break;
    }
  }
  roHint() { const now = Date.now(); if (now - this._roHint > 4000) { this._roHint = now; this.status({ event: 'ro' }); } }
  write(data) {
    if (!this.ch || this.closed) return;
    if (!this.canWrite) { this.roHint(); return; }
    try { this.ch.write(JSON.stringify({ t: 'in', d: String(data) }) + '\n'); } catch (_) {}
  }
  resize() { /* Größe bestimmt der Freigebende */ }
  kill() { this.closed = true; try { this.ch && this.ch.end(); } catch (_) {} try { this.client && this.client.end(); } catch (_) {} }
  async action(a) {
    if (!this.ch) return null;
    if (a === 'requestWrite') { this.ch.write(JSON.stringify({ t: 'req' }) + '\n'); return true; }
    if (a === 'releaseWrite') { this.ch.write(JSON.stringify({ t: 'release' }) + '\n'); return true; }
    if (a === 'shareInfo') return { ...(this.info || {}), mode: this.mode, write: this.canWrite };
    return null;
  }
}

module.exports = { ShareHost, ShareClientSession, generatePassword, localAddresses, DEFAULT_PORT, readKnown, writeKnown, knownFile };
