'use strict';
/* Kleine DOM- und Hilfsfunktionen */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Plattform: unter Windows andere Tastenkürzel (Strg+Umschalt statt ⌘, damit Strg+C/D/W im Terminal frei bleiben) */
const IS_WIN = typeof window !== 'undefined' && window.api && window.api.platform === 'win32';
const WIN_KB = {
  '⌘N': 'Strg+Umschalt+S', '⌘T': 'Strg+Umschalt+T', '⌘K': 'Strg+Umschalt+K', '⌘D': 'Strg+Umschalt+E', '⇧⌘D': 'Strg+Umschalt+O',
  '⇧⌘I': 'Strg+Umschalt+I', '⇧⌘V': 'Strg+Umschalt+M', '⌘,': 'Strg+,', '⇧⌘F': 'Strg+Umschalt+D', '⇧⌘↩': 'Strg+Umschalt+X',
  '⌘W': 'Strg+Umschalt+W', '⇧⌘W': 'Strg+Umschalt+Q', '⌘F': 'Strg+Umschalt+F', '⇧⌘A': 'Alt+Umschalt+A', '⌘R': 'Strg+Umschalt+R',
  '⇧⌘R': 'Alt+Umschalt+R', '⇧⌘M': 'Alt+Umschalt+M', '⌘.': 'Strg+.', '⌥⌘D': 'Alt+Umschalt+D', '⌥⇧⌘D': 'Alt+Umschalt+T',
  '⌥⌘T': 'Alt+Umschalt+S', '⌘→': 'Alt+Umschalt+→', '⌘←': 'Alt+Umschalt+←', '⌘-': 'Strg+-', '⌘+': 'Strg++', '⌘0': 'Strg+0',
  '⌘B': 'Strg+Umschalt+B', '⌘L': 'Strg+Umschalt+L', '⌘A': 'Strg+Umschalt+A', '⇧↩': 'Umschalt+Enter', '⌘↩': 'Strg+Enter',
  '⌘C': 'Strg+Umschalt+C', '⌘V': 'Strg+Umschalt+V', '⇧⌘]': 'Strg+Bild↓', '⇧⌘[': 'Strg+Bild↑', '⌘]': 'Strg+Umschalt+N', '⌘[': 'Strg+Umschalt+P',
  '⌘1': 'Alt+1', '⌘9': 'Alt+9', '⌥⌘=': 'Strg+Umschalt+G', '⇧⌘E': '', '⌘-Klick': 'Strg+Klick'
};
/* Sprache: 'de' oder 'en' (aus den Einstellungen bzw. vom System, siehe src/main.js) */
const I18 = (typeof window !== 'undefined' && window.I18N) || { t: (x) => x, lang: 'de', setLang() {} };
if (typeof window !== 'undefined' && window.api && window.api.lang) I18.setLang(window.api.lang);
const IS_EN = () => I18.lang === 'en';
const LOC = () => (IS_EN() ? 'en-GB' : 'de-DE');
/** Text in die eingestellte Sprache übersetzen (Original ist Deutsch) */
const tx = (s) => I18.t(s);
/** Windows: Mac-Begriffe in (bereits übersetztem) Text ersetzen */
function winWords(s) {
  if (IS_EN()) {
    return s.replace(/\bFinder\b/g, 'Explorer').replace(/\/dev\/cu\.usbserial(?:-\d+)?/g, 'COM3')
      .replace(/\bOption key\b/g, 'Alt key')
      .replace(/\b(this|each|a|another|which|every) Mac\b/g, '$1 PC').replace(/\bMacs\b/g, 'PCs').replace(/<IP-des-Mac>/g, '<IP-of-the-PC>')
      .replace(/\bmacOS firewall\b/g, 'Windows firewall').replace(/\(Keychain-encrypted\)/g, '(encrypted)').replace(/\bmacOS asks\b/g, 'Windows asks')
      .replace(/\bStrg\b/g, 'Ctrl').replace(/\bUmschalt\b/g, 'Shift').replace(/Bild↓/g, 'PgDn').replace(/Bild↑/g, 'PgUp').replace(/\+Klick\b/g, '+click').replace(/\bAlt-Taste\b/g, 'Alt key');
  }
  return s.replace(/\bFinder\b/g, 'Explorer').replace(/\/dev\/cu\.usbserial(?:-\d+)?/g, 'COM3')
    .replace(/\bWahltaste\b/g, 'Alt-Taste')
    .replace(/\b(diesem|jedem|einem|anderen|anderem|jeden|welchem) Mac\b/g, '$1 PC').replace(/\bMacs\b/g, 'PCs').replace(/<IP-des-Mac>/g, '<IP-des-PCs>')
    .replace(/macOS-Firewall/g, 'Windows-Firewall').replace(/\(Schlüsselbund-verschlüsselt\)/g, '(verschlüsselt)').replace(/\bmacOS fragt\b/g, 'Windows fragt');
}
/** Text übersetzen und – unter Windows – Mac-Tastenkürzel und -Begriffe umschreiben */
function kb(s) {
  if (!s) return s;
  let r = I18.t(String(s));
  if (!IS_WIN) return r;
  r = r.replace(/⌘-(Klick|click)/g, 'Strg+Klick').replace(/[⌥⇧⌘]+(?:↩|→|←|\S)/g, (m) => (m in WIN_KB ? WIN_KB[m] : m));
  return winWords(r);
}
const FILE_MANAGER = IS_WIN ? 'Explorer' : 'Finder';
/** Alle sichtbaren Texte (auch später erzeugte Dialoge, Menüs, Hinweise) automatisch übersetzen bzw. für Windows
 *  umschreiben – nicht im Terminal, nicht in Eingabefeldern und nicht in Namen, die der Benutzer vergeben hat. */
