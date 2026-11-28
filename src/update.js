'use strict';
/*
 * Update-Prüfung gegen das neueste Release auf GitHub.
 * 1. GitHub-API  /repos/<repo>/releases/latest  (Version, Link, Datum, Beschreibung)
 * 2. Ausweichweg, falls die API nicht antwortet oder das Limit (60 Anfragen/h je IP) erreicht ist:
 *    https://github.com/<repo>/releases/latest leitet auf …/releases/tag/vX.Y.Z weiter → Version aus der Adresse.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { isNewer, cmpVer } = require('./version');

const REPO = 'denkteich/MacT-1000';
const RELEASES_URL = `https://github.com/${REPO}/releases`;

function get(url, { timeout = 10000, headers = {}, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'http:' ? http : https).get(u, { headers, timeout }, (res) => {
      if (redirects > 0 && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, u).toString(), { timeout, headers, redirects: redirects - 1 }));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 2e6) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, url }));
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
  });
}

const tagToVersion = (t) => String(t || '').trim().replace(/^v/i, '');

function friendly(e) {
  const c = e && e.code;
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'GitHub nicht erreichbar (keine Internetverbindung oder DNS-Problem)';
  if (c === 'ECONNREFUSED' || c === 'ECONNRESET') return 'Verbindung zu GitHub fehlgeschlagen';
  if (c === 'CERT_HAS_EXPIRED' || /certificate/i.test(String(e && e.message))) return 'Zertifikatsfehler bei der Verbindung zu GitHub (Proxy?)';
  return (e && e.message) || String(e);
}

/**
 * @returns {Promise<{ok, current, latest, tag, url, name, publishedAt, notes, newer, ahead, checkedAt, source, error}>}
 */
async function checkLatest(current, opts = {}) {
  const apiUrl = opts.apiUrl || process.env.MACT_UPDATE_API || `https://api.github.com/repos/${REPO}/releases/latest`;
  const pageUrl = opts.pageUrl || process.env.MACT_UPDATE_PAGE || `${RELEASES_URL}/latest`;
  const ua = { 'User-Agent': `MacT-1000/${current}`, Accept: 'application/vnd.github+json' };
  const out = { ok: false, current, checkedAt: new Date().toISOString(), releasesUrl: RELEASES_URL };
  const finish = (r) => {
    Object.assign(out, r, { ok: true });
    out.newer = isNewer(out.latest, current);
    out.ahead = !out.newer && cmpVer(current, out.latest) > 0;
    return out;
  };
  let apiErr = '';
  try {
    const r = await get(apiUrl, { timeout: opts.timeout || 10000, headers: ua });
    if (r.status === 200) {
      const j = JSON.parse(r.body);
      if (j && j.tag_name) {
        return finish({ latest: tagToVersion(j.tag_name), tag: j.tag_name, url: j.html_url || `${RELEASES_URL}/tag/${j.tag_name}`,
          name: j.name || j.tag_name, publishedAt: j.published_at || j.created_at || '', notes: String(j.body || '').slice(0, 4000), source: 'api',
          assets: (Array.isArray(j.assets) ? j.assets : []).map(x => ({ name: x.name, size: x.size, digest: x.digest || '', url: x.browser_download_url })) });
      }
      apiErr = 'unerwartete Antwort der GitHub-API';
    } else if (r.status === 404) apiErr = 'noch kein veröffentlichtes Release gefunden';
    else if (r.status === 403 || r.status === 429) apiErr = 'Abfragelimit der GitHub-API erreicht';
    else apiErr = `GitHub-API antwortet mit Status ${r.status}`;
  } catch (e) { apiErr = friendly(e); }
  // Ausweichweg über die Weiterleitung der Release-Seite
  try {
    const r = await get(pageUrl, { timeout: opts.timeout || 10000, headers: { 'User-Agent': ua['User-Agent'] } });
    const loc = r.headers.location || '';
    const m = /\/releases\/tag\/([^/?#]+)/.exec(loc);
    if (r.status >= 300 && r.status < 400 && m) {
      const tag = decodeURIComponent(m[1]);
      return finish({ latest: tagToVersion(tag), tag, url: new URL(loc, pageUrl).toString(), name: `MacT-1000 ${tag}`, publishedAt: '', notes: '', source: 'page' });
    }
  } catch (_) { /* Fehler der API melden */ }
  out.error = apiErr || 'Release-Information nicht gefunden';
  return out;
}

module.exports = { checkLatest, tagToVersion, REPO, RELEASES_URL };
