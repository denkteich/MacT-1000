'use strict';
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  fontFamily: process.platform === 'win32' ? '"Cascadia Mono", Consolas, "Courier New", monospace' : 'Menlo, "SF Mono", Monaco, "Courier New", monospace',
  fontSize: 13,
  scrollback: 10000,
  cursorStyle: 'block',
  cursorBlink: true,
  copyOnSelect: true,
  fxSyncShell: true,
  rightClickPaste: true,
  confirmMultiPaste: true,
  theme: 'standard',
  sidebarVisible: true,
  defaultShell: '',
  loadKeychainKeys: true,
  updateCheck: true,
  autoUpdate: true,
  language: 'auto'
};

function dir() {
  const d = app.getPath('userData');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dir(), file), 'utf8')); }
  catch (_) { return fallback; }
}
// ---------- Versionskennung der lokalen Konfiguration ----------
const META_FILE = 'config-meta.json';
const CONFIG_FILES = new Set(['sessions.json', 'settings.json', 'passwords.json']);
let startMeta; // Stand beim Programmstart (= mit welcher Version die geladene Konfiguration geschrieben wurde)
// Version aus package.json (gleich app.getVersion() im fertigen Programm, auch beim Start aus dem Quellcode korrekt)
const appVersion = () => { try { return require('../package.json').version || app.getVersion(); } catch (_) { return ''; } };
function readMeta() {
  try { return JSON.parse(fs.readFileSync(path.join(dir(), META_FILE), 'utf8')) || {}; } catch (_) { return {}; }
}
function captureStartMeta() {
  if (startMeta !== undefined) return;
  const m = readMeta();
  const hasConfig = ['sessions.json', 'settings.json'].some(f => fs.existsSync(path.join(dir(), f)));
  startMeta = { writtenWith: m.writtenWith || '', newestAppVersion: maxVer(m.newestAppVersion, m.writtenWith), writtenAt: m.writtenAt || '', hasConfig };
}
function stampMeta() {
  captureStartMeta();
  const m = readMeta();
  const v = appVersion();
  const out = { app: 'MacT-1000', writtenWith: v, writtenAt: new Date().toISOString(), newestAppVersion: maxVer(m.newestAppVersion, m.writtenWith, v) };
  const p = path.join(dir(), META_FILE);
  try { fs.writeFileSync(p + '.tmp', JSON.stringify(out, null, 2), { mode: 0o600 }); fs.renameSync(p + '.tmp', p); } catch (_) {}
}
function localVersionInfo() {
  captureStartMeta();
  const v = appVersion();
  const cur = readMeta();
  return {
    // geladen = Stand beim Start; aktuell = nach eigenen Änderungen
    loadedWith: startMeta.writtenWith, loadedNewest: startMeta.newestAppVersion, loadedAt: startMeta.writtenAt, hasConfig: startMeta.hasConfig,
    writtenWith: cur.writtenWith || '', writtenAt: cur.writtenAt || '', newestAppVersion: maxVer(cur.newestAppVersion, cur.writtenWith),
    newer: isNewer(startMeta.newestAppVersion, v)
  };
}
async function versionInfo() {
  const v = appVersion();
  const out = { app: v, local: localVersionInfo(), shared: null };
  if (active()) {
    const st = shared.status();
    out.shared = { writtenWith: st.writtenWith, newestAppVersion: st.newestAppVersion, updatedBy: st.updatedBy, updatedAt: st.updatedAt, rev: st.rev, newer: st.newer };
  }
  return out;
}

function writeJson(file, data) {
  if (CONFIG_FILES.has(file)) stampMeta();
  const p = path.join(dir(), file);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
}

// Passwörter werden mit safeStorage (macOS-Schlüsselbund) verschlüsselt abgelegt
function enc(pw, required = false) {
  try { if (safeStorage.isEncryptionAvailable()) return { passwordEnc: safeStorage.encryptString(pw).toString('base64') }; } catch (_) {}
  if (required) throw new Error('IMPORT_SECURE_STORAGE');
  return { password: pw };
}
function dec(s) {
  if (s.passwordEnc) {
    try { return { ...s, password: safeStorage.decryptString(Buffer.from(s.passwordEnc, 'base64')), passwordEnc: undefined }; }
    catch (_) { return { ...s, passwordLocked: true }; } // verschlüsselt behalten statt still zu verwerfen
  }
  return s;
}

// ---------------------------------------------------------------------
// Gemeinsame Konfiguration auf Netzlaufwerk
// ---------------------------------------------------------------------
const { SharedConfig, DEFAULT_BACKUP_KEEP } = require('./shared');
const { eq, clone } = require('./merge3');
const { maxVer, isNewer } = require('./version');
const configIO = require('./config-io');

