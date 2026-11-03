'use strict';
/* Kleine DOM- und Hilfsfunktionen */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let _uid = 0;
const uid = (p = 'id') => `${p}${Date.now().toString(36)}${(++_uid).toString(36)}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

const TYPE_META = {
  local:  { label: 'Lokale Shell', icon: 'SH', color: '#7ec699' },
  ssh:    { label: 'SSH',          icon: 'SSH', color: '#6cb6ff' },
  telnet: { label: 'Telnet',       icon: 'TEL', color: '#f0b05a' },
  serial: { label: 'Seriell',      icon: 'COM', color: '#d38bff' },
  rdp:    { label: 'RDP',          icon: 'RDP', color: '#ff7b72' },
  command:{ label: 'Befehl',       icon: 'CMD', color: '#c9d1d9' }
};

function sessionSubtitle(c) {
  switch (c.type) {
    case 'ssh': return `${c.username ? c.username + '@' : ''}${c.host || ''}${c.port && c.port != 22 ? ':' + c.port : ''}`;
    case 'telnet': return `${c.host || ''}${c.port && c.port != 23 ? ':' + c.port : ''}`;
    case 'serial': return `${(c.path || '').replace('/dev/', '')} @ ${c.baudRate || 9600}`;
    case 'rdp': return `${c.username ? c.username + '@' : ''}${c.host || ''}`;
    case 'local': return c.shell || 'Standard-Shell';
    case 'command': return c.command || '';
    default: return '';
  }
}
function sessionTitle(c) {
  if (c.name) return c.name;
  if (c.type === 'local') return 'Lokal';
  return sessionSubtitle(c) || TYPE_META[c.type]?.label || 'Session';
}

/** Quick-Connect-Zeile in eine Session-Konfiguration übersetzen */
function parseQuick(str) {
  const s = str.trim();
  if (!s) return null;
  const parts = s.split(/\s+/);
  const kw = parts[0].toLowerCase();
  if (kw === 'local' || kw === 'shell' || kw === 'lokal') return { type: 'local' };
  if (kw === 'telnet') {
    const [host, port] = (parts[1] || '').includes(':') && !parts[2] ? parts[1].split(':') : [parts[1], parts[2]];
    return { type: 'telnet', host, port: Number(port) || 23 };
  }
  if (kw === 'rdp') {
    let target = parts[1] || ''; let username = '';
    if (target.includes('@')) [username, target] = target.split('@');
    const [host, port] = target.split(':');
    return { type: 'rdp', host, port: Number(port) || 3389, username };
  }
  if (kw === 'serial' || kw === 'seriell' || kw.startsWith('/dev/')) {
    const path = kw.startsWith('/dev/') ? parts[0] : parts[1];
    const baud = kw.startsWith('/dev/') ? parts[1] : parts[2];
    return { type: 'serial', path, baudRate: Number(baud) || 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' };
  }
  let rest = parts;
  if (kw === 'ssh') rest = parts.slice(1);
  // ssh [opts] [user@]host[:port]
  const cfg = { type: 'ssh', port: 22 };
  const extra = [];
  for (let i = 0; i < rest.length; i++) {
    const p = rest[i];
    if (p === '-p' && rest[i + 1]) { cfg.port = Number(rest[++i]); continue; }
    if (p === '-l' && rest[i + 1]) { cfg.username = rest[++i]; continue; }
    if (p === '-i' && rest[i + 1]) { cfg.identityFile = rest[++i]; continue; }
    if (p === '-J' && rest[i + 1]) { cfg.jumpHost = rest[++i]; continue; }
    if (p.startsWith('-')) { extra.push(p); if (/^-[oLRDFEbcmQSWw]$/.test(p) && rest[i + 1]) extra.push(rest[++i]); continue; }
    if (!cfg.host) {
      let t = p;
      if (t.includes('@')) { const at = t.lastIndexOf('@'); cfg.username = t.slice(0, at); t = t.slice(at + 1); }
      const m = t.match(/^\[?([^\]]+?)\]?(?::(\d+))?$/);
      if (m && m[2] && !t.includes('::')) { cfg.host = m[1]; cfg.port = Number(m[2]); } else cfg.host = t;
    } else extra.push(p);
  }
  if (extra.length) cfg.extraArgs = extra.join(' ');
  if (!cfg.host) return null;
  if (kw !== 'ssh' && cfg.port === 23) return { type: 'telnet', host: cfg.host, port: 23 };
  if (kw !== 'ssh' && cfg.port === 3389) return { type: 'rdp', host: cfg.host, port: 3389, username: cfg.username };
  return cfg;
}

if (typeof module !== 'undefined') module.exports = { parseQuick, sessionSubtitle, sessionTitle };
