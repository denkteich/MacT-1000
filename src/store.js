'use strict';
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  fontFamily: 'Menlo, "SF Mono", Monaco, "Courier New", monospace',
  fontSize: 13,
  scrollback: 10000,
  cursorStyle: 'block',
  cursorBlink: true,
  copyOnSelect: true,
  rightClickPaste: true,
  confirmMultiPaste: true,
  theme: 'standard',
  sidebarVisible: true,
  defaultShell: '',
  loadKeychainKeys: true
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
function writeJson(file, data) {
  const p = path.join(dir(), file);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
}

// Passwörter werden mit safeStorage (macOS-Schlüsselbund) verschlüsselt abgelegt
function enc(pw) {
  try { if (safeStorage.isEncryptionAvailable()) return { passwordEnc: safeStorage.encryptString(pw).toString('base64') }; } catch (_) {}
  return { password: pw };
}
function dec(s) {
  if (s.passwordEnc) {
    try { return { ...s, password: safeStorage.decryptString(Buffer.from(s.passwordEnc, 'base64')), passwordEnc: undefined }; }
    catch (_) { return { ...s, passwordEnc: undefined }; }
  }
  return s;
}

module.exports = {
  getSessions: () => readJson('sessions.json', []).map(dec),
  saveSessions: (list) => writeJson('sessions.json', (Array.isArray(list) ? list : []).map(s => {
    if (!s || !s.password) return s;
    const { password, ...rest } = s;
    return { ...rest, ...enc(password) };
  })),
  getSettings: () => ({ ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) }),
  saveSettings: (s) => writeJson('settings.json', { ...DEFAULT_SETTINGS, ...s })
};
