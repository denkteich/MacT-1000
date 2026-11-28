'use strict';
/**
 * Automatisches Update von GitHub:
 *  1. passendes Paket (MacT-1000-<v>-arm64-mac.zip bzw. -x64-mac.zip) aus dem Release laden
 *  2. SHA-256 mit der Prüfsumme von GitHub vergleichen, Größe prüfen
 *  3. entpacken (ditto), Version der neuen App prüfen, Quarantäne-Attribut entfernen
 *  4. bereitstellen; ersetzt wird die App erst nach dem Beenden durch ein kleines Hilfsskript
 *     (eine laufende App lässt sich nicht sicher austauschen), das sie danach auf Wunsch neu startet.
 * Ohne Apple-Developer-ID funktioniert der eingebaute Electron-Updater (Squirrel) nicht – daher eigener Weg.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { EventEmitter } = require('events');
const { execFile, spawn } = require('child_process');
const { cmpVer } = require('./version');

const ASSET_RE = (arch) => new RegExp(`^MacT-1000-(\\d+\\.\\d+\\.\\d+[^-]*)-${arch}-mac\\.zip$`, 'i');
const run = (cmd, args, opts = {}) => new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 8 << 20, ...opts }, (e, so, se) => (e ? rej(Object.assign(e, { stderr: String(se || '') })) : res(String(so || '')))));
const fmtMB = (n) => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';

function pickAsset(info, arch) {
  const re = ASSET_RE(arch);
  const list = (info && Array.isArray(info.assets)) ? info.assets : [];
  const a = list.find(x => re.test(x.name || ''));
  if (a) return { name: a.name, size: a.size || 0, digest: a.digest || '', url: a.url };
  // Ausweichweg (Release-Seite statt API): Name nach Konvention, ohne Prüfsumme
  if (info && info.tag && info.latest && info.source === 'page') {
    const name = `MacT-1000-${info.latest}-${arch}-mac.zip`;
    return { name, size: 0, digest: '', url: `https://github.com/denkteich/MacT-1000/releases/download/${encodeURIComponent(info.tag)}/${name}` };
  }
  return null;
}

// Info.plist (XML) → CFBundleShortVersionString
function plistVersion(txt) {
  const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(String(txt || ''));
  return m ? m[1].trim() : '';
}

/* ---------- Hilfsskripte ---------- */
// läuft als Benutzer: wartet auf das Ende von MacT-1000, tauscht die App (ggf. mit Administratorrechten) und startet neu
const RUN_SH = `#!/bin/bash
# MacT-1000 – Update installieren (wird nach dem Beenden der App ausgeführt)
PID="$1"; TARGET="$2"; NEW="$3"; RELAUNCH="$4"; ADMIN="$5"; LOG="$6"; SWAP="$7"
exec >>"$LOG" 2>&1
echo "[$(date '+%F %T')] warte auf Ende von PID $PID"
for i in $(seq 1 1200); do kill -0 "$PID" 2>/dev/null || break; sleep 0.1; done
if kill -0 "$PID" 2>/dev/null; then echo "MacT-1000 läuft noch – Update abgebrochen"; exit 1; fi
if [ "$ADMIN" = "1" ]; then
  /usr/bin/osascript - "$SWAP" "$TARGET" "$NEW" "$LOG" <<'OSA'
on run argv
  do shell script "/bin/bash " & quoted form of item 1 of argv & " " & quoted form of item 2 of argv & " " & quoted form of item 3 of argv & " " & quoted form of item 4 of argv with administrator privileges with prompt "MacT-1000 möchte das Update installieren."
end run
OSA
  RC=$?
else
  /bin/bash "$SWAP" "$TARGET" "$NEW" "$LOG"
  RC=$?
fi
echo "[$(date '+%F %T')] Austausch beendet (Code $RC)"
if [ "$RELAUNCH" = "1" ]; then
  if [ -n "$MACT_UPDATE_OPEN" ]; then "$MACT_UPDATE_OPEN" "$TARGET"; else /usr/bin/open "$TARGET"; fi
fi
exit $RC
`;
// tauscht das App-Paket; bei Fehler wird die alte Version wiederhergestellt
const SWAP_SH = `#!/bin/bash
TARGET="$1"; NEW="$2"; LOG="$3"
exec >>"$LOG" 2>&1
[ -d "$NEW" ] || { echo "neue Version fehlt: $NEW"; exit 3; }
BAK="$(dirname "$TARGET")/.MacT-1000-alt-$$.app"
if [ -e "$TARGET" ]; then mv "$TARGET" "$BAK" || { echo "alte Version kann nicht verschoben werden"; exit 4; }; fi
if mv "$NEW" "$TARGET"; then
  rm -rf "$BAK"
  if command -v xattr >/dev/null; then xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null; fi
  echo "installiert: $TARGET"
  exit 0
fi
echo "Installation fehlgeschlagen – alte Version wird wiederhergestellt"
rm -rf "$TARGET"; [ -e "$BAK" ] && mv "$BAK" "$TARGET"
exit 5
`;

