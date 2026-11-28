'use strict';
/* global S, h, $, toast, api, saveSettings, setSideTab, fmtSize */
/**
 * Seitenleisten-Tab „Server“: TFTP, FTP, HTTP und SFTP/SCP.
 * Jeder Server hat eine aufklappbare Karte mit Einstellungen und Start/Stopp;
 * darunter ein gemeinsames Protokoll aller Übertragungen.
 */
const SRV_DEF = [
  { kind: 'tftp', name: 'TFTP', port: 69, auth: false, del: false, hint: 'Für Switches, Router, Telefone und PXE: Konfigurationen und Firmware sichern/einspielen.' },
  { kind: 'ftp', name: 'FTP', port: 21, auth: true, del: true, anon: true, hint: 'Klassisches FTP (aktiv und passiv). Achtung: Passwörter werden unverschlüsselt übertragen.' },
  { kind: 'http', name: 'HTTP', port: 8080, auth: true, del: true, optAuth: true, listing: true, hint: 'Dateien per Browser, curl oder wget abholen; Hochladen per PUT/POST oder im Browser.' },
  { kind: 'ssh', name: 'SFTP/SCP', port: 2222, auth: true, del: true, keys: true, hint: 'Verschlüsselt über SSH: SFTP und klassisches SCP (auch für Netzwerkgeräte). Kein Shell-Zugang.' }
];
const SRV = { st: {}, cfg: {}, open: 'tftp', built: false, log: new Map() };
const srvErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const sid = (k, f) => `#srv-${k}-${f}`;

function srvBuild() {
  const root = $('#side-servers');
  root.innerHTML = '';
  const cards = h('div', { class: 'srv-cards' });
  for (const d of SRV_DEF) cards.append(srvCard(d));
  root.append(
    h('div', { class: 'tftp-head' }, h('span', { class: 'tftp-title' }, 'Server'), h('span', { id: 'srv-summary', class: 'tftp-state' }, 'alle gestoppt')),
    cards,
    h('div', { class: 'fx-jobs-head' }, h('span', { style: { flex: '1' } }, 'Übertragungen'),
      h('button', { class: 'p-btn', title: 'Abgeschlossene entfernen', onclick: srvClearLog }, 'Leeren')),
    h('div', { id: 'srv-log', class: 'tftp-log' }),
    h('div', { class: 'side-foot' }, h('span', { id: 'srv-count' }, '')));
  SRV.built = true;
}

