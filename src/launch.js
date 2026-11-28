'use strict';
/*
 * Aufrufe von außen: Kommandozeilen-Argumente und mact1000://-Links in Aufträge übersetzen.
 *
 *   MacT-1000 --local --run "uptime"            mact1000://local?run=uptime
 *   MacT-1000 --ssh admin@10.0.0.1 --run "..."  mact1000://ssh/admin@10.0.0.1?run=...
 *   MacT-1000 --session "Rechenzentrum/core"    mact1000://session/Rechenzentrum/core?macro=Backup
 *   MacT-1000 --folder Rechenzentrum --multi    mact1000://folder/Rechenzentrum?multi=1
 *
 * Ergebnis: { source, requests: [ { kind, value, run[], macro, vars{}, split, cwd, shell, title, prompt, close, log } ],
 *             tile, multi, tabs, quit, help, errors[] }
 *
 *   --close [SEK]  Pane nach dem letzten Befehl/Makro schließen, sobald SEK Sekunden keine Ausgabe mehr kam (Standard 3)
 *   --log DATEI    Ausgabe des Panes (ohne Farbcodes) an DATEI anhängen
 *   --quit         wie --close für alle Ziele; danach MacT-1000 beenden, wenn keine anderen Sessions mehr laufen
 *   --layout NAME  Ziel-Tab mit festen Plätzen (wird beim ersten Aufruf angelegt, danach über den Namen gefunden)
 *   --slot PLATZ   oben|unten|links|rechts|oben-links|oben-rechts|unten-links|unten-rechts|1–4|next
 *   --grid RASTER  2h (oben/unten), 2v (links/rechts), 4 (2×2) – ohne Angabe aus dem Platz abgeleitet
 *   --busy WAS     belegter Platz: fragen (Standard), ersetzen, neu (zusätzlich teilen), abbrechen
 *   --share        Pane nach dem Verbinden freigeben (Pane-Freigabe); dazu optional
 *                  --share-mode ro|ask|rw  --share-password PW  --share-name NAME  --share-expires MIN  --share-info DATEI
 *                  --share-confirm nein  ohne Rückfrage freigeben (nur Kommandozeile, nur wenn in den Einstellungen erlaubt)
 *                  (jede --share-…-Option schaltet --share mit ein)
 * Die Übersetzung in Sessions/Panes erfolgt im Fenster (renderer/external.js).
 */