// immer gemeinsam (sobald ein Netzordner gewählt ist)
const ALWAYS_SHARED = ['macros', 'triggers', 'sessionFolders', 'configBackupKeep'];
// niemals gemeinsam – gehören zum jeweiligen Rechner
const LOCAL_ONLY = new Set(['language', 'windowWidth', 'windowHeight', 'sidebarWidth', 'sidebarVisible', 'downloadDir', 'defaultShell',
  'loadKeychainKeys', 'updateCheck', 'autoUpdate', 'extAllow', 'extDistribute', 'extTrusted', 'copySelV1523', 'tftpDir', 'tftpPort', 'tftpHost', 'tftpAllowWrite', 'tftpOverwrite', 'servers', 'sharedDir', 'sharedAllSettings', 'sharedTeamPassEnc', 'sharedTeamPass',
  'shareAllow', 'shareExtNoConfirm', 'sharePort', 'shareBind', 'shareViewerName']);

let shared = null;
let notifyFn = () => {};
const view = { sessions: null, settings: null, secrets: null }; // Stand, den das Fenster zuletzt geladen hat

const localSettingsRaw = () => readJson('settings.json', {});
const localSettings = () => ({ ...DEFAULT_SETTINGS, ...localSettingsRaw() });
const isSharedKey = (k, ls) => ALWAYS_SHARED.includes(k) || (!!ls.sharedAllSettings && !LOCAL_ONLY.has(k));
const active = () => !!(shared && shared.enabled);
const stripPw = (s) => { if (!s || typeof s !== 'object') return s; const { password, passwordEnc, passwordLocked, ...r } = s; return r; };

function encLocal(str) {
  try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(str).toString('base64'); } catch (_) {}
  return 'raw:' + Buffer.from(str, 'utf8').toString('base64');
}
function decLocal(v) {
  if (typeof v !== 'string') throw new Error('leer');
  if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
  if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString('utf8');
  throw new Error('unbekannt');
}
// ---------- Standard-Passwörter für Session-Ordner ----------
// Gilt für alle SSH-/Telnet-Sessions im Ordner (und in Unterordnern), die kein eigenes Passwort haben.
// Nur lokal und verschlüsselt (Schlüsselbund bzw. DPAPI) – wird nicht über den Netzordner verteilt.
const FOLDER_PW_FILE = 'folder-passwords.json';
const cleanFolder = value => String(value || '').split('/').map(part => part.trim()).filter(Boolean).join('/');
const insideFolder = (value, root) => {
  const folder = cleanFolder(value);
  return folder === root || folder.startsWith(root + '/');
};
function getFolderPasswords() {
  const out = {};
  for (const [f, v] of Object.entries(readJson(FOLDER_PW_FILE, {}))) { try { out[f] = decLocal(v); } catch (_) {} }
  return out;
}
function saveFolderPasswords(map) {
  const raw = readJson(FOLDER_PW_FILE, {});
  const out = {};
  // nicht entschlüsselbare Einträge (z.B. anderer Benutzer) unverändert behalten, sofern nicht ausdrücklich gesetzt/gelöscht
  for (const [f, v] of Object.entries(raw)) { try { decLocal(v); } catch (_) { if (!(f in (map || {}))) out[f] = v; } }
  for (const [f, pw] of Object.entries(map || {})) if (f && typeof pw === 'string' && pw) out[f] = encLocal(pw);
  writeJson(FOLDER_PW_FILE, out);
  return { ok: true, count: Object.keys(out).length };
}

function teamPass(ls = localSettings()) { try { return ls.sharedTeamPassEnc ? decLocal(ls.sharedTeamPassEnc) : ''; } catch (_) { return ''; } }

// ---------- lokaler Modus ----------
function localGetSessions() { return readJson('sessions.json', []).map(dec); }
function localSaveSessions(list, protect = new Set()) {
  writeJson('sessions.json', (Array.isArray(list) ? list : []).map(s => {
    if (!s) return s;
    const { passwordLocked, ...base } = s;
    if (!base.password) { if (!base.passwordEnc) delete base.passwordEnc; return base; }
    const { password, passwordEnc, ...rest } = base;
    return { ...rest, ...enc(password, protect.has(s.id)) };
  }));
}