class Updater extends EventEmitter {
  /**
   * @param {object} o
   *  dir()        Arbeitsverzeichnis (userData/updates)
   *  current      laufende Version
   *  bundlePath() Pfad der laufenden MacT-1000.app oder null
   *  arch         'arm64' | 'x64'
   *  allowAnyHost Tests: auch andere Server als GitHub zulassen
   */
  constructor(o) {
    super();
    this.o = o;
    this.state = { phase: 'idle' };
    this.req = null;
  }
  dir() { return typeof this.o.dir === 'function' ? this.o.dir() : this.o.dir; }
  set(p) { this.state = { ...this.state, ...p }; this.emit('state', this.status()); }
  status() { return { ...this.state, ...this.installTarget() }; }

  // Wohin wird installiert und geht das überhaupt?
  installTarget() {
    const target = this.o.bundlePath && this.o.bundlePath();
    if (!target) return { canInstall: false, reason: 'Automatische Updates funktionieren nur in der installierten App (nicht im Entwicklungsmodus).' };
    if (/\/AppTranslocation\//.test(target)) return { canInstall: false, target, reason: 'MacT-1000 läuft aus einem schreibgeschützten Ort (macOS-Quarantäne, z. B. direkt aus „Downloads“). Bitte die App nach „Programme“ verschieben und neu starten.' };
    if (/^\/Volumes\/[^/]+\/MacT-1000\.app$/.test(target)) {
      try { fs.accessSync(path.dirname(target), fs.constants.W_OK); } catch (_) { return { canInstall: false, target, reason: 'MacT-1000 läuft von einem schreibgeschützten Laufwerk. Bitte nach „Programme“ kopieren.' }; }
    }
    let admin = false;
    try { fs.accessSync(path.dirname(target), fs.constants.W_OK); fs.accessSync(target, fs.constants.W_OK); } catch (_) { admin = true; }
    return { canInstall: true, target, needsAdmin: admin };
  }

  async cleanup(keepVersion) {
    const d = this.dir();
    let names = [];
    try { names = await fsp.readdir(d); } catch (_) { return; }
    for (const n of names) {
      if (/^(run|swap)\.sh$|^install\.log$|^pending\.json$/.test(n)) continue;
      if (keepVersion && n === keepVersion) continue;
      await fsp.rm(path.join(d, n), { recursive: true, force: true }).catch(() => {});
    }
  }

  cancel() {
    if (this.req) { this.cancelled = true; try { this.req.destroy(new Error('abgebrochen')); } catch (_) {} }
  }

  /** Lädt die Version aus info (Ergebnis von checkLatest) und stellt sie bereit. */
  async prepare(info) {
    if (['downloading', 'verifying', 'extracting'].includes(this.state.phase)) return this.status();
    if (this.state.phase === 'ready' && this.state.version === info.latest) return this.status();
    if (!info || !info.latest || !(cmpVer(info.latest, this.o.current) > 0)) throw new Error('Keine neuere Version vorhanden');
    const asset = pickAsset(info, this.o.arch);
    const base = { version: info.latest, from: this.o.current, url: info.url, bytes: 0, total: 0, error: '', asset: asset ? asset.name : '', digestChecked: false };
    if (!asset) { this.set({ ...base, phase: 'error', error: `Im Release ${info.tag || info.latest} gibt es kein Paket für ${this.o.arch === 'arm64' ? 'Apple Silicon' : 'Intel-Macs'} (${'MacT-1000-' + info.latest + '-' + this.o.arch + '-mac.zip'}).` }); return this.status(); }
    const t = this.installTarget();
    if (!t.canInstall) { this.set({ ...base, phase: 'error', error: t.reason }); return this.status(); }
    this.cancelled = false;
    this.set({ ...base, phase: 'downloading', total: asset.size || 0, startedAt: Date.now() });
    const dir = path.join(this.dir(), info.latest);
    try {
      await this.cleanup();
      await fsp.mkdir(dir, { recursive: true });
      const zip = path.join(dir, asset.name);
      const hash = await this.download(asset, zip);
      this.set({ phase: 'verifying' });
      const st = await fsp.stat(zip);
      if (asset.size && st.size !== asset.size) throw new Error(`Download unvollständig (${fmtMB(st.size)} statt ${fmtMB(asset.size)})`);
      let digestChecked = false;
      if (asset.digest) {
        const m = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest);
        if (m) { if (m[1].toLowerCase() !== hash) throw new Error('Prüfsumme (SHA-256) stimmt nicht – Download beschädigt oder verändert. Update abgebrochen.'); digestChecked = true; }
      }
      this.set({ phase: 'extracting', digestChecked, sha256: hash });
      const out = path.join(dir, 'app');
      await fsp.rm(out, { recursive: true, force: true });
      await fsp.mkdir(out, { recursive: true });
      if (process.platform === 'darwin') await run('/usr/bin/ditto', ['-x', '-k', zip, out]);
      else await run('unzip', ['-q', zip, '-d', out]);
      const appDir = path.join(out, 'MacT-1000.app');
      let plist = '';
      try { plist = await fsp.readFile(path.join(appDir, 'Contents', 'Info.plist'), 'utf8'); } catch (_) { throw new Error('Das Paket enthält keine MacT-1000.app'); }
      let v = plistVersion(plist);
      if (!v && process.platform === 'darwin') { try { v = (await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(appDir, 'Contents', 'Info.plist')])).trim(); } catch (_) {} }
      if (v !== info.latest) throw new Error(`Das Paket enthält Version ${v || 'unbekannt'} statt ${info.latest}`);
      if (process.platform === 'darwin') {
        await run('/usr/bin/xattr', ['-cr', appDir]).catch(() => {});
        // ad-hoc-Signatur prüfen (nur Hinweis im Protokoll, kein Abbruch)
        await run('/usr/bin/codesign', ['--verify', '--deep', appDir]).then(() => this.set({ signatureOk: true })).catch((e) => this.set({ signatureOk: false, signatureMsg: String(e.stderr || e.message).slice(0, 300) }));
      }
      await fsp.rm(zip, { force: true });
      this.set({ phase: 'ready', staged: appDir, readyAt: Date.now() });
    } catch (e) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      this.set({ phase: this.cancelled ? 'idle' : 'error', error: this.cancelled ? '' : (e.message || String(e)) });
    } finally { this.req = null; }
    return this.status();
  }

  download(asset, file) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      let bytes = 0, last = 0;
      const get = (url, redirects) => {
        const u = new URL(url);
        if (!this.o.allowAnyHost && !(u.protocol === 'https:' && /(^|\.)github\.com$|(^|\.)githubusercontent\.com$/.test(u.hostname))) return reject(new Error('Download nur von GitHub erlaubt: ' + u.hostname));
        const req = (u.protocol === 'http:' ? http : https).get(u, { headers: { 'User-Agent': `MacT-1000/${this.o.current}`, Accept: 'application/octet-stream' }, timeout: 30000 }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirects <= 0) return reject(new Error('Zu viele Weiterleitungen'));
            return get(new URL(res.headers.location, u).toString(), redirects - 1);
          }
          if (res.statusCode !== 200) { res.resume(); return reject(new Error(res.statusCode === 404 ? 'Paket auf GitHub nicht gefunden (404)' : `Download fehlgeschlagen (HTTP ${res.statusCode})`)); }
          const total = Number(res.headers['content-length']) || asset.size || 0;
          if (total) this.set({ total });
          const out = fs.createWriteStream(file);
          res.on('data', (c) => {
            hash.update(c); bytes += c.length;
            const now = Date.now();
            if (now - last > 200) { last = now; this.set({ bytes }); }
          });
          res.on('error', reject);
          out.on('error', reject);
          out.on('finish', () => { this.set({ bytes }); resolve(hash.digest('hex')); });
          res.on('aborted', () => reject(new Error('Verbindung abgebrochen')));
          res.pipe(out);
        });
        req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung beim Download')));
        req.on('error', (e) => reject(this.cancelled ? new Error('abgebrochen') : e));
        this.req = req;
      };
      get(asset.url, 6);
    });
  }

  /**
   * Startet das Hilfsskript (wartet auf das Ende dieses Prozesses, tauscht die App, startet ggf. neu).
   * Danach muss die App beendet werden.
   */
  install({ relaunch = true, pid = process.pid } = {}) {
    // bewusst synchron: wird auch beim Beenden (will-quit) aufgerufen
    if (this.state.phase !== 'ready' || !this.state.staged) throw new Error('Kein Update bereit');
    const t = this.installTarget();
    if (!t.canInstall) throw new Error(t.reason);
    if (!fs.existsSync(this.state.staged)) { this.set({ phase: 'error', error: 'Die heruntergeladene Version wurde inzwischen gelöscht – bitte erneut laden.' }); throw new Error(this.state.error); }
    const d = this.dir();
    const runSh = path.join(d, 'run.sh'), swapSh = path.join(d, 'swap.sh'), log = path.join(d, 'install.log');
    fs.writeFileSync(runSh, RUN_SH, { mode: 0o755 });
    fs.writeFileSync(swapSh, SWAP_SH, { mode: 0o755 });
    fs.writeFileSync(path.join(d, 'pending.json'), JSON.stringify({ from: this.o.current, to: this.state.version, at: new Date().toISOString(), target: t.target, relaunch: !!relaunch }));
    fs.appendFileSync(log, `\n[${new Date().toISOString()}] Update ${this.o.current} -> ${this.state.version} nach ${t.target}${t.needsAdmin ? ' (mit Administratorrechten)' : ''}\n`);
    const child = spawn('/bin/bash', [runSh, String(pid), t.target, this.state.staged, relaunch ? '1' : '0', t.needsAdmin ? '1' : '0', log, swapSh], { detached: true, stdio: 'ignore', env: process.env });
    child.unref();
    this.set({ phase: 'installing', relaunch: !!relaunch });
    return this.status();
  }

  /** Nach dem Start: Ergebnis eines vorherigen Updates auswerten. */
  async takeResult() {
    const f = path.join(this.dir(), 'pending.json');
    let p;
    try { p = JSON.parse(await fsp.readFile(f, 'utf8')); } catch (_) { return null; }
    await fsp.rm(f, { force: true });
    const ok = p.to === this.o.current;
    let log = '';
    if (!ok) { try { log = (await fsp.readFile(path.join(this.dir(), 'install.log'), 'utf8')).split('\n').slice(-12).join('\n'); } catch (_) {} }
    await this.cleanup();
    return { ...p, ok, current: this.o.current, log, logFile: path.join(this.dir(), 'install.log') };
  }
}

module.exports = { Updater, pickAsset, plistVersion, RUN_SH, SWAP_SH };