const SCHEME = 'mact1000';
// frühere Schemata (z. B. Links der Windows-Ausgabe bis 1.5.23) weiter annehmen
const ALL_SCHEMES = [SCHEME, ...require('./compat').LEGACY_SCHEMES];
const schemeOf = (a) => ALL_SCHEMES.find(sc => String(a).toLowerCase().startsWith(sc + '://'));
const TARGETS = ['local', 'shell', 'ssh', 'telnet', 'serial', 'rdp', 'session', 'folder', 'connect'];
const SHARE_OPTS = ['share-mode', 'share-password', 'share-name', 'share-expires', 'share-info', 'share-confirm'];
const VALUE_OPTS = ['run', 'macro', 'var', 'split', 'cwd', 'title', 'prompt', 'log', 'layout', 'slot', 'grid', 'busy', ...SHARE_OPTS];
const REQ_FLAGS = ['share']; // Schalter je Ziel (gelten für das Ziel davor)
const SHARE_MODE_ALIAS = { ro: 'ro', read: 'ro', readonly: 'ro', lesen: 'ro', 'nur-lesen': 'ro', ask: 'ask', fragen: 'ask', bestaetigen: 'ask', 'bestätigen': 'ask', rw: 'rw', write: 'rw', schreiben: 'rw' };
const SHARE_EXPIRES_MAX = 10080; // Minuten (7 Tage)
const PATH_RE = /^([A-Za-z]:[\\/]|\\\\[^\\/]|~[\\/]|\/)/;
const OPTIONAL_OPTS = ['close']; // Wert optional (Zahl)
const FLAGS = ['tile', 'multi', 'tabs', 'quit', 'help'];
const CLOSE_DEFAULT = 3;
const CLOSE_MAX = 3600;
const SPLITS = {
  right: 'row', rechts: 'row', nebeneinander: 'row', v: 'row', vertical: 'row', vertikal: 'row', row: 'row',
  down: 'column', unten: 'column', untereinander: 'column', h: 'column', horizontal: 'column', column: 'column',
  tab: 'tab', here: 'here', hier: 'here'
};
// Feste Plätze in einem Layout-Tab
const GRIDS = {
  '2h': { label: 'oben/unten', slots: ['oben', 'unten'] },
  '2v': { label: 'links/rechts', slots: ['links', 'rechts'] },
  '4': { label: '2×2', slots: ['oben-links', 'oben-rechts', 'unten-links', 'unten-rechts'] }
};
const GRID_ALIAS = {
  '2h': '2h', h: '2h', horizontal: '2h', untereinander: '2h', 'oben-unten': '2h', obenunten: '2h', column: '2h', down: '2h',
  '2v': '2v', v: '2v', vertical: '2v', vertikal: '2v', nebeneinander: '2v', 'links-rechts': '2v', linksrechts: '2v', row: '2v', right: '2v',
  '4': '4', '2x2': '4', '2×2': '4', raster: '4', grid: '4', vier: '4'
};
const SLOT_ALIAS = {
  oben: 'oben', top: 'oben', o: 'oben', up: 'oben',
  unten: 'unten', bottom: 'unten', u: 'unten', down: 'unten',
  links: 'links', left: 'links', l: 'links',
  rechts: 'rechts', right: 'rechts', r: 'rechts',
  'oben-links': 'oben-links', 'links-oben': 'oben-links', ol: 'oben-links', 'top-left': 'oben-links', tl: 'oben-links',
  'oben-rechts': 'oben-rechts', 'rechts-oben': 'oben-rechts', or: 'oben-rechts', 'top-right': 'oben-rechts', tr: 'oben-rechts',
  'unten-links': 'unten-links', 'links-unten': 'unten-links', ul: 'unten-links', 'bottom-left': 'unten-links', bl: 'unten-links',
  'unten-rechts': 'unten-rechts', 'rechts-unten': 'unten-rechts', ur: 'unten-rechts', 'bottom-right': 'unten-rechts', br: 'unten-rechts',
  next: 'next', auto: 'next', frei: 'next', naechster: 'next', 'nächster': 'next', 'nächste': 'next', naechste: 'next',
  1: '1', 2: '2', 3: '3', 4: '4'
};
const BUSY_ALIAS = {
  fragen: 'fragen', ask: 'fragen', ersetzen: 'ersetzen', replace: 'ersetzen',
  neu: 'neu', new: 'neu', teilen: 'neu', split: 'neu', abbrechen: 'abbrechen', cancel: 'abbrechen', skip: 'abbrechen', 'überspringen': 'abbrechen', ueberspringen: 'abbrechen'
};
// Raster, zu dem ein Platz eindeutig gehört (Zahlen und next passen zu jedem)
const gridOfSlot = (s) => Object.keys(GRIDS).find(g => GRIDS[g].slots.includes(s)) || null;
/** Platz → Index im Raster (oder -1 = passt nicht, null = next) */
function slotIndex(grid, slot) {
  if (slot === 'next') return null;
  const g = GRIDS[grid]; if (!g) return -1;
  if (/^[1-4]$/.test(slot)) { const i = Number(slot) - 1; return i < g.slots.length ? i : -1; }
  return g.slots.indexOf(slot);
}
const MAX_REQUESTS = 50;
const MAX_LEN = 8000;

function emptyBatch(source) { return { source, requests: [], tile: false, multi: false, tabs: false, quit: false, help: false, errors: [] }; }

function newRequest(kind, value) {
  if (kind === 'shell') return { kind: 'local', value: '', shell: value || '', run: [], vars: {} };
  return { kind, value: value || '', run: [], vars: {} };
}

