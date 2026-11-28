'use strict';
const T = (x) => require('../renderer/i18n.js').t(x);
const os = require('os');
const fs = require('fs');
const path = require('path');
const IS_WIN = process.platform === 'win32';
const { TelnetSession } = require('./telnet');
const { SerialSession } = require('./serial');
const { RdpSession } = require('./rdp');
const { splitArgs, expandHome } = require('./ssh-args');

let pty = null;
function getPty() {
  if (!pty) pty = require('node-pty');
  return pty;
}

function termEnv(extra) {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'MacT-1000' };
  if (!env.LANG) env.LANG = 'de_DE.UTF-8';
  delete env.ELECTRON_RUN_AS_NODE;
  return { ...env, ...(extra || {}) };
}

/** Wrapper für Prozesse in einem Pseudo-Terminal (lokale Shell, ssh, beliebige Befehle). */
class PtySession {
  constructor(file, args, opts, emit) {
    this.emit = emit;
    this.proc = getPty().spawn(file, args, {
      name: 'xterm-256color',
      cols: opts.cols || 80,
      rows: opts.rows || 24,
      cwd: opts.cwd || os.homedir(),
      env: termEnv(opts.env)
    });
    this.proc.onData((d) => this.emit('data', d));
    this.proc.onExit(({ exitCode, signal }) => this.emit('exit', { code: exitCode, signal }));
  }
  write(d) { try { this.proc.write(d); } catch (_) {} }
  resize(c, r) { try { this.proc.resize(Math.max(c, 2), Math.max(r, 1)); } catch (_) {} }
  kill() { try { this.proc.kill(); } catch (_) {} }
  action(a) {
    if (a === 'cwd' && !IS_WIN) {
      // aktuelles Arbeitsverzeichnis des Shell-Prozesses (für "Duplizieren")
      try {
        const { execFileSync } = require('child_process');
        const out = execFileSync('lsof', ['-a', '-d', 'cwd', '-p', String(this.proc.pid), '-Fn'], { encoding: 'utf8' });
        const line = out.split('\n').find(l => l.startsWith('n'));
        return line ? line.slice(1) : null;
      } catch (_) { return null; }
    }
    return null;
  }
}

function shellPath(cfg) {
  const cands = [cfg.shell, process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(Boolean);
  return cands.find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch (_) { return false; } }) || '/bin/sh';
}

function findInPath(exe) {
  for (const d of String(process.env.PATH || process.env.Path || '').split(path.delimiter)) {
    if (!d) continue;
    const p = path.join(d.replace(/^"|"$/g, ''), exe);
    try { if (fs.statSync(p).isFile()) return p; } catch (_) {}
  }
  return null;
}
const sysRoot = () => process.env.SystemRoot || 'C:\\Windows';