function srvCard(d) {
  const k = d.kind, c = SRV.cfg[k] || {};
  const inp = (f, attrs) => h('input', { id: `srv-${k}-${f}`, class: 'tftp-in', spellcheck: 'false', ...attrs });
  const chk = (f, label, val) => { const i = h('input', { type: 'checkbox', id: `srv-${k}-${f}` }); i.checked = !!val; return h('label', { class: 'tftp-chk' }, i, ' ' + label); };
  const dirIn = inp('dir', { type: 'text', placeholder: 'Verzeichnis wählen…', value: c.root || '' });
  const form = h('div', { class: 'tftp-form' },
    h('label', { class: 'tftp-lbl' }, 'Verzeichnis'),
    h('div', { class: 'tftp-row' }, dirIn,
      h('button', { class: 'p-btn', id: `srv-${k}-pick`, title: 'Verzeichnis wählen', onclick: async () => { const p = await api.srv.pickDir(dirIn.value); if (p) dirIn.value = p; } }, 'Wählen…')),
    h('div', { class: 'tftp-row' },
      h('div', { class: 'tftp-col', style: { flex: '0 0 74px' } }, h('label', { class: 'tftp-lbl' }, 'Port'), inp('port', { type: 'number', min: '1', max: '65535', value: String(c.port || d.port) })),
      h('div', { class: 'tftp-col', style: { flex: '1' } }, h('label', { class: 'tftp-lbl' }, 'Adresse'), h('select', { id: `srv-${k}-host`, class: 'tftp-in' }))));
  if (d.auth) {
    form.append(h('div', { class: 'tftp-row' },
      h('div', { class: 'tftp-col', style: { flex: '1' } }, h('label', { class: 'tftp-lbl' }, d.optAuth ? 'Benutzer (leer = ohne Anmeldung)' : 'Benutzer'), inp('user', { type: 'text', autocomplete: 'off', value: c.user || '' })),
      h('div', { class: 'tftp-col', style: { flex: '1' } }, h('label', { class: 'tftp-lbl' }, 'Passwort'), inp('pass', { type: 'password', autocomplete: 'new-password', placeholder: c.hasPassword ? 'gespeichert' : '' }))));
  }
  if (d.anon) form.append(chk('anon', 'Anonym erlauben (nur Lesen)', c.anonymous));
  if (d.keys) {
    form.append(h('label', { class: 'tftp-lbl' }, 'Öffentliche Schlüssel (optional, authorized_keys-Format)'),
      h('textarea', { id: `srv-${k}-keys`, class: 'tftp-in srv-keys', spellcheck: 'false', rows: '2', placeholder: 'ssh-ed25519 AAAA… benutzer@rechner' }, c.authorizedKeys || ''));
  }
  if (d.listing) form.append(chk('list', 'Verzeichnisliste anzeigen', c.listing !== false));
  form.append(chk('write', d.kind === 'tftp' ? 'Hochladen erlauben' : 'Hochladen und Ordner anlegen', c.allowWrite),
    chk('over', 'Vorhandene überschreiben', c.overwrite));
  if (d.del) form.append(chk('del', 'Löschen und Umbenennen', c.allowDelete));
  form.append(h('div', { class: 'tftp-row', style: { marginTop: '6px' } },
    h('button', { id: `srv-${k}-toggle`, class: 'btn primary small', style: { flex: '1' }, onclick: () => srvToggle(k) }, 'Starten'),
    h('button', { class: 'btn small', title: 'Verzeichnis im Finder öffnen', onclick: () => { const p = (SRV.st[k] && SRV.st[k].root) || dirIn.value; if (p) api.srv.reveal(p); } }, 'Im Finder')));
  const card = h('div', { class: 'srv-card', id: `srv-${k}-card` },
    h('div', { class: 'srv-card-head', onclick: (e) => { if (e.target.closest('button')) return; SRV.open = SRV.open === k ? '' : k; renderServers(); } },
      h('span', { class: 'srv-caret' }, '▸'),
      h('span', { class: 'srv-name' }, d.name),
      h('span', { class: 'srv-port', id: `srv-${k}-portlbl` }, ''),
      h('span', { id: `srv-${k}-state`, class: 'tftp-state' }, 'gestoppt'),
      h('button', { class: 'p-btn srv-quick', id: `srv-${k}-quick`, title: 'Starten/Stoppen', onclick: () => srvToggle(k) }, 'Start')),
    h('div', { class: 'srv-body', id: `srv-${k}-body` }, form, h('div', { id: `srv-${k}-info`, class: 'tftp-info' })));
  const wr = card.querySelector(sid(k, 'write'));
  wr.addEventListener('change', () => renderServers());
  card.querySelector(sid(k, 'port')).addEventListener('input', () => renderServers());
  return card;
}

function srvHostOptions(k, sel, current) {
  const st = SRV.st[k] || {};
  const list = [{ v: '0.0.0.0', t: 'Alle Netzwerke (0.0.0.0)' }, ...(st.addresses || []).map(a => ({ v: a.address, t: `${a.address} (${a.ifname})` })), { v: '127.0.0.1', t: 'Nur dieser Mac (127.0.0.1)' }];
  if (current && !list.some(o => o.v === current)) list.push({ v: current, t: current + ' (nicht vorhanden)' });
  const key = list.map(o => o.v).join('|');
  if (sel.dataset.key === key && sel.value === current) return;
  sel.innerHTML = '';
  for (const o of list) sel.append(h('option', { value: o.v }, o.t));
  sel.value = current || '0.0.0.0';
  sel.dataset.key = key;
}

