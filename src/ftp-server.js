'use strict';
/**
 * FTP-Server (RFC 959 + EPSV/EPRT, SIZE, MDTM, REST, MLSD/MLST, UTF8).
 * Passiv (PASV/EPSV) und aktiv (PORT/EPRT, nur zur Adresse des Clients).
 * Anmeldung mit Benutzer/Passwort und/oder anonym; Schreiben, Überschreiben und Löschen getrennt freigebbar.
 */
const net = require('net');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pipeline } = require('stream');
const { Jail, BaseServer, bindError, checkPort, checkRoot, lsLine, safeEqual, tmpName, peerOf, fsError, denied } = require('./srv-common');

const ANON = new Set(['anonymous', 'ftp']);
const DATA_TIMEOUT = 20000;
const mdtm = (d) => d.toISOString().replace(/[-:T]/g, '').replace(/\.\d+Z$/, '');
const plainIp = (a) => String(a || '').replace(/^::ffff:/, '');

class FtpSession {
  constructor(server, sock) {
    this.srv = server; this.sock = sock; this.jail = server.jail;
    this.user = ''; this.authed = false; this.anon = false; this.cwd = '/';
    this.pasv = null; this.active = null; this.rest = 0; this.rnfr = null; this.fails = 0; this.dataSock = null; this.closed = false;
    this.peer = peerOf(sock);
    sock.setEncoding('utf8');
    let buf = '';
    this.queue = Promise.resolve();
    sock.on('data', (d) => {
      buf += d;
      if (buf.length > 16384) { this.reply(500, 'Zeile zu lang'); sock.destroy(); return; }
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        // ABOR sofort behandeln, alles andere der Reihe nach
        if (/^\s*ABOR\b/i.test(line.replace(/[\xf2\xff\xf4]/g, ''))) { this.abort(); continue; }
        this.queue = this.queue.then(() => this.command(line)).catch((e) => this.reply(550, fsError(e)));
      }
    });
    sock.on('close', () => { this.closed = true; this.closeData(); });
    sock.on('error', () => {});
    sock.setTimeout(15 * 60 * 1000, () => { this.reply(421, 'Zeitüberschreitung'); sock.end(); });
    this.reply(220, 'MacT-1000 FTP-Server bereit');
  }
  reply(code, text) {
    if (this.closed) return;
    const lines = String(text).split('\n');
    const out = lines.length === 1 ? `${code} ${lines[0]}\r\n` : lines.map((l, i) => (i === lines.length - 1 ? `${code} ${l}` : `${code}-${l}`)).join('\r\n') + '\r\n';
    try { this.sock.write(out); } catch (_) {}
  }
  get o() { return this.srv.opts; }
  canWrite() { return this.o.allowWrite; }

  async command(line) {
    if (this.closed) return;
    const sp = line.indexOf(' ');
    const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase().trim();
    const arg = sp < 0 ? '' : line.slice(sp + 1);
    const pre = ['USER', 'PASS', 'QUIT', 'FEAT', 'SYST', 'NOOP', 'OPTS', 'HELP', 'AUTH', 'PBSZ', 'PROT'];
    if (!this.authed && !pre.includes(cmd)) return this.reply(530, 'Bitte zuerst anmelden');
    const h = this['c_' + cmd];
    if (!h) return this.reply(502, `Befehl ${cmd} wird nicht unterstützt`);
    return h.call(this, arg);
  }

  c_USER(a) { this.user = a.trim(); this.authed = false; this.reply(331, ANON.has(this.user.toLowerCase()) ? 'Anonym: bitte E-Mail-Adresse als Passwort' : 'Passwort erforderlich'); }
  async c_PASS(a) {
    const o = this.o;
    const u = this.user;
    let ok = false;
    if (ANON.has(u.toLowerCase()) && o.anonymous) { ok = true; this.anon = true; }
    else if (o.user && safeEqual(u, o.user) && safeEqual(a, o.password)) ok = true;
    if (ok) { this.authed = true; this.fails = 0; return this.reply(230, `Angemeldet${this.anon ? ' (anonym)' : ''} – Verzeichnis / ist ${this.srv.rootDir}`); }
    this.fails++;
    this.srv.authFailed(this.peer, u);
    await new Promise(r => setTimeout(r, 800));
    this.reply(530, 'Anmeldung fehlgeschlagen');
    if (this.fails >= 5) this.sock.end();
  }
  c_AUTH() { this.reply(502, 'TLS wird nicht unterstützt (unverschlüsseltes FTP)'); }
  c_PBSZ() { this.reply(200, 'PBSZ=0'); }
  c_PROT(a) { this.reply(a.trim().toUpperCase() === 'C' ? 200 : 536, a.trim().toUpperCase() === 'C' ? 'Klartext' : 'Nur PROT C'); }
  c_QUIT() { this.reply(221, 'Auf Wiedersehen'); this.sock.end(); }
  c_NOOP() { this.reply(200, 'OK'); }
  c_SYST() { this.reply(215, 'UNIX Type: L8'); }
  c_FEAT() { this.reply(211, 'Funktionen:\n EPRT\n EPSV\n MDTM\n MLST type*;size*;modify*;\n PASV\n REST STREAM\n SIZE\n UTF8\nEnde'); }
  c_OPTS(a) { this.reply(/^utf8\s+on/i.test(a.trim()) ? 200 : 501, /^utf8\s+on/i.test(a.trim()) ? 'UTF8 aktiv' : 'Option nicht unterstützt'); }
  c_HELP() { this.reply(214, 'MacT-1000 FTP-Server'); }
  c_TYPE(a) { const t = a.trim().toUpperCase(); if (/^(A|I|L 8|A N)$/.test(t)) this.reply(200, `Typ ${t}`); else this.reply(504, 'Typ nicht unterstützt'); }
  c_MODE(a) { this.reply(a.trim().toUpperCase() === 'S' ? 200 : 504, 'Modus S'); }
  c_STRU(a) { this.reply(a.trim().toUpperCase() === 'F' ? 200 : 504, 'Struktur F'); }
  c_ALLO() { this.reply(202, 'Nicht nötig'); }
  c_SITE() { this.reply(202, 'SITE wird ignoriert'); }
  c_STAT() { this.reply(211, `MacT-1000 FTP-Server – angemeldet als ${this.user || '-'}`); }

  c_PWD() { this.reply(257, `"${this.cwd.replace(/"/g, '""')}" ist das aktuelle Verzeichnis`); }
  c_XPWD() { return this.c_PWD(); }
  async c_CWD(a) {
    const t = this.jail.resolve(a.trim() || '/', this.cwd);
    await this.jail.safe(t.abs);
    let st; try { st = await fsp.stat(t.abs); } catch (_) { return this.reply(550, 'Verzeichnis nicht gefunden'); }
    if (!st.isDirectory()) return this.reply(550, 'Kein Verzeichnis');
    this.cwd = t.virt; this.reply(250, `Verzeichnis ist jetzt ${this.cwd}`);
  }
  c_XCWD(a) { return this.c_CWD(a); }
  c_CDUP() { return this.c_CWD('..'); }
  c_XCUP() { return this.c_CDUP(); }

  async c_SIZE(a) {
    const t = this.jail.resolve(a, this.cwd); await this.jail.safe(t.abs);
    try { const st = await fsp.stat(t.abs); if (!st.isFile()) return this.reply(550, 'Keine Datei'); this.reply(213, String(st.size)); }
    catch (_) { this.reply(550, 'Datei nicht gefunden'); }
  }
  async c_MDTM(a) {
    const t = this.jail.resolve(a, this.cwd); await this.jail.safe(t.abs);
    try { const st = await fsp.stat(t.abs); this.reply(213, mdtm(st.mtime)); } catch (_) { this.reply(550, 'Datei nicht gefunden'); }
  }
  c_REST(a) { const n = parseInt(a, 10); if (!(n >= 0)) return this.reply(501, 'Ungültige Position'); this.rest = n; this.reply(350, `Fortsetzen ab ${n}`); }

  /* ---------- Datenverbindung ---------- */
  closeData() {
    if (this.pasv) { try { this.pasv.server.close(); } catch (_) {} this.pasv = null; }
    if (this.dataSock) { try { this.dataSock.destroy(); } catch (_) {} this.dataSock = null; }
  }
  async openPasv() {
    this.closeData(); this.active = null;
    const server = net.createServer();
    const host = this.sock.localAddress;
    await new Promise((res, rej) => { server.once('error', rej); server.listen(0, host, res); });
    const pending = { server, sock: null, waiters: [] };
    server.on('connection', (s) => {
      // nur Datenverbindungen vom selben Rechner wie die Steuerverbindung
      if (plainIp(s.remoteAddress) !== plainIp(this.sock.remoteAddress)) { s.destroy(); return; }
      if (pending.sock) { s.destroy(); return; }
      pending.sock = s; server.close();
      pending.waiters.splice(0).forEach(w => w(s));
    });
    this.pasv = pending;
    return server.address().port;
  }
  async c_PASV() {
    const ip = plainIp(this.sock.localAddress);
    if (!net.isIPv4(ip)) return this.reply(425, 'PASV nur mit IPv4 – bitte EPSV verwenden');
    const port = await this.openPasv();
    this.reply(227, `Passiver Modus (${ip.split('.').join(',')},${port >> 8},${port & 255})`);
  }
  async c_EPSV(a) {
    if (/^all$/i.test(a.trim())) return this.reply(200, 'EPSV ALL');
    const port = await this.openPasv();
    this.reply(229, `Erweiterter passiver Modus (|||${port}|)`);
  }
  c_PORT(a) {
    const p = a.split(',').map(Number);
    if (p.length !== 6 || p.some(x => !(x >= 0 && x <= 255))) return this.reply(501, 'Ungültige PORT-Angabe');
    return this.setActive(p.slice(0, 4).join('.'), p[4] * 256 + p[5]);
  }
  c_EPRT(a) {
    const d = a.trim()[0]; const parts = a.trim().split(d);
    if (parts.length < 5) return this.reply(501, 'Ungültige EPRT-Angabe');
    return this.setActive(parts[2], parseInt(parts[3], 10));
  }
  setActive(ip, port) {
    if (plainIp(ip) !== plainIp(this.sock.remoteAddress)) return this.reply(504, 'Aktiver Modus nur zur Adresse des Clients erlaubt');
    if (!(port >= 1 && port <= 65535)) return this.reply(501, 'Ungültiger Port');
    this.closeData(); this.active = { ip, port };
    this.reply(200, 'Aktiver Modus');
  }
  async dataConn() {
    if (this.active) {
      const { ip, port } = this.active; this.active = null;
      return new Promise((res, rej) => {
        const s = net.connect({ host: ip, port, localAddress: this.sock.localAddress });
        const to = setTimeout(() => { s.destroy(); rej(new Error('Datenverbindung: Zeitüberschreitung')); }, DATA_TIMEOUT);
        s.once('connect', () => { clearTimeout(to); res(s); });
        s.once('error', (e) => { clearTimeout(to); rej(e); });
      });
    }
    const p = this.pasv;
    if (!p) throw Object.assign(new Error('Bitte zuerst PASV oder PORT senden'), { ftp: 425 });
    this.pasv = null;
    if (p.sock) return p.sock;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { try { p.server.close(); } catch (_) {} rej(new Error('Datenverbindung: Zeitüberschreitung')); }, DATA_TIMEOUT);
      p.waiters.push((s) => { clearTimeout(to); res(s); });
    });
  }
  async withData(fn) {
    let s;
    try { s = await this.dataConn(); } catch (e) { this.reply(e.ftp || 425, e.message); return; }
    this.dataSock = s;
    s.on('error', () => {});
    try { await fn(s); } finally { if (this.dataSock === s) this.dataSock = null; }
  }
  abort() {
    if (this.dataSock || this.pasv) { this.aborted = true; this.closeData(); this.reply(426, 'Übertragung abgebrochen'); }
    this.reply(226, 'ABOR ausgeführt');
  }

  /* ---------- Listen ---------- */
  async listTarget(a) {
    const arg = a.replace(/^(\s*-[a-zA-Z]+\s*)+/, '').trim();
    const t = this.jail.resolve(arg || '.', this.cwd);
    await this.jail.safe(t.abs);
    const st = await fsp.stat(t.abs);
    if (!st.isDirectory()) return { t, entries: [{ name: t.name, st }] };
    const names = await fsp.readdir(t.abs);
    const entries = [];
    for (const n of names.sort()) { try { entries.push({ name: n, st: await fsp.stat(path.join(t.abs, n)) }); } catch (_) {} }
    return { t, entries };
  }
  async sendListing(a, fmt) {
    let lst;
    try { lst = await this.listTarget(a); } catch (e) { return this.reply(550, fsError(e)); }
    this.reply(150, 'Verzeichnisliste folgt');
    await this.withData(async (s) => {
      const body = lst.entries.map(e => fmt(e)).join('\r\n') + (lst.entries.length ? '\r\n' : '');
      await new Promise((res) => s.end(Buffer.from(body, 'utf8'), res));
      this.reply(226, 'Liste gesendet');
    });
  }
  c_LIST(a) { return this.sendListing(a, (e) => lsLine(e.name, e.st)); }
  c_NLST(a) { return this.sendListing(a, (e) => e.name); }
  c_MLSD(a) { return this.sendListing(a, (e) => this.facts(e)); }
  facts(e) { return `type=${e.st.isDirectory() ? 'dir' : 'file'};size=${e.st.size};modify=${mdtm(e.st.mtime)}; ${e.name}`; }
  async c_MLST(a) {
    const t = this.jail.resolve(a.trim() || '.', this.cwd); await this.jail.safe(t.abs);
    try { const st = await fsp.stat(t.abs); this.reply(250, `Info\n ${this.facts({ name: t.virt, st })}\nEnde`); }
    catch (_) { this.reply(550, 'Nicht gefunden'); }
  }

  /* ---------- Download ---------- */
  async c_RETR(a) {
    const t = this.jail.resolve(a, this.cwd);
    const start = this.rest; this.rest = 0;
    let st;
    try { await this.jail.safe(t.abs); st = await fsp.stat(t.abs); } catch (e) { return this.reply(550, fsError(e)); }
    if (!st.isFile()) return this.reply(550, 'Keine Datei');
    this.reply(150, `Sende ${t.name} (${st.size - start} Bytes)`);
    await this.withData(async (s) => {
      const tr = this.srv.transfer({ kind: 'get', peer: this.peer, file: t.virt.slice(1), size: st.size, user: this.anon ? 'anonym' : this.user });
      tr.set(start);
      this.aborted = false;
      await new Promise((res) => {
        const rs = fs.createReadStream(t.abs, { start });
        rs.on('data', (c) => tr.add(c.length));
        pipeline(rs, s, (e) => {
          if (e || this.aborted) { tr.fail(this.aborted ? 'abgebrochen' : fsError(e)); if (!this.aborted) this.reply(426, 'Übertragung abgebrochen'); }
          else { tr.done(); this.reply(226, 'Übertragung abgeschlossen'); }
          res();
        });
      });
    });
  }

  /* ---------- Upload ---------- */
  async c_STOR(a) { return this.store(a, false); }
  async c_APPE(a) { return this.store(a, true); }
  async store(a, append) {
    const o = this.o;
    const offset = this.rest; this.rest = 0;
    if (!this.canWrite()) return this.reply(550, 'Hochladen ist auf diesem Server nicht erlaubt');
    const t = this.jail.resolve(a, this.cwd);
    if (t.virt === '/') return this.reply(553, 'Ungültiger Dateiname');
    let exists = false;
    try { await this.jail.safe(t.abs); const st = await fsp.stat(t.abs); if (st.isDirectory()) return this.reply(553, 'Ist ein Verzeichnis'); exists = true; } catch (e) { if (e.code === 'EACCES') return this.reply(550, fsError(e)); }
    if (exists && !o.overwrite) return this.reply(553, 'Datei existiert bereits (Überschreiben ist nicht erlaubt)');
    try { await fsp.mkdir(path.dirname(t.abs), { recursive: true }); } catch (e) { return this.reply(553, fsError(e)); }
    const direct = append || offset > 0;
    const target = direct ? t.abs : tmpName(t.abs);
    this.reply(150, `Bereit zum Empfang von ${t.name}`);
    await this.withData(async (s) => {
      const tr = this.srv.transfer({ kind: 'put', peer: this.peer, file: t.virt.slice(1), user: this.anon ? 'anonym' : this.user });
      this.aborted = false;
      await new Promise((res) => {
        const ws = fs.createWriteStream(target, direct ? { flags: append ? 'a' : 'r+', start: append ? undefined : offset } : { flags: 'wx' });
        s.on('data', (c) => tr.add(c.length));
        pipeline(s, ws, async (e) => {
          if (e || this.aborted) {
            tr.fail(this.aborted ? 'abgebrochen' : fsError(e));
            if (!direct) fsp.unlink(target).catch(() => {});
            if (!this.aborted) this.reply(426, 'Übertragung abgebrochen');
            return res();
          }
          try { if (!direct) await fsp.rename(target, t.abs); tr.done(); this.reply(226, 'Datei gespeichert'); }
          catch (e2) { tr.fail(fsError(e2)); this.reply(550, fsError(e2)); }
          res();
        });
      });
    });
  }

  /* ---------- Verwalten ---------- */
  async c_MKD(a) {
    if (!this.canWrite()) return this.reply(550, 'Anlegen ist auf diesem Server nicht erlaubt');
    const t = this.jail.resolve(a, this.cwd);
    try { await this.jail.safe(t.abs); await fsp.mkdir(t.abs); this.reply(257, `"${t.virt}" angelegt`); } catch (e) { this.reply(550, fsError(e)); }
  }
  c_XMKD(a) { return this.c_MKD(a); }
  async c_RMD(a) {
    if (!this.o.allowDelete) return this.reply(550, 'Löschen ist auf diesem Server nicht erlaubt');
    const t = this.jail.resolve(a, this.cwd);
    if (t.virt === '/') return this.reply(550, 'Das Wurzelverzeichnis kann nicht gelöscht werden');
    try { await this.jail.safe(t.abs); await fsp.rmdir(t.abs); this.reply(250, 'Verzeichnis gelöscht'); } catch (e) { this.reply(550, fsError(e)); }
  }
  c_XRMD(a) { return this.c_RMD(a); }
  async c_DELE(a) {
    if (!this.o.allowDelete) return this.reply(550, 'Löschen ist auf diesem Server nicht erlaubt');
    const t = this.jail.resolve(a, this.cwd);
    try { await this.jail.safe(t.abs); await fsp.unlink(t.abs); this.reply(250, 'Datei gelöscht'); } catch (e) { this.reply(550, fsError(e)); }
  }
  async c_RNFR(a) {
    if (!this.o.allowDelete) return this.reply(550, 'Umbenennen ist auf diesem Server nicht erlaubt');
    const t = this.jail.resolve(a, this.cwd);
    try { await this.jail.safe(t.abs); await fsp.stat(t.abs); this.rnfr = t; this.reply(350, 'Bereit zum Umbenennen'); } catch (e) { this.reply(550, fsError(e)); }
  }
  async c_RNTO(a) {
    const from = this.rnfr; this.rnfr = null;
    if (!from) return this.reply(503, 'Bitte zuerst RNFR');
    const t = this.jail.resolve(a, this.cwd);
    try {
      await this.jail.safe(t.abs);
      let exists = false; try { await fsp.stat(t.abs); exists = true; } catch (_) {}
      if (exists && !this.o.overwrite) return this.reply(553, 'Ziel existiert bereits');
      await fsp.rename(from.abs, t.abs); this.reply(250, 'Umbenannt');
    } catch (e) { this.reply(550, fsError(e)); }
  }
}