const TA = { orig: new WeakMap(), attrs: new WeakMap(), on: false };
const TA_SKIP = '.xterm, textarea, input, select.nt, pre.ext-opts-keep, [data-nt]';
const TA_NAMES = '.l-name, .s-name, .s-sub, .f-name, .fx-name, .fx-job-name, .m-name, .t-title, .p-title, .fx-path, .srv-tag, .tftp-peer';
const TA_DEFAULT_NAMES = new Set(['Lokal', 'Neues Pane', 'Standard-Shell', 'Lokale Shell', 'Aufrufe']);
const TA_ATTRS = ['title', 'placeholder', 'aria-label'];
const taActive = () => IS_WIN || IS_EN();
function taValue(orig, el) {
  if (!el) return kb(orig);
  if (el.closest(TA_SKIP)) return orig;
  if (el.closest(TA_NAMES)) return TA_DEFAULT_NAMES.has(orig.trim()) ? kb(orig) : orig;
  return kb(orig);
}
function taText(n) {
  const cur = n.nodeValue;
  let rec = TA.orig.get(n);
  if (!rec || rec.w !== cur) { rec = { o: cur, w: cur }; TA.orig.set(n, rec); }
  if (!/[A-Za-zÄÖÜäöüß⌘⌥⇧]/.test(rec.o)) return;
  const nv = taActive() ? taValue(rec.o, n.parentElement) : rec.o;
  rec.w = nv;
  if (nv !== cur) n.nodeValue = nv;
}
function taAttrs(el) {
  if (!el.getAttribute || (el.closest && el.closest('.xterm'))) return;
  let map = TA.attrs.get(el);
  for (const a of TA_ATTRS) {
    const cur = el.getAttribute(a);
    if (cur === null || cur === '') continue;
    if (!map) { map = {}; TA.attrs.set(el, map); }
    let rec = map[a];
    if (!rec || rec.w !== cur) rec = map[a] = { o: cur, w: cur };
    const nv = taActive() ? kb(rec.o) : rec.o;
    rec.w = nv;
    if (nv !== cur) el.setAttribute(a, nv);
  }
}
function taWalk(root) {
  if (!root) return;
  if (root.nodeType === 3) { if (!(root.parentElement && root.parentElement.closest('.xterm'))) taText(root); return; }
  if (root.nodeType !== 1 || root.closest('.xterm')) return;
  taAttrs(root);
  root.querySelectorAll('[title],[placeholder],[aria-label]').forEach(taAttrs);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest('.xterm, textarea, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  const list = []; let n; while ((n = tw.nextNode())) list.push(n);
  list.forEach(taText);
}
let TA_TITLE = null;
function taTitle() {
  if (TA_TITLE === null || (document.title !== TA_TITLE.w)) TA_TITLE = { o: document.title };
  TA_TITLE.w = taActive() ? kb(TA_TITLE.o) : TA_TITLE.o;
  if (document.title !== TA_TITLE.w) document.title = TA_TITLE.w;
}
function startTextAdapter() {
  if (TA.on) return;
  TA.on = true;
  if (IS_WIN) document.body.classList.add('win');
  document.documentElement.lang = I18.lang;
  taWalk(document.body); taTitle();
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') taAttrs(m.target);
      else if (m.type === 'characterData') taWalk(m.target);
      else m.addedNodes.forEach(taWalk);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: TA_ATTRS });
}
/** Sprache zur Laufzeit wechseln: alle bereits angezeigten Texte neu übersetzen */
function applyLanguage(l) {
  if (I18.setLang(l) === document.documentElement.lang) return;
  document.documentElement.lang = I18.lang;
  if (!TA.on) return;
  taWalk(document.body); taTitle();
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, String(sv)); else el.style[sk] = sv; } }
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
  command:{ label: 'Befehl',       icon: 'CMD', color: '#c9d1d9' },
  share:  { label: 'Freigabe',     icon: 'SHR', color: '#56d4c4' }
};

function sessionSubtitle(c) {
  switch (c.type) {
    case 'ssh': return `${c.username ? c.username + '@' : ''}${c.host || ''}${c.port && c.port != 22 ? ':' + c.port : ''}`;
    case 'telnet': return `${c.host || ''}${c.port && c.port != 23 ? ':' + c.port : ''}`;
    case 'serial': return `${(c.path || '').replace('/dev/', '')} @ ${c.baudRate || 9600}`;
    case 'rdp': return `${c.username ? c.username + '@' : ''}${c.host || ''}`;
    case 'local': return c.shell || 'Standard-Shell';
    case 'command': return c.command || '';
    case 'share': return `${c.host || ''}${c.port && c.port != 7022 ? ':' + c.port : ''}`;
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
  if (kw === 'share' || kw === 'freigabe') {
    const [host, port] = (parts[1] || '').split(':');
    if (!host) return null;
    return { type: 'share', host, port: Number(port || parts[2]) || 7022 };
  }
  if (kw === 'rdp') {
    let target = parts[1] || ''; let username = '';
    if (target.includes('@')) [username, target] = target.split('@');
    const [host, port] = target.split(':');
    return { type: 'rdp', host, port: Number(port) || 3389, username };
  }
  const direct = kw.startsWith('/dev/') || /^com\d+(:\d+)?$/.test(kw);
  if (kw === 'serial' || kw === 'seriell' || direct) {
    let path = direct ? parts[0] : parts[1];
    let baud = direct ? parts[1] : parts[2];
    const cm = /^(com\d+):(\d+)$/i.exec(path || '');
    if (cm) { path = cm[1]; baud = baud || cm[2]; }
    if (/^com\d+$/i.test(path || '')) path = path.toUpperCase();
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