// Option auf den aktuellen Auftrag anwenden (fehlt einer, wird eine lokale Shell angenommen)
function applyOpt(b, name, value) {
  if (FLAGS.includes(name)) { b[name] = value === undefined || !/^(0|false|nein|no)$/i.test(String(value)); return; }
  if (!b.requests.length) b.requests.push(newRequest('local'));
  const r = b.requests[b.requests.length - 1];
  const v = String(value === undefined ? '' : value);
  if (v.length > MAX_LEN) { b.errors.push(`--${name}: Wert zu lang`); return; }
  if (name === 'run') { if (v !== '') r.run.push(v); return; }
  if (name === 'share') { r.share = value === undefined || !/^(0|false|nein|no)$/i.test(String(value)); return; }
  if (SHARE_OPTS.includes(name)) {
    r.share = true;
    if (name === 'share-mode') {
      const m = SHARE_MODE_ALIAS[v.trim().toLowerCase()];
      if (!m) { b.errors.push(`--share-mode: unbekannt „${v}“ (erlaubt: ro = nur lesen, ask = Schreiben nach Bestätigung, rw = Lesen und Schreiben)`); return; }
      r.shareMode = m; return;
    }
    if (name === 'share-password') {
      if (v.length < 4 || v.length > 128 || /[\u0000-\u001f]/.test(v)) { b.errors.push('--share-password: das Passwort muss 4–128 Zeichen haben'); return; }
      r.sharePassword = v; return;
    }
    if (name === 'share-name') {
      const n = v.trim();
      if (!n || n.length > 80 || /[\u0000-\u001f]/.test(n)) { b.errors.push(`--share-name: bitte einen Namen mit 1–80 Zeichen angeben (bekommen: ${v || 'nichts'})`); return; }
      r.shareName = n; return;
    }
    if (name === 'share-expires') {
      const n = Number(v.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > SHARE_EXPIRES_MAX) { b.errors.push(`--share-expires: „${v}“ ist keine gültige Dauer (0–${SHARE_EXPIRES_MAX} Minuten, 0 = bis zum Beenden)`); return; }
      r.shareExpires = n; return;
    }
    if (name === 'share-confirm') {
      const t = v.trim().toLowerCase();
      if (/^(1|true|ja|yes|j|y)$/.test(t)) { r.shareConfirm = true; return; }
      if (/^(0|false|nein|no|n)$/.test(t)) { r.shareConfirm = false; return; }
      b.errors.push(`--share-confirm: „${v}“ – bitte ja oder nein angeben`); return;
    }
    if (name === 'share-info') {
      if (!PATH_RE.test(v) || /[\\/]$/.test(v)) { b.errors.push(`--share-info: bitte den vollständigen Pfad einer Datei angeben, z. B. ~/freigabe.json (bekommen: ${v || 'nichts'})`); return; }
      if (/(^|[\\/])\.\.([\\/]|$)/.test(v)) { b.errors.push('--share-info: „..“ ist im Pfad nicht erlaubt'); return; }
      r.shareInfo = v; return;
    }
  }
  if (name === 'var') {
    const i = v.indexOf('=');
    if (i < 1) { b.errors.push(`--var erwartet Name=Wert (bekommen: ${v || 'nichts'})`); return; }
    r.vars[v.slice(0, i).trim()] = v.slice(i + 1);
    return;
  }
  if (name === 'close') {
    if (v.trim() === '') { r.close = CLOSE_DEFAULT; return; }
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > CLOSE_MAX) { b.errors.push(`--close: „${v}“ ist keine gültige Wartezeit (0–${CLOSE_MAX} Sekunden)`); return; }
    r.close = n; return;
  }
  if (name === 'log') {
    // erlaubt: C:\…, C:/…, \\server\freigabe\…, ~\…, ~/…, /… – keine relativen Pfade, kein Ordner am Ende
    if (!/^([A-Za-z]:[\\/]|\\\\[^\\/]|~[\\/]|\/)/.test(v) || /[\\/]$/.test(v)) { b.errors.push(`--log: bitte den vollständigen Pfad einer Datei angeben, z. B. C:\\Logs\\switch.log oder ~\\Logs\\switch.log (bekommen: ${v || 'nichts'})`); return; }
    if (/(^|[\\/])\.\.([\\/]|$)/.test(v)) { b.errors.push('--log: „..“ ist im Pfad nicht erlaubt'); return; }
    r.log = v; return;
  }
  if (name === 'layout') {
    const n = v.trim();
    if (!n || n.length > 60 || /[\u0000-\u001f]/.test(n)) { b.errors.push(`--layout: bitte einen Namen mit 1–60 Zeichen angeben (bekommen: ${v || 'nichts'})`); return; }
    r.layout = n; return;
  }
  if (name === 'slot') {
    const s = SLOT_ALIAS[v.trim().toLowerCase()];
    if (!s) { b.errors.push(`--slot: unbekannt „${v}“ (erlaubt: oben, unten, links, rechts, oben-links, oben-rechts, unten-links, unten-rechts, 1–4, next)`); return; }
    r.slot = s; return;
  }
  if (name === 'grid') {
    const g = GRID_ALIAS[v.trim().toLowerCase()];
    if (!g) { b.errors.push(`--grid: unbekannt „${v}“ (erlaubt: 2h = oben/unten, 2v = links/rechts, 4 = 2×2)`); return; }
    r.grid = g; return;
  }
  if (name === 'busy') {
    const x = BUSY_ALIAS[v.trim().toLowerCase()];
    if (!x) { b.errors.push(`--busy: unbekannt „${v}“ (erlaubt: fragen, ersetzen, neu, abbrechen)`); return; }
    r.busy = x; return;
  }
  if (name === 'split') {
    const s = SPLITS[v.toLowerCase()];
    if (!s) { b.errors.push(`--split: unbekannt „${v}“ (erlaubt: right/nebeneinander, down/untereinander, tab, here)`); return; }
    r.split = s; return;
  }
  r[name] = v;
}

