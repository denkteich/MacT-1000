'use strict';
/**
 * Datei-Browser-Backend über SFTP (Bibliothek ssh2, reines JavaScript).
 *
 * Wird unter Windows verwendet: Das OpenSSH von Windows kennt kein ControlMaster,
 * daher kann der Datei-Browser die Terminal-Verbindung nicht mitbenutzen. Stattdessen
 * baut er eine eigene, wiederverwendete SFTP-Verbindung auf. Anmeldung in dieser
 * Reihenfolge: ssh-agent → Schlüsseldatei(en) → Passwort → Keyboard-Interactive.
 * Passwörter/Passphrasen werden nur im Arbeitsspeicher gehalten.
 *
 * Gleiche Schnittstelle wie FileTransfer in scp.js (list / op / transfer / cancel / closeAll).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { expandHome } = require('./ssh-args');

const IDLE_MS = 10 * 60 * 1000;
const DEFAULT_KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa'];
const WIN_AGENT = '\\\\.\\pipe\\openssh-ssh-agent';

function lazySsh2() { return require('ssh2'); }

// ---------- known_hosts ----------
function knownHostsFile() { return path.join(os.homedir(), '.ssh', 'known_hosts'); }
function hostPattern(host, port) { return Number(port) && Number(port) !== 22 ? `[${host}]:${port}` : host; }
function matchHostField(field, name) {
  for (const f of field.split(',')) {
    if (f.startsWith('|1|')) {
      const [, , salt, hash] = f.split('|');
      try {
        const h = crypto.createHmac('sha1', Buffer.from(salt, 'base64')).update(name).digest('base64');
        if (h === hash) return true;
      } catch (_) {}
    } else if (f === name) return true;
  }
  return false;
}
/** → 'ok' | 'unknown' | 'mismatch' */
function checkKnownHost(host, port, keyBuf) {
  const name = hostPattern(host, port);
  let text = '';
  try { text = fs.readFileSync(knownHostsFile(), 'utf8'); } catch (_) { return 'unknown'; }
  const b64 = keyBuf.toString('base64');
  const type = keyBuf.readUInt32BE(0) ? keyBuf.slice(4, 4 + keyBuf.readUInt32BE(0)).toString() : '';
  let sameTypeOther = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0].startsWith('@')) continue; // @cert-authority / @revoked nicht ausgewertet
    if (parts.length < 3 || !matchHostField(parts[0], name)) continue;
    if (parts[2] === b64) return 'ok';
    if (parts[1] === type) sameTypeOther = true;
  }
  return sameTypeOther ? 'mismatch' : 'unknown';
}
function addKnownHost(host, port, keyBuf) {
  const type = keyBuf.slice(4, 4 + keyBuf.readUInt32BE(0)).toString();
  const f = knownHostsFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  let pre = '';
  try { const cur = fs.readFileSync(f, 'utf8'); if (cur && !cur.endsWith('\n')) pre = '\n'; } catch (_) {}
  fs.appendFileSync(f, `${pre}${hostPattern(host, port)} ${type} ${keyBuf.toString('base64')}\n`);
}
const fingerprint = (keyBuf) => 'SHA256:' + crypto.createHash('sha256').update(keyBuf).digest('base64').replace(/=+$/, '');

