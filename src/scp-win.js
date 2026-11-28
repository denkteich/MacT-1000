'use strict';
/**
 * Datei-Browser für SSH-Sessions unter Windows – per SCP (statt SFTP).
 *
 * Windows-OpenSSH kennt kein ControlMaster; deshalb baut MacT-1000 die
 * Verbindung selbst auf (ssh2, Anmeldung wie in sftp.js: Agent, Schlüssel,
 * Passwort, Keyboard-Interactive, Jump-Host, known_hosts).
 *
 * - Verzeichnisse auflisten, anlegen, umbenennen, löschen: Shell-Befehle über
 *   einen exec-Kanal (wie der Mac-Datei-Browser)
 * - Übertragung: klassisches SCP-Protokoll („scp -t“ / „scp -f“ auf dem Server),
 *   funktioniert auch ohne SFTP-Subsystem
 */
const fs = require('fs');
const path = require('path');
const { SftpTransfer, fmtSize, fmtEta } = require('./sftp');
const { parseLs, shq } = require('./scp');
const { expandHome } = require('./ssh-args');

const rbase = (p) => p.replace(/\/+$/, '').split('/').pop();

/** gepufferter Leser für einen ssh2-Kanal */
class ChanReader {
  constructor(ch) {
    this.buf = Buffer.alloc(0);
    this.ended = false;
    this.wake = null;
    ch.on('data', (d) => { this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d; this._wake(); });
    const end = () => { this.ended = true; this._wake(); };
    ch.on('end', end); ch.on('close', end);
  }
  _wake() { const w = this.wake; this.wake = null; if (w) w(); }
  async _wait() { if (this.ended) throw new Error('Verbindung unterbrochen'); await new Promise(r => { this.wake = r; }); }
  async byte() {
    while (!this.buf.length) await this._wait();
    const b = this.buf[0]; this.buf = this.buf.subarray(1); return b;
  }
  async line() {
    for (;;) {
      const i = this.buf.indexOf(10);
      if (i >= 0) { const l = this.buf.subarray(0, i).toString('utf8'); this.buf = this.buf.subarray(i + 1); return l; }
      await this._wait();
    }
  }
  /** bis zu max Bytes (mindestens 1) */
  async chunk(max) {
    while (!this.buf.length) await this._wait();
    const n = Math.min(max, this.buf.length);
    const c = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return c;
  }
}

class ScpTransfer extends SftpTransfer {
  constructor(ask, emit) {
    super(ask, emit);
    this.mode = 'scp';
    this.useSftp = false;
  }

  /** Befehl auf dem Server ausführen, Ausgabe sammeln */
  async run(cfg, cmd) {
    const client = await this.get(cfg);
    return new Promise((resolve, reject) => {
      client.exec(cmd, (err, ch) => {
        if (err) return reject(new Error('Befehl konnte nicht gestartet werden: ' + err.message));
        const out = []; const errb = []; let code = null;
        ch.on('data', d => out.push(d));
        ch.stderr.on('data', d => errb.push(d));
        ch.on('exit', (c) => { code = c; });
        ch.on('close', () => resolve({ code: code === null ? 0 : code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(errb).toString('utf8') }));
      });
    });
  }
  exec(cfg, script, args = []) { return this.run(cfg, `sh -c ${shq(script)} sh ${args.map(shq).join(' ')}`); }

  /** SFTP-Kanal auf derselben Verbindung – nur als Rückfall, wenn der Server keine Shell anbietet */
  async _sftp(cfg) {
    const client = await this.get(cfg);
    const c = this.conns.get(this.key(cfg));
    if (c && c.sftp) return c.sftp;
    const sftp = await new Promise((res, rej) => client.sftp((e, s) => (e ? rej(e) : res(s))));
    if (c) c.sftp = sftp;
    return sftp;
  }

