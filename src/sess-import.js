'use strict';
const crypto = require('node:crypto');
const IMPORT_FOLDER = 'moba_import';
const types = { 0: 'ssh', 1: 'telnet', 4: 'rdp', 8: 'serial' };
const ports = { ssh: 22, telnet: 23, rdp: 3389 };

function sections(text) {
  if (typeof text !== 'string' || text.includes('\0') || /^\s*(Windows Registry Editor|REGEDIT4)/i.test(text)) return [];
  const out = []; let cur;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const sec = raw.trim().match(/^\[(.+)\]$/);
    if (sec) { cur = { name: sec[1].toLowerCase(), rows: [] }; out.push(cur); continue; }
    if (!cur || /^\s*[;#]/.test(raw)) continue;
    const i = raw.indexOf('=');
    if (i > 0) cur.rows.push([raw.slice(0, i).trim(), raw.slice(i + 1).trim()]);
  }
  return out;
}

const unescapeField = s => String(s || '').replace(/__(PTVIRG|DBLQUO|PIPE|DIEZE|PERCENT)__/g,
  (_, k) => ({ PTVIRG: ';', DBLQUO: '"', PIPE: '|', DIEZE: '#', PERCENT: '%' })[k]);
const clean = s => unescapeField(s).trim();

function readBookmark(name, value, folder) {
  const [, icon, fields] = value.split('#', 3);
  if (!/^\d+$/.test(icon || '') || !/^\d+%/.test(fields || '') || !name || /\p{Cc}/u.test(name)) return null;
  const f = fields.split('%');
  const type = types[f[0]];
  if (!type) return false;
  const s = { name, folder, type };
  if (type === 'serial') {
    const device = f.slice(1, 8).map(clean).find(v => /^(COM\d+|\/dev\/[\w./-]+)$/i.test(v));
    if (!device) return null;
    s.path = device;
    const bauds = new Set([110, 300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 76800, 115200, 128000, 230400, 250000, 256000, 460800, 500000, 576000, 921600, 1000000, 1500000, 2000000, 3000000]);
    s.baudRate = f.slice(1, 8).map(Number).find(n => bauds.has(n)) || 9600;
  } else {
    s.host = clean(f[1]);
    s.port = f[2] ? Number(f[2]) : ports[type];
    if (!/^[\p{L}\p{N}_.:%[\]-]+$/u.test(s.host) || s.host.startsWith('-') ||
        !Number.isInteger(s.port) || s.port < 1 || s.port > 65535) return null;
    const user = clean(f[3]);
    const named = user.match(/^\[(.+)\]$/u);
    if (named) s.credential = named[1];
    else if (user && user !== '<default>' && !setUser(s, user)) return null;
  }
  return s;
}

function setUser(s, user) {
  if (!user || /[\p{Cc}@]/u.test(user) || user.startsWith('-')) return false;
  const slash = s.type === 'rdp' ? user.indexOf('\\') : -1;
  if (slash >= 0) {
    if (!slash || slash === user.length - 1) return false;
    s.domain = user.slice(0, slash); s.username = user.slice(slash + 1);
  } else s.username = user;
  return true;
}

function aesBlockCipher(key) {
  const cipher = crypto.createCipheriv('aes-256-ecb', key, null);
  cipher.setAutoPadding(false);
  return cipher;
}

function decryptCfb8(key, iv, body) {
  // Electron/BoringSSL exposes AES blocks but does not expose CFB with 8-bit feedback.
  const cipher = aesBlockCipher(key);
  const feedback = Buffer.from(iv);
  const plain = Buffer.alloc(body.length);
  try {
    for (let i = 0; i < body.length; i++) {
      const block = cipher.update(feedback);
      plain[i] = body[i] ^ block[0];
      block.fill(0);
      feedback.copyWithin(0, 1);
      feedback[15] = body[i];
    }
    cipher.final();
    return plain;
  } catch (e) { plain.fill(0); throw e; }
  finally { feedback.fill(0); }
}

function decodeSecret(key, value) {
  let output;
  try {
    if (value.length > 16384) return null;
    const base64 = value.replace(/@/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '')) return null;
    let iv, body;
    if (value.startsWith('_@')) {
      if (bytes.length <= 15) return null;
      iv = Buffer.from(value.slice(2, 18), 'ascii');
      body = bytes.subarray(15);
    } else {
      const cipher = aesBlockCipher(key);
      iv = Buffer.concat([cipher.update(Buffer.alloc(16)), cipher.final()]);
      body = bytes;
    }
    output = decryptCfb8(key, iv, body);
    // Dieses Exportformat authentifiziert den Klartext nicht.
    const secret = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(output);
    return secret && !/\p{Cc}/u.test(secret) ? secret : null;
  } catch (_) { return null; }
  finally { if (output) output.fill(0); }
}