// ---------- Hilfen ----------
function parseJump(spec) {
  // [user@]host[:port] – bei mehreren (a,b) nur der erste
  const s = String(spec).split(',')[0].trim();
  const m = s.match(/^(?:([^@]+)@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  if (!m) return null;
  return { username: m[1] || '', host: m[2].replace(/^\[|\]$/g, ''), port: m[3] ? Number(m[3]) : 22 };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function lsDate(mtime) {
  const d = new Date(mtime * 1000);
  const recent = Math.abs(Date.now() - d.getTime()) < 182 * 864e5;
  const p = (n) => String(n).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${recent ? p(d.getHours()) + ':' + p(d.getMinutes()) : d.getFullYear()}`;
}
function permStr(mode) {
  const t = (mode & 0o170000) === 0o040000 ? 'd' : (mode & 0o170000) === 0o120000 ? 'l' : (mode & 0o170000) === 0o100000 ? '-' : '?';
  const r = 'rwxrwxrwx'.split('').map((c, i) => (mode & (1 << (8 - i)) ? c : '-')).join('');
  return t + r;
}
const isDir = (mode) => (mode & 0o170000) === 0o040000;
const isLink = (mode) => (mode & 0o170000) === 0o120000;
const isFile = (mode) => (mode & 0o170000) === 0o100000;
const rjoin = (a, b) => (a.endsWith('/') ? a + b : a + '/' + b);
const rbase = (p) => p.replace(/\/+$/, '').split('/').pop();
function fmtSize(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(1) : String(n)) + u[i];
}
function fmtEta(sec) {
  if (!isFinite(sec) || sec < 0) return '--:--';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
const P = (fn) => new Promise((res, rej) => fn((err, v) => (err ? rej(err) : res(v))));
function sftpErr(e, p) {
  const code = e && e.code;
  const map = { 2: 'Nicht gefunden', 3: 'Zugriff verweigert', 4: 'Fehler', 11: 'Existiert bereits' };
  const msg = map[code] || (e && e.message) || String(e);
  return new Error(p ? `${msg}: ${p}` : msg);
}

class SftpTransfer {
  /** ask({kind:'password'|'confirm', text, host}) → Promise<string|boolean|null> */
  constructor(ask, emit) {
    this.mode = 'sftp';
    this.useSftp = true;         // Unterklasse ScpTransfer (scp-win.js) braucht nur die SSH-Verbindung
    this.ask = (q) => ask({ ...q, mode: this.mode });
    this.emit = emit;
    this.conns = new Map();      // key -> { client, sftp, jump, timer }
    this.connecting = new Map();
    this.secrets = new Map();    // key -> { password, passphrase: {file: pw} }
    this.jobs = new Map();
  }

  key(cfg) { return [cfg.username || '', cfg.host, cfg.port || 22, cfg.jumpHost || '', cfg.identityFile || ''].join('|'); }

  async get(cfg) {
    if (!cfg || !cfg.host) throw new Error('Kein Host');
    const k = this.key(cfg);
    const c = this.conns.get(k);
    if (c && c.alive) { this._touch(k, c); return c.handle; }
    if (this.connecting.has(k)) return this.connecting.get(k);
    const p = this._open(cfg, k).finally(() => this.connecting.delete(k));
    this.connecting.set(k, p);
    return p;
  }

  _touch(k, c) {
    clearTimeout(c.timer);
    c.timer = setTimeout(() => this._close(k), IDLE_MS);
  }
  _close(k) {
    const c = this.conns.get(k);
    if (!c) return;
    this.conns.delete(k);
    clearTimeout(c.timer);
    try { c.client.end(); } catch (_) {}
    if (c.jump) try { c.jump.end(); } catch (_) {}
  }

  async _open(cfg, k) {
    let jump = null; let sock = null;
    if (cfg.jumpHost) {
      const j = parseJump(cfg.jumpHost);
      if (!j) throw new Error('Jump-Host nicht erkannt: ' + cfg.jumpHost);
      const jcfg = { host: j.host, port: j.port, username: j.username || cfg.username, identityFile: cfg.identityFile };
      jump = await this._connect(jcfg, this.key(jcfg), null);
      sock = await P(cb => jump.forwardOut('127.0.0.1', 0, cfg.host, Number(cfg.port) || 22, cb)).catch(e => {
        try { jump.end(); } catch (_) {}
        throw new Error('Jump-Host: Weiterleitung fehlgeschlagen – ' + e.message);
      });
    }
    let client;
    try { client = await this._connect(cfg, k, sock); }
    catch (e) { if (jump) try { jump.end(); } catch (_) {} throw e; }
    const sftp = !this.useSftp ? null : await P(cb => client.sftp(cb)).catch(e => { client.end(); if (jump) jump.end(); throw new Error('SFTP nicht verfügbar: ' + e.message); });
    const handle = this.useSftp ? sftp : client;
    const entry = { client, sftp, handle, jump, alive: true, timer: null };
    const dead = () => { entry.alive = false; if (this.conns.get(k) === entry) this._close(k); };
    client.on('close', dead); client.on('end', dead);
    this.conns.set(k, entry);
    this._touch(k, entry);
    return handle;
  }

  _keyCandidates(cfg) {
    const files = [];
    if (cfg.identityFile) files.push(expandHome(cfg.identityFile));
    for (const n of DEFAULT_KEYS) files.push(path.join(os.homedir(), '.ssh', n));
    return [...new Set(files)].filter(f => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } });
  }

  _agent() {
    if (process.platform === 'win32') return WIN_AGENT;
    return process.env.SSH_AUTH_SOCK || null;
  }

  /** prüft kurz, ob der Agent erreichbar ist (läuft der Windows-Dienst nicht, wird er übersprungen) */
  _agentReachable(agent) {
    if (!agent) return Promise.resolve(false);
    return new Promise((resolve) => {
      let s;
      const t = setTimeout(() => { try { s.destroy(); } catch (_) {} resolve(false); }, 1500);
      try { s = require('net').connect(agent); } catch (_) { clearTimeout(t); return resolve(false); }
      s.once('connect', () => { clearTimeout(t); s.destroy(); resolve(true); });
      s.once('error', () => { clearTimeout(t); resolve(false); });
    });
  }

  /** eine SSH-Verbindung mit interaktiver Anmeldung */
  async _connect(cfg, k, sock) {
    const agentPath = this._agent();
    const agentOk = await this._agentReachable(agentPath);
    return this._connectWith(cfg, k, sock, agentOk ? agentPath : null);
  }
  _connectWith(cfg, k, sock, agent) {
    const { Client, utils } = lazySsh2();
    const sec = this.secrets.get(k) || { password: cfg.password || null, passphrase: {} };
    this.secrets.set(k, sec);
    const username = cfg.username || os.userInfo().username;
    const port = Number(cfg.port) || 22;
    const host = cfg.host;

    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false; let hostRejected = null; let canceled = false;
      const done = (err) => {
        if (settled) return; settled = true;
        if (err) { try { client.end(); } catch (_) {} reject(err); } else resolve(client);
      };

      // Anmeldemethoden der Reihe nach anbieten
      const methods = [];
      if (agent) methods.push({ type: 'agent', agent });
      for (const f of this._keyCandidates(cfg)) methods.push({ type: 'key', file: f });
      methods.push({ type: 'password' });
      methods.push({ type: 'keyboard-interactive' });
      let pwTries = 0;

      const next = async (allowed, cb) => {
        while (methods.length) {
          const m = methods[0];
          const ok = (t) => !allowed || allowed.includes(t);
          if (m.type === 'agent') {
            methods.shift();
            if (ok('publickey')) return cb({ type: 'agent', username, agent: m.agent });
            continue;
          }
          if (m.type === 'key') {
            methods.shift();
            if (!ok('publickey')) continue;
            let raw; try { raw = fs.readFileSync(m.file); } catch (_) { continue; }
            let parsed = utils.parseKey(raw);
            let pass = sec.passphrase[m.file];
            if (parsed instanceof Error && /encrypted|passphrase/i.test(parsed.message)) {
              for (let i = 0; i < 3; i++) {
                if (!pass) {
                  pass = await this.ask({ kind: 'password', host, text: `Passphrase für Schlüssel ${path.basename(m.file)}:` });
                  if (pass === null || pass === undefined || pass === false) { pass = null; break; }
                }
                parsed = utils.parseKey(raw, pass);
                if (!(parsed instanceof Error)) { sec.passphrase[m.file] = pass; break; }
                pass = null;
              }
              if (!pass) continue;
            }
            if (parsed instanceof Error) continue;
            return cb({ type: 'publickey', username, key: raw, passphrase: pass || undefined });
          }
          if (m.type === 'password') {
            if (!ok('password')) { methods.shift(); continue; }
            if (pwTries >= 3) { methods.shift(); continue; }
            let pw = pwTries === 0 && sec.password ? sec.password : null;
            if (!pw) {
              pw = await this.ask({ kind: 'password', host, text: `${username}@${host}'s password:` });
              if (pw === null || pw === undefined || pw === false) { canceled = true; return cb(false); }
            }
            pwTries++;
            sec._lastPw = pw;
            return cb({ type: 'password', username, password: pw });
          }
          if (m.type === 'keyboard-interactive') {
            methods.shift();
            if (!ok('keyboard-interactive')) continue;
            return cb({
              type: 'keyboard-interactive', username,
              prompt: async (name, instructions, lang, prompts, finish) => {
                const answers = [];
                for (const p of prompts) {
                  const a = await this.ask({ kind: 'password', host, text: [instructions, p.prompt].filter(Boolean).join('\n') });
                  if (a === null || a === undefined || a === false) { canceled = true; return finish([]); }
                  answers.push(String(a));
                }
                finish(answers);
              }
            });
          }
          methods.shift();
        }
        cb(false);
      };

      const verify = (keyBuf, cb) => {
        const st = checkKnownHost(host, port, keyBuf);
        if (st === 'ok') return cb(true);
        if (st === 'mismatch') {
          hostRejected = new Error(`WARNUNG: Der Host-Schlüssel von ${host} hat sich geändert (${fingerprint(keyBuf)}). Verbindung abgelehnt – known_hosts prüfen.`);
          return cb(false);
        }
        this.ask({ kind: 'confirm', host, text: `Die Echtheit von „${hostPattern(host, port)}“ ist unbekannt.\nSchlüssel-Fingerprint: ${fingerprint(keyBuf)}` })
          .then(yes => {
            if (yes) { try { addKnownHost(host, port, keyBuf); } catch (_) {} cb(true); }
            else { hostRejected = new Error('Abgebrochen'); cb(false); }
          }, () => cb(false));
      };

      client.on('ready', () => {
        if (sec._lastPw) { sec.password = sec._lastPw; delete sec._lastPw; }
        done(null);
      });
      client.on('error', (e) => {
        if (hostRejected) return done(hostRejected);
        if (canceled) return done(new Error('Abgebrochen'));
        if (e.level === 'client-authentication') { sec.password = null; return done(new Error('Anmeldung fehlgeschlagen (Permission denied)')); }
        done(new Error(e.message || String(e)));
      });
      client.on('close', () => done(new Error(hostRejected ? hostRejected.message : 'Verbindung geschlossen')));

      const opts = {
        host, port, username,
        readyTimeout: 30 * 60 * 1000,
        keepaliveInterval: 30000,
        tryKeyboard: true,
        authHandler: (allowed, partial, cb) => { next(allowed, cb); },
        hostVerifier: verify,
        algorithms: cfg.legacyAlgos ? {
          kex: { append: ['diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1'] },
          serverHostKey: { append: ['ssh-rsa'] },
          cipher: { append: ['aes128-cbc', 'aes256-cbc', '3des-cbc'] }
        } : undefined
      };
      const go = (sk) => { if (sk) opts.sock = sk; try { client.connect(opts); } catch (e) { done(e); } };
      if (sock) return go(sock);
      // TCP-Verbindung selbst aufbauen: kurzer Timeout fürs Netz, aber beliebig Zeit für die Passworteingabe
      const net = require('net');
      const s = net.connect({ host, port });
      const t = setTimeout(() => { s.destroy(); done(new Error(`Zeitüberschreitung beim Verbinden mit ${host}:${port}`)); }, 20000);
      s.once('connect', () => { clearTimeout(t); go(s); });
      s.once('error', (e) => { clearTimeout(t); done(new Error(`Verbindung zu ${host}:${port} fehlgeschlagen: ${e.code || e.message}`)); });
    });
  }

  // ---------- Dateioperationen ----------
  _sftp(cfg) { return this.get(cfg); }

  async list(cfg, dir) {
    const sftp = await this._sftp(cfg);
    let cwd;
    try { cwd = await P(cb => sftp.realpath(dir || '.', cb)); }
    catch (e) { throw new Error(`Verzeichnis nicht lesbar: ${dir}`); }
    let items;
    try { items = await P(cb => sftp.readdir(cwd, cb)); }
    catch (e) { throw new Error(`Verzeichnis nicht lesbar: ${cwd}`); }
    const out = [];
    for (const it of items) {
      if (it.filename === '.' || it.filename === '..') continue;
      let a = it.attrs;
      let type = isDir(a.mode) ? 'dir' : isFile(a.mode) ? 'file' : isLink(a.mode) ? 'link' : 'other';
      if (type === 'link') {
        // wie "ls -L": Ziel des Links auswerten
        try { a = await P(cb => sftp.stat(rjoin(cwd, it.filename), cb)); type = isDir(a.mode) ? 'dir' : isFile(a.mode) ? 'file' : 'other'; }
        catch (_) { type = 'link'; }
      }
      const lp = String(it.longname || '').split(/\s+/);
      out.push({
        name: it.filename, type, perms: permStr(a.mode),
        owner: lp[2] || String(a.uid), group: lp[3] || String(a.gid),
        size: type === 'dir' ? (a.size || 0) : (a.size || 0),
        date: lsDate(a.mtime)
      });
    }
    out.sort((x, y) => (x.type === 'dir' ? 0 : 1) - (y.type === 'dir' ? 0 : 1) || x.name.localeCompare(y.name, 'de', { numeric: true, sensitivity: 'base' }));
    return { cwd, entries: out };
  }

  async _mkdirp(sftp, p) {
    const parts = p.split('/').filter(Boolean);
    let cur = p.startsWith('/') ? '' : '.';
    for (const part of parts) {
      cur = cur + '/' + part;
      let st = null;
      try { st = await P(cb => sftp.stat(cur, cb)); } catch (e) { if (e.code !== 2) throw sftpErr(e, cur); }
      if (st && isDir(st.mode)) continue;
      if (st) throw sftpErr({ code: 11 }, cur);
      await P(cb => sftp.mkdir(cur, cb)).catch(er => { throw sftpErr(er, cur); });
    }
  }

  async _rmrf(sftp, p) {
    let st;
    try { st = await P(cb => sftp.lstat(p, cb)); } catch (e) { if (e.code === 2) return; throw sftpErr(e, p); }
    if (isDir(st.mode)) {
      const items = await P(cb => sftp.readdir(p, cb)).catch(e => { throw sftpErr(e, p); });
      for (const it of items) if (it.filename !== '.' && it.filename !== '..') await this._rmrf(sftp, rjoin(p, it.filename));
      await P(cb => sftp.rmdir(p, cb)).catch(e => { throw sftpErr(e, p); });
    } else {
      await P(cb => sftp.unlink(p, cb)).catch(e => { throw sftpErr(e, p); });
    }
  }

  async op(cfg, name, args) {
    const sftp = await this._sftp(cfg);
    switch (name) {
      case 'mkdir': await this._mkdirp(sftp, args[0]); return true;
      case 'rename': await P(cb => sftp.rename(args[0], args[1], cb)).catch(e => { throw sftpErr(e, args[0]); }); return true;
      case 'delete': for (const p of args) await this._rmrf(sftp, p); return true;
      case 'touch': {
        const h = await P(cb => sftp.open(args[0], 'a', cb)).catch(e => { throw sftpErr(e, args[0]); });
        await P(cb => sftp.close(h, cb)); return true;
      }
      default: throw new Error('Unbekannte Aktion');
    }
  }

  // ---------- Übertragung ----------
  async _planUpload(src, rdest, list) {
    const st = fs.statSync(src);
    const target = rjoin(rdest, path.basename(src));
    if (st.isDirectory()) {
      list.push({ dir: true, remote: target, mtime: st.mtimeMs / 1000, mode: st.mode & 0o777 });
      for (const n of fs.readdirSync(src)) await this._planUpload(path.join(src, n), target, list);
    } else if (st.isFile()) {
      list.push({ local: src, remote: target, size: st.size, mtime: st.mtimeMs / 1000, mode: st.mode & 0o777, name: path.basename(src) });
    }
  }
  async _planDownload(sftp, rsrc, ldest, list) {
    const st = await P(cb => sftp.stat(rsrc, cb)).catch(e => { throw sftpErr(e, rsrc); });
    const target = path.join(ldest, rbase(rsrc));
    if (isDir(st.mode)) {
      list.push({ dir: true, local: target, mtime: st.mtime });
      const items = await P(cb => sftp.readdir(rsrc, cb)).catch(e => { throw sftpErr(e, rsrc); });
      for (const it of items) if (it.filename !== '.' && it.filename !== '..') await this._planDownload(sftp, rjoin(rsrc, it.filename), target, list);
    } else {
      list.push({ remote: rsrc, local: target, size: st.size, mtime: st.mtime, atime: st.atime, mode: st.mode & 0o777, name: rbase(rsrc) });
    }
  }

  _copy(job, sftp, item, direction, onBytes) {
    return new Promise((resolve, reject) => {
      let rs, ws;
      if (direction === 'upload') { rs = fs.createReadStream(item.local); ws = sftp.createWriteStream(item.remote, { mode: item.mode || 0o644 }); }
      else { rs = sftp.createReadStream(item.remote); ws = fs.createWriteStream(item.local); }
      job.streams = [rs, ws];
      let fin = false;
      const end = (err) => { if (fin) return; fin = true; job.streams = null; err ? reject(err) : resolve(); };
      rs.on('data', (b) => onBytes(b.length));
      rs.on('error', end); ws.on('error', end);
      ws.on(direction === 'upload' ? 'close' : 'finish', () => end(job.canceled ? new Error('Abgebrochen') : null));
      rs.pipe(ws);
    });
  }

  async transfer(jobId, cfg, { direction, sources, dest }) {
    const job = { id: jobId, canceled: false, streams: null };
    this.jobs.set(jobId, job);
    const ev = (type, extra) => this.emit('fx:job', { id: jobId, type, ...extra });
    let files = 0;
    try {
      const sftp = await this.get(cfg);
      if (job.canceled) throw new Error('Abgebrochen');
      ev('start', { cmd: `sftp ${direction === 'upload' ? 'put' : 'get'} ${sources.length} Element(e) → ${dest}` });
      const plan = [];
      if (direction === 'upload') {
        for (const s of sources) await this._planUpload(expandHome(s), dest.replace(/\/+$/, '') || '/', plan);
      } else {
        const d = expandHome(dest);
        fs.mkdirSync(d, { recursive: true });
        for (const s of sources) await this._planDownload(sftp, s, d, plan);
      }
      for (const it of plan) {
        if (job.canceled) throw new Error('Abgebrochen');
        if (it.dir) {
          if (direction === 'upload') await this._mkdirp(sftp, it.remote);
          else fs.mkdirSync(it.local, { recursive: true });
          continue;
        }
        const t0 = Date.now(); let done = 0; let last = 0;
        const prog = (final) => {
          const now = Date.now();
          if (!final && now - last < 150) return;
          last = now;
          const secs = Math.max((now - t0) / 1000, 0.001);
          const rate = done / secs;
          ev('progress', { file: it.name, percent: it.size ? Math.min(100, Math.floor(done * 100 / it.size)) : 100, size: fmtSize(done), speed: fmtSize(Math.round(rate)) + '/s', eta: fmtEta((it.size - done) / (rate || 1)), files: files + 1 });
        };
        prog(true);
        await this._copy(job, sftp, it, direction, (n) => { done += n; prog(false); });
        done = it.size; prog(true);
        files++;
        // Zeitstempel übernehmen (wie scp -p)
        try {
          if (direction === 'upload') await P(cb => sftp.utimes(it.remote, it.mtime, it.mtime, cb));
          else fs.utimesSync(it.local, it.atime || it.mtime, it.mtime);
        } catch (_) {}
      }
      this.jobs.delete(jobId);
      ev('done', { ok: true, files });
    } catch (e) {
      this.jobs.delete(jobId);
      ev('done', { ok: false, error: job.canceled ? 'Abgebrochen' : String(e && e.message || e) });
    }
  }

  cancel(jobId) {
    const j = this.jobs.get(jobId);
    if (!j) return;
    j.canceled = true;
    if (j.streams) for (const s of j.streams) try { s.destroy(new Error('Abgebrochen')); } catch (_) {}
  }

  closeAll() {
    for (const j of this.jobs.values()) this.cancel(j.id);
    for (const k of [...this.conns.keys()]) this._close(k);
    this.secrets.clear();
  }
}

module.exports = { SftpTransfer, checkKnownHost, matchHostField, parseJump, permStr, lsDate, fmtSize, fmtEta };