function srvFormValues(k) {
  const d = SRV_DEF.find(x => x.kind === k);
  const v = (f) => { const el = $(sid(k, f)); return el ? el.value : ''; };
  const c = (f) => { const el = $(sid(k, f)); return !!(el && el.checked); };
  const o = { root: v('dir').trim(), port: parseInt(v('port'), 10), host: v('host') || '0.0.0.0', allowWrite: c('write'), overwrite: c('write') && c('over'), allowDelete: c('del') };
  if (d.auth) { o.user = v('user').trim(); o.password = v('pass'); }
  if (d.anon) o.anonymous = c('anon');
  if (d.listing) o.listing = c('list');
  if (d.keys) o.authorizedKeys = v('keys');
  return o;
}

async function srvToggle(k) {
  const d = SRV_DEF.find(x => x.kind === k);
  const btns = [$(sid(k, 'toggle')), $(sid(k, 'quick'))];
  btns.forEach(b => { b.disabled = true; });
  try {
    if (SRV.st[k] && SRV.st[k].running) { srvApply(k, await api.srv.stop(k)); toast(`${d.name}-Server gestoppt`); return; }
    const o = srvFormValues(k);
    if (!o.root) { SRV.open = k; renderServers(); toast('Bitte zuerst ein Verzeichnis wählen'); return; }
    if (!(o.port >= 1 && o.port <= 65535)) { SRV.open = k; renderServers(); toast('Ungültiger Port'); return; }
    if (d.auth && o.user && !o.password && !(SRV.cfg[k] && SRV.cfg[k].hasPassword && SRV.cfg[k].user === o.user) && !(k === 'ssh' && o.authorizedKeys.trim())) {
      SRV.open = k; renderServers(); toast('Bitte ein Passwort angeben'); $(sid(k, 'pass')).focus(); return;
    }
    const st = await api.srv.start(k, o);
    const { password, ...cfg } = o;
    SRV.cfg[k] = { ...(SRV.cfg[k] || {}), ...cfg, hasPassword: !!(password || (SRV.cfg[k] && SRV.cfg[k].hasPassword && SRV.cfg[k].user === o.user)) };
    if ($(sid(k, 'pass'))) { $(sid(k, 'pass')).value = ''; $(sid(k, 'pass')).placeholder = SRV.cfg[k].hasPassword ? 'gespeichert' : ''; }
    srvApply(k, st);
    toast(`${d.name}-Server läuft auf Port ${st.port}`);
  } catch (e) {
    toast(`${d.name}: ${srvErr(e)}`, 6000);
  } finally { btns.forEach(b => { b.disabled = false; }); }
}

function srvApply(k, st) {
  if (!st) return;
  const prev = SRV.st[k] || {};
  SRV.st[k] = { ...prev, ...st };
  if (Array.isArray(st.log)) {
    for (const [id, i] of [...SRV.log]) if (i.srv === k) SRV.log.delete(id);
    for (const i of st.log) SRV.log.set(i.id, { ...i, srv: k });
    SRV.log = new Map([...SRV.log].sort((a, b) => b[1].started - a[1].started));
  }
  if (prev.running && !st.running && st.error) toast(`${(SRV_DEF.find(x => x.kind === k) || {}).name}: ${st.error}`, 5000);
  renderServers();
}

function srvOnTransfer({ kind, info }) {
  const had = SRV.log.has(info.id);
  const it = { ...info, srv: kind };
  if (had) SRV.log.set(info.id, it);
  else SRV.log = new Map([[info.id, it], ...SRV.log]);
  if (SRV.st[kind]) SRV.st[kind].active = [...SRV.log.values()].filter(i => i.srv === kind && i.state === 'running').length;
  renderServers();
}

async function srvClearLog() {
  for (const d of SRV_DEF) { try { srvApply(d.kind, await api.srv.clearLog(d.kind)); } catch (_) {} }
}

