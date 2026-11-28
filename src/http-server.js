'use strict';
/**
 * HTTP-Dateiserver: Download (GET/HEAD, Range für Fortsetzen), Verzeichnisliste im Browser,
 * optional Upload (PUT, POST mit Rohdaten, Upload-Feld in der Liste) und Löschen (DELETE),
 * optional Anmeldung per HTTP-Basic-Auth.
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream');
const { Jail, BaseServer, bindError, checkPort, checkRoot, safeEqual, tmpName, peerOf, fsError } = require('./srv-common');

const MIME = {
  '.txt': 'text/plain; charset=utf-8', '.cfg': 'text/plain; charset=utf-8', '.conf': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml',
  '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip', '.tar': 'application/x-tar', '.iso': 'application/x-iso9660-image'
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
const encPath = (v) => v.split('/').map(encodeURIComponent).join('/');

class HttpFileServer extends BaseServer {
  constructor() { super('http'); this.server = null; this.defaultPort = 8080; this.sockets = new Set(); }
  get running() { return !!this.server; }

  async start({ root, port = 8080, host = '0.0.0.0', allowWrite = false, overwrite = false, allowDelete = false, listing = true, user = '', password = '' } = {}) {
    await this.stop();
    const r = await checkRoot(root);
    port = checkPort(port);
    host = String(host || '0.0.0.0').trim() || '0.0.0.0';
    if (user && !password) throw new Error('Für die Anmeldung bitte auch ein Passwort angeben');
    this.rootDir = r.root; this.jail = new Jail(r.root, r.real);
    this.opts = { port, host, allowWrite: !!allowWrite, overwrite: !!allowWrite && !!overwrite, allowDelete: !!allowDelete, listing: listing !== false, user: user || '', password: password || '' };
    const srv = http.createServer((req, res) => this.handle(req, res).catch((e) => this.send(res, 500, fsError(e))));
    srv.on('connection', (s) => { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); });
    srv.requestTimeout = 0; // große Uploads
    try { await new Promise((res, rej) => { srv.once('error', rej); srv.listen(port, host, () => { srv.removeListener('error', rej); res(); }); }); }
    catch (e) { try { srv.close(); } catch (_) {} throw bindError(e, port, host, 'HTTP'); }
    srv.on('error', (e) => this.emit('status', { ...this.status(), error: e.message }));
    this.server = srv;
    this.emit('status', this.status());
    return this.status();
  }

  async stop() {
    if (this.server) {
      const s = this.server; this.server = null;
      for (const t of [...this.active]) { t.state = 'error'; t.error = 'Server gestoppt'; t.ended = Date.now(); this.emit('transfer', { ...t }); }
      this.active.clear();
      for (const so of this.sockets) so.destroy();
      await new Promise(r => s.close(() => r()));
      this.emit('status', this.status());
    }
    return this.status();
  }

  status() { return { ...this.baseStatus(), listing: this.opts ? this.opts.listing : true, auth: !!(this.opts && this.opts.user) }; }

  send(res, code, text, headers = {}) {
    if (res.headersSent) { try { res.destroy(); } catch (_) {} return; }
    const body = Buffer.from(String(text || '') + '\n', 'utf8');
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(res.req && res.req.method === 'HEAD' ? undefined : body);
  }

  authOk(req) {
    const o = this.opts;
    if (!o.user) return true;
    const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) return false;
    const dec = Buffer.from(m[1], 'base64').toString('utf8');
    const i = dec.indexOf(':');
    return i >= 0 && safeEqual(dec.slice(0, i), o.user) && safeEqual(dec.slice(i + 1), o.password);
  }

  async handle(req, res) {
    const o = this.opts;
    const peer = peerOf(req.socket);
    if (!this.authOk(req)) {
      if (req.headers.authorization) this.authFailed(peer, (Buffer.from(String(req.headers.authorization).replace(/^Basic\s+/i, ''), 'base64').toString('utf8').split(':')[0]) || '');
      req.resume();
      return this.send(res, 401, 'Anmeldung erforderlich', { 'WWW-Authenticate': 'Basic realm="MacT-1000", charset="UTF-8"' });
    }
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (_) { req.resume(); return this.send(res, 400, 'Ungültige Adresse'); }
    const t = this.jail.resolve(urlPath, '/');
    try { await this.jail.safe(t.abs); } catch (_) { req.resume(); return this.send(res, 403, 'Zugriff verweigert'); }
    const m = req.method.toUpperCase();
    if (m === 'GET' || m === 'HEAD') return this.get(req, res, t, peer);
    if (m === 'PUT' || m === 'POST') return this.put(req, res, t, peer);
    if (m === 'DELETE') return this.del(req, res, t);
    if (m === 'OPTIONS') { req.resume(); res.writeHead(204, { Allow: this.allowed() }); return res.end(); }
    req.resume();
    return this.send(res, 405, 'Methode nicht erlaubt', { Allow: this.allowed() });
  }
  allowed() { const o = this.opts; return ['GET', 'HEAD', 'OPTIONS', ...(o.allowWrite ? ['PUT', 'POST'] : []), ...(o.allowDelete ? ['DELETE'] : [])].join(', '); }

  async get(req, res, t, peer) {
    let st;
    try { st = await fsp.stat(t.abs); } catch (_) { return this.send(res, 404, 'Nicht gefunden: ' + t.virt); }
    if (st.isDirectory()) {
      const pathname = new URL(req.url, 'http://x').pathname;
      if (!pathname.endsWith('/')) { res.writeHead(301, { Location: pathname + '/' }); return res.end(); }
      if (!this.opts.listing) {
        try { const idx = path.join(t.abs, 'index.html'); const s2 = await fsp.stat(idx); if (s2.isFile()) return this.sendFile(req, res, { ...t, abs: idx, virt: path.posix.join(t.virt, 'index.html') }, s2, peer); } catch (_) {}
        return this.send(res, 403, 'Verzeichnisliste ist abgeschaltet');
      }
      return this.listing(req, res, t);
    }
    if (!st.isFile()) return this.send(res, 403, 'Keine Datei');
    return this.sendFile(req, res, t, st, peer);
  }

  sendFile(req, res, t, st, peer) {
    const size = st.size;
    let start = 0, end = size - 1, code = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
    if (range && size > 0) {
      if (range[1] === '') { start = Math.max(0, size - Number(range[2])); } else { start = Number(range[1]); if (range[2] !== '') end = Math.min(size - 1, Number(range[2])); }
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      code = 206;
    }
    const len = size ? end - start + 1 : 0;
    const headers = { 'Content-Type': MIME[path.extname(t.abs).toLowerCase()] || 'application/octet-stream', 'Content-Length': len, 'Accept-Ranges': 'bytes',
      'Last-Modified': st.mtime.toUTCString(), 'X-Content-Type-Options': 'nosniff' };
    if (code === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    if (req.method === 'HEAD') { res.writeHead(code, headers); return res.end(); }
    res.writeHead(code, headers);
    if (!len) return res.end();
    const tr = this.transfer({ kind: 'get', peer, file: t.virt.slice(1), size: len, user: this.opts.user });
    const rs = fs.createReadStream(t.abs, { start, end });
    rs.on('data', (c) => tr.add(c.length));
    pipeline(rs, res, (e) => { if (e || tr.info.bytes < len) tr.fail(e ? (e.code === 'ERR_STREAM_PREMATURE_CLOSE' ? 'Verbindung vom Gerät abgebrochen' : fsError(e)) : 'abgebrochen'); else tr.done(); });
  }

  async listing(req, res, t) {
    const o = this.opts;
    let names = [];
    try { names = await fsp.readdir(t.abs); } catch (e) { return this.send(res, 500, fsError(e)); }
    const rows = [];
    for (const n of names.sort((a, b) => a.localeCompare(b, 'de'))) {
      try { const s = await fsp.stat(path.join(t.abs, n)); rows.push({ n, dir: s.isDirectory(), size: s.size, mtime: s.mtime }); } catch (_) {}
    }
    rows.sort((a, b) => (b.dir - a.dir) || a.n.localeCompare(b.n, 'de'));
    const nonce = crypto.randomBytes(12).toString('base64');
    const base = t.virt === '/' ? '/' : encPath(t.virt) + '/';
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MacT-1000 – ${esc(t.virt)}</title><style nonce="${nonce}">
body{font:14px -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;margin:0;background:#1b1d23;color:#d7dae0}
header{padding:14px 20px;background:#22252c;border-bottom:1px solid #3a3f4b}h1{font-size:16px;margin:0;font-weight:600}
h1 small{color:#8b93a1;font-weight:400;margin-left:8px}main{padding:10px 20px 30px}table{border-collapse:collapse;width:100%;max-width:1000px}
td,th{padding:6px 10px;text-align:left;border-bottom:1px solid #2a2e37}th{color:#8b93a1;font-weight:500;font-size:12px}
td.s,th.s{text-align:right;white-space:nowrap}td.d{color:#8b93a1;white-space:nowrap}a{color:#4f9cf9;text-decoration:none}a:hover{text-decoration:underline}
.up{margin:14px 0;padding:12px;border:1px dashed #3a3f4b;border-radius:8px;max-width:976px}.up.drag{border-color:#4f9cf9;background:#22252c}
#msg{color:#8b93a1;margin-left:10px}button,input[type=file]{font:inherit;color:inherit}</style></head><body>
<header><h1>MacT-1000 HTTP-Server <small>${esc(t.virt)}</small></h1></header><main>
${o.allowWrite ? `<div class="up" id="up">Dateien hierher ziehen oder <input type="file" id="f" multiple> <span id="msg"></span></div>` : ''}
<table><tr><th>Name</th><th class="s">Größe</th><th>Geändert</th></tr>
${t.virt !== '/' ? `<tr><td><a href="../">../ (übergeordneter Ordner)</a></td><td></td><td></td></tr>` : ''}
${rows.map(r => `<tr><td><a href="${base}${encodeURIComponent(r.n)}${r.dir ? '/' : ''}">${esc(r.n)}${r.dir ? '/' : ''}</a></td><td class="s">${r.dir ? '' : fmtSize(r.size)}</td><td class="d">${r.mtime.toLocaleString('de-DE')}</td></tr>`).join('\n')}
</table>${rows.length ? '' : '<p style="color:#8b93a1">Leeres Verzeichnis</p>'}</main>
${o.allowWrite ? `<script nonce="${nonce}">
const up=document.getElementById('up'),f=document.getElementById('f'),msg=document.getElementById('msg');
async function send(files){for(const x of files){msg.textContent='Lade '+x.name+' …';
const r=await fetch(location.pathname+encodeURIComponent(x.name),{method:'PUT',body:x});
if(!r.ok){msg.textContent=x.name+': '+(await r.text());return;}}msg.textContent='Fertig';setTimeout(()=>location.reload(),400);}
f.onchange=()=>send(f.files);up.ondragover=e=>{e.preventDefault();up.classList.add('drag')};up.ondragleave=()=>up.classList.remove('drag');
up.ondrop=e=>{e.preventDefault();up.classList.remove('drag');send(e.dataTransfer.files)};</script>` : ''}
</body></html>`;
    const body = Buffer.from(html, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'` });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async put(req, res, t, peer) {
    const o = this.opts;
    if (!o.allowWrite) { req.resume(); return this.send(res, 403, 'Hochladen ist auf diesem Server nicht erlaubt'); }
    if (/multipart\/form-data/i.test(req.headers['content-type'] || '')) { req.resume(); return this.send(res, 415, 'Bitte PUT oder Rohdaten senden (z. B. curl -T datei http://…/datei)'); }
    if (t.virt === '/' || urlEndsSlash(req.url)) { req.resume(); return this.send(res, 400, 'Bitte einen Dateinamen in der Adresse angeben'); }
    let exists = false;
    try { const st = await fsp.stat(t.abs); if (st.isDirectory()) { req.resume(); return this.send(res, 409, 'Ist ein Verzeichnis'); } exists = true; } catch (_) {}
    if (exists && !o.overwrite) { req.resume(); return this.send(res, 409, 'Datei existiert bereits (Überschreiben ist nicht erlaubt)'); }
    await fsp.mkdir(path.dirname(t.abs), { recursive: true });
    await this.jail.safe(path.dirname(t.abs));
    const tmp = tmpName(t.abs);
    const size = Number(req.headers['content-length']) || null;
    const tr = this.transfer({ kind: 'put', peer, file: t.virt.slice(1), size, user: o.user });
    const ws = fs.createWriteStream(tmp, { flags: 'wx' });
    req.on('data', (c) => tr.add(c.length));
    pipeline(req, ws, async (e) => {
      if (e || (size !== null && tr.info.bytes < size)) { tr.fail(e ? fsError(e) : 'Upload unvollständig'); fsp.unlink(tmp).catch(() => {}); if (!res.writableEnded) this.send(res, 500, 'Upload fehlgeschlagen'); return; }
      try { await fsp.rename(tmp, t.abs); tr.done(); this.send(res, exists ? 200 : 201, exists ? 'Überschrieben: ' + t.virt : 'Gespeichert: ' + t.virt); }
      catch (e2) { tr.fail(fsError(e2)); fsp.unlink(tmp).catch(() => {}); this.send(res, 500, fsError(e2)); }
    });
  }

  async del(req, res, t) {
    req.resume();
    if (!this.opts.allowDelete) return this.send(res, 403, 'Löschen ist auf diesem Server nicht erlaubt');
    try { const st = await fsp.stat(t.abs); if (st.isDirectory()) await fsp.rmdir(t.abs); else await fsp.unlink(t.abs); return this.send(res, 200, 'Gelöscht: ' + t.virt); }
    catch (e) { return this.send(res, e.code === 'ENOENT' ? 404 : 409, fsError(e)); }
  }
}
const urlEndsSlash = (u) => { try { return new URL(u, 'http://x').pathname.endsWith('/'); } catch (_) { return false; } };

module.exports = { HttpFileServer };