// ---------- Sessions ----------
function getSessions({ trackView = false } = {}) {
  if (!active()) return localGetSessions();
  const pw = readJson('passwords.json', {});
  const sec = shared.local.secrets || {};
  if (trackView) { view.sessions = clone(shared.local.sessions); view.secrets = clone(shared.local.secrets); }
  return shared.local.sessions.map(s => {
    if (pw[s.id]) { const d = dec({ ...s, ...pw[s.id] }); if (!d.passwordLocked || !sec[s.id]) return d; }
    if (sec[s.id]) return { ...s, password: sec[s.id] };
    return { ...s };
  });
}

function baseFor(fromView) {
  const L = shared.local;
  if (!fromView) return clone(L);
  return { sessions: view.sessions || L.sessions, settings: view.settings || L.settings, secrets: view.secrets === null ? L.secrets : view.secrets };
}
async function commitShared(ours, base, fromView) {
  const r = await shared.commit(ours, base);
  if (fromView) {
    // eigene Änderung ist im Fenster schon sichtbar; kamen beim Zusammenführen fremde Änderungen hinzu → neu laden lassen
    const mine = { sessions: ours.sessions, settings: ours.settings };
    const now = { sessions: r.state.sessions, settings: r.state.settings };
    if (!eq(mine, now)) notifyFn('changed', { merged: true, silent: true });
  }
  return { ok: r.ok, pending: !!r.pending, error: r.error || '' };
}

async function saveSessions(list, { fromView = false, protect = new Set() } = {}) {
  list = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!active()) { localSaveSessions(list, protect); return { ok: true }; }
  const b = baseFor(fromView);
  const pw = readJson('passwords.json', {});
  const team = shared.teamSecrets && b.secrets !== null;
  const secrets = b.secrets === null ? null : { ...(b.secrets || {}) };
  const ids = new Set(list.map(s => s.id));
  for (const s of list) {
    if (s.password) {
      pw[s.id] = enc(s.password, protect.has(s.id));
      if (team) secrets[s.id] = s.password;
    }
    else if (!s.passwordLocked) { delete pw[s.id]; if (team) delete secrets[s.id]; }
  }
  for (const id of Object.keys(pw)) if (!ids.has(id)) delete pw[id];
  if (secrets) for (const id of Object.keys(secrets)) if (!ids.has(id)) delete secrets[id];
  writeJson('passwords.json', pw);
  const ours = { sessions: list.map(stripPw), settings: b.settings, secrets };
  const r = await commitShared(ours, b, fromView);
  if (fromView) { view.sessions = clone(shared.local.sessions); view.secrets = clone(shared.local.secrets); }
  return r;
}

async function deleteSessionFolder(folder, confirmedIds, confirmedFolders) {
  const root = cleanFolder(folder);
  if (!root || root === 'Sessions' || !Array.isArray(confirmedIds) || !Array.isArray(confirmedFolders)) return { ok: false };
  const network = active();
  const base = network ? clone(shared.local) : null;
  const sessions = network ? base.sessions : readJson('sessions.json', []);
  const settings = network ? base.settings : localSettingsRaw();
  const folders = settings.sessionFolders || [];
  const removedSessions = sessions.filter(s => s && insideFolder(s.folder, root));
  const removedFolders = folders.filter(f => insideFolder(f, root));
  const ids = new Set(confirmedIds);
  const paths = new Set(confirmedFolders);
  if (removedSessions.some(s => !ids.has(s.id)) || removedFolders.some(f => !paths.has(cleanFolder(f)))) return { ok: false, changed: true };

  const keepSessions = sessions.filter(s => !s || !insideFolder(s.folder, root));
  const keepSettings = { ...settings, sessionFolders: folders.filter(f => !insideFolder(f, root)) };
  const removedIds = new Set(removedSessions.map(s => s.id));
  const withoutRemovedIds = map => Object.fromEntries(Object.entries(map).filter(([id]) => !removedIds.has(id)));
  let result = { ok: true };
  if (network) {
    const secrets = base.secrets === null ? null : withoutRemovedIds(base.secrets || {});
    result = await commitShared({ sessions: keepSessions, settings: keepSettings, secrets }, base, false);
    if (!result.ok && !result.pending) return result;
    const current = new Set(shared.local.sessions.map(s => s.id));
    for (const id of removedIds) if (current.has(id)) removedIds.delete(id);
    const localPasswords = readJson('passwords.json', {});
    if (Object.keys(localPasswords).some(id => removedIds.has(id))) writeJson('passwords.json', withoutRemovedIds(localPasswords));
  } else {
    if (removedSessions.length) writeJson('sessions.json', keepSessions);
    if (removedFolders.length) writeJson('settings.json', keepSettings);
  }
  const remaining = getSessions({ trackView: true });
  const effective = getSettings({ trackView: true });
  const folderStillExists = remaining.some(s => s && insideFolder(s.folder, root)) || (effective.sessionFolders || []).some(f => insideFolder(f, root));
  if (!folderStillExists) {
    const passwords = readJson(FOLDER_PW_FILE, {});
    const keep = Object.entries(passwords).filter(([f]) => !insideFolder(f, root));
    if (keep.length !== Object.keys(passwords).length) writeJson(FOLDER_PW_FILE, Object.fromEntries(keep));
  }
  return { ...result, folderStillExists, sessions: remaining, settings: effective, folderPasswords: getFolderPasswords() };
}

