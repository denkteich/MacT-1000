'use strict';
const net = require('net');

// Telnet-Protokollkonstanten (RFC 854 ff.)
const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
const GA = 249, EL = 248, EC = 247, AYT = 246, AO = 245, IP = 244, BRK = 243, NOP = 241;
const OPT_BINARY = 0, OPT_ECHO = 1, OPT_SGA = 3, OPT_TTYPE = 24, OPT_NAWS = 31, OPT_NEW_ENVIRON = 39;
const TTYPE_IS = 0, TTYPE_SEND = 1;

/**
 * Minimaler, aber vollständiger Telnet-Client mit Optionsverhandlung:
 * ECHO, SGA, TTYPE (xterm-256color), NAWS (Fenstergröße), BINARY.
 */
class TelnetParser {
  constructor() { this.state = 'data'; this.cmd = 0; this.sbOpt = 0; this.sbBuf = []; }
  /** liefert { data: Buffer, events: [...] } */
  feed(buf) {
    const out = []; const events = [];
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      switch (this.state) {
        case 'data':
          if (b === IAC) this.state = 'iac'; else out.push(b);
          break;
        case 'iac':
          if (b === IAC) { out.push(IAC); this.state = 'data'; }
          else if (b === DO || b === DONT || b === WILL || b === WONT) { this.cmd = b; this.state = 'opt'; }
          else if (b === SB) { this.state = 'sbopt'; }
          else { this.state = 'data'; /* NOP, GA, etc. ignorieren */ }
          break;
        case 'opt':
          events.push({ type: 'neg', cmd: this.cmd, opt: b });
          this.state = 'data';
          break;
        case 'sbopt':
          this.sbOpt = b; this.sbBuf = []; this.state = 'sb';
          break;
        case 'sb':
          if (b === IAC) this.state = 'sbiac'; else this.sbBuf.push(b);
          break;
        case 'sbiac':
          if (b === SE) { events.push({ type: 'sb', opt: this.sbOpt, data: Buffer.from(this.sbBuf) }); this.state = 'data'; }
          else if (b === IAC) { this.sbBuf.push(IAC); this.state = 'sb'; }
          else { this.state = 'sb'; }
          break;
      }
    }
    return { data: Buffer.from(out), events };
  }
}

class TelnetSession {
  constructor(cfg, opts, emit) {
    this.emit = emit;
    this.cfg = cfg;
    this.cols = opts.cols || 80;
    this.rows = opts.rows || 24;
    this.parser = new TelnetParser();
    this.nawsEnabled = false;
    this.remoteEcho = false;
    this.binary = false;
    this.closed = false;
    this.enter = { cr: '\r\0', crlf: '\r\n', lf: '\n' }[cfg.enterMode || 'crlf'] || '\r\n';
    this.decoder = new (require('string_decoder').StringDecoder)(cfg.encoding === 'latin1' ? 'latin1' : 'utf8');

    const host = cfg.host; const port = Number(cfg.port) || 23;
    emit('data', `\x1b[90mVerbinde mit ${host}:${port} (Telnet)…\x1b[0m\r\n`);
    this.sock = net.createConnection({ host, port });
    this.sock.setNoDelay(true);
    this.sock.setTimeout(Number(cfg.connectTimeout || 15) * 1000);
    this.sock.on('connect', () => {
      this.sock.setTimeout(0);
      if (cfg.keepAlive !== false) this.sock.setKeepAlive(true, 30000);
      emit('data', `\x1b[90mVerbunden.\x1b[0m\r\n`);
      if (!cfg.rawMode) {
        // proaktiv anbieten: Terminaltyp und Fenstergröße
        this.sendRaw([IAC, WILL, OPT_TTYPE, IAC, WILL, OPT_NAWS, IAC, DO, OPT_SGA]);
      }
      if (cfg.username && cfg.autoLogin) this.autoLoginStep = 'user';
    });
    this.sock.on('timeout', () => { emit('data', '\r\n\x1b[31mZeitüberschreitung beim Verbinden.\x1b[0m\r\n'); this.sock.destroy(); });
    this.sock.on('data', (buf) => this.onSocketData(buf));
    this.sock.on('error', (e) => emit('data', `\r\n\x1b[31mFehler: ${e.message}\x1b[0m\r\n`));
    this.sock.on('close', () => {
      if (this.closed) return;
      this.closed = true;
      emit('exit', { code: 0, message: 'Verbindung geschlossen' });
    });
  }

  sendRaw(arr) { if (!this.closed && this.sock.writable) this.sock.write(Buffer.from(arr)); }

  onSocketData(buf) {
    if (this.cfg.rawMode) { this.emitText(buf); return; }
    const { data, events } = this.parser.feed(buf);
    for (const ev of events) this.handleEvent(ev);
    if (data.length) this.emitText(data);
  }

