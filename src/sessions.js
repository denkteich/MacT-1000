'use strict';
const os = require('os');
const fs = require('fs');
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
    if (a === 'cwd') {
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
  if (cfg.shareConnection !== false) {
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

class SessionManager {
  constructor(send) {
    this.send = send;
    this.map = new Map();
  }

  open(id, cfg, size) {
    this.kill(id);
    const emit = (type, payload) => {
      if (type === 'data') this.send('session:data', { id, data: payload });
      else if (type === 'exit') { this.map.delete(id); this.send('session:exit', { id, ...payload }); }
      else if (type === 'status') this.send('session:status', { id, ...payload });
    };
    const opts = { cols: size && size.cols, rows: size && size.rows };
    let s;
    try {
      switch (cfg.type) {
        case 'local': {
          const sh = shellPath(cfg);
          const args = cfg.loginShell === false ? [] : ['-l'];
          s = new PtySession(sh, args, { ...opts, cwd: expandHome(cfg.cwd) || os.homedir() }, emit);
          if (cfg.startupCommand) setTimeout(() => s.write(cfg.startupCommand + '\r'), 300);
          break;
        }
        case 'ssh': {
          if (!cfg.host) throw new Error('Kein Host angegeben');
          const args = buildSshArgs(cfg);
          const shown = args.filter((x, i) => !/^Control(Master|Path)=/.test(x) && !(x === '-o' && /^Control(Master|Path)=/.test(args[i + 1] || '')));
          emit('data', `\x1b[90mssh ${shown.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' ')}\x1b[0m\r\n`);
          s = new PtySession(cfg.sshBinary || '/usr/bin/ssh', args, opts, emit);
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
        case 'command': {
          const parts = splitArgs(cfg.command);
          if (!parts.length) throw new Error('Kein Befehl angegeben');
          s = new PtySession(parts[0], parts.slice(1), opts, emit);
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
  resize(id, c, r) { const s = this.map.get(id); if (s && c > 0 && r > 0) s.resize(c, r); }
  kill(id) { const s = this.map.get(id); if (s) { this.map.delete(id); s.kill(); } }
  // Aktive Netzwerk-/Seriell-Verbindungen (für die Rückfrage beim Beenden)
  activeConnections() {
    const names = { ssh: 'SSH', telnet: 'Telnet', serial: 'Seriell' };
    return [...this.map.values()].filter(s => s._info && names[s._info.type]).map(s => `${names[s._info.type]}: ${s._info.label}`);
  }
  killAll() { for (const id of [...this.map.keys()]) this.kill(id); }
  async action(id, a, arg) {
    const s = this.map.get(id);
    if (!s || !s.action) return null;
    return s.action(a, arg);
  }
}

module.exports = { SessionManager, splitArgs, buildSshArgs };