  async list(cfg, dir) {
    const r = await this._listShell(cfg, dir);
    if (r.ok) return r.value;
    if (/nicht lesbar/.test(r.error.message)) throw r.error;
    // Server ohne Shell (z.B. reiner SFTP/SCP-Server): Verzeichnis per SFTP lesen, Übertragung bleibt SCP
    try { return await super.list(cfg, dir); } catch (_) { throw r.error; }
  }
  async _listShell(cfg, dir) {
    const script = 'if [ -n "$1" ]; then cd -- "$1" || exit 3; else cd; fi; pwd; echo "@@MACT@@"; LC_ALL=C ls -laL 2>/dev/null; exit 0';
    const r = await this.exec(cfg, script, [dir || '']);
    if (r.code !== 0) {
      const err = r.stderr.trim().split('\n').pop() || `Fehler (Code ${r.code})`;
      if (r.code === 3) return { ok: false, error: new Error(`Verzeichnis nicht lesbar: ${dir}`) };
      return { ok: false, error: new Error(err) };
    }
    const [head, rest = ''] = r.stdout.split('@@MACT@@');
    const cwd = head.trim().split('\n').pop().trim() || '/';
    return { ok: true, value: { cwd, entries: parseLs(rest) } };
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
    if (r.code !== 0 && !r.stdout && /SFTP und SCP|not allowed|nicht erlaubt|shell/i.test(r.stderr)) return super.op(cfg, name, args);
    if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || `Fehler (Code ${r.code})`);
    return true;
  }

  _channel(client, cmd) {
    return new Promise((resolve, reject) => client.exec(cmd, (err, ch) => (err ? reject(new Error('scp konnte nicht gestartet werden: ' + err.message)) : resolve(ch))));
  }

  async transfer(jobId, cfg, { direction, sources, dest }) {
    const job = { id: jobId, canceled: false, streams: null, ch: null };
    this.jobs.set(jobId, job);
    const ev = (type, extra) => this.emit('fx:job', { id: jobId, type, ...extra });
    const st = { files: 0, stderr: '' };
    try {
      const client = await this.get(cfg);
      if (job.canceled) throw new Error('Abgebrochen');
      const cmd = direction === 'upload'
        ? `scp -r -p -t ${shq(dest.replace(/\/+$/, '') || '/')}`
        : `scp -r -p -f ${sources.map(shq).join(' ')}`;
      ev('start', { cmd: `scp ${direction === 'upload' ? 'hochladen' : 'herunterladen'}: ${sources.length} Element(e) → ${dest}` });
      const ch = await this._channel(client, cmd);
      job.ch = ch;
      ch.stderr.on('data', d => { st.stderr += d.toString('utf8'); });
      const rd = new ChanReader(ch);
      if (direction === 'upload') await this._upload(job, ch, rd, sources.map(expandHome), ev, st);
      else {
        const d = expandHome(dest);
        fs.mkdirSync(d, { recursive: true });
        await this._download(job, ch, rd, d, ev, st);
      }
      try { ch.end(); } catch (_) {}
      this.jobs.delete(jobId);
      ev('done', { ok: true, files: st.files });
    } catch (e) {
      this.jobs.delete(jobId);
      if (job.ch) try { job.ch.close(); } catch (_) {}
      let msg = job.canceled ? 'Abgebrochen' : String(e && e.message || e);
      const se = st.stderr.trim().split('\n').pop();
      if (!job.canceled && se && /unterbrochen/.test(msg)) msg = se.replace(/^scp:\s*/, '');
      if (!job.canceled && /not found|nicht gefunden/i.test(msg)) msg = 'Auf dem Server ist kein scp vorhanden: ' + msg;
      ev('done', { ok: false, error: msg });
    }
  }

  // ----- SCP-Protokoll -----
  async _ack(rd) {
    const b = await rd.byte();
    if (b === 0) return;
    const msg = (await rd.line()).trim();
    throw new Error((msg || 'scp-Fehler').replace(/^scp:\s*/, ''));
  }
  _send(ch, data) {
    return new Promise((resolve) => { if (ch.write(data)) resolve(); else ch.once('drain', resolve); });
  }
  _progress(ev, st, name, size) {
    const t0 = Date.now(); let last = 0;
    return (done, final) => {
      const now = Date.now();
      if (!final && now - last < 150) return;
      last = now;
      const secs = Math.max((now - t0) / 1000, 0.001);
      const rate = done / secs;
      ev('progress', { file: name, percent: size ? Math.min(100, Math.floor(done * 100 / size)) : 100, size: fmtSize(done), speed: fmtSize(Math.round(rate)) + '/s', eta: fmtEta((size - done) / (rate || 1)), files: st.files + 1 });
    };
  }

  async _upload(job, ch, rd, sources, ev, st) {
    await this._ack(rd);
    const sendItem = async (src) => {
      if (job.canceled) throw new Error('Abgebrochen');
      const s = fs.statSync(src);
      const name = path.basename(src).replace(/[\r\n]/g, '_');
      const mt = Math.floor(s.mtimeMs / 1000); const at = Math.floor(s.atimeMs / 1000);
      await this._send(ch, `T${mt} 0 ${at} 0\n`); await this._ack(rd);
      if (s.isDirectory()) {
        await this._send(ch, `D0755 0 ${name}\n`); await this._ack(rd);
        for (const n of fs.readdirSync(src)) await sendItem(path.join(src, n));
        await this._send(ch, 'E\n'); await this._ack(rd);
        return;
      }
      if (!s.isFile()) return;
      const mode = ((s.mode & 0o777) || 0o644) | 0o600;
      await this._send(ch, `C0${mode.toString(8).padStart(3, '0')} ${s.size} ${name}\n`); await this._ack(rd);
      const prog = this._progress(ev, st, name, s.size);
      prog(0, true);
      let done = 0;
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(src, { highWaterMark: 64 * 1024 });
        job.streams = [rs];
        rs.on('data', (b) => {
          done += b.length; prog(done, false);
          if (!ch.write(b)) { rs.pause(); ch.once('drain', () => rs.resume()); }
        });
        rs.on('error', reject);
        rs.on('close', () => (job.canceled ? reject(new Error('Abgebrochen')) : resolve()));
      });
      job.streams = null;
      await this._send(ch, Buffer.from([0]));
      await this._ack(rd);
      prog(s.size, true);
      st.files++;
    };
    for (const s of sources) await sendItem(s);
  }

  async _download(job, ch, rd, destDir, ev, st) {
    const stack = [destDir];
    const dirTimes = [];
    let times = null;
    await this._send(ch, Buffer.from([0]));
    for (;;) {
      if (job.canceled) throw new Error('Abgebrochen');
      let b;
      try { b = await rd.byte(); } catch (_) { break; } // Kanal zu = fertig
      if (b === 1 || b === 2) {
        const msg = (await rd.line()).trim().replace(/^scp:\s*/, '');
        throw new Error(msg || 'scp-Fehler');
      }
      const line = String.fromCharCode(b) + await rd.line();
      const kind = line[0];
      if (kind === 'T') {
        const m = line.match(/^T(\d+) \d+ (\d+) \d+/);
        times = m ? { mtime: Number(m[1]), atime: Number(m[2]) } : null;
        await this._send(ch, Buffer.from([0]));
      } else if (kind === 'D') {
        const m = line.match(/^D([0-7]+) \d+ (.+)$/);
        if (!m) throw new Error('Unerwartete Antwort: ' + line);
        const dir = path.join(stack[stack.length - 1], safeName(m[2]));
        fs.mkdirSync(dir, { recursive: true });
        stack.push(dir); dirTimes.push(times); times = null;
        await this._send(ch, Buffer.from([0]));
      } else if (kind === 'E') {
        const dir = stack.pop(); const t = dirTimes.pop();
        if (t) try { fs.utimesSync(dir, t.atime, t.mtime); } catch (_) {}
        await this._send(ch, Buffer.from([0]));
      } else if (kind === 'C') {
        const m = line.match(/^C([0-7]+) (\d+) (.+)$/);
        if (!m) throw new Error('Unerwartete Antwort: ' + line);
        const size = Number(m[2]); const name = safeName(m[3]);
        const file = path.join(stack[stack.length - 1], name);
        await this._send(ch, Buffer.from([0]));
        const ws = fs.createWriteStream(file, { mode: parseInt(m[1], 8) | 0o600 });
        job.streams = [ws];
        const prog = this._progress(ev, st, name, size);
        prog(0, true);
        let got = 0;
        while (got < size) {
          if (job.canceled) { ws.destroy(); throw new Error('Abgebrochen'); }
          const c = await rd.chunk(size - got);
          got += c.length;
          if (!ws.write(c)) await new Promise(r => ws.once('drain', r));
          prog(got, false);
        }
        await new Promise((resolve, reject) => { ws.end(resolve); ws.on('error', reject); });
        job.streams = null;
        await this._ack(rd);
        if (times) try { fs.utimesSync(file, times.atime, times.mtime); } catch (_) {}
        times = null;
        prog(size, true);
        st.files++;
        await this._send(ch, Buffer.from([0]));
      } else {
        throw new Error('Unerwartete Antwort: ' + line.slice(0, 80));
      }
    }
    if (st.stderr.trim() && !st.files) throw new Error(st.stderr.trim().split('\n').pop().replace(/^scp:\s*/, ''));
  }

  cancel(jobId) {
    const j = this.jobs.get(jobId);
    if (!j) return;
    j.canceled = true;
    if (j.streams) for (const s of j.streams) try { s.destroy(new Error('Abgebrochen')); } catch (_) {}
    if (j.ch) try { j.ch.close(); } catch (_) {}
  }
}

/** Dateinamen vom Server nicht aus dem Zielordner ausbrechen lassen */
function safeName(n) {
  const s = String(n).replace(/[\\/]/g, '_').replace(/[<>:"|?*\x00-\x1f]/g, '_');
  return s === '.' || s === '..' || !s ? '_' : s;
}

module.exports = { ScpTransfer, ChanReader, safeName };
