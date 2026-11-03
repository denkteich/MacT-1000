'use strict';
const { StringDecoder } = require('string_decoder');

/** Serielle Konsole über das serialport-Modul (USB-Seriell-Adapter, Konsolenkabel usw.). */
class SerialSession {
  constructor(cfg, opts, emit) {
    this.emit = emit;
    this.cfg = cfg;
    this.closed = false;
    this.enter = { cr: '\r', crlf: '\r\n', lf: '\n' }[cfg.enterMode || 'cr'] || '\r';
    this.decoder = new StringDecoder(cfg.encoding === 'latin1' ? 'latin1' : 'utf8');
    const { SerialPort } = require('serialport');

    const settings = {
      path: cfg.path,
      baudRate: Number(cfg.baudRate) || 9600,
      dataBits: Number(cfg.dataBits) || 8,
      stopBits: Number(cfg.stopBits) || 1,
      parity: cfg.parity || 'none',
      rtscts: cfg.flowControl === 'rtscts',
      xon: cfg.flowControl === 'xonxoff',
      xoff: cfg.flowControl === 'xonxoff',
      autoOpen: false
    };
    emit('data', `\x1b[90mÖffne ${settings.path} – ${settings.baudRate} ${settings.dataBits}${settings.parity[0].toUpperCase()}${settings.stopBits}` +
      `${settings.rtscts ? ' RTS/CTS' : ''}${settings.xon ? ' XON/XOFF' : ''}…\x1b[0m\r\n`);
    this.port = new SerialPort(settings);
    this.port.open((err) => {
      if (err) {
        emit('data', `\x1b[31mFehler beim Öffnen: ${err.message}\x1b[0m\r\n`);
        emit('data', `\x1b[90mTipp: Wird der Port von einem anderen Programm (screen, minicom, …) benutzt? Für Konsolenkabel /dev/cu.* statt /dev/tty.* verwenden.\x1b[0m\r\n`);
        this.closed = true;
        emit('exit', { code: 1, message: err.message });
        return;
      }
      emit('data', `\x1b[90mGeöffnet. (Break über das Pane-Menü)\x1b[0m\r\n`);
      emit('status', { connected: true });
      if (cfg.wakeup) this.port.write(this.enter);
    });
    this.port.on('data', (buf) => {
      const s = this.decoder.write(buf);
      if (s) emit('data', this.cfg.addCrToLf ? s.replace(/(?<!\r)\n/g, '\r\n') : s);
    });
    this.port.on('error', (e) => emit('data', `\r\n\x1b[31mFehler: ${e.message}\x1b[0m\r\n`));
    this.port.on('close', (e) => {
      if (this.closed) return;
      this.closed = true;
      emit('exit', { code: e && e.disconnected ? 1 : 0, message: e && e.disconnected ? 'Gerät getrennt' : 'Port geschlossen' });
    });
  }

  write(str) {
    if (this.closed || !this.port.isOpen) return;
    const s = str.replace(/\r/g, this.enter);
    this.port.write(Buffer.from(s, this.cfg.encoding === 'latin1' ? 'latin1' : 'utf8'));
    if (this.cfg.localEcho) this.emit('data', str.replace(/\r/g, '\r\n'));
  }

  resize() { /* serielle Leitungen kennen keine Fenstergröße */ }

  action(a) {
    if (!this.port || !this.port.isOpen) return false;
    if (a === 'break') {
      // Break-Signal ~ 500 ms (z.B. Cisco ROMMON / Passwort-Recovery)
      this.port.set({ brk: true }, () => setTimeout(() => this.port.set({ brk: false }, () => {}), 500));
      this.emit('data', '\x1b[90m[Break gesendet]\x1b[0m');
      return true;
    }
    if (a === 'dtr') { this.dtr = !this.dtr; this.port.set({ dtr: this.dtr }, () => {}); return this.dtr; }
    if (a === 'rts') { this.rts = !this.rts; this.port.set({ rts: this.rts }, () => {}); return this.rts; }
    return false;
  }

  kill() {
    if (this.closed) return;
    this.closed = true;
    try { if (this.port.isOpen) this.port.close(() => {}); } catch (_) {}
  }
}

module.exports = { SerialSession };
