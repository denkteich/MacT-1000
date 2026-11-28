'use strict';
/** Versionsvergleich (x.y.z, optional -suffix). Leere/ungültige Versionen gelten als „unbekannt“ (= kleiner als jede echte). */
function parts(v) {
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(String(v || ''));
  return m ? { n: [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)], pre: m[4] || '' } : null;
}
function cmpVer(a, b) {
  const A = parts(a), B = parts(b);
  if (!A || !B) return A ? 1 : (B ? -1 : 0);
  for (let i = 0; i < 3; i++) if (A.n[i] !== B.n[i]) return A.n[i] < B.n[i] ? -1 : 1;
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1; // 1.2.0 > 1.2.0-beta
  if (!B.pre) return -1;
  return A.pre < B.pre ? -1 : 1;
}
function maxVer(...list) {
  let best = '';
  for (const v of list) if (parts(v) && (!best || cmpVer(v, best) > 0)) best = String(v).trim();
  return best;
}
const isNewer = (v, than) => !!parts(v) && cmpVer(v, than) > 0;
module.exports = { cmpVer, maxVer, isNewer };
