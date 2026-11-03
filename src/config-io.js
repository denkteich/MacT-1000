'use strict';
/**
 * Export/Import der gesamten MacT-1000-Konfiguration:
 * Adressbuch (Sessions inkl. Ordner/Farben), Einstellungen, UI-Zustand (Layout,
 * eingeklappte Ordner, Multi-Paste-Verlauf) und optional Passwörter.
 * Passwörter werden nur verschlüsselt exportiert (AES-256-GCM, Schlüssel per scrypt
 * aus einem Export-Passwort abgeleitet).
 */
const crypto = require('crypto');

const FORMAT = 'macterm-config';
const FORMAT_VERSION = 1;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function stripPw(s) {
  if (!s || typeof s !== 'object') return s;
  const { password, passwordEnc, ...rest } = s;
  return rest;
}
function stripLayout(node) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'leaf') return { ...node, cfg: node.cfg ? stripPw(node.cfg) : node.cfg };
  if (node.type === 'split') return { ...node, a: stripLayout(node.a), b: stripLayout(node.b) };
  return node;
}

function encryptSecrets(obj, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(passphrase), salt, 32, SCRYPT);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { kdf: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, cipher: 'aes-256-gcm',
    salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decryptSecrets(sec, passphrase) {
  if (!sec) return {};
  try {
    const key = crypto.scryptSync(String(passphrase), Buffer.from(sec.salt, 'base64'), 32,
      { N: sec.N || SCRYPT.N, r: sec.r || SCRYPT.r, p: sec.p || SCRYPT.p, maxmem: SCRYPT.maxmem });
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sec.iv, 'base64'));
    d.setAuthTag(Buffer.from(sec.tag, 'base64'));
    const out = Buffer.concat([d.update(Buffer.from(sec.data, 'base64')), d.final()]);
    return JSON.parse(out.toString('utf8'));
  } catch (_) {
    throw new Error('Export-Passwort falsch oder Datei beschädigt');
  }
}

/** Baut das Export-Objekt. sessions enthalten (entschlüsselte) Passwörter. */
function buildExport({ sessions = [], settings = {}, ui = {}, includePasswords = false, passphrase = '', appVersion = '' }) {
  const out = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    app: 'MacT-1000',
    appVersion,
    exportedAt: new Date().toISOString(),
    settings: { ...settings },
    sessions: sessions.map(stripPw),
    ui: {
      layout: ui.layout && Array.isArray(ui.layout.tabs) ? { ...ui.layout, tabs: ui.layout.tabs.map(t => ({ ...t, node: stripLayout(t.node) })) } : null,
      collapsedFolders: Array.isArray(ui.collapsedFolders) ? ui.collapsedFolders : [],
      mpHistory: Array.isArray(ui.mpHistory) ? ui.mpHistory : []
    }
  };
  if (includePasswords) {
    if (!passphrase || String(passphrase).length < 6) throw new Error('Export-Passwort (mind. 6 Zeichen) erforderlich');
    const secrets = {};
    for (const s of sessions) if (s && s.id && s.password) secrets[s.id] = s.password;
    out.secretsCount = Object.keys(secrets).length;
    out.secrets = encryptSecrets(secrets, passphrase);
  }
  return out;
}

/** Liest eine Export-Datei (neues Format oder alte Sessions-Liste). */
function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error('Keine gültige JSON-Datei'); }
  if (Array.isArray(data)) {
    return { kind: 'legacy', sessions: data.filter(s => s && typeof s === 'object'), settings: null, ui: null, secrets: null };
  }
  if (!data || data.format !== FORMAT) throw new Error('Keine MacT-1000-Konfigurationsdatei');
  if ((data.formatVersion || 1) > FORMAT_VERSION) throw new Error('Datei stammt aus einer neueren MacT-1000-Version');
  return {
    kind: 'config',
    appVersion: data.appVersion || '',
    exportedAt: data.exportedAt || '',
    sessions: Array.isArray(data.sessions) ? data.sessions.filter(s => s && typeof s === 'object') : [],
    settings: data.settings && typeof data.settings === 'object' ? data.settings : null,
    ui: data.ui || null,
    secrets: data.secrets || null,
    secretsCount: data.secretsCount || 0
  };
}

function summary(p) {
  const folders = new Set(p.sessions.map(s => s.folder).filter(Boolean));
  return {
    kind: p.kind, appVersion: p.appVersion || '', exportedAt: p.exportedAt || '',
    sessions: p.sessions.length, folders: folders.size,
    hasSettings: !!p.settings, hasLayout: !!(p.ui && p.ui.layout && p.ui.layout.tabs && p.ui.layout.tabs.length),
    hasSecrets: !!p.secrets, secretsCount: p.secretsCount || 0
  };
}

/**
 * Führt Import aus. existing = aktuelle Sessions (mit Passwörtern).
 * mode: 'merge' (gleiche ID wird aktualisiert, neue hinzugefügt) | 'replace'
 */
function mergeSessions(existing, imported, { mode = 'merge', passwords = {} } = {}) {
  const withPw = imported.map((s) => {
    const c = stripPw(s);
    if (!c.id) c.id = 'sess-' + crypto.randomBytes(6).toString('hex');
    if (passwords[s.id]) c.password = passwords[s.id];
    return c;
  });
  if (mode === 'replace') return { list: withPw, added: withPw.length, updated: 0 };
  const list = existing.map(s => ({ ...s }));
  const idx = new Map(list.map((s, i) => [s.id, i]));
  let added = 0, updated = 0;
  for (const s of withPw) {
    if (idx.has(s.id)) {
      const old = list[idx.get(s.id)];
      list[idx.get(s.id)] = { ...s, ...(s.password ? {} : old.password ? { password: old.password } : {}) };
      updated++;
    } else { list.push(s); idx.set(s.id, list.length - 1); added++; }
  }
  return { list, added, updated };
}

module.exports = { buildExport, parseImport, summary, mergeSessions, encryptSecrets, decryptSecrets, FORMAT };
