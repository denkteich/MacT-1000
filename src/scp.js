'use strict';
/**
 * Dateiübertragung für SSH-Sessions per scp.
 *
 * Damit Passwort/Passphrase/2FA nicht für jede Aktion erneut abgefragt werden,
 * nutzen Terminal-Session und Datei-Browser eine gemeinsame OpenSSH-Verbindung
 * (ControlMaster/ControlPath). Existiert noch keine, wird einmalig eine im
 * Hintergrund aufgebaut (ControlPersist) – Abfragen werden an die Oberfläche
 * weitergereicht.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { splitArgs, expandHome } = require('./ssh-args');

let pty = null;
const getPty = () => (pty || (pty = require('node-pty')));

const PERSIST = 600; // Sekunden, die eine vom Datei-Browser geöffnete Verbindung ohne Nutzung bestehen bleibt

function controlDir() {
  const d = path.join(os.homedir(), '.mact1000', 'cm');
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(d, 0o700); } catch (_) {}
  return d;
}
/** %C = Hash aus lokalem Host, Ziel, Port, User (und Jump-Host) – kurz genug für Unix-Sockets */
function controlPathOpt() { return ['-o', `ControlPath=${path.join(controlDir(), '%C')}`]; }

function sshBin(cfg) { return cfg.sshBinary || '/usr/bin/ssh'; }
function scpBin(cfg) {
  const s = sshBin(cfg);
  const cand = path.join(path.dirname(s), 'scp');
  try { fs.accessSync(cand, fs.constants.X_OK); return cand; } catch (_) { return '/usr/bin/scp'; }
}

/** Optionen, die ssh UND scp gleichermaßen verstehen (deshalb -o Port/User statt -p/-P/-l). */
function commonOpts(cfg) {
  const a = [];
  if (cfg.port && String(cfg.port) !== '22') a.push('-o', `Port=${cfg.port}`);
  if (cfg.username) a.push('-o', `User=${cfg.username}`);
  if (cfg.identityFile) a.push('-i', expandHome(cfg.identityFile));
  if (cfg.useKeychain !== false && process.platform === 'darwin' && sshBin(cfg) === '/usr/bin/ssh') {
    a.push('-o', 'UseKeychain=yes', '-o', 'AddKeysToAgent=yes');
  }
  if (cfg.jumpHost) a.push('-J', cfg.jumpHost);
  if (cfg.compression) a.push('-C');
  if (cfg.legacyAlgos) {
    a.push('-o', 'KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1',
      '-o', 'HostKeyAlgorithms=+ssh-rsa', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa',
      '-o', 'Ciphers=+aes128-cbc,aes256-cbc,3des-cbc');
  }
  // aus den zusätzlichen ssh-Argumenten nur -o-Optionen übernehmen (scp kennt nicht alle ssh-Schalter)
  const extra = splitArgs(cfg.extraArgs);
  for (let i = 0; i < extra.length; i++) {
    if (extra[i] === '-o' && extra[i + 1]) { a.push('-o', extra[++i]); }
    else if (/^-o./.test(extra[i])) a.push('-o', extra[i].slice(2));
  }
  a.push(...controlPathOpt());
  return a;
}

const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const scpHost = (h) => (h.includes(':') && !h.startsWith('[') ? `[${h}]` : h);
/** Remote-Pfad für scp. Klassisches Protokoll (-O) wertet den Pfad in der Remote-Shell aus → quoten. */
function remoteSpec(cfg, p) { return `${scpHost(cfg.host)}:${cfg.scpLegacy ? shq(p) : p}`; }

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', timeout: opts.timeout || 30000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: stdout || '', stderr: stderr || '', killed: err && err.killed }));
  });
}

const PROMPT_PASS = /(password|passphrase|passwort|kennwort|pin|verification code|one-time|otp|token|response)[^\n]*[:?]\s*$/i;
const PROMPT_YESNO = /\(yes\/no(\/\[fingerprint\])?\)\?\s*$/i;

class FileTransfer {
  /** ask({kind:'password'|'confirm', text, title}) → Promise<string|boolean|null> */
  constructor(ask, emit) {
    this.ask = ask;
    this.emit = emit;           // (channel, payload)
    this.jobs = new Map();
    this.masters = new Map();   // key -> cfg (für Aufräumen beim Beenden)
    this.connecting = new Map();
    this.connProcs = new Set();
  }

  key(cfg) { return [cfg.username || '', cfg.host, cfg.port || 22, cfg.jumpHost || '', cfg.sshBinary || ''].join('|'); }

  async check(cfg) {
    const r = await run(sshBin(cfg), [...commonOpts(cfg), '-O', 'check', '--', cfg.host], { timeout: 5000 });
    return r.code === 0;
  }