/** Windows: Shell + Argumente. Standard: PowerShell 7 (pwsh), sonst Windows PowerShell. */
function winShell(cfg) {
  const parts = splitArgs(cfg.shell || '', true);
  if (parts.length) {
    const exe = parts[0];
    const full = /[\\/]/.test(exe) ? exe : (findInPath(exe) || findInPath(exe + '.exe') || exe);
    return { file: full, args: parts.slice(1) };
  }
  const pwsh = findInPath('pwsh.exe');
  if (pwsh) return { file: pwsh, args: ['-NoLogo'] };
  const ps = path.join(sysRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (fs.existsSync(ps)) return { file: ps, args: ['-NoLogo'] };
  return { file: process.env.ComSpec || 'cmd.exe', args: [] };
}

/** Pfad zum ssh-Programm (Windows: eingebauter OpenSSH-Client) */
function sshPath(cfg) {
  if (cfg.sshBinary) return cfg.sshBinary;
  if (!IS_WIN) return '/usr/bin/ssh';
  const builtin = path.join(sysRoot(), 'System32', 'OpenSSH', 'ssh.exe');
  if (fs.existsSync(builtin)) return builtin;
  const p = findInPath('ssh.exe');
  if (p) return p;
  throw new Error('OpenSSH-Client nicht gefunden. Unter Windows nachinstallieren: Einstellungen → System → Optionale Features → „OpenSSH-Client“.');
}

function buildSshArgs(cfg) {
  const args = [];
  if (cfg.port && String(cfg.port) !== '22') args.push('-p', String(cfg.port));
  if (cfg.username) args.push('-l', cfg.username);
  if (cfg.identityFile) args.push('-i', expandHome(cfg.identityFile));
  // macOS: Passphrase des Schlüssels im Schlüsselbund speichern und von dort laden.
  // UseKeychain kennt nur Apples /usr/bin/ssh, nicht z.B. Homebrew-OpenSSH.
  if (cfg.useKeychain !== false && process.platform === 'darwin' && (!cfg.sshBinary || cfg.sshBinary === '/usr/bin/ssh')) {
    args.push('-o', 'UseKeychain=yes', '-o', 'AddKeysToAgent=yes');
  }
  if (cfg.jumpHost) args.push('-J', cfg.jumpHost);
  // Verbindung mit dem Datei-Browser (scp) teilen → keine zweite Passwortabfrage
  if (cfg.shareConnection !== false && !IS_WIN) {
    const { controlPathOpt } = require('./scp');
    args.push('-o', 'ControlMaster=auto', ...controlPathOpt());
  }
  if (cfg.forwardAgent) args.push('-A');
  if (cfg.x11) args.push('-Y');
  if (cfg.compression) args.push('-C');
  if (cfg.keepAlive) args.push('-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=4');
  if (cfg.legacyAlgos) {
    // Hilfreich für alte Switches/Router
    args.push('-o', 'KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1',
      '-o', 'HostKeyAlgorithms=+ssh-rsa', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa',
      '-o', 'Ciphers=+aes128-cbc,aes256-cbc,3des-cbc');
  }
  for (const f of (cfg.forwards || [])) {
    if (!f || !f.spec) continue;
    const flag = f.type === 'R' ? '-R' : f.type === 'D' ? '-D' : '-L';
    args.push(flag, f.spec);
  }
  args.push(...splitArgs(cfg.extraArgs));
  args.push(cfg.host);
  if (cfg.remoteCommand) args.push('-t', cfg.remoteCommand);
  return args;
}

// Gespeichertes Passwort beim SSH-Passwort-Prompt einmal automatisch eingeben.
// Schlüssel-Passphrasen ("Enter passphrase for key") werden nicht beantwortet (dafür gibt es den Schlüsselbund).
const SSH_PW_PROMPT = /(password|passwort|kennwort)[^\n:]*:\s*$/i;
const stripCtl = (s) => String(s).replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '').replace(/\x1b[()][0-9A-Za-z]|\x1b[=>78DEHMc]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
function attachSshAutoPassword(s, cfg, emit) {
  let buf = '', tries = 0, done = false, lastInput = 0;
  const host = String(cfg.host || '').toLowerCase();
  // Eingaben von Benutzer/Makro merken: wer schon selbst antwortet, bekommt kein zweites Passwort dazwischen
  const origWrite = s.write.bind(s);
  s.write = (d) => { lastInput = Date.now(); origWrite(d); };
  s.proc.onData((d) => {
    if (done) return;
    // Steuerzeichen entfernen (Windows-Konsole/ConPTY schickt z. B. Cursor-Befehle und Fenstertitel hinter dem Prompt)
    buf = (buf + stripCtl(d)).slice(-400);
    const line = buf.split(/\r?\n|\r/).filter(x => x.trim()).pop() || '';
    if (/passphrase/i.test(line) || !SSH_PW_PROMPT.test(line)) return;
    // Prompt eines Jump-Hosts (anderer Host im Prompt) nicht beantworten
    const m = line.match(/@([^'"\s]+?)'s password/i);
    if (m && host && !m[1].toLowerCase().startsWith(host.split('.')[0]) && m[1].toLowerCase() !== host) return;
    buf = '';
    if (tries++ >= 1) {
      done = true;
      emit('data', T('\x1b[90m(Gespeichertes Passwort wurde abgelehnt – bitte manuell eingeben)\x1b[0m '));
      return;
    }
    const seen = Date.now();
    setTimeout(() => { if (lastInput >= seen) { tries--; return; } origWrite(cfg.password + '\r'); }, 200);
  });
  setTimeout(() => { done = true; }, 120000);
}

class SessionManager {
  constructor(send) {
    this.send = send;
    this.map = new Map();
  }

  open(id, cfg, size) {
    this.kill(id);
    let seq = 0;
    const emit = (type, payload) => {
      if (type === 'data') { seq++; this.send('session:data', { id, data: payload, seq }); if (this.tap) this.tap('data', id, payload, seq); return; }
      if (type === 'exit') { if (this.tap) this.tap('exit', id); this.map.delete(id); this.send('session:exit', { id, ...payload }); }
      else if (type === 'status') this.send('session:status', { id, ...payload });
    };
    const opts = { cols: size && size.cols, rows: size && size.rows };
    let s;
    try {
      switch (cfg.type) {
        case 'local': {
          let sh, args;
          if (IS_WIN) ({ file: sh, args } = winShell(cfg));
          else { sh = shellPath(cfg); args = cfg.loginShell === false ? [] : ['-l']; }
          s = new PtySession(sh, args, { ...opts, cwd: expandHome(cfg.cwd) || os.homedir() }, emit);
          if (cfg.startupCommand) setTimeout(() => s.write(cfg.startupCommand + '\r'), 300);
          break;
        }
        case 'ssh': {
          if (!cfg.host) throw new Error('Kein Host angegeben');
          const args = buildSshArgs(cfg);
          const shown = args.filter((x, i) => !/^Control(Master|Path)=/.test(x) && !(x === '-o' && /^Control(Master|Path)=/.test(args[i + 1] || '')));
          emit('data', `\x1b[90mssh ${shown.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' ')}\x1b[0m\r\n`);
          s = new PtySession(sshPath(cfg), args, opts, emit);
          if (cfg.password) attachSshAutoPassword(s, cfg, emit);
          break;
        }
        case 'telnet':
          if (!cfg.host) throw new Error('Kein Host angegeben');
          s = new TelnetSession(cfg, opts, emit);
          break;
        case 'serial':
          if (!cfg.path) throw new Error('Keine serielle Schnittstelle gewählt');
          s = new SerialSession(cfg, opts, emit);
          break;
        case 'rdp':
          if (!cfg.host) throw new Error('Kein Host angegeben');
          s = new RdpSession(cfg, opts, emit);
          break;
        case 'share':
          if (!cfg.host) throw new Error('Kein Host angegeben');
          s = new (require('./share').ShareClientSession)(cfg, opts, emit, this.shareEnv);
          break;
        case 'command': {
          const parts = splitArgs(cfg.command);
          if (!parts.length) throw new Error('Kein Befehl angegeben');
          const exe = IS_WIN && !/[\\/]/.test(parts[0]) ? (findInPath(parts[0]) || findInPath(parts[0] + '.exe') || parts[0]) : parts[0];
          s = new PtySession(exe, parts.slice(1), opts, emit);
          break;
        }
        default:
          throw new Error('Unbekannter Session-Typ: ' + cfg.type);
      }
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
    s._info = { type: cfg.type, label: cfg.name || (cfg.type === 'serial' ? cfg.path : [cfg.user, cfg.host].filter(Boolean).join('@')) || '' };
    this.map.set(id, s);
    return { ok: true };
  }

  write(id, data) { const s = this.map.get(id); if (s) s.write(data); }
  resize(id, c, r) { const s = this.map.get(id); if (s && c > 0 && r > 0) { s.resize(c, r); if (this.tap) this.tap('resize', id, c, r); } }
  kill(id) { const s = this.map.get(id); if (s) { this.map.delete(id); s.kill(); } }
  // Aktive Netzwerk-/Seriell-Verbindungen (für die Rückfrage beim Beenden)
  activeConnections() {
    const names = { ssh: 'SSH', telnet: 'Telnet', serial: 'Seriell', share: 'Freigabe' };
    return [...this.map.values()].filter(s => s._info && names[s._info.type]).map(s => `${names[s._info.type]}: ${s._info.label}`);
  }
  killAll() { for (const id of [...this.map.keys()]) this.kill(id); }
  async action(id, a, arg) {
    const s = this.map.get(id);
    if (!s || !s.action) return null;
    return s.action(a, arg);
  }
}

module.exports = { SessionManager, splitArgs, buildSshArgs, winShell, sshPath, findInPath };