// ---------- Einstellungen ----------
function getSettings({ trackView = false } = {}) {
  const ls = localSettings();
  const out = { ...ls };
  if (active()) {
    const sh = shared.local.settings || {};
    for (const k of ALWAYS_SHARED) { if (sh[k] !== undefined) out[k] = sh[k]; else delete out[k]; }
    for (const k of Object.keys(sh)) if (isSharedKey(k, ls)) out[k] = sh[k];
    if (trackView) view.settings = clone(sh);
  }
  delete out.sharedTeamPassEnc;
  out.sharedTeamPass = !!ls.sharedTeamPassEnc;
  return out;
}

async function saveSettings(s, { patch = null, fromView = false } = {}) {
  const ls = localSettings();
  const loc = { ...DEFAULT_SETTINGS, ...s };
  // Netzwerk-Optionen werden nur über die eigenen Funktionen geändert
  for (const k of ['sharedDir', 'sharedAllSettings', 'sharedTeamPassEnc']) { if (ls[k] !== undefined) loc[k] = ls[k]; else delete loc[k]; }
  delete loc.sharedTeamPass;
  if (active()) for (const k of Object.keys(loc)) if (isSharedKey(k, ls)) { if (ls[k] !== undefined) loc[k] = ls[k]; else delete loc[k]; }
  writeJson('settings.json', loc);
  if (!active()) return { ok: true };
  const src = patch || s;
  const cur = getSettings();
  const changes = {};
  for (const k of Object.keys(src)) if (isSharedKey(k, ls) && !eq(src[k], cur[k])) changes[k] = clone(src[k]);
  if (!Object.keys(changes).length) return { ok: true };
  const b = baseFor(fromView);
  const ours = { sessions: b.sessions, settings: { ...b.settings, ...changes }, secrets: b.secrets };
  const r = await commitShared(ours, b, fromView);
  if (fromView) view.settings = clone(shared.local.settings);
  return r;
}

// ---------- Netzlaufwerk verwalten ----------
function initShared(notify, appVersion) {
  captureStartMeta();
  notifyFn = notify || (() => {});
  shared = new SharedConfig({
    localDir: dir(), appVersion, encLocal, decLocal,
    encrypt: configIO.encryptSecrets, decrypt: configIO.decryptSecrets,
    notify: (type, payload) => notifyFn(type, payload)
  });
  const ls = localSettings();
  if (ls.sharedDir) shared.start(ls.sharedDir, teamPass(ls)).catch(() => {});
}

async function sharedStatus() {
  const ls = localSettings();
  const st = { ...(shared ? shared.status() : { enabled: false }), allSettings: !!ls.sharedAllSettings, teamPassSet: !!ls.sharedTeamPassEnc };
  const keep = active() ? (shared.local.settings || {}).configBackupKeep : undefined;
  st.backupKeep = Number.isFinite(Number(keep)) && keep !== undefined && keep !== null && keep !== '' ? Number(keep) : DEFAULT_BACKUP_KEEP;
  st.backups = active() ? await shared.listBackups() : [];
  st.backupDir = active() ? shared.backupDir : '';
  return st;
}
const sharedProbe = (d) => shared.probe(d);

function sharedPart(ls, allSettings) {
  const flags = { ...ls, sharedAllSettings: allSettings };
  const out = {};
  for (const k of Object.keys(ls)) if (ls[k] !== undefined && isSharedKey(k, flags)) out[k] = clone(ls[k]);
  return out;
}

/** Lokale Passwörter, die ins Team-Passwortfach gehören (nur bei gesetzter Team-Passphrase). */
async function pushLocalPasswords() {
  if (!active() || !shared.teamSecrets || shared.local.secrets === null) return;
  const full = getSessions();
  const sec = { ...(shared.local.secrets || {}) };
  let n = 0;
  for (const s of full) if (s.password && sec[s.id] !== s.password) { sec[s.id] = s.password; n++; }
  if (n) await shared.commit({ ...shared.local, secrets: sec });
}

