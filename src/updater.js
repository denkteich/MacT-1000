'use strict';
/**
 * Automatisches Update – je Plattform eigene Umsetzung:
 *  macOS:   updater-mac.js (zip je Architektur, Austausch des .app-Bundles nach dem Beenden)
 *  Windows: updater-win.js (setup.exe, stille Installation; portable EXE: nur Hinweis)
 * MACT_UPDATER=win|mac erzwingt eine Variante (nur für Tests).
 */
const which = process.env.MACT_UPDATER || (process.platform === 'win32' ? 'win' : 'mac');
module.exports = which === 'win' ? require('./updater-win') : require('./updater-mac');
