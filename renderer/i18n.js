'use strict';
/* Sprachumschaltung Deutsch/Englisch.
 * Die Oberfläche ist auf Deutsch geschrieben; i18n-en.js enthält die englischen Texte
 * (Schlüssel = deutscher Originaltext, {} = Platzhalter für eingesetzte Werte).
 * Wird im Fenster (als globales I18N) und im Hauptprozess (per require) verwendet. */
(function (root) {
  const DICT = (typeof module !== 'undefined' && typeof require === 'function') ? require('./i18n-en.js') : (root.I18N_EN || {});
  let lang = 'de';
  const cache = new Map();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Muster mit Platzhaltern vorbereiten (längstes festes Textstück dient als schneller Vorfilter)
  const patterns = [];
  for (const k of Object.keys(DICT)) {
    if (k.indexOf('{}') < 0) continue;
    const parts = k.split('{}');
    const lit = parts.reduce((a, b) => (b.length > a.length ? b : a), '');
    if ((lit.match(/[A-Za-zÄÖÜäöüß]/g) || []).length < 3) continue; // zu allgemein
    patterns.push({ key: k, lit, rx: new RegExp('^' + parts.map(esc).join('([\\s\\S]*?)') + '$'), parts: DICT[k].split('{}') });
  }
  patterns.sort((a, b) => b.key.length - a.key.length);

  function exact(s) { return Object.prototype.hasOwnProperty.call(DICT, s) ? DICT[s] : undefined; }

  function viaPattern(s, depth) {
    for (const p of patterns) {
      if (p.lit && s.indexOf(p.lit) < 0) continue;
      const m = p.rx.exec(s);
      if (!m) continue;
      let out = p.parts[0];
      for (let i = 1; i < p.parts.length; i++) out += sub(m[i] || '', depth) + p.parts[i];
      return out;
    }
    return undefined;
  }
  // eingesetzte Werte: nur übersetzen, wenn sie selbst ein bekannter Text sind
  function sub(v, depth) {
    if (!v || depth > 2) return v;
    const e = exact(v);
    if (e !== undefined) return e;
    if (v.length > 8 && /[a-zäöüß]{3}/.test(v)) {
      // auch mit kurzem Vorspann (z. B. Plural-„s“ aus dem vorigen Platzhalter)
      for (let k = 0; k <= 3 && k < v.length; k++) {
        const w = v.slice(k);
        const r = exact(w) !== undefined ? exact(w) : viaPattern(w, depth + 1);
        if (r !== undefined) return v.slice(0, k) + r;
      }
    }
    return v;
  }

  const SEPS = [/(\n+)/, /( · )/, /( – )/, /(: )/];
  function split(s, level) {
    for (let i = level; i < SEPS.length; i++) {
      const bits = s.split(SEPS[i]);
      if (bits.length < 3) continue;
      let changed = false;
      const out = bits.map((b, j) => {
        if (j % 2) return b;
        const r = core(b, i + 1);
        if (r !== b) changed = true;
        return r;
      });
      if (changed) return out.join('');
    }
    return s;
  }

  function core(s, level) {
    if (!s) return s;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const lead = m[1], body = m[2], trail = m[3];
    let r = exact(s);
    if (r !== undefined) return r;
    if (body !== s) { r = exact(body); if (r !== undefined) return lead + r + trail; }
    if (!/[A-Za-zÄÖÜäöüß]{2}/.test(body)) return s;
    r = viaPattern(s, 0);
    if (r !== undefined) return r;
    if (body !== s) { r = viaPattern(body, 0); if (r !== undefined) return lead + r + trail; }
    return split(s, level || 0);
  }

  function t(s) {
    if (lang !== 'en' || s === null || s === undefined) return s;
    s = String(s);
    if (cache.has(s)) return cache.get(s);
    const r = core(s, 0);
    if (cache.size > 20000) cache.clear();
    cache.set(s, r);
    return r;
  }

  /** 'auto' | 'de' | 'en' + bevorzugte Systemsprachen → 'de' oder 'en' */
  function resolve(setting, systemLangs) {
    if (setting === 'de' || setting === 'en') return setting;
    const list = (systemLangs || []).filter(Boolean);
    for (const l of list) {
      const c = String(l).toLowerCase();
      if (c.startsWith('de')) return 'de';
      if (c.startsWith('en')) return 'en';
      return 'en'; // erste bevorzugte Sprache ist weder Deutsch noch Englisch → Englisch
    }
    return 'de';
  }

  const api = {
    t,
    resolve,
    get lang() { return lang; },
    setLang(l) { const n = l === 'en' ? 'en' : 'de'; if (n !== lang) { lang = n; cache.clear(); } return lang; },
    has: (s) => exact(s) !== undefined,
    size: () => Object.keys(DICT).length
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof window !== 'undefined' ? window : globalThis);
