'use strict';
/**
 * Gemeinsame Bausteine der Dateiserver (FTP, HTTP, SFTP/SCP):
 * Verzeichnis-„Gefängnis“, Übertragungsprotokoll, Fehlermeldungen beim Binden, Hilfsfunktionen.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const MAX_LOG = 200;

function localAddresses() {
  const r = [];
  for (const [ifname, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) r.push({ ifname, address: a.address });
  }
  return r;
}

function bindError(e, port, host, what) {
  if (e.code === 'EADDRINUSE') return new Error(`Port ${port} ist bereits belegt – läuft schon ein anderer ${what}-Server? Bitte einen anderen Port wählen.`);
  if (e.code === 'EACCES') return new Error(`Keine Berechtigung für Port ${port}. Bitte einen Port über 1024 wählen.`);
  if (e.code === 'EADDRNOTAVAIL') return new Error(`Adresse ${host} gibt es auf diesem Mac nicht`);
  return e;
}

function checkPort(port) {
  port = parseInt(port, 10);
  if (!(port >= 1 && port <= 65535)) throw new Error('Ungültiger Port');
  return port;
}

async function checkRoot(root) {
  if (!root) throw new Error('Kein Verzeichnis gewählt');
  let st;
  try { st = await fsp.stat(root); } catch (_) { throw new Error('Verzeichnis nicht gefunden: ' + root); }
  if (!st.isDirectory()) throw new Error('Kein Verzeichnis: ' + root);
  const abs = path.resolve(root);
  return { root: abs, real: await fsp.realpath(abs) };
}

const inside = (root, p) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/**
 * Bildet virtuelle Pfade („/backup/sw01.cfg“, relativ zu cwd) sicher auf das freigegebene Verzeichnis ab.
 * „..“ kann das Verzeichnis nicht verlassen; Symlinks, die nach außen zeigen, werden abgewiesen.
 */
class Jail {
  constructor(root, real) { this.root = root; this.real = real || root; }
  virt(p, cwd = '/') {
    let s = String(p == null ? '' : p).replace(/\\/g, '/').replace(/\0/g, '');
    if (!s.startsWith('/')) s = path.posix.join(cwd || '/', s);
    s = path.posix.normalize(s);
    if (!s.startsWith('/')) s = '/' + s;
    if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
    return s;
  }
  abs(v) { return v === '/' ? this.root : path.join(this.root, ...v.slice(1).split('/')); }
  resolve(p, cwd) { const v = this.virt(p, cwd); return { virt: v, abs: this.abs(v), name: v === '/' ? '/' : path.posix.basename(v) }; }
  // Existierenden Pfad (oder dessen nächsten existierenden Elternordner) auf Symlinks nach außen prüfen
  async safe(abs) {
    let p = abs;
    for (;;) {
      try {
        const r = await fsp.realpath(p);
        if (!inside(this.real, r)) { const e = new Error('Zugriff verweigert'); e.code = 'EACCES'; throw e; }
        return true;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        const up = path.dirname(p);
        if (up === p || !inside(this.root, up)) return true;
        p = up;
      }
    }
  }
}

// ls -l-ähnliche Zeile für Verzeichnislisten
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function modeString(st) {
  const t = st.isDirectory() ? 'd' : st.isSymbolicLink() ? 'l' : '-';
  const m = st.mode;
  const rwx = (s) => ((m >> s) & 4 ? 'r' : '-') + ((m >> s) & 2 ? 'w' : '-') + ((m >> s) & 1 ? 'x' : '-');
  return t + rwx(6) + rwx(3) + rwx(0);
}
function lsLine(name, st) {
  const d = st.mtime;
  const recent = Math.abs(Date.now() - d.getTime()) < 180 * 864e5;
  const when = `${MON[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${recent ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : ' ' + d.getFullYear()}`;
  return `${modeString(st)} 1 mact mact ${String(st.size).padStart(10, ' ')} ${when} ${name}`;
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a || ''), 'utf8'), B = Buffer.from(String(b || ''), 'utf8');
  const ha = crypto.createHash('sha256').update(A).digest(), hb = crypto.createHash('sha256').update(B).digest();
  return crypto.timingSafeEqual(ha, hb) && A.length === B.length;
}

