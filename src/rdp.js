'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const MS_APPS = [
  '/Applications/Windows App.app',
  '/Applications/Microsoft Remote Desktop.app',
  path.join(os.homedir(), 'Applications/Windows App.app')
];
const FREERDP_BINS = ['sdl3-freerdp', 'sdl-freerdp', 'xfreerdp3', 'xfreerdp'];

function which(bin) {
  try { return execFileSync('/usr/bin/which', [bin], { encoding: 'utf8', env: process.env }).trim() || null; }
  catch (_) {
    for (const d of ['/opt/homebrew/bin', '/usr/local/bin']) { const p = path.join(d, bin); if (fs.existsSync(p)) return p; }
    return null;
  }
}

function detectClients() {
  const res = [];
  for (const a of MS_APPS) if (fs.existsSync(a)) { res.push({ id: 'microsoft', name: path.basename(a, '.app'), path: a }); break; }
  for (const b of FREERDP_BINS) { const p = which(b); if (p) res.push({ id: 'freerdp', name: 'FreeRDP (' + b + ')', path: p }); }
  return res;
}

function rdpFileContent(cfg) {
  const port = Number(cfg.port) || 3389;
  const user = cfg.username ? (cfg.domain ? `${cfg.domain}\\${cfg.username}` : cfg.username) : '';
  const full = cfg.resolution === 'fullscreen';
  const [w, h] = (cfg.resolution && cfg.resolution.includes('x') ? cfg.resolution : '1920x1080').split('x').map(Number);
  const lines = [
    `full address:s:${cfg.host}${port !== 3389 ? ':' + port : ''}`,
    user ? `username:s:${user}` : null,
    `screen mode id:i:${full ? 2 : 1}`,
    `desktopwidth:i:${w || 1920}`,
    `desktopheight:i:${h || 1080}`,
    `dynamic resolution:i:${cfg.resolution === 'dynamic' || !cfg.resolution ? 1 : 0}`,
    `smart sizing:i:1`,
    `use multimon:i:${cfg.multimon ? 1 : 0}`,
    `session bpp:i:32`,
    `redirectclipboard:i:${cfg.clipboard === false ? 0 : 1}`,
    `audiomode:i:${cfg.audio ? 0 : 2}`,
    cfg.redirectDrives ? 'drivestoredirect:s:*' : null,
    `prompt for credentials:i:0`,
    `authentication level:i:${cfg.ignoreCert ? 0 : 2}`,
    cfg.gateway ? `gatewayhostname:s:${cfg.gateway}` : null,
    cfg.gateway ? 'gatewayusagemethod:i:1' : null,
    cfg.adminSession ? 'administrative session:i:1' : null
  ].filter(Boolean);
  return lines.join('\r\n') + '\r\n';
}

function freerdpArgs(cfg) {
  const port = Number(cfg.port) || 3389;
  const a = [`/v:${cfg.host}${port !== 3389 ? ':' + port : ''}`];
  if (cfg.username) a.push(`/u:${cfg.username}`);
  if (cfg.domain) a.push(`/d:${cfg.domain}`);
  if (cfg.resolution === 'fullscreen') a.push('/f');
  else if (cfg.resolution && cfg.resolution.includes('x')) a.push(`/size:${cfg.resolution}`);
  else a.push('/dynamic-resolution', '/size:1600x1000');
  if (cfg.multimon) a.push('/multimon');
  if (cfg.clipboard !== false) a.push('+clipboard');
  if (cfg.audio) a.push('/sound');
  if (cfg.redirectDrives) a.push(`/drive:home,${os.homedir()}`);
  if (cfg.ignoreCert) a.push('/cert:ignore');
  if (cfg.gateway) a.push(`/g:${cfg.gateway}`);
  if (cfg.adminSession) a.push('/admin');
  a.push('/from-stdin:force'); // Passwort interaktiv im Pane abfragen (nicht in der Prozessliste)
  return a;
}

/**
 * RDP öffnet ein eigenes Fenster (Windows App oder FreeRDP). Das Pane zeigt Status/Log
 * und dient bei FreeRDP zur Passworteingabe.
 */
class RdpSession {
  constructor(cfg, opts, emit) {
    this.emit = emit;
    this.cfg = cfg;
    this.inner = null;
    const clients = detectClients();
    let client = clients.find(c => c.id === (cfg.client || 'auto')) || null;
    if (!client && (cfg.client === 'auto' || !cfg.client)) client = clients[0] || null;

    emit('data', `\x1b[1mRDP → ${cfg.host}${cfg.port && cfg.port != 3389 ? ':' + cfg.port : ''}\x1b[0m\r\n`);
    if (!client) {
      emit('data', '\r\n\x1b[31mKein RDP-Client gefunden.\x1b[0m\r\n\r\nInstalliere eine der folgenden Optionen:\r\n' +
        '  • Microsoft \x1b[1mWindows App\x1b[0m (kostenlos im Mac App Store)\r\n' +
        '  • FreeRDP:  \x1b[36mbrew install freerdp\x1b[0m\r\n\r\nDanach mit „Neu verbinden“ im Pane-Menü erneut versuchen.\r\n');
      setTimeout(() => emit('exit', { code: 1, message: 'kein RDP-Client', keep: true }), 0);
      return;
    }

    if (client.id === 'microsoft') {
      const dir = path.join(require('electron').app.getPath('userData'), 'rdp');
      fs.mkdirSync(dir, { recursive: true });
      const name = (cfg.name || cfg.host).replace(/[^\w.-]+/g, '_');
      const file = path.join(dir, `${name}.rdp`);
      fs.writeFileSync(file, rdpFileContent(cfg), { mode: 0o600 });
      emit('data', `\x1b[90mClient: ${client.name}\r\nRDP-Datei: ${file}\x1b[0m\r\n\r\n`);
      execFile('/usr/bin/open', ['-a', client.path, file], (err) => {
        if (err) emit('data', `\x1b[31mFehler beim Start: ${err.message}\x1b[0m\r\n`);
        else emit('data', '\x1b[32mRDP-Sitzung im Windows-App-Fenster gestartet.\x1b[0m\r\n' +
          '\x1b[90mDas Remote-Desktop-Fenster läuft unabhängig von diesem Pane.\r\nFür erneutes Verbinden: Pane-Menü → „Neu verbinden“.\x1b[0m\r\n');
      });
      emit('status', { rdp: 'launched' });
    } else {
      const args = freerdpArgs(cfg);
      emit('data', `\x1b[90m${client.path} ${args.join(' ')}\x1b[0m\r\n\x1b[90m(Passwort wird hier im Pane abgefragt)\x1b[0m\r\n\r\n`);
      const pty = require('node-pty');
      this.inner = pty.spawn(client.path, args, {
        name: 'xterm-256color', cols: opts.cols || 80, rows: opts.rows || 24, cwd: os.homedir(), env: { ...process.env }
      });
      this.inner.onData(d => emit('data', d));
      this.inner.onExit(({ exitCode }) => {
        this.inner = null;
        emit('data', `\r\n\x1b[90mFreeRDP beendet (Code ${exitCode}).\x1b[0m\r\n`);
        emit('exit', { code: exitCode, keep: true });
      });
    }
  }
  write(d) { if (this.inner) this.inner.write(d); }
  resize(c, r) { if (this.inner) try { this.inner.resize(c, r); } catch (_) {} }
  kill() { if (this.inner) { try { this.inner.kill(); } catch (_) {} this.inner = null; } }
}

module.exports = { RdpSession, detectClients, rdpFileContent, freerdpArgs };
