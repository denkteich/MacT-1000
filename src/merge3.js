'use strict';
/**
 * 3-Wege-Zusammenführung für die gemeinsame Konfiguration.
 * base = gemeinsamer Ausgangsstand, ours = eigene Änderung, theirs = Stand eines anderen Rechners.
 * - Nur einer hat geändert → dessen Stand gilt.
 * - Beide haben geändert:
 *   Listen von Objekten mit id (Sessions, Makros, Trigger) → pro Eintrag zusammenführen,
 *   Listen einfacher Werte (Ordner) → als Menge (Hinzufügen/Entfernen beider Seiten),
 *   Objekte → pro Schlüssel, sonst gewinnt die eigene (zuletzt gespeicherte) Änderung.
 */

function stable(v) {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
const eq = (a, b) => stable(a) === stable(b);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isIdList = (a) => Array.isArray(a) && a.every(x => isObj(x) && typeof x.id === 'string' && x.id);
const isPrimList = (a) => Array.isArray(a) && a.every(x => x === null || typeof x !== 'object');

function mergeIdList(base, ours, theirs) {
  const B = new Map(base.map(x => [x.id, x]));
  const O = new Map(ours.map(x => [x.id, x]));
  const T = new Map(theirs.map(x => [x.id, x]));
  const ids = (l) => l.map(x => x.id);
  // Reihenfolge: hat man selbst umsortiert, gilt die eigene, sonst die fremde
  const primary = eq(ids(base), ids(ours)) ? theirs : ours;
  const secondary = primary === ours ? theirs : ours;
  const order = [...ids(primary)];
  const seen = new Set(order);
  for (const id of ids(secondary)) if (!seen.has(id)) { order.push(id); seen.add(id); }
  const out = [];
  for (const id of order) {
    const v = merge3(B.get(id), O.get(id), T.get(id));
    if (v !== undefined) out.push(v);
  }
  return out;
}

function mergeSet(base, ours, theirs) {
  const b = new Set(base.map(stable));
  const o = new Set(ours.map(stable));
  const removed = new Set([...b].filter(x => !o.has(x)));
  const out = theirs.filter(x => !removed.has(stable(x)));
  const have = new Set(out.map(stable));
  for (const x of ours) { const k = stable(x); if (!b.has(k) && !have.has(k)) { out.push(x); have.add(k); } }
  return clone(out);
}

function merge3(base, ours, theirs) {
  if (eq(ours, theirs)) return clone(ours);
  if (eq(base, ours)) return clone(theirs);
  if (eq(base, theirs)) return clone(ours);
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    const b = Array.isArray(base) ? base : [];
    if (isIdList(ours) && isIdList(theirs) && isIdList(b)) return mergeIdList(b, ours, theirs);
    if (isPrimList(ours) && isPrimList(theirs) && isPrimList(b)) return mergeSet(b, ours, theirs);
    return clone(ours);
  }
  if (isObj(ours) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(ours)])) {
      const v = merge3(b[k], ours[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return clone(ours);
}

module.exports = { merge3, eq, clone, stable };