// Plausibilität der Layout-Angaben je Auftrag (nach dem Einlesen aller Optionen)
function finish(b) {
  for (const r of b.requests) {
    if (!r.share) continue;
    const who = r.kind === 'local' ? '--local' : `--${r.kind} ${r.value}`;
    if (r.kind === 'folder') b.errors.push(`${who}: --share gilt nur für einzelne Ziele, nicht für ganze Ordner`);
    else if (r.kind === 'rdp') b.errors.push(`${who}: RDP-Verbindungen laufen in einem eigenen Programm und lassen sich nicht freigeben`);
  }
  for (const r of b.requests) {
    if (!(r.layout || r.slot || r.grid || r.busy)) continue;
    const who = r.kind === 'local' ? '--local' : `--${r.kind} ${r.value}`;
    if (r.kind === 'folder') { b.errors.push(`${who}: --layout/--slot gelten nur für einzelne Ziele, nicht für ganze Ordner`); continue; }
    if (r.split) { b.errors.push(`${who}: --split und --layout/--slot bitte nicht zusammen verwenden`); continue; }
    if (!r.layout) r.layout = 'Layout';
    if (!r.slot) r.slot = 'next';
    const sg = gridOfSlot(r.slot);
    if (r.grid && sg && sg !== r.grid) { b.errors.push(`${who}: Platz „${r.slot}“ gibt es im Raster ${GRIDS[r.grid].label} nicht`); continue; }
    if (r.grid && slotIndex(r.grid, r.slot) === -1) { b.errors.push(`${who}: Platz ${r.slot} gibt es im Raster ${GRIDS[r.grid].label} nicht (nur ${GRIDS[r.grid].slots.length} Plätze)`); continue; }
    if (!r.grid && sg) r.grid = sg;
    if (!r.grid && /^[34]$/.test(r.slot)) r.grid = '4';
  }
  return b;
}

function addTarget(b, kind, value) {
  if (b.requests.length >= MAX_REQUESTS) { b.errors.push(`Zu viele Ziele (höchstens ${MAX_REQUESTS})`); return; }
  if (kind !== 'local' && kind !== 'shell' && !value) { b.errors.push(`--${kind}: Ziel fehlt`); return; }
  b.requests.push(newRequest(kind, value));
}

/**
 * Kommandozeile auswerten. Unbekannte Argumente (z. B. Chromium-Schalter, Pfad zur App) werden ignoriert;
 * mact1000://-Links in den Argumenten werden ebenfalls verarbeitet.
 */
