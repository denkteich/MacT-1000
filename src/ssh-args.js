'use strict';
const os = require('os');

function splitArgs(str) {
  // einfache Shell-artige Argumentzerlegung mit Quotes
  const out = []; let cur = ''; let q = null; let has = false;
  for (let i = 0; i < (str || '').length; i++) {
    const c = str[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < str.length) cur += str[++i]; else cur += c; }
    else if (c === '"' || c === "'") { q = c; has = true; }
    else if (c === '\\' && i + 1 < str.length) { cur += str[++i]; has = true; }
    else if (/\s/.test(c)) { if (cur || has) { out.push(cur); cur = ''; has = false; } }
    else { cur += c; has = true; }
  }
  if (cur || has) out.push(cur);
  return out;
}

function expandHome(p) { return p && p.startsWith('~') ? p.replace(/^~/, os.homedir()) : p; }

module.exports = { splitArgs, expandHome };
