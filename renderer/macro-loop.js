'use strict';
/*
 * Schleifen in Makros.
 *
 * Schritt „Schleife“ = { t:'loop', var:'Port', mode:'num'|'list', values:'1,2,3 7-10' }
 * Schritt „Schleifenende“ = { t:'end' }
 * Alles zwischen loop und dem passenden end wird je Wert einmal ausgeführt, verschachtelt erlaubt.
 * Im Schleifenrumpf stehen {{Port}} (aktueller Wert) und {{Port#}} (laufende Nummer ab 1) zur Verfügung.
 *
 * Zahlen (mode 'num'): Einträge durch Komma, Semikolon oder Leerzeichen getrennt.
 *   5          einzelne Zahl
 *   7-10       Bereich (auch absteigend: 10-7)
 *   0-100/10   Bereich mit Schrittweite
 *   01-12      führende Nullen bleiben erhalten (01, 02 … 12)
 * Texte (mode 'list'): durch Komma getrennt, Leerzeichen am Rand werden entfernt, \, = Komma im Wert.
 */
const LOOP_MAX = 10000;           // max. Werte je Schleife
const LOOP_VAR_RE = /^[A-Za-z_\u00c0-\u024f][\w\u00c0-\u024f.-]*$/;

function parseLoopValues(spec, mode) {
  const s = String(spec == null ? '' : spec);
  if (mode === 'list') {
    const out = []; let cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && s[i + 1] === ',') { cur += ','; i++; continue; }
      if (c === ',' || c === '\n') { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    const vals = out.map(x => x.trim()).filter(x => x !== '');
    if (!vals.length) return { values: [], error: 'keine Werte angegeben' };
    if (vals.length > LOOP_MAX) return { values: [], error: `zu viele Werte (max. ${LOOP_MAX})` };
    return { values: vals };
  }
  const toks = s.split(/[\s,;]+/).filter(Boolean);
  if (!toks.length) return { values: [], error: 'keine Zahlen angegeben' };
  const vals = [];
  for (const tk of toks) {
    const m = /^(-?\d+)(?:\s*(?:-|\.\.)\s*(-?\d+)(?:\/(\d+))?)?$/.exec(tk);
    if (!m) return { values: [], error: `„${tk}“ ist keine Zahl und kein Bereich (z.B. 7-10)` };
    const pad = (a) => (/^-?0\d/.test(a) ? a.replace('-', '').length : 0);
    const fmt = (n, w) => (w ? (n < 0 ? '-' : '') + String(Math.abs(n)).padStart(w, '0') : String(n));
    const a = parseInt(m[1], 10);
    if (m[2] === undefined) { vals.push(fmt(a, pad(m[1]))); continue; }
    const b = parseInt(m[2], 10);
    const step = m[3] !== undefined ? parseInt(m[3], 10) : 1;
    if (!(step > 0)) return { values: [], error: `Schrittweite in „${tk}“ muss größer als 0 sein` };
    const w = Math.max(pad(m[1]), pad(m[2]));
    const count = Math.floor(Math.abs(b - a) / step) + 1;
    if (vals.length + count > LOOP_MAX) return { values: [], error: `zu viele Werte (max. ${LOOP_MAX})` };
    const dir = b >= a ? 1 : -1;
    for (let k = 0, n = a; k < count; k++, n += dir * step) vals.push(fmt(n, w));
  }
  if (vals.length > LOOP_MAX) return { values: [], error: `zu viele Werte (max. ${LOOP_MAX})` };
  return { values: vals };
}

// Zuordnung Schleifenanfang ↔ Schleifenende (Index → Index), Tiefe je Schritt
function loopStructure(steps) {
  const pair = {}; const depth = []; const stack = [];
  const errors = [];
  (steps || []).forEach((st, i) => {
    if (st.t === 'end') {
      if (!stack.length) { errors.push(`Schritt ${i + 1}: „Schleifenende“ ohne passende Schleife`); depth.push(0); return; }
      const j = stack.pop(); pair[j] = i; pair[i] = j; depth.push(stack.length);
      return;
    }
    depth.push(stack.length);
    if (st.t === 'loop') stack.push(i);
  });
  for (const j of stack) errors.push(`Schritt ${j + 1}: Schleife ohne „Schleifenende“`);
  return { pair, depth, errors };
}

// Namen aller Schleifenvariablen (inkl. „Name#“), damit sie beim Start nicht abgefragt werden
function loopVarNames(steps) {
  const out = new Set();
  for (const st of steps || []) if (st.t === 'loop' && st.var) { out.add(st.var); out.add(st.var + '#'); }
  return out;
}

// Prüfung beim Speichern; Werte mit {{Variable}} werden erst beim Start ausgewertet
function validateLoops(steps) {
  const { errors } = loopStructure(steps);
  (steps || []).forEach((st, i) => {
    if (st.t !== 'loop') return;
    if (!st.var || !LOOP_VAR_RE.test(st.var)) errors.push(`Schritt ${i + 1}: Ungültiger Variablenname „${st.var || ''}“ (Buchstaben, Ziffern, _ . -)`);
    if (/\{\{[^}]+\}\}/.test(st.values || '')) return;
    const r = parseLoopValues(st.values, st.mode);
    if (r.error) errors.push(`Schritt ${i + 1}: ${r.error}`);
  });
  return errors;
}

function loopPreview(values, max = 6) {
  if (!values.length) return '';
  if (values.length <= max) return values.join(', ');
  return values.slice(0, max - 2).join(', ') + ' … ' + values.slice(-2).join(', ');
}

if (typeof module !== 'undefined') module.exports = { parseLoopValues, loopStructure, loopVarNames, validateLoops, loopPreview, LOOP_MAX };