class FtpServer extends BaseServer {
  constructor() { super('ftp'); this.server = null; this.defaultPort = 21; this.sessions = new Set(); }
  get running() { return !!this.server; }

  async start({ root, port = 21, host = '0.0.0.0', allowWrite = false, overwrite = false, allowDelete = false, anonymous = false, user = '', password = '' } = {}) {
    await this.stop();
    const r = await checkRoot(root);
    port = checkPort(port);
    host = String(host || '0.0.0.0').trim() || '0.0.0.0';
    if (!anonymous && !(user && password)) throw new Error('Bitte Benutzer und Passwort angeben oder anonyme Anmeldung erlauben');
    if (user && !password) throw new Error('Bitte ein Passwort für den Benutzer angeben');
    this.rootDir = r.root; this.jail = new Jail(r.root, r.real);
    this.opts = { port, host, allowWrite: !!allowWrite, overwrite: !!allowWrite && !!overwrite, allowDelete: !!allowDelete, anonymous: !!anonymous, user: user || '', password: password || '' };
    const srv = net.createServer((sock) => { const s = new FtpSession(this, sock); this.sessions.add(s); sock.on('close', () => { this.sessions.delete(s); this.emit('status', this.status()); }); this.emit('status', this.status()); });
    try { await new Promise((res, rej) => { srv.once('error', rej); srv.listen(port, host, () => { srv.removeListener('error', rej); res(); }); }); }
    catch (e) { try { srv.close(); } catch (_) {} throw bindError(e, port, host, 'FTP'); }
    srv.on('error', (e) => this.emit('status', { ...this.status(), error: e.message }));
    this.server = srv;
    this.emit('status', this.status());
    return this.status();
  }
  async stop() {
    if (this.server) {
      const s = this.server; this.server = null;
      for (const t of [...this.active]) { t.state = 'error'; t.error = 'Server gestoppt'; t.ended = Date.now(); this.emit('transfer', { ...t }); }
      this.active.clear();
      for (const se of this.sessions) { se.closeData(); try { se.sock.destroy(); } catch (_) {} }
      this.sessions.clear();
      await new Promise(r => s.close(() => r()));
      this.emit('status', this.status());
    }
    return this.status();
  }
  status() { return { ...this.baseStatus(), anonymous: !!(this.opts && this.opts.anonymous), clients: this.sessions.size }; }
}

module.exports = { FtpServer };