const tmpName = (abs) => path.join(path.dirname(abs), `.${path.basename(abs)}.${crypto.randomBytes(3).toString('hex')}.part`);
const peerOf = (sock) => `${String(sock.remoteAddress || '').replace(/^::ffff:/, '')}:${sock.remotePort || ''}`;

function fsError(e) {
  if (!e) return 'Fehler';
  if (e.code === 'ENOENT') return 'Datei oder Verzeichnis nicht gefunden';
  if (e.code === 'EEXIST') return 'Existiert bereits';
  if (e.code === 'EACCES' || e.code === 'EPERM') return e.message === 'Zugriff verweigert' ? e.message : 'Keine Berechtigung';
  if (e.code === 'ENOTEMPTY') return 'Verzeichnis ist nicht leer';
  if (e.code === 'ENOTDIR') return 'Kein Verzeichnis';
  if (e.code === 'EISDIR') return 'Ist ein Verzeichnis';
  if (e.code === 'ENOSPC') return 'Kein Speicherplatz mehr';
  return e.message || String(e);
}
const denied = (msg) => { const e = new Error(msg || 'Nicht erlaubt'); e.code = 'EPERM'; e.denied = true; return e; };

/** Basis: Ereignisse 'transfer' und 'status', Protokoll der Übertragungen */
class BaseServer extends EventEmitter {
  constructor(kind) { super(); this.kind = kind; this.log = []; this.active = new Set(); this.opts = null; }
  transfer({ kind, peer, file, size = null, user = '' }) {
    const info = { id: crypto.randomBytes(5).toString('hex'), kind, peer, file, size, bytes: 0, state: 'running', error: '', started: Date.now(), ended: 0, user };
    this.log.unshift(info); if (this.log.length > MAX_LOG) this.log.length = MAX_LOG;
    this.active.add(info);
    let last = 0;
    const emit = (force) => { const now = Date.now(); if (force || now - last > 250) { last = now; this.emit('transfer', { ...info }); } };
    emit(true);
    return {
      info,
      add: (n) => { info.bytes += n; emit(false); },
      set: (n) => { info.bytes = n; emit(false); },
      size: (n) => { info.size = n; },
      done: () => { if (info.state !== 'running') return; info.state = 'done'; info.ended = Date.now(); this.active.delete(info); emit(true); this.emit('status', this.status()); },
      fail: (msg) => { if (info.state !== 'running') return; info.state = 'error'; info.error = msg; info.ended = Date.now(); this.active.delete(info); emit(true); this.emit('status', this.status()); }
    };
  }
  // fehlgeschlagene Anmeldung als Eintrag im Protokoll
  authFailed(peer, user) {
    // mehrere Verfahren nacheinander (z. B. Passwort + keyboard-interactive) nur einmal zählen
    const ip = String(peer || '').replace(/:\d+$/, ''), now = Date.now();
    if (this._lastAuth && this._lastAuth.ip === ip && this._lastAuth.user === user && now - this._lastAuth.t < 1500) { this._lastAuth.t = now; return; }
    this._lastAuth = { ip, user, t: now };
    const info = { id: crypto.randomBytes(5).toString('hex'), kind: 'auth', peer, file: user ? `Anmeldung „${user}“` : 'Anmeldung', size: null, bytes: 0, state: 'error', error: 'Anmeldung fehlgeschlagen', started: Date.now(), ended: Date.now(), user };
    this.log.unshift(info); if (this.log.length > MAX_LOG) this.log.length = MAX_LOG;
    this.emit('transfer', { ...info });
  }
  clearLog() { this.log = this.log.filter(i => i.state === 'running'); }
  baseStatus() {
    const o = this.opts || {};
    return {
      kind: this.kind, running: this.running, root: this.rootDir || '', port: o.port || this.defaultPort, host: o.host || '0.0.0.0',
      allowWrite: !!o.allowWrite, overwrite: !!o.overwrite, allowDelete: !!o.allowDelete, user: o.user || '',
      active: this.active.size, addresses: localAddresses(), log: this.log.slice(0, 100).map(i => ({ ...i }))
    };
  }
}

module.exports = { Jail, BaseServer, localAddresses, bindError, checkPort, checkRoot, lsLine, modeString, safeEqual, tmpName, peerOf, fsError, denied, inside };