  emitText(buf) {
    const s = this.decoder.write(buf);
    if (s) {
      this.emit('data', s);
      this.autoLogin(s);
    }
  }

  autoLogin(s) {
    if (!this.autoLoginStep) return;
    this.autoBuf = ((this.autoBuf || '') + s).slice(-200);
    if (this.autoLoginStep === 'user' && /(login|username|user name)\s*:\s*$/i.test(this.autoBuf)) {
      this.write(this.cfg.username + '\r'); this.autoLoginStep = this.cfg.password ? 'pass' : null; this.autoBuf = '';
    } else if (this.autoLoginStep === 'pass' && /password\s*:\s*$/i.test(this.autoBuf)) {
      this.write(this.cfg.password + '\r'); this.autoLoginStep = null; this.autoBuf = '';
    }
  }

  handleEvent(ev) {
    if (ev.type === 'neg') {
      const { cmd, opt } = ev;
      if (cmd === DO) {
        if (opt === OPT_TTYPE) this.sendRaw([IAC, WILL, OPT_TTYPE]);
        else if (opt === OPT_NAWS) { this.sendRaw([IAC, WILL, OPT_NAWS]); this.nawsEnabled = true; this.sendNaws(); }
        else if (opt === OPT_SGA) this.sendRaw([IAC, WILL, OPT_SGA]);
        else if (opt === OPT_BINARY) { this.sendRaw([IAC, WILL, OPT_BINARY]); this.binary = true; }
        else this.sendRaw([IAC, WONT, opt]);
      } else if (cmd === DONT) {
        if (opt === OPT_NAWS) this.nawsEnabled = false;
        this.sendRaw([IAC, WONT, opt]);
      } else if (cmd === WILL) {
        if (opt === OPT_ECHO) { this.remoteEcho = true; this.sendRaw([IAC, DO, OPT_ECHO]); }
        else if (opt === OPT_SGA) this.sendRaw([IAC, DO, OPT_SGA]);
        else if (opt === OPT_BINARY) this.sendRaw([IAC, DO, OPT_BINARY]);
        else this.sendRaw([IAC, DONT, opt]);
      } else if (cmd === WONT) {
        if (opt === OPT_ECHO) this.remoteEcho = false;
        this.sendRaw([IAC, DONT, opt]);
      }
    } else if (ev.type === 'sb') {
      if (ev.opt === OPT_TTYPE && ev.data[0] === TTYPE_SEND) {
        const tt = Buffer.from((this.cfg.termType || 'XTERM-256COLOR').toUpperCase(), 'ascii');
        this.sendRaw([IAC, SB, OPT_TTYPE, TTYPE_IS, ...tt, IAC, SE]);
      }
    }
  }

  sendNaws() {
    if (!this.nawsEnabled) return;
    const w = this.cols, h = this.rows;
    const bytes = [(w >> 8) & 0xff, w & 0xff, (h >> 8) & 0xff, h & 0xff];
    const esc = [];
    for (const b of bytes) { esc.push(b); if (b === IAC) esc.push(IAC); }
    this.sendRaw([IAC, SB, OPT_NAWS, ...esc, IAC, SE]);
  }

  write(str) {
    if (this.closed || !this.sock.writable) return;
    let s = str;
    if (!this.cfg.rawMode) s = s.replace(/\r(?!\n)/g, this.enter);
    let buf = Buffer.from(s, this.cfg.encoding === 'latin1' ? 'latin1' : 'utf8');
    if (!this.cfg.rawMode && buf.includes(IAC)) {
      const out = [];
      for (const b of buf) { out.push(b); if (b === IAC) out.push(IAC); }
      buf = Buffer.from(out);
    }
    this.sock.write(buf);
    if (this.cfg.localEcho === true || (this.cfg.localEcho === 'auto' && !this.remoteEcho)) {
      this.emit('data', str.replace(/\r(?!\n)/g, '\r\n'));
    }
  }

  resize(c, r) { this.cols = c; this.rows = r; this.sendNaws(); }

  action(a) {
    if (a === 'break') this.sendRaw([IAC, BRK]);
    else if (a === 'ayt') this.sendRaw([IAC, AYT]);
    else if (a === 'ip') this.sendRaw([IAC, IP]);
    return true;
  }

  kill() {
    if (this.closed) return;
    this.closed = true;
    try { this.sock.destroy(); } catch (_) {}
  }
}

module.exports = { TelnetSession, TelnetParser, consts: { IAC, DO, DONT, WILL, WONT, SB, SE, OPT_TTYPE, OPT_NAWS, OPT_ECHO, OPT_SGA } };