  /** stellt sicher, dass eine gemeinsame Verbindung existiert (fragt ggf. Passwort o.ä. ab) */
  async ensure(cfg) {
    if (!cfg || !cfg.host) throw new Error('Kein Host');
    const k = this.key(cfg);
    if (await this.check(cfg)) { this.masters.set(k, cfg); return true; }
    if (this.connecting.has(k)) return this.connecting.get(k);
    const p = this._connect(cfg).finally(() => this.connecting.delete(k));
    this.connecting.set(k, p);
    await p;
    this.masters.set(k, cfg);
    return true;
  }

  _connect(cfg) {
    return new Promise((resolve, reject) => {
      const args = [...commonOpts(cfg), '-o', 'ControlMaster=auto', '-o', `ControlPersist=${PERSIST}`,
        '-o', 'ConnectTimeout=20', '-o', 'NumberOfPasswordPrompts=3', '--', cfg.host, 'exit 0'];
      let proc;
      try {
        proc = getPty().spawn(sshBin(cfg), args, { name: 'xterm', cols: 200, rows: 24, cwd: os.homedir(), env: { ...process.env, LC_ALL: 'C' } });
      } catch (e) { reject(e); return; }
      this.connProcs.add(proc);
      let buf = ''; let all = ''; let busy = false; let canceled = false;
      const handle = async () => {
        if (busy) return;
        const tail = buf.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/).pop();
        let kind = null;
        if (PROMPT_YESNO.test(tail)) kind = 'confirm';
        else if (PROMPT_PASS.test(tail)) kind = 'password';
        if (!kind) return;
        busy = true; buf = '';
        const context = all.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim().split(/\r?\n/).slice(-6).join('\n');
        const ans = await this.ask({ kind, text: kind === 'confirm' ? context : tail.trim(), host: cfg.host });
        busy = false;
        if (ans === null || ans === undefined || ans === false) {
          canceled = true; try { proc.kill(); } catch (_) {}
          return;
        }
        proc.write((kind === 'confirm' ? 'yes' : String(ans)) + '\r');
      };
      proc.onData((d) => { buf += d; all += d; if (all.length > 20000) all = all.slice(-10000); handle(); });
      proc.onExit(({ exitCode }) => {
        this.connProcs.delete(proc);
        if (canceled) return reject(new Error('Abgebrochen'));
        if (exitCode === 0) return resolve(true);
        const msg = all.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/).map(s => s.trim())
          .filter(s => s && !PROMPT_PASS.test(s)).slice(-3).join(' ');
        reject(new Error(msg || `ssh beendet (Code ${exitCode})`));
      });
    });
  }

  /** Shell-Skript per bestehender Verbindung ausführen; Argumente werden sicher gequotet */
  async exec(cfg, script, args = []) {
    await this.ensure(cfg);
    const cmd = `sh -c ${shq(script)} sh ${args.map(shq).join(' ')}`;
    const r = await run(sshBin(cfg), [...commonOpts(cfg), '-o', 'ControlMaster=no', '-o', 'BatchMode=yes', '-T', '--', cfg.host, cmd]);
    return r;
  }

  async list(cfg, dir) {
    const script = 'if [ -n "$1" ]; then cd -- "$1" || exit 3; else cd; fi; pwd; echo "@@MACTERM@@"; LC_ALL=C ls -laL 2>/dev/null; exit 0';
    const r = await this.exec(cfg, script, [dir || '']);
    if (r.code !== 0) {
      const err = r.stderr.trim().split('\n').pop() || `Fehler (Code ${r.code})`;
      throw new Error(r.code === 3 ? `Verzeichnis nicht lesbar: ${dir}` : err);
    }
    const [head, rest = ''] = r.stdout.split('@@MACTERM@@');
    const cwd = head.trim().split('\n').pop() || '/';
    return { cwd, entries: parseLs(rest) };
  }

  async op(cfg, name, args) {
    const scripts = {
      mkdir: 'mkdir -p -- "$1"',
      rename: 'mv -- "$1" "$2"',
      delete: 'rm -rf -- "$@"',
      touch: 'touch -- "$1"'
    };
    if (!scripts[name]) throw new Error('Unbekannte Aktion');
    const r = await this.exec(cfg, scripts[name], args);
    if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || `Fehler (Code ${r.code})`);
    return true;
  }

  /**
   * Übertragung starten. direction 'upload': sources = lokale Pfade, dest = Remote-Verzeichnis.
   * 'download': sources = Remote-Pfade, dest = lokales Verzeichnis.
   */
  async transfer(jobId, cfg, { direction, sources, dest }) {
    const job = { id: jobId, direction, sources, dest, proc: null, canceled: false };
    this.jobs.set(jobId, job);
    const ev = (type, extra) => this.emit('fx:job', { id: jobId, type, ...extra });
    try {
      await this.ensure(cfg);
    } catch (e) {
      this.jobs.delete(jobId);
      ev('done', { ok: false, error: String(e.message || e) });
      return;
    }
    if (job.canceled) { this.jobs.delete(jobId); ev('done', { ok: false, error: 'Abgebrochen' }); return; }
    const args = [...commonOpts(cfg), '-o', 'ControlMaster=no', '-o', 'BatchMode=yes', '-r', '-p'];
    if (cfg.scpLegacy) args.push('-O');
    if (direction === 'upload') {
      args.push('--', ...sources.map(expandHome), remoteSpec(cfg, dest.endsWith('/') ? dest : dest + '/'));
    } else {
      const d = expandHome(dest);
      fs.mkdirSync(d, { recursive: true });
      args.push('--', ...sources.map(s => remoteSpec(cfg, s)), d.endsWith('/') ? d : d + '/');
    }
    ev('start', { cmd: [path.basename(scpBin(cfg)), ...args.filter(a => !a.startsWith('ControlPath='))].join(' ') });
    let proc;
    try {
      proc = getPty().spawn(scpBin(cfg), args, { name: 'xterm', cols: 160, rows: 24, cwd: os.homedir(), env: { ...process.env } });
    } catch (e) {
      this.jobs.delete(jobId); ev('done', { ok: false, error: String(e.message || e) }); return;
    }
    job.proc = proc;
    let out = ''; let lastEmit = 0; const files = new Set();
    proc.onData((d) => {
      out += d; if (out.length > 40000) out = out.slice(-20000);
      const parts = d.split(/[\r\n]+/).filter(Boolean);
      for (const line of parts) {
        const p = parseProgress(line);
        if (!p) continue;
        files.add(p.file);
        const now = Date.now();
        if (now - lastEmit > 150 || p.percent === 100) { lastEmit = now; ev('progress', { ...p, files: files.size }); }
      }
    });
    proc.onExit(({ exitCode }) => {
      this.jobs.delete(jobId);
      if (job.canceled) return ev('done', { ok: false, error: 'Abgebrochen' });
      if (exitCode === 0) return ev('done', { ok: true, files: files.size });
      const msg = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/[\r\n]+/).map(s => s.trim())
        .filter(s => s && !parseProgress(s)).slice(-3).join(' ');
      ev('done', { ok: false, error: msg || `scp beendet (Code ${exitCode})` });
    });
  }

  cancel(jobId) {
    const j = this.jobs.get(jobId);
    if (!j) return;
    j.canceled = true;
    if (j.proc) try { j.proc.kill(); } catch (_) {}
  }

  /** Beim Beenden: Hintergrund-Verbindungen schließen, die der Datei-Browser geöffnet hat */
  closeAll() {
    for (const j of this.jobs.values()) this.cancel(j.id);
    for (const p of this.connProcs) try { p.kill(); } catch (_) {}
    this.connProcs.clear();
    const { execFileSync } = require('child_process');
    for (const cfg of this.masters.values()) {
      try { execFileSync(sshBin(cfg), [...commonOpts(cfg), '-O', 'exit', '--', cfg.host], { timeout: 2000, stdio: 'ignore' }); } catch (_) {}
    }
    this.masters.clear();
  }
}