function analyze(text, master = '') {
  const ini = sections(text);
  const bookmarks = ini.filter(s => /^bookmarks(?:_\d+)?$/.test(s.name));
  const passwords = ini.filter(s => s.name === 'passwords' || s.name === 'credentials').flatMap(s => s.rows.map(row => [s.name, ...row]));
  const sessions = [];
  let skipped = 0;
  for (const { rows } of bookmarks) {
    const sub = rows.find(([key]) => /^subrep$/i.test(key))?.[1] || '';
    const folder = [IMPORT_FOLDER, ...sub.split(/[\\/]/).map(clean).filter(v => v && v !== '.' && v !== '..' && !/\p{Cc}/u.test(v))].join('/');
    for (const [name, value] of rows) {
      if (/^(subrep|imgnum)$/i.test(name)) continue;
      const session = readBookmark(name, value, folder);
      if (session) sessions.push(session); else skipped++;
    }
  }
  const result = { recognized: bookmarks.length > 0, sessions, skipped, encrypted: passwords.length, unmatched: 0, failed: false };
  const direct = new Map(), named = new Map(), matched = new Set();
  if (master && passwords.length) {
    const key = crypto.createHash('sha512').update(master, 'utf8').digest();
    try {
      for (const [kind, id, value] of passwords) {
        let body = value, user = '';
        if (kind === 'credentials') {
          const i = value.indexOf(':');
          if (i < 1) { result.failed = true; break; }
          user = value.slice(0, i); body = value.slice(i + 1);
        }
        const password = decodeSecret(key.subarray(0, 32), body);
        if (password === null) { result.failed = true; break; }
        if (kind === 'credentials') {
          if (named.has(id)) { result.failed = true; break; }
          named.set(id, { user, password });
        } else {
          const m = id.match(/^(?:([a-z]+)(\d*):)?(.+)@([^@]+)$/i);
          if (!m) continue;
          const host = m[4].toLowerCase();
          if (!direct.has(host)) direct.set(host, []);
          direct.get(host).push({ proto: (m[1] || '').toLowerCase(), port: Number(m[2]), user: m[3], password });
        }
      }
    } finally { key.fill(0); }
  }
  const endpoints = new Map();
  for (const s of sessions) {
    if (!s.host) continue;
    const host = s.host.toLowerCase();
    if (!endpoints.has(host)) endpoints.set(host, new Set());
    endpoints.get(host).add(JSON.stringify([s.type, s.port, s.domain, s.username, s.credential]));
  }
  for (const s of sessions) {
    if (s.host && !result.failed) {
      if (s.credential) {
        const entry = named.get(s.credential);
        if (entry && setUser(s, entry.user)) { s.password = entry.password; matched.add(entry); }
      } else if (s.username) {
        const host = s.host.toLowerCase();
        const user = s.domain ? `${s.domain}\\${s.username}` : s.username;
        const entries = (direct.get(host) || []).filter(e => e.user === user && (!e.proto || e.proto === s.type) &&
          (!e.port || e.port === s.port) && ((e.proto && e.port) || endpoints.get(host).size === 1));
        if (entries.length === 1) { s.password = entries[0].password; matched.add(entries[0]); }
      }
    }
    delete s.credential;
    if (s.type === 'telnet' && (s.username || s.password)) s.autoLogin = true;
  }
  result.unmatched = master && !result.failed ? passwords.length - matched.size : 0;
  return result;
}

function newSessions(sessions, existing) {
  const key = s => JSON.stringify([s.folder || '', s.name || '', s.type, String(s.host || s.path || '').toLowerCase(), Number(s.port) || 0]);
  const seen = new Set(existing.map(key));
  return sessions.filter(s => { const k = key(s); if (seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { IMPORT_FOLDER, analyze, newSessions };