function parseArgs(argv, source = 'cli') {
  const b = emptyBatch(source);
  const args = Array.isArray(argv) ? argv.map(String) : [];
  let seen = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (schemeOf(a)) {
      const u = parseUrl(a);
      b.requests.push(...u.requests); b.errors.push(...u.errors);
      for (const f of FLAGS) b[f] = b[f] || u[f];
      seen = true; continue;
    }
    const m = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(a);
    if (!m) continue;
    const name = m[1];
    let val = m[2];
    const takeNext = () => { if (val === undefined && i + 1 < args.length && !/^--[a-z]/.test(args[i + 1])) val = args[++i]; return val; };
    if (TARGETS.includes(name)) {
      seen = true;
      if (name === 'local') {
        // --local "befehl" ist eine Kurzform für --local --run "befehl"
        takeNext(); addTarget(b, 'local');
        if (val !== undefined && val !== '') applyOpt(b, 'run', val);
      } else addTarget(b, name, takeNext());
    } else if (VALUE_OPTS.includes(name)) {
      seen = true;
      if (takeNext() === undefined) { b.errors.push(`--${name}: Wert fehlt`); continue; }
      applyOpt(b, name, val);
    } else if (OPTIONAL_OPTS.includes(name)) {
      seen = true;
      if (val === undefined && i + 1 < args.length && /^\d+([.,]\d+)?$/.test(args[i + 1])) val = args[++i];
      applyOpt(b, name, val);
    } else if (REQ_FLAGS.includes(name)) {
      seen = true;
      if (val === undefined && i + 1 < args.length && /^(0|1|true|false|ja|nein|yes|no)$/i.test(args[i + 1])) val = args[++i];
      applyOpt(b, name, val);
    } else if (FLAGS.includes(name)) { seen = true; applyOpt(b, name, val); }
  }
  return seen ? finish(b) : null;
}

/** mact1000://<ziel>/<wert>?run=…&run=…&macro=…&var=Name=Wert&split=…&cwd=…&title=…&prompt=…&close=3&log=~/x.log&layout=core&slot=unten&multi=1&tile=1&quit=1 */
function parseUrl(url, source = 'url') {
  const b = emptyBatch(source);
  let u;
  try { u = new URL(url); } catch (_) { b.errors.push('Ungültiger Link: ' + url); return b; }
  const sc = ALL_SCHEMES.find(x => u.protocol === x + ':');
  if (!sc) { b.errors.push('Kein mact1000://-Link: ' + url); return b; }
  // mact1000://ssh/admin@host → host = "ssh", pathname = "/admin@host" (Benutzer@ ist dann Teil des Pfads)
  const raw = String(url).slice(sc.length + 3);
  const q = raw.indexOf('?'); const h = raw.indexOf('#');
  const end = Math.min(q < 0 ? raw.length : q, h < 0 ? raw.length : h);
  const pathPart = raw.slice(0, end).replace(/\/+$/, '');
  const slash = pathPart.indexOf('/');
  const kind = decodeURIComponent((slash < 0 ? pathPart : pathPart.slice(0, slash))).toLowerCase();
  let value = slash < 0 ? '' : pathPart.slice(slash + 1);
  try { value = decodeURIComponent(value); } catch (_) { b.errors.push('Ungültige Kodierung im Link'); return b; }
  if (kind === 'help' || kind === 'hilfe') { b.help = true; return b; }
  if (!TARGETS.includes(kind)) { b.errors.push(`Unbekanntes Ziel „${kind}“ im Link (erlaubt: ${TARGETS.filter(t => t !== 'shell').join(', ')})`); return b; }
  addTarget(b, kind, value);
  for (const [k, v] of u.searchParams) {
    const name = k.toLowerCase();
    if (VALUE_OPTS.includes(name) || OPTIONAL_OPTS.includes(name) || FLAGS.includes(name) || REQ_FLAGS.includes(name)) applyOpt(b, name, v);
    else if (name === 'cmd') applyOpt(b, 'run', v);
    else b.errors.push(`Unbekannter Parameter „${k}“ im Link`);
  }
  // Links kann jede Webseite auslösen – eine Freigabe ohne Rückfrage gibt es nur über die Kommandozeile
  if (b.requests.some(r => r.shareConfirm === false)) b.errors.push('share-confirm=nein ist in Links nicht erlaubt – Freigaben ohne Rückfrage gehen nur über die Kommandozeile');
  return finish(b);
}