async function setBackupKeep(n) {
  if (!active() || n === undefined || n === null || n === '') return;
  const v = Math.max(0, Math.min(500, Math.floor(Number(n))));
  if (!Number.isFinite(v) || (shared.local.settings || {}).configBackupKeep === v) return;
  await shared.commit({ ...shared.local, settings: { ...shared.local.settings, configBackupKeep: v } });
}

async function sharedEnable({ dir: d, mode = 'merge', allSettings = false, teamPass: tp = '', backupKeep }) {
  if (!d) throw new Error('Kein Ordner gewählt');
  if (active()) await sharedDisable();
  const ls = localSettings();
  const sessions = localGetSessions();
  const pw = {};
  for (const s of sessions) if (s.password) pw[s.id] = enc(s.password); else if (s.passwordEnc) pw[s.id] = { passwordEnc: s.passwordEnc };
  writeJson('passwords.json', pw);
  const secrets = {};
  if (tp) for (const s of sessions) if (s.password) secrets[s.id] = s.password;
  const state = { sessions: sessions.map(stripPw), settings: sharedPart(ls, allSettings), secrets };
  try { await shared.enable(d, mode, state, tp); }
  catch (e) { shared.stop(); throw e; }
  writeJson('settings.json', { ...localSettingsRaw(), sharedDir: d, sharedAllSettings: !!allSettings, sharedTeamPassEnc: tp ? encLocal(tp) : undefined });
  await afterOptionChange(allSettings, ls);
  await setBackupKeep(backupKeep);
  return sharedStatus();
}

async function afterOptionChange(allSettings, ls) {
  if (allSettings) { // fehlende allgemeine Einstellungen einmalig hochladen
    const sh = shared.local.settings || {};
    const add = {};
    for (const [k, v] of Object.entries(sharedPart(ls, true))) if (sh[k] === undefined && !ALWAYS_SHARED.includes(k)) add[k] = v;
    if (Object.keys(add).length) await shared.commit({ ...shared.local, settings: { ...sh, ...add } });
  }
  await pushLocalPasswords();
}

async function sharedUpdate({ allSettings, teamPass: tp, backupKeep } = {}) {
  if (!active()) throw new Error('Netzwerk-Konfiguration ist nicht aktiv');
  const raw = localSettingsRaw();
  const before = localSettings();
  if (allSettings !== undefined) raw.sharedAllSettings = !!allSettings;
  if (tp !== undefined) {
    if (tp) raw.sharedTeamPassEnc = encLocal(tp); else delete raw.sharedTeamPassEnc;
    shared.passphrase = tp || '';
    await shared.serial(async () => { // Datei mit neuer Passphrase neu lesen
      const F = await shared.readFile();
      if (F && !shared.pending) shared.adopt(F);
    });
  }
  writeJson('settings.json', raw);
  await afterOptionChange(!!raw.sharedAllSettings && !before.sharedAllSettings, before);
  await setBackupKeep(backupKeep);
  notifyFn('changed', { silent: true });
  return sharedStatus();
}

/** Trennen: aktueller gemeinsamer Stand wird als lokale Konfiguration übernommen. */
async function sharedDisable() {
  if (!active()) return sharedStatus();
  const sess = getSessions();
  const eff = getSettings();
  shared.stop();
  localSaveSessions(sess);
  const raw = { ...localSettingsRaw() };
  for (const k of Object.keys(eff)) if (!LOCAL_ONLY.has(k)) raw[k] = eff[k];
  for (const k of ALWAYS_SHARED) if (eff[k] === undefined) delete raw[k];
  delete raw.sharedDir; delete raw.sharedAllSettings; delete raw.sharedTeamPassEnc; delete raw.sharedTeamPass;
  writeJson('settings.json', raw);
  try { fs.unlinkSync(path.join(dir(), 'passwords.json')); } catch (_) {}
  view.sessions = view.settings = view.secrets = null;
  return sharedStatus();
}

async function sharedSyncNow() { if (active()) { shared.lastRead = 0; await shared.poll(); } return sharedStatus(); }

module.exports = {
  getSessions, saveSessions, getSettings, saveSettings, deleteSessionFolder,
  initShared, versionInfo, appVersion, captureStartMeta, sharedStatus, sharedProbe, sharedEnable, sharedUpdate, sharedDisable, sharedSyncNow,
  ALWAYS_SHARED, LOCAL_ONLY, encLocal, decLocal, getFolderPasswords, saveFolderPasswords
};