function srvExamples(k, st, ip) {
  const p = st.port, u = st.user || 'benutzer';
  switch (k) {
    case 'tftp': return [`copy running-config tftp://${ip}${p === 69 ? '' : ':' + p}/`, `curl -O tftp://${ip}${p === 69 ? '' : ':' + p}/datei.bin`];
    case 'ftp': return [`ftp://${st.anonymous && !st.user ? '' : u + '@'}${ip}${p === 21 ? '' : ':' + p}/`, `copy running-config ftp://${u}:<passwort>@${ip}/`];
    case 'http': return [`http://${ip}${p === 80 ? '' : ':' + p}/`, `curl ${st.auth ? `-u ${u} ` : ''}-T datei.bin http://${ip}${p === 80 ? '' : ':' + p}/`];
    case 'ssh': return [`sftp -P ${p} ${u}@${ip}`, `scp -O -P ${p} datei.bin ${u}@${ip}:/`, `copy running-config scp://${u}@${ip}/`];
    default: return [];
  }
}

function renderServers() {
  const running = SRV_DEF.filter(d => SRV.st[d.kind] && SRV.st[d.kind].running);
  const ind = $('#srv-ind');
  if (ind) { ind.hidden = !running.length; ind.textContent = 'Server: ' + running.map(d => d.name).join(', '); }
  if (!SRV.built || $('#side-servers').hidden) return;
  $('#srv-summary').textContent = running.length ? `${running.length} von ${SRV_DEF.length} läuft` : 'alle gestoppt';
  $('#srv-summary').className = 'tftp-state' + (running.length ? ' on' : '');
  for (const d of SRV_DEF) {
    const k = d.kind, st = SRV.st[k] || {}, run = !!st.running;
    const card = $(sid(k, 'card'));
    card.classList.toggle('open', SRV.open === k);
    card.classList.toggle('running', run);
    $(sid(k, 'body')).hidden = SRV.open !== k;
    const state = $(sid(k, 'state'));
    state.textContent = run ? (st.active ? `läuft · ${st.active} aktiv` : 'läuft') : 'gestoppt';
    state.className = 'tftp-state' + (run ? ' on' : '');
    $(sid(k, 'portlbl')).textContent = ':' + (run ? st.port : ($(sid(k, 'port')).value || d.port));
    const q = $(sid(k, 'quick')); q.textContent = run ? 'Stopp' : 'Start'; q.classList.toggle('danger', run);
    for (const f of ['dir', 'port', 'host', 'pick', 'write', 'user', 'pass', 'anon', 'list', 'keys', 'del']) { const el = $(sid(k, f)); if (el) el.disabled = run; }
    const wr = $(sid(k, 'write'));
    $(sid(k, 'over')).disabled = run || !wr.checked;
    if (run) {
      $(sid(k, 'dir')).value = st.root; $(sid(k, 'port')).value = st.port;
      wr.checked = st.allowWrite; $(sid(k, 'over')).checked = st.overwrite;
      if ($(sid(k, 'del'))) $(sid(k, 'del')).checked = st.allowDelete;
      if ($(sid(k, 'user'))) $(sid(k, 'user')).value = st.user || '';
    }
    srvHostOptions(k, $(sid(k, 'host')), run ? st.host : ($(sid(k, 'host')).value || (SRV.cfg[k] || {}).host || '0.0.0.0'));
    const btn = $(sid(k, 'toggle'));
    btn.textContent = run ? 'Stoppen' : 'Starten';
    btn.className = 'btn small ' + (run ? 'danger' : 'primary');
    const info = $(sid(k, 'info'));
    info.innerHTML = '';
    if (run) {
      const addrs = st.host === '0.0.0.0' ? (st.addresses || []).map(a => a.address) : [st.host];
      const rights = st.allowWrite ? `Lesen und Schreiben${st.overwrite ? ', Überschreiben' : ''}${st.allowDelete ? ', Löschen' : ''}` : 'Nur Lesen';
      info.append(
        h('div', null, 'Erreichbar unter: ', h('b', null, addrs.length ? addrs.map(a => `${a}:${st.port}`).join(', ') : 'keine Netzwerkadresse')),
        h('div', null, rights + (k === 'ftp' && st.anonymous ? ' · anonym erlaubt' : '') + (k === 'http' && !st.auth ? ' · ohne Anmeldung' : '')));
      if (k === 'ssh' && st.fingerprint) info.append(h('div', null, 'Host-Schlüssel: ', h('b', null, st.fingerprint)));
      for (const ex of srvExamples(k, st, addrs[0] || '<IP-des-Mac>')) {
        info.append(h('div', { class: 'tftp-ex', title: 'Beispiel – klicken zum Kopieren', onclick: () => { api.writeClipboard(ex); toast('Beispiel kopiert'); } }, ex));
      }
    } else {
      info.append(h('div', null, d.hint));
      if ((parseInt($(sid(k, 'port')).value, 10) || d.port) < 1024) info.append(h('div', { class: 'tftp-hint' }, 'Ports unter 1024 sind Standard-Ports. Die macOS-Firewall fragt ggf. beim ersten Start, ob eingehende Verbindungen erlaubt werden sollen.'));
      if (k === 'ssh' && st.fingerprint) info.append(h('div', null, 'Host-Schlüssel: ', h('b', null, st.fingerprint)));
    }
  }

  const list = $('#srv-log');
  list.innerHTML = '';
  const items = [...SRV.log.values()];
  if (!items.length) list.append(h('div', { class: 'tftp-empty' }, running.length ? 'Noch keine Übertragungen.' : ''));
  for (const i of items.slice(0, 150)) {
    const name = (SRV_DEF.find(x => x.kind === i.srv) || {}).name || i.srv;
    const pct = i.size ? Math.min(100, Math.round(i.bytes / i.size * 100)) : (i.state === 'done' ? 100 : 0);
    const arrow = i.kind === 'auth' ? '!' : i.kind === 'get' ? '↑' : '↓';
    const statusText = i.state === 'error' ? i.error
      : i.state === 'done' ? `${i.kind === 'get' ? 'gesendet' : 'empfangen'} · ${fmtSize(i.bytes)} · ${new Date(i.ended).toLocaleTimeString(LOC())}`
        : `${fmtSize(i.bytes)}${i.size ? ' von ' + fmtSize(i.size) : ''}`;
    const who = String(i.peer || '').replace(/:\d+$/, '');
    list.append(h('div', { class: 'fx-job ' + i.state, title: `${name} · ${i.kind === 'auth' ? 'Anmeldung' : i.kind === 'get' ? 'Gerät lädt herunter' : 'Gerät lädt hoch'}: ${i.file}\n${i.peer}${i.user ? ' · ' + i.user : ''}` },
      h('div', { class: 'fx-job-top' }, h('span', { class: 'tftp-arrow' }, arrow), h('span', { class: 'srv-tag' }, name), h('span', { class: 'fx-job-name' }, i.file), h('span', { class: 'tftp-peer' }, who)),
      i.kind === 'auth' ? null : h('div', { class: 'fx-bar' }, h('div', { style: { width: pct + '%' } })),
      h('div', { class: 'fx-job-status' }, statusText)));
  }
  const done = items.filter(i => i.state === 'done').length, err = items.filter(i => i.state === 'error').length;
  $('#srv-count').textContent = items.length ? `${done} fertig${err ? ' · ' + err + ' Fehler' : ''}` : '';
}

async function toggleServersPanel() {
  if (!$('#sidebar').hidden && !$('#side-servers').hidden) { setSideTab('sessions'); return; }
  if (S.settings.sidebarVisible === false) await saveSettings({ sidebarVisible: true });
  setSideTab('servers');
}

async function initServers() {
  try {
    const all = await api.srv.all();
    for (const [k, v] of Object.entries(all)) { SRV.cfg[k] = v.config || {}; SRV.st[k] = v.status || {}; }
  } catch (_) {}
  srvBuild();
  for (const d of SRV_DEF) if (SRV.st[d.kind]) srvApply(d.kind, SRV.st[d.kind]);
  api.srv.onTransfer(srvOnTransfer);
  api.srv.onStatus(({ kind, status }) => srvApply(kind, status));
  $('#srv-ind').addEventListener('click', () => setSideTab('servers'));
  renderServers();
}