// Kurzbeschreibung eines Auftrags (für Rückfrage und Protokoll)
function describe(r) {
  const k = { local: 'Lokale Shell', ssh: 'SSH', telnet: 'Telnet', serial: 'Seriell', rdp: 'RDP', session: 'Session', folder: 'Ordner', connect: 'Verbindung' }[r.kind] || r.kind;
  return k + (r.value ? ' ' + r.value : '') + (r.shell ? ` (${r.shell})` : '');
}

// Shell-sicheres Zitieren für Beispiele (Kopieren in Automator)
const shq = (s) => /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Auftrag zurück in Kommandozeilen-Argumente bzw. Link übersetzen (für „Als Befehl kopieren“). */
function toArgs(batch) {
  const out = [];
  for (const r of batch.requests) {
    if (r.kind === 'local') { out.push(r.shell ? '--shell' : '--local'); if (r.shell) out.push(r.shell); }
    else out.push('--' + r.kind, r.value);
    for (const c of r.run || []) out.push('--run', c);
    if (r.macro) out.push('--macro', r.macro);
    for (const [k, v] of Object.entries(r.vars || {})) out.push('--var', `${k}=${v}`);
    for (const o of ['split', 'cwd', 'title', 'prompt', 'log', 'layout', 'slot', 'grid', 'busy']) if (r[o]) out.push('--' + o, o === 'split' ? ({ row: 'right', column: 'down' }[r[o]] || r[o]) : r[o]);
    if (r.close !== undefined && r.close !== null) out.push('--close', String(r.close));
    for (const [o, v] of shareParts(r)) out.push('--' + o, ...(v === null ? [] : [v]));
  }
  for (const f of ['tile', 'multi', 'tabs', 'quit']) if (batch[f]) out.push('--' + f);
  return out;
}
function toUrl(r, batch = {}) {
  const p = new URLSearchParams();
  for (const c of r.run || []) p.append('run', c);
  if (r.macro) p.append('macro', r.macro);
  for (const [k, v] of Object.entries(r.vars || {})) p.append('var', `${k}=${v}`);
  for (const o of ['split', 'cwd', 'title', 'prompt', 'log', 'layout', 'slot', 'grid', 'busy']) if (r[o]) p.append(o, o === 'split' ? ({ row: 'right', column: 'down' }[r[o]] || r[o]) : r[o]);
  if (r.close !== undefined && r.close !== null) p.append('close', String(r.close));
  for (const [o, v] of shareParts(r)) p.append(o, v === null ? '1' : v);
  for (const f of ['tile', 'multi', 'tabs', 'quit']) if (batch[f]) p.append(f, '1');
  const v = r.kind === 'local' ? '' : '/' + String(r.value).split('/').map(encodeURIComponent).join('/').replace(/%40/g, '@').replace(/%3A/gi, ':');
  const qs = p.toString().replace(/\+/g, '%20');
  return `${SCHEME}://${r.kind}${v}${qs ? '?' + qs : ''}`;
}

// --share und seine Optionen eines Auftrags als [Name, Wert|null]
function shareParts(r) {
  if (!r.share) return [];
  const out = [['share', null]];
  if (r.shareMode) out.push(['share-mode', r.shareMode]);
  if (r.sharePassword) out.push(['share-password', r.sharePassword]);
  if (r.shareName) out.push(['share-name', r.shareName]);
  if (r.shareExpires !== undefined && r.shareExpires !== null) out.push(['share-expires', String(r.shareExpires)]);
  if (r.shareInfo) out.push(['share-info', r.shareInfo]);
  if (r.shareConfirm === false) out.push(['share-confirm', 'nein']);
  return out;
}

module.exports = { SCHEME, parseArgs, parseUrl, describe, toArgs, toUrl, shq, MAX_REQUESTS, CLOSE_DEFAULT, GRIDS, slotIndex };