/** scp-Fortschrittszeile: "datei.iso   45%  123MB  11.2MB/s   00:12 ETA" */
function parseProgress(line) {
  const s = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  const m = s.match(/^(.*?)\s+(\d{1,3})%\s+(\S+)\s+(\S+\/s|-+\s*\S*\/s|\s*--\.-\S*)\s+(\S+)(?:\s+ETA)?\s*$/);
  if (!m) return null;
  return { file: m[1].trim(), percent: Math.min(100, parseInt(m[2], 10)), size: m[3], speed: m[4].trim(), eta: m[5] };
}

const LS_RE = /^([\-dlcbpsD])([rwxsStTl\-]{9})[.+@]?\s+\d+\s+(\S+)\s+(\S+)\s+(\d+(?:,\s*\d+)?)\s+([A-Za-z]{3}\s+\d{1,2}\s+(?:\d{1,2}:\d{2}|\d{4}))\s(.*)$/;
/** Ausgabe von "ls -laL" (GNU, BSD, BusyBox) parsen */
function parseLs(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = line.match(LS_RE);
    if (!m) continue;
    const name = m[7];
    if (name === '.' || name === '..') continue;
    const t = m[1];
    out.push({
      name,
      type: t === 'd' ? 'dir' : t === '-' ? 'file' : t === 'l' ? 'link' : 'other',
      perms: m[1] + m[2],
      owner: m[3], group: m[4],
      size: /,/.test(m[5]) ? 0 : Number(m[5]),
      date: m[6].replace(/\s+/g, ' ')
    });
  }
  out.sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' }));
  return out;
}

module.exports = { FileTransfer, parseLs, parseProgress, commonOpts, remoteSpec, shq, controlPathOpt };
