'use strict';
/**
 * Technische Kennungen für die Zusammenarbeit mit älteren Versionen.
 * Nur hier stehen alte Namen – sie erscheinen nicht in der Oberfläche.
 *  - LEGACY_DATA_DIRS: Datenordner früherer Versionen (neben dem eigenen Datenordner), werden einmalig übernommen
 *      macOS:   ~/Library/Application Support/MacTerm   (Versionen vor 1.3)
 *      Windows: %APPDATA%\WinT-1000                     (Windows-Ausgabe 1.5.21–1.5.23)
 *  - SHARED_PEER:     Dateiname/Format einer gemeinsamen Netzwerk-Konfiguration, die die frühere
 *                     Windows-Ausgabe (WinT-1000) angelegt hat – wird weiter gelesen und mitgepflegt
 *  - CONFIG_FORMATS:  zusätzlich lesbare Formate beim Import einer exportierten Konfiguration
 *  - LEGACY_SCHEMES:  frühere Link-Schemata, die weiter angenommen werden
 */
module.exports = {
  LEGACY_DATA_DIRS: { darwin: 'MacTerm', win32: 'WinT-1000' },
  SHARED_PEER: { prefix: 'WinT-1000', format: 'wint1000-shared' },
  CONFIG_FORMATS: ['wint1000-config', 'mact1000-config'],
  LEGACY_SCHEMES: ['wint1000']
};
