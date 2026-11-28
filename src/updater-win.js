'use strict';
/**
 * Update-Hinweis für Windows (ab 1.8.4 ohne automatische Installation):
 *  - Bei einer neuen Version erscheint nur ein Hinweis.
 *  - Der Knopf „Herunterladen“ startet den Download der passenden Datei im Standard-Browser:
 *      installierte Version → MacT-1000-<v>-setup.exe
 *      portable EXE         → MacT-1000-<v>-portable.exe
 *    Fehlt die Datei im Release, wird die Release-Seite geöffnet.
 *  - Es wird nichts im Hintergrund geladen, ersetzt oder installiert.
 *  - Reste der früheren automatischen Updates (userData/updates) werden beim Start entfernt.
 */
const fsp = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const { cmpVer } = require('./version');

const REPO_DL = 'https://github.com/denkteich/MacT-1000/releases/download';
const RELEASES = 'https://github.com/denkteich/MacT-1000/releases';
const KIND_RE = { setup: /^MacT-1000-(\d+\.\d+\.\d+[^-]*)-setup\.exe$/i, portable: /^MacT-1000-(\d+\.\d+\.\d+[^-]*)-portable\.exe$/i };
const assetName = (v, kind = 'setup') => `MacT-1000-${v}-${kind === 'portable' ? 'portable' : 'setup'}.exe`;
const ASSET_RE = KIND_RE.setup;
const okHost = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)github\.com$/.test(x.hostname); } catch (_) { return false; } };

/** Passende Datei aus dem Release (Ergebnis von checkLatest) */
function pickAsset(info, kind = 'setup') {
  const list = (info && Array.isArray(info.assets)) ? info.assets : [];
  const a = list.find(x => KIND_RE[kind === 'portable' ? 'portable' : 'setup'].test(x.name || ''));
  if (a) return { name: a.name, size: a.size || 0, url: a.url };
  // Ausweichweg (Release-Seite statt API): Name nach Konvention
  if (info && info.tag && info.latest && info.source === 'page') {
    const name = assetName(info.latest, kind);
    return { name, size: 0, url: `${REPO_DL}/${encodeURIComponent(info.tag)}/${name}` };
  }
  return null;
}

class Updater extends EventEmitter {
  /**
   * @param {object} o
   *  dir()        frühere Update-Ablage (userData/updates) – wird nur aufgeräumt
   *  current      laufende Version
   *  manualOnly   true = portable EXE (lädt die portable EXE statt des Installers)
   *  openUrl(url) öffnet eine Adresse im Standard-Browser (shell.openExternal)
   *  allowAnyHost Tests: auch andere Server als GitHub zulassen
   */
  constructor(o) {
    super();
    this.o = o;
    this.state = { phase: 'idle' };
  }
  kind() { return this.o.manualOnly ? 'portable' : 'setup'; }
  dir() { return typeof this.o.dir === 'function' ? this.o.dir() : this.o.dir; }
  set(p) { this.state = { ...this.state, ...p }; this.emit('state', this.status()); }
  status() { return { ...this.state, manual: true, notifyOnly: true, kind: this.kind(), canInstall: true }; }

  /** Startet den Download der neuen Version im Browser. */
  async prepare(info) {
    if (!info || !info.latest || !(cmpVer(info.latest, this.o.current) > 0)) throw new Error('Keine neuere Version vorhanden');
    const kind = this.kind();
    const asset = pickAsset(info, kind);
    let url = asset && asset.url;
    let fallback = false;
    if (!url || (!this.o.allowAnyHost && !okHost(url))) { url = (info.url && okHost(info.url)) ? info.url : RELEASES; fallback = true; }
    if (this.o.openUrl) await this.o.openUrl(url);
    this.set({ phase: 'opened', version: info.latest, from: this.o.current, asset: asset ? asset.name : assetName(info.latest, kind), openedUrl: url, fallback, openedAt: Date.now() });
    return this.status();
  }

  cancel() { return this.status(); }
  install() { throw new Error('Unter Windows wird nicht automatisch installiert – bitte die heruntergeladene Datei starten.'); }

  /** Reste früherer automatischer Updates entfernen; liefert kein Ergebnis mehr. */
  async takeResult() {
    const d = this.dir();
    if (d) await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
    return null;
  }
}

module.exports = { Updater, pickAsset, assetName, ASSET_RE, KIND_RE, okHost };
