'use strict';
/**
 * Gemeinsame Konfiguration auf einem Netzlaufwerk (SMB/NFS/AFP …).
 *
 * Datei:  <Ordner>/MacT-1000-config.json   (Adressbuch, Ordner, Makros, Trigger, optional Einstellungen,
 *                                            optional Team-Passwörter AES-256-GCM-verschlüsselt)
 * Sperre: <Ordner>/MacT-1000-config.lock   (wird NUR während eines Schreibvorgangs angelegt – O_EXCL,
 *                                            Inhalt: Rechner/Benutzer/PID; verwaiste Sperren > 60 s werden entfernt)
 *
 * Lesen braucht keine Sperre. Jeder Rechner prüft die Datei alle 2 s (Änderungszeit/Größe, alle 15 s
 * zusätzlich die Revision) – Dateisystem-Events sind auf Netzlaufwerken unzuverlässig.
 * Beim Schreiben: Sperre holen → aktuelle Datei lesen → 3-Wege-Merge mit eigenem Stand → Revision +1 →
 * atomar per Umbenennen ersetzen → Sperre freigeben. Ist das Laufwerk nicht erreichbar, wird lokal
 * weitergearbeitet (Cache) und beim nächsten Kontakt automatisch zusammengeführt.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { merge3, eq, clone } = require('./merge3');
const { maxVer, isNewer } = require('./version');

const { SHARED_PEER } = require('./compat');

// Dateinamen hängen vom Präfix ab: eigene Datei „MacT-1000-config.json“ – liegt im Ordner nur die Datei
// der Mac-Ausgabe, wird diese mitbenutzt (gleicher Inhalt, Format der Mac-Ausgabe), damit Mac und Windows teilen können.
const OWN_PREFIX = 'MacT-1000';
const FORMAT = 'mact1000-shared';
const FORMATS = [FORMAT, SHARED_PEER.format];
function names(prefix = OWN_PREFIX) {
  const esc = prefix.replace(/[-]/g, '\\-');
  return {
    prefix,
    file: `${prefix}-config.json`,
    lock: `${prefix}-config.lock`,
    legacyBackup: `${prefix}-config.bak.json`,
    backupDir: `${prefix}-Backups`,
    backupRe: new RegExp(`^${esc}-config_(\\d{4}-\\d{2}-\\d{2})_(\\d{2}-\\d{2}-\\d{2})_rev(\\d+)\\.json$`),
    format: prefix === OWN_PREFIX ? FORMAT : SHARED_PEER.format
  };
}
function namesFor(dir) {
  if (!dir) return names();
  try { if (fs.existsSync(path.join(dir, names().file))) return names(); } catch (_) {}
  try { if (fs.existsSync(path.join(dir, names(SHARED_PEER.prefix).file))) return names(SHARED_PEER.prefix); } catch (_) {}
  return names();
}
const FILE = names().file;
const LOCK = names().lock;
const BACKUP_DIR = names().backupDir;
const DEFAULT_BACKUP_KEEP = 15;
const pad = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`; }
function keepCount(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(500, Math.floor(n)) : DEFAULT_BACKUP_KEEP; }
const STALE_MS = 60000;
const LOCK_WAIT_MS = 10000;
const POLL_MS = 2000;
const FORCE_READ_MS = 15000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EMPTY = () => ({ sessions: [], settings: {}, secrets: {} });

function normState(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    sessions: Array.isArray(s.sessions) ? s.sessions.filter(x => x && typeof x === 'object') : [],
    settings: s.settings && typeof s.settings === 'object' && !Array.isArray(s.settings) ? s.settings : {},
    secrets: s.secrets === null ? null : (s.secrets && typeof s.secrets === 'object' ? s.secrets : {})
  };
}

class SharedConfig {
  constructor({ localDir, notify = () => {}, encLocal = (s) => s, decLocal = (s) => s, encrypt, decrypt, appVersion = '', host, pollMs = POLL_MS }) {
    this.localDir = localDir;
    this.notify = notify;
    this.encLocal = encLocal; this.decLocal = decLocal;
    this.encrypt = encrypt; this.decrypt = decrypt;
    this.appVersion = appVersion;
    this.host = host || os.hostname().replace(/\.local$/, '');
    this.user = (() => { try { return os.userInfo().username; } catch (_) { return ''; } })();
    this.pollMs = pollMs;
    this.dir = '';
    this.passphrase = '';
    this.local = EMPTY();      // aktueller (wirksamer) Stand dieses Rechners
    this.fileState = EMPTY();  // zuletzt mit der Datei abgeglichener Stand (Basis für den Merge)
    this.fileRev = 0;
    this.fileMeta = { updatedBy: '', updatedAt: '', appVersion: '', newestAppVersion: '' };
    this.opaqueSecrets = null; // verschlüsselte Team-Passwörter, die hier nicht lesbar sind (werden unverändert weitergereicht)
    this.secretsState = 'none'; // none | ok | nopass | mismatch
    this.pending = false;
    this.online = false;
    this.error = '';
    this.lastStat = '';
    this.lastRead = 0;
    this.timer = null;
    this.queue = Promise.resolve();
    this.polling = false;
  }

  /** Namen für den aktuellen Ordner (einmal je Ordner bestimmt; neu, wenn die Datei verschwindet) */
  nm(dir = this.dir) {
    if (dir !== this.dir) return namesFor(dir);
    if (!this._nm || this._nmDir !== dir) { this._nm = namesFor(dir); this._nmDir = dir; }
    return this._nm;
  }
  get file() { return path.join(this.dir, this.nm().file); }
  get backupDir() { return this.dir ? path.join(this.dir, this.nm().backupDir) : ''; }
  get enabled() { return !!this.dir; }
  get teamSecrets() { return !!this.passphrase && !!this.encrypt; }

  // ---------- lokaler Cache (damit es auch ohne Netzlaufwerk weitergeht) ----------
  cachePath() { return path.join(this.localDir, 'shared-cache.json'); }
  packState(s) { const { secrets, ...rest } = s; return { ...rest, secretsEnc: secrets ? this.encLocal(JSON.stringify(secrets)) : null }; }
  unpackState(s) {
    let secrets = {};
    if (s && s.secretsEnc) { try { secrets = JSON.parse(this.decLocal(s.secretsEnc)); } catch (_) { secrets = {}; } }
    else if (s && s.secretsEnc === null) secrets = null;
    return normState({ ...(s || {}), secrets });
  }
  saveCache() {
    try {
      const data = { dir: this.dir, fileRev: this.fileRev, fileMeta: this.fileMeta, pending: this.pending,
        local: this.packState(this.local), fileState: this.packState(this.fileState), opaqueSecrets: this.opaqueSecrets };
      const p = this.cachePath();
      const tmp = `${p}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(tmp, p);
    } catch (_) {}
  }
  loadCache(dir) {
    try {
      const c = JSON.parse(fs.readFileSync(this.cachePath(), 'utf8'));
      if (!c || c.dir !== dir) return false;
      this.local = this.unpackState(c.local);
      this.fileState = this.unpackState(c.fileState);
      this.fileRev = c.fileRev || 0;
      this.fileMeta = { ...this.fileMeta, ...(c.fileMeta || {}) };
      this.pending = !!c.pending;
      this.opaqueSecrets = c.opaqueSecrets || null;
      return true;
    } catch (_) { return false; }
  }

  // ---------- Datei lesen/schreiben ----------
  async readFile(dir = this.dir) {
    let text;
    try { text = await fsp.readFile(path.join(dir, this.nm(dir).file), 'utf8'); }
    catch (e) {
      if (e.code === 'ENOENT') {
        await fsp.access(dir);
        if (dir === this.dir) { this._nm = null; const n = this.nm(dir); if (fs.existsSync(path.join(dir, n.file))) return this.readFile(dir); }
        return null;
      }
      throw e;
    }
    let d;
    try { d = JSON.parse(text); } catch (_) { const e = new Error('Konfigurationsdatei unvollständig/beschädigt'); e.code = 'EPARSE'; throw e; }
    if (!d || !FORMATS.includes(d.format)) { const e = new Error('Datei ist keine gemeinsame MacT-1000-Konfiguration'); e.code = 'EFORMAT'; throw e; }
    let secrets = null, opaque = null, secretsState = 'none';
    if (d.secrets) {
      if (this.teamSecrets) {
        try { secrets = this.decrypt(d.secrets, this.passphrase); secretsState = 'ok'; }
        catch (_) { opaque = d.secrets; secretsState = 'mismatch'; }
      } else { opaque = d.secrets; secretsState = 'nopass'; }
    } else { secrets = {}; secretsState = this.teamSecrets ? 'ok' : 'none'; }
    return { rev: d.rev || 0, updatedBy: d.updatedBy || '', updatedAt: d.updatedAt || '',
      appVersion: d.appVersion || '', newestAppVersion: maxVer(d.newestAppVersion, d.appVersion),
      state: normState({ sessions: d.sessions, settings: d.settings, secrets }), opaque, secretsState };
  }

  async writeFile(state, rev, opaque, newest = '') {
    const out = {
      format: this.nm().format, formatVersion: 1, app: 'MacT-1000', appVersion: this.appVersion,
      // höchste Version, die diese Datei je geschrieben hat – damit ältere Versionen weiter warnen können
      newestAppVersion: maxVer(newest, this.appVersion),
      rev, updatedAt: new Date().toISOString(), updatedBy: this.host + (this.user ? ` (${this.user})` : ''),
      sessions: state.sessions, settings: state.settings
    };
    if (state.secrets && this.teamSecrets) { if (Object.keys(state.secrets).length) out.secrets = this.encrypt(state.secrets, this.passphrase); }
    else if (opaque) out.secrets = opaque;
    const tmp = path.join(this.dir, `.${this.nm().prefix}-config.${this.host}.${process.pid}.tmp`);
    await fsp.writeFile(tmp, JSON.stringify(out, null, 2), { mode: 0o660 });
    await this.backup(rev - 1, keepCount(state.settings && state.settings.configBackupKeep));
    try { await fsp.rename(tmp, this.file); }
    catch (e) { // manche SMB-Server ersetzen beim Umbenennen nicht
      try { await fsp.unlink(this.file); } catch (_) {}
      await fsp.rename(tmp, this.file);
    }
    return out;
  }

  /** Vorige Version mit Datum/Uhrzeit sichern und nur die neuesten „keep“ Backups behalten (läuft unter der Sperre). */
  async backup(prevRev, keep) {
    const N = this.nm();
    const bdir = path.join(this.dir, N.backupDir);
    try {
      if (keep > 0 && prevRev > 0) {
        await fsp.mkdir(bdir, { recursive: true });
        await fsp.copyFile(this.file, path.join(bdir, `${N.prefix}-config_${stamp()}_rev${prevRev}.json`));
      }
    } catch (_) {}
    try { await fsp.unlink(path.join(this.dir, N.legacyBackup)); } catch (_) {}
    try {
      const list = (await fsp.readdir(bdir)).map(n => { const m = N.backupRe.exec(n); return m ? { n, rev: Number(m[3]), t: m[1] + m[2] } : null; })
        .filter(Boolean).sort((a, b) => (a.t === b.t ? b.rev - a.rev : (b.t < a.t ? -1 : 1)));
      for (const b of list.slice(keep)) await fsp.unlink(path.join(bdir, b.n)).catch(() => {});
    } catch (_) {}
  }

  async listBackups() {
    if (!this.dir) return [];
    try {
      const N = this.nm();
      const bdir = path.join(this.dir, N.backupDir);
      return (await fsp.readdir(bdir)).map(n => { const m = N.backupRe.exec(n); return m ? { name: n, rev: Number(m[3]), date: m[1], time: m[2].replace(/-/g, ':'), t: m[1] + m[2] } : null; })
        .filter(Boolean).sort((a, b) => (a.t === b.t ? b.rev - a.rev : (b.t < a.t ? -1 : 1)));
    } catch (_) { return []; }
  }

  async lock() {
    const p = path.join(this.dir, this.nm().lock);
    const token = `${this.host}:${process.pid}:${crypto.randomBytes(6).toString('hex')}`;
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        const fh = await fsp.open(p, 'wx', 0o660);
        await fh.writeFile(JSON.stringify({ token, host: this.host, user: this.user, pid: process.pid, at: new Date().toISOString() }));
        await fh.close();
        return token;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let holder = {};
        try {
          const st = await fsp.stat(p);
          try { holder = JSON.parse(await fsp.readFile(p, 'utf8')); } catch (_) {}
          const age = Math.max(Date.now() - st.mtimeMs, holder.at ? Date.now() - Date.parse(holder.at) : 0);
          if (age > STALE_MS || (holder.host === this.host && holder.pid === process.pid)) { await fsp.unlink(p).catch(() => {}); continue; }
        } catch (_) { continue; } // inzwischen freigegeben
        if (Date.now() > deadline) {
          const err = new Error(`Konfiguration wird gerade von ${holder.host || 'einem anderen Rechner'} geändert (Sperre)`);
          err.code = 'ELOCKED'; throw err;
        }
        await sleep(120 + Math.random() * 180);
      }
    }
  }
  async unlock(token) {
    const p = path.join(this.dir, this.nm().lock);
    try { const c = JSON.parse(await fsp.readFile(p, 'utf8')); if (c.token === token) await fsp.unlink(p); } catch (_) {}
  }

  /** Eigenen Stand mit der Datei abgleichen (unter Sperre). */
  async sync() {
    const token = await this.lock();
    try {
      const F = await this.readFile();
      let final = this.local;
      let rev = 1;
      let opaque = this.opaqueSecrets;
      if (F) {
        rev = F.rev + 1;
        const useSecrets = F.state.secrets !== null && this.local.secrets !== null && this.fileState.secrets !== null;
        const strip = (s) => ({ sessions: s.sessions, settings: s.settings });
        final = merge3(strip(this.fileState), strip(this.local), strip(F.state));
        final.secrets = useSecrets ? merge3(this.fileState.secrets, this.local.secrets, F.state.secrets) : (F.state.secrets || this.local.secrets);
        opaque = F.opaque;
        this.secretsState = F.secretsState;
        if (eq(final, F.state) && !this.pending) { // nichts zu schreiben
          this.adopt(F, final);
          return { changed: false };
        }
      }
      const out = await this.writeFile(final, rev, opaque, F ? F.newestAppVersion : '');
      const mergedOthers = !!F && !eq(final, this.local);
      this.local = clone(final); this.fileState = clone(final);
      this.fileRev = rev; this.fileMeta = { updatedBy: out.updatedBy, updatedAt: out.updatedAt, appVersion: out.appVersion, newestAppVersion: out.newestAppVersion };
      this.opaqueSecrets = opaque;
      this.pending = false; this.online = true; this.error = '';
      this.lastStat = await this.statKey();
      this.lastRead = Date.now();
      this.saveCache();
      return { changed: true, merged: mergedOthers };
    } finally { await this.unlock(token); }
  }

  adopt(F, state) {
    this.local = clone(state || F.state); this.fileState = clone(state || F.state);
    this.fileRev = F.rev; this.fileMeta = { updatedBy: F.updatedBy, updatedAt: F.updatedAt, appVersion: F.appVersion, newestAppVersion: F.newestAppVersion };
    this.opaqueSecrets = F.opaque; this.secretsState = F.secretsState;
    this.online = true; this.error = '';
    this.saveCache();
  }

  async statKey() {
    try { const st = await fsp.stat(this.file); return `${st.mtimeMs}:${st.size}:${st.ino}`; } catch (_) { return ''; }
  }

  serial(fn) { const r = this.queue.then(fn, fn); this.queue = r.catch(() => {}); return r; }

  /** Änderung übernehmen. base = Stand, auf dem die Änderung beruht (z.B. was das Fenster zuletzt geladen hat). */
  commit(ours, base) {
    // Ohne Angabe ist die Basis der Stand zum Zeitpunkt des Aufrufs – nicht der beim Ausführen
    // (sonst würde eine inzwischen übernommene fremde Änderung als „von uns gelöscht“ gewertet).
    const snap = base ? normState(base) : clone(this.local);
    return this.serial(async () => {
      const b = snap;
      const strip = (s) => ({ sessions: s.sessions, settings: s.settings });
      const next = merge3(strip(b), strip(normState(ours)), strip(this.local));
      const os_ = normState(ours).secrets, ls = this.local.secrets;
      next.secrets = (os_ === null || ls === null) ? ls : merge3(b.secrets || {}, os_, ls);
      if (eq(next, this.local) && !this.pending) return { ok: true, changed: false, state: this.local };
      this.local = next;
      try {
        await this.sync();
        return { ok: true, changed: true, state: this.local };
      } catch (e) {
        this.pending = true; this.online = e.code === 'ELOCKED' || e.code === 'EPARSE'; this.error = e.message;
        this.saveCache();
        this.notify('status', this.status());
        return { ok: false, pending: true, error: e.message, state: this.local };
      }
    });
  }

  // ---------- Überwachung ----------
  async poll() {
    if (!this.enabled || this.polling) return;
    this.polling = true;
    try {
      await this.serial(async () => {
        const key = await this.statKey();
        if (!key) {
          await fsp.access(this.dir); // wirft, wenn Laufwerk weg
          if (this.fileRev && !this.pending) { this.error = 'Konfigurationsdatei fehlt im Ordner'; }
        }
        const changed = key !== this.lastStat || Date.now() - this.lastRead > FORCE_READ_MS;
        if (!changed && !this.pending && this.online) return;
        const wasOnline = this.online;
        const F = key ? await this.readFile() : null;
        this.lastStat = key; this.lastRead = Date.now();
        if (this.pending) {
          const r = await this.sync();
          this.notify('changed', { by: this.fileMeta.updatedBy, at: this.fileMeta.updatedAt, rev: this.fileRev, resynced: true, merged: r.changed });
          return;
        }
        if (F && F.rev !== this.fileRev) {
          this.adopt(F);
          this.notify('changed', { by: F.updatedBy, at: F.updatedAt, rev: F.rev });
        } else if (F) {
          this.secretsState = F.secretsState; this.online = true; this.error = '';
          if (F.newestAppVersion !== this.fileMeta.newestAppVersion || F.appVersion !== this.fileMeta.appVersion) {
            this.fileMeta = { ...this.fileMeta, appVersion: F.appVersion, newestAppVersion: F.newestAppVersion };
            this.notify('status', this.status());
          }
        }
        else { this.online = true; }
        if (!wasOnline) this.notify('status', this.status());
      });
    } catch (e) {
      const was = this.online, wasErr = this.error;
      this.online = e.code === 'EPARSE' || e.code === 'ELOCKED';
      this.error = e.code === 'ENOENT' || e.code === 'EACCES' || e.code === 'ENOTDIR' || e.code === 'EHOSTDOWN'
        ? 'Netzlaufwerk nicht erreichbar' : e.message;
      if (was !== this.online || wasErr !== this.error) this.notify('status', this.status());
    } finally { this.polling = false; }
  }

  start(dir, passphrase = '') {
    this.stop();
    this.dir = dir; this.passphrase = passphrase || '';
    if (!this.loadCache(dir)) { this.local = EMPTY(); this.fileState = EMPTY(); this.fileRev = 0; this.pending = false; }
    this.lastStat = ''; this.lastRead = 0;
    this.timer = setInterval(() => this.poll(), this.pollMs);
    if (this.timer.unref) this.timer.unref();
    return this.poll();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.dir = ''; this.online = false; this.error = ''; }

  /** Ordner prüfen, bevor die Freigabe aktiviert wird. */
  async probe(dir) {
    try { await fsp.access(dir, fs.constants.W_OK); }
    catch (e) { return { ok: false, error: e.code === 'ENOENT' ? 'Ordner nicht gefunden' : 'Kein Schreibrecht im Ordner' }; }
    try {
      const F = await this.readFile(dir);
      if (!F) return { ok: true, exists: false };
      const folders = new Set(F.state.sessions.map(s => s.folder).filter(Boolean));
      return { ok: true, exists: true, rev: F.rev, updatedBy: F.updatedBy, updatedAt: F.updatedAt,
        writtenWith: F.appVersion, newestAppVersion: F.newestAppVersion, newer: isNewer(F.newestAppVersion, this.appVersion),
        sessions: F.state.sessions.length, folders: folders.size,
        macros: Array.isArray(F.state.settings.macros) ? F.state.settings.macros.length : 0, hasSecrets: F.secretsState !== 'none' && F.secretsState !== 'ok' ? true : !!(F.state.secrets && Object.keys(F.state.secrets).length) };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  /**
   * Aktivieren. mode: 'use' (Datei übernehmen) | 'merge' (zusammenführen) | 'upload' (lokalen Stand hochladen/ersetzen)
   */
  async enable(dir, mode, localState, passphrase = '') {
    this.stop();
    this.dir = dir; this.passphrase = passphrase || '';
    this.lastStat = ''; this.lastRead = 0;
    const L = normState(localState);
    if (!this.teamSecrets) L.secrets = {};
    const F = await this.readFile();
    if (!F) {
      this.local = L; this.fileState = EMPTY(); this.fileRev = 0; this.opaqueSecrets = null; this.pending = true;
      await this.sync();
    } else if (mode === 'use') {
      this.adopt(F);
      this.pending = false;
    } else {
      this.fileState = mode === 'upload' ? F.state : EMPTY();
      if (mode === 'upload') { this.local = { ...L, secrets: F.state.secrets === null ? null : L.secrets }; }
      else this.local = { sessions: L.sessions, settings: L.settings, secrets: F.state.secrets === null ? null : L.secrets };
      this.fileRev = F.rev; this.opaqueSecrets = F.opaque; this.pending = true;
      if (mode === 'merge') {
        // gemeinsame Basis leer → Vereinigung beider Stände
        const strip = (s) => ({ sessions: s.sessions, settings: s.settings });
        const m = merge3(strip(EMPTY()), strip(this.local), strip(F.state));
        m.secrets = this.local.secrets === null || F.state.secrets === null ? (F.state.secrets || this.local.secrets) : { ...F.state.secrets, ...this.local.secrets };
        this.local = m; this.fileState = F.state;
      }
      await this.sync();
    }
    this.timer = setInterval(() => this.poll(), this.pollMs);
    if (this.timer.unref) this.timer.unref();
    return this.status();
  }

  status() {
    return {
      enabled: this.enabled, dir: this.dir, file: this.enabled ? this.file : '', online: this.online, pending: this.pending,
      error: this.error, rev: this.fileRev, updatedBy: this.fileMeta.updatedBy, updatedAt: this.fileMeta.updatedAt,
      host: this.host, teamSecrets: this.teamSecrets, secretsState: this.secretsState,
      writtenWith: this.fileMeta.appVersion || '', newestAppVersion: this.fileMeta.newestAppVersion || '', appVersion: this.appVersion,
      newer: isNewer(this.fileMeta.newestAppVersion, this.appVersion),
      sessions: this.local.sessions.length
    };
  }
}

module.exports = { SharedConfig, FILE, LOCK, FORMAT, BACKUP_DIR, DEFAULT_BACKUP_KEEP, names, namesFor };
