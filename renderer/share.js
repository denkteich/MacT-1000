'use strict';
/* global api, S, h, toast, openModal, field, inp, sel, chk, confirmDialog, sessionTitle, IS_WIN, activePane, setActivePane, kb, tx */
/**
 * Pane-Freigabe – Oberfläche
 *  - freigebende Seite: Dialog „Session freigeben…“, Anzeige „Freigegeben · n“, Verwaltung der Zuschauer,
 *    Rückfrage bei Schreibwunsch, Bildschirminhalt (Snapshot) für neue Zuschauer
 *  - Zuschauer-Seite: Pane vom Typ „share“, feste Größe des freigebenden Panes, Schreibrecht anfordern
 */
const SHARE = { list: [], info: null, managerFor: null, managerRender: null, requests: new Map() };
const SHAREABLE = ['local', 'ssh', 'telnet', 'serial', 'command'];
const SHARE_MODES = [['ro', 'Nur lesen'], ['ask', 'Lesen, Schreiben nach meiner Bestätigung'], ['rw', 'Lesen und Schreiben ohne Rückfrage']];
const SHARE_EXPIRY = [[0, 'Bis ich sie beende'], [60, '1 Stunde'], [240, '4 Stunden'], [480, '8 Stunden'], [1440, '24 Stunden']];

function shareOfPane(p) { return p && p.shareId ? SHARE.list.find(s => s.id === p.shareId) : null; }
function paneOfShare(sh) { for (const p of S.panes.values()) if (p.shareId === sh.id) return p; return null; }
function shareModeLabel(m) { return (SHARE_MODES.find(x => x[0] === m) || SHARE_MODES[0])[1]; }
function fmtTime(ts) { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

/* ---------- Pane-Menü ---------- */
function shareMenuItems(p) {
  const t = p.cfg && p.cfg.type;
  if (t === 'share') {
    const v = p.shareView || {};
    return [{ sep: true },
      v.write ? { label: 'Schreibrecht abgeben', click: () => api.action(p.sessionId, 'releaseWrite'), disabled: p.state !== 'running' }
        : { label: 'Schreibrecht anfordern', click: () => shareRequestWrite(p), disabled: p.state !== 'running' || v.mode === 'ro' }];
  }
  if (!SHAREABLE.includes(t)) return [];
  const sh = shareOfPane(p);
  if (sh) return [{ sep: true }, { label: 'Freigabe verwalten…', click: () => shareManager(p) }, { label: 'Freigabe beenden', click: () => shareStop(p) }];
  return [{ sep: true }, { label: 'Session freigeben…', click: () => shareDialog(p), disabled: p.state !== 'running' }];
}

function shareRequestWrite(p) {
  if (!p.sessionId) return;
  const v = p.shareView || {};
  if (v.mode === 'ro') { toast('Diese Freigabe ist nur zum Lesen'); return; }
  api.action(p.sessionId, 'requestWrite');
  toast(v.mode === 'rw' ? 'Schreibrecht angefordert' : 'Schreibrecht angefordert – wartet auf Bestätigung');
}

/* ---------- Anzeige in der Pane-Kopfzeile ---------- */
function shareUi(p) {
  if (!p.shareEl) return;
  const el = p.shareEl;
  el.className = 'share-ind';
  if (p.cfg && p.cfg.type === 'share') {
    const v = p.shareView;
    if (!v || p.state !== 'running') { el.hidden = true; return; }
    el.hidden = false;
    el.classList.add('viewer', v.write ? 'rw' : 'ro');
    el.textContent = v.write ? tx('Schreibrecht') : tx('Nur lesen');
    el.title = v.write ? tx('Du kannst in dieser freigegebenen Session schreiben – klicken zum Abgeben')
      : v.mode === 'ro' ? tx('Freigabe nur zum Lesen') : tx('Nur lesen – klicken, um Schreibrecht anzufordern');
    p.el.classList.toggle('share-view', true);
    return;
  }
  p.el.classList.remove('share-view');
  const sh = shareOfPane(p);
  if (!sh) { el.hidden = true; p.el.classList.remove('shared-pane'); return; }
  el.hidden = false;
  const n = sh.viewers.length;
  const w = sh.viewers.filter(v => v.write).length;
  const req = sh.viewers.some(v => v.requested);
  el.classList.add('host'); if (w) el.classList.add('rw'); if (req) el.classList.add('req');
  el.textContent = tx(`Freigegeben · ${n}`) + (w ? ' · ' + tx('schreibt') : '');
  el.title = tx(`Freigegeben als „${sh.name}“ (${tx(shareModeLabel(sh.mode))}) – ${n} Zuschauer. Klicken zum Verwalten.`);
  p.el.classList.add('shared-pane');
}
function shareIndClick(p) {
  if (p.cfg && p.cfg.type === 'share') {
    const v = p.shareView || {};
    if (v.write) api.action(p.sessionId, 'releaseWrite'); else shareRequestWrite(p);
    return;
  }
  shareManager(p);
}

/* ---------- Freigeben ---------- */
async function shareDialog(p) {
  if (!p || !p.sessionId || p.state !== 'running') { toast('Nur laufende Sessions können freigegeben werden'); return; }
  const info = await api.share.info();
  const pw = await api.share.genPassword();
  const allow = !!S.settings.shareAllow;
  const pwIn = inp('password', pw, { type: 'text', autocomplete: 'off' });
  const modeSel = sel('mode', 'ro', SHARE_MODES);
  const expSel = sel('expiresIn', 0, SHARE_EXPIRY);
  const nameIn = inp('name', p.title, { placeholder: 'Name, den die Zuschauer sehen' });
  const allowChk = allow ? null : chk('allow', false, 'Freigaben von Panes auf diesem Rechner erlauben');
  const warn = h('p', { class: 'hint warn', hidden: true }, p.cfg.type === 'local'
    ? 'Achtung: Mit Schreibrecht arbeitet der Zuschauer direkt in einer Shell auf diesem Rechner – mit deinen Rechten.'
    : 'Mit Schreibrecht kann der Zuschauer in dieser Session Befehle eingeben – mit deiner Anmeldung.');
  const updWarn = () => { warn.hidden = modeSel.value === 'ro'; };
  modeSel.addEventListener('change', updWarn);
  const addrs = shareAddrList(info);
  const body = h('div', { class: 'settings-form share-form' },
    h('p', { class: 'hint' }, 'Andere Rechner mit MacT-1000 können sich mit diesem Pane verbinden und mitlesen – mit Schreibrecht auch mittippen. Die Verbindung ist verschlüsselt (SSH).'),
    field('Name der Freigabe', nameIn),
    field('Passwort', h('span', { class: 'with-btn' }, pwIn,
      h('button', { class: 'btn small', type: 'button', title: 'Neues Passwort erzeugen', onclick: async () => { pwIn.value = await api.share.genPassword(); } }, '↻'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { api.writeClipboard(pwIn.value); toast('Passwort kopiert'); } }, 'Kopieren')),
    'Mindestens 4 Zeichen. Gib es dem Zuschauer auf einem anderen Weg weiter (z. B. Telefon).'),
    h('div', { class: 'grid2' }, field('Zugriff', modeSel), field('Gültig', expSel)),
    warn,
    h('div', { class: 'share-connect' },
      h('div', { class: 'lbl' }, 'So verbindet sich der Zuschauer'),
      h('div', null, tx('In MacT-1000: Quick Connect') + ' ', h('code', null, `share ${addrs[0] || info.hostname}${info.port !== 7022 ? ':' + info.port : ''}`), ' ' + tx('oder neue Session vom Typ „Freigabe“.')),
      h('div', { class: 'share-addrs' }, tx('Adressen dieses Rechners:') + ' ' + (addrs.length ? addrs.join(', ') : info.hostname) + ` · ${tx('Port')} ${info.port}`),
      h('div', { class: 'share-fp' }, tx('Fingerprint:') + ' ', h('code', null, info.fingerprint || '–'))),
    allowChk,
    h('p', { class: 'hint' }, IS_WIN ? 'Beim ersten Freigeben fragt die Windows-Firewall eventuell, ob eingehende Verbindungen erlaubt werden.' : 'Beim ersten Freigeben fragt macOS eventuell, ob eingehende Verbindungen erlaubt werden.'));
  openModal({
    title: tx(`Session freigeben – ${p.title}`), width: 560, body,
    buttons: [{ label: 'Abbrechen', click: () => {} }, {
      label: 'Freigeben', cls: 'primary', click: async () => {
        if (allowChk && !allowChk.querySelector('input').checked) { toast('Bitte zuerst Freigaben auf diesem Rechner erlauben'); return false; }
        if (String(pwIn.value).length < 4) { toast('Das Passwort muss mindestens 4 Zeichen haben.'); return false; }
        if (modeSel.value !== 'ro' && p.cfg.type === 'local' && !(await confirmDialog('Schreibrecht auf die lokale Shell', 'Zuschauer mit Schreibrecht können auf diesem Rechner Befehle mit deinen Rechten ausführen. Trotzdem freigeben?', 'Freigeben'))) return false;
        if (allowChk) { S.settings.shareAllow = true; await api.saveSettings(S.settings, { shareAllow: true }); }
        if (!p.sessionId) { toast('Die Session läuft nicht mehr'); return; }
        const r = await api.share.start(p.sessionId, { name: nameIn.value || p.title, type: p.cfg.type, password: pwIn.value, mode: modeSel.value, expiresIn: Number(expSel.value) || 0, cols: p.term.cols, rows: p.term.rows });
        if (!r.ok) { toast(r.error, 6000); return false; }
        p.shareId = r.share.id;
        upsertShare(r.share);
        api.writeClipboard(pwIn.value);
        toast(`„${r.share.name}“ freigegeben – Passwort in der Zwischenablage`, 3500);
      }
    }]
  });
}
function shareAddrList(info) {
  const v4 = (info.addresses || []).filter(a => a.family === 'IPv4').map(a => a.address);
  if (info.bind && info.bind !== '0.0.0.0' && info.bind !== '::') return [info.bind];
  return v4.length ? v4 : (info.addresses || []).map(a => a.address);
}

async function shareStop(p, quiet) {
  const sh = shareOfPane(p);
  if (!sh) return;
  if (!quiet && sh.viewers.length && !(await confirmDialog('Freigabe beenden', `${sh.viewers.length} Zuschauer werden getrennt. Freigabe „${sh.name}“ beenden?`, 'Freigabe beenden', { enterConfirms: true }))) return;
  p.shareId = null;
  await api.share.stop(sh.id);
  SHARE.list = SHARE.list.filter(s => s.id !== sh.id);
  shareUi(p);
}

/* ---------- Verwaltung ---------- */
function shareManager(p) {
  const sh0 = shareOfPane(p);
  if (!sh0) return;
  const body = h('div', { class: 'settings-form share-form' });
  let showPw = false;
  const render = () => {
    const sh = shareOfPane(p);
    if (!sh) { m.close(); return; }
    body.textContent = '';
    const modeSel = sel('mode', sh.mode, SHARE_MODES);
    modeSel.addEventListener('change', async () => {
      if (modeSel.value !== 'ro' && p.cfg.type === 'local' && !(await confirmDialog('Schreibrecht auf die lokale Shell', 'Zuschauer mit Schreibrecht können auf diesem Rechner Befehle mit deinen Rechten ausführen. Trotzdem erlauben?', 'Erlauben'))) { modeSel.value = sh.mode; return; }
      const r = await api.share.update(sh.id, { mode: modeSel.value }); if (r && r.ok) upsertShare(r.share);
    });
    const info = SHARE.info || {};
    const addrs = shareAddrList(info);
    body.append(...[
      h('div', { class: 'grid2' },
        field('Name', h('div', { class: 'ro-val' }, sh.name)),
        field('Zugriff', modeSel)),
      h('div', { class: 'grid2' },
        field('Passwort', h('span', { class: 'with-btn' }, h('code', { class: 'ro-val' }, showPw ? sh.password : '••••••••'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { showPw = !showPw; render(); } }, showPw ? 'Verbergen' : 'Anzeigen'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { api.writeClipboard(sh.password); toast('Passwort kopiert'); } }, 'Kopieren'))),
        field('Gültig', h('div', { class: 'ro-val' }, sh.expires ? tx(`bis ${fmtTime(sh.expires)} Uhr`) : tx('bis ich sie beende')))),
      h('div', { class: 'share-connect' },
        h('div', null, tx('Verbinden mit:') + ' ', h('code', null, `share ${addrs[0] || info.hostname || ''}${info.port && info.port !== 7022 ? ':' + info.port : ''}`)),
        h('div', { class: 'share-fp' }, tx('Fingerprint:') + ' ', h('code', null, info.fingerprint || '–'))),
      sh.ended ? h('p', { class: 'hint warn' }, 'Die Session ist beendet. Mit „Neu verbinden“ läuft die Freigabe mit der neuen Verbindung weiter.') : null,
      h('div', { class: 'lbl share-vh' }, tx(`Zuschauer (${sh.viewers.length})`)),
      sh.viewers.length ? h('table', { class: 'share-viewers' },
        h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Adresse'), h('th', null, 'Seit'), h('th', null, 'Recht'), h('th'))),
        h('tbody', null, sh.viewers.map(v => h('tr', null,
          h('td', null, v.name), h('td', null, v.ip), h('td', null, fmtTime(v.since)),
          h('td', null, v.write ? tx('schreibt') : v.requested ? tx('möchte schreiben') : tx('liest')),
          h('td', { class: 'acts' },
            v.write ? h('button', { class: 'btn small', type: 'button', onclick: () => api.share.setWrite(sh.id, v.id, false) }, 'Schreibrecht entziehen')
              : h('button', { class: 'btn small', type: 'button', disabled: sh.mode === 'ro', title: sh.mode === 'ro' ? tx('Zugriff steht auf „Nur lesen“') : '', onclick: () => api.share.setWrite(sh.id, v.id, true) }, 'Schreiben erlauben'),
            h('button', { class: 'btn small danger', type: 'button', onclick: () => api.share.kick(sh.id, v.id) }, 'Trennen'))))))
        : h('p', { class: 'hint' }, 'Noch niemand verbunden.')].filter(Boolean));
  };
  const m = openModal({
    title: tx(`Freigabe – ${p.title}`), width: 640, body,
    buttons: [{ label: 'Freigabe beenden', cls: 'danger', click: async () => { await shareStop(p); } }, { label: 'Schließen', cls: 'primary', click: () => {} }],
    onClose: () => { if (SHARE.managerRender === render) { SHARE.managerRender = null; SHARE.managerFor = null; } }
  });
  SHARE.managerFor = p; SHARE.managerRender = render;
  render();
}

/* ---------- Rückfrage, wenn ein Zuschauer schreiben möchte ---------- */
function shareAskWrite(q) {
  const p = [...S.panes.values()].find(x => x.shareId === q.shareId);
  if (!p) { api.share.deny(q.shareId, q.viewerId); return; }
  const key = q.shareId + '/' + q.viewerId;
  if (SHARE.requests.has(key)) return;
  const close = () => { const b = SHARE.requests.get(key); if (b) { clearTimeout(b._t); b.remove(); SHARE.requests.delete(key); } };
  const btn = (label, fn, cls = '') => h('button', { class: 'btn small ' + cls, type: 'button', onclick: (e) => { e.stopPropagation(); fn(); close(); p.focus(); } }, label);
  const local = p.cfg && p.cfg.type === 'local';
  const ban = h('div', { class: 'pw-offer share-req' },
    h('span', { class: 'pw-text' }, tx(`„${q.name}“ (${q.ip}) möchte in dieser Session schreiben.`) + (local ? ' ' + tx('Achtung: lokale Shell dieses Rechners.') : '')),
    btn('Erlauben', () => api.share.setWrite(q.shareId, q.viewerId, true), 'primary'),
    btn('Ablehnen', () => api.share.deny(q.shareId, q.viewerId)));
  // Abfragen mehrerer Zuschauer untereinander
  ban.style.top = (30 + SHARE.requests.size * 40) + 'px';
  p.el.appendChild(ban);
  ban._t = setTimeout(() => { api.share.deny(q.shareId, q.viewerId); close(); }, 60000);
  SHARE.requests.set(key, ban);
  if (p.tabId !== S.activeTabId) toast(`„${q.name}“ möchte in „${p.title}“ schreiben`, 5000);
}

function upsertShare(sh) {
  const i = SHARE.list.findIndex(s => s.id === sh.id);
  if (i >= 0) SHARE.list[i] = sh; else SHARE.list.push(sh);
  for (const p of S.panes.values()) if (p.shareId === sh.id) shareUi(p);
  if (SHARE.managerRender) SHARE.managerRender();
}

/* ---------- Zuschauer-Seite: Status aus dem Hauptprozess ---------- */
function shareViewStatus(p, st) {
  const v = p.shareView = { ...(p.shareView || {}), ...st };
  delete v.event;
  if (v.write && p._roBanner) { clearTimeout(p._roBanner._t); p._roBanner.remove(); p._roBanner = null; }
  if (st.cols && st.rows) { p.shareSize = { cols: st.cols, rows: st.rows }; p.fit(); }
  if (st.name && !p.cfg.name) { p.shareTitle = tx(`${st.name} (Freigabe auf ${st.host || st.address})`); p.updateHeader(); }
  switch (st.event) {
    case 'granted': toast('Schreibrecht erteilt – deine Eingaben gehen jetzt an die freigegebene Session', 3500); break;
    case 'revoked': toast('Schreibrecht entzogen – nur lesen', 3000); break;
    case 'denied': toast('Schreibrecht abgelehnt', 3000); break;
    case 'denyRo': toast('Diese Freigabe ist nur zum Lesen'); break;
    case 'ro': shareRoHint(p); break;
    default: break;
  }
  shareUi(p);
  if (p === activePane()) updateStatus();
}
function shareRoHint(p) {
  const v = p.shareView || {};
  if (p._roBanner) return;
  const close = () => { if (p._roBanner) { clearTimeout(p._roBanner._t); p._roBanner.remove(); p._roBanner = null; } };
  const b = (label, fn, cls = '') => h('button', { class: 'btn small ' + cls, type: 'button', onclick: (e) => { e.stopPropagation(); fn(); close(); p.focus(); } }, label);
  p._roBanner = h('div', { class: 'pw-offer share-req' },
    h('span', { class: 'pw-text' }, v.mode === 'ro' ? tx('Diese Freigabe ist nur zum Lesen – Eingaben werden nicht gesendet.') : tx('Nur lesen – Eingaben werden nicht gesendet.')),
    v.mode === 'ro' ? null : b('Schreibrecht anfordern', () => shareRequestWrite(p), 'primary'),
    b('OK', () => {}));
  p.el.appendChild(p._roBanner);
  p._roBanner._t = setTimeout(close, 8000);
}

/* ---------- Snapshot für neue Zuschauer ---------- */
function shareSnapshot({ reqId, sid }) {
  const p = S.bySession.get(sid);
  if (!p || !p.term || !p.serAddon) { api.share.snapReply(reqId, null); return; }
  // leerer write: Rückruf kommt, wenn alle bisher empfangenen Daten verarbeitet sind
  const seq = p.recvSeq || 0;
  p.term.write('', () => {
    let data = '';
    try { data = p.serAddon.serialize({ scrollback: Math.min(2000, S.settings.scrollback || 2000) }); } catch (_) {}
    api.share.snapReply(reqId, { data, seq, cols: p.term.cols, rows: p.term.rows });
  });
}

function initShare() {
  api.share.onSnapReq(shareSnapshot);
  api.share.onChanged(({ shares, info }) => {
    SHARE.list = shares || []; SHARE.info = info || SHARE.info;
    for (const p of S.panes.values()) {
      if (p.shareId && !SHARE.list.some(s => s.id === p.shareId)) p.shareId = null;
      shareUi(p);
    }
    // erledigte Abfragen entfernen
    for (const [key, b] of [...SHARE.requests]) {
      const [sid, vid] = key.split('/');
      const sh = SHARE.list.find(s => s.id === sid);
      const v = sh && sh.viewers.find(x => x.id === vid);
      if (!v || !v.requested) { clearTimeout(b._t); b.remove(); SHARE.requests.delete(key); }
    }
    if (SHARE.managerRender) SHARE.managerRender();
  });
  api.share.onRequest(shareAskWrite);
  api.share.onEvent((e) => {
    if (e.kind === 'joined') toast(`„${e.name}“ (${e.ip}) schaut jetzt zu`, 3000);
    else if (e.kind === 'left') toast(`„${e.name}“ hat die Freigabe verlassen`, 2500);
    else if (e.kind === 'blocked') toast(`Freigabe: ${e.ip} nach mehreren falschen Passwörtern für 10 Minuten gesperrt`, 5000);
    else if (e.kind === 'stopped' && e.reason === 'expired') toast(`Freigabe „${e.name}“ ist abgelaufen`, 4000);
  });
  api.share.info().then((i) => { SHARE.info = i; SHARE.list = i.shares || []; }).catch(() => {});
}

/* ---------- Einstellungen ---------- */
function shareSettingsSection(st) {
  const known = h('div', { class: 'share-known' });
  const renderKnown = async (map) => {
    map = map || await api.share.known();
    known.textContent = '';
    const keys = Object.keys(map || {});
    if (!keys.length) { known.appendChild(h('span', { class: 'hint' }, 'Noch keine bekannten Freigaben.')); return; }
    for (const k of keys) known.appendChild(h('div', { class: 'share-known-row' }, h('code', null, k), h('span', { class: 'hint' }, map[k]),
      h('button', { class: 'btn small', type: 'button', onclick: async () => renderKnown(await api.share.forget(k)) }, 'Entfernen')));
  };
  renderKnown();
  const fp = h('code', null, '…');
  api.share.info().then(i => { fp.textContent = i.fingerprint || '–'; });
  return h('div', { class: 'share-settings' },
    h('div', { class: 'checks' }, chk('shareAllow', !!st.shareAllow, 'Freigaben von Panes auf diesem Rechner erlauben (Pane-Menü → „Session freigeben…“)'),
      chk('shareExtNoConfirm', !!st.shareExtNoConfirm, 'Aufrufe von außen dürfen ohne Rückfrage freigeben – auch mit Schreibrecht und für die lokale Shell (nur Kommandozeile mit --share-confirm nein, nie über Links)')),
    h('p', { class: 'hint', style: { margin: '2px 0 12px 24px' } }, 'Nur einschalten, wenn ausschließlich deine eigenen Skripte MacT-1000 aufrufen: Jedes Programm auf diesem Rechner kann dann Panes ohne Nachfrage freigeben.'),
    h('div', { class: 'grid3' },
      field('Port für Freigaben', inp('sharePort', st.sharePort || 7022, { type: 'number', min: 1, max: 65535 })),
      field('Netzwerkadresse', inp('shareBind', st.shareBind || '', { placeholder: 'alle (0.0.0.0)' })),
      field('Mein Name beim Zuschauen', inp('shareViewerName', st.shareViewerName || '', { placeholder: 'Standard: Benutzer@Rechner' }))),
    h('p', { class: 'hint' }, h('span', null, tx('Fingerprint dieses Rechners:') + ' '), fp),
    field('Bekannte Freigaben anderer Rechner', known, 'Fingerprints, die du beim Verbinden bestätigt hast. Entfernen, wenn MacT-1000 auf dem anderen Rechner neu installiert wurde.'));
}

/* ---------- Freigabe aus einem Aufruf von außen (--share) ---------- */
async function shareAuto(p, o) {
  if (!p.sessionId || p.shareId) return;
  const password = o.password || await api.share.genPassword();
  const r = await api.share.start(p.sessionId, { name: o.name || p.title, type: p.cfg.type, password, mode: o.mode || 'ro', expiresIn: Number(o.expiresIn) || 0, cols: p.term.cols, rows: p.term.rows });
  if (!r.ok) { toast(tx(`Freigabe nicht möglich: ${r.error}`), 7000); p.term.write(tx(`\r\n\x1b[31m── Freigabe nicht möglich: ${r.error} ──\x1b[0m\r\n`)); return; }
  p.shareId = r.share.id;
  upsertShare(r.share);
  const info = await api.share.info();
  const addrs = shareAddrList(info);
  const connect = `share ${addrs[0] || info.hostname}${info.port !== 7022 ? ':' + info.port : ''}`;
  if (o.info) {
    try {
      const f = await api.share.writeInfo(o.info, {
        name: r.share.name, mode: r.share.mode, password, host: info.hostname, addresses: addrs, port: info.port,
        fingerprint: info.fingerprint, connect, expires: r.share.expires ? new Date(r.share.expires).toISOString() : null, created: new Date().toISOString()
      });
      p.shareInfoFile = f;
    } catch (e) { toast(tx(`--share-info: Datei konnte nicht geschrieben werden (${e.message || e})`), 7000); }
  }
  if (!o.password) api.writeClipboard(password);
  if (o.noConfirm) p.term.write(tx(`\r\n\x1b[36m── Ohne Rückfrage freigegeben (Aufruf von außen): „${r.share.name}“, ${tx(shareModeLabel(r.share.mode))} ──\x1b[0m\r\n`));
  toast(o.password ? tx(`„${r.share.name}“ freigegeben (${connect})`) : tx(`„${r.share.name}“ freigegeben (${connect}) – Passwort in der Zwischenablage`), 5000);
}

/* ---------- Abfragen beim Verbinden als Zuschauer ---------- */
function shareAsk(q) {
  if (q.kind === 'confirm') {
    confirmDialog('Unbekannte Freigabe', `${q.text}\n\nVerbinden und Fingerprint speichern?`, 'Verbinden').then(ok => api.fx.answer(q.reqId, ok));
    return;
  }
  if (q.kind === 'choose') {
    let val = null;
    const s = sel('pick', (q.options[0] || {}).value, q.options.map(o => [o.value, o.label]));
    openModal({ title: tx(`Freigabe wählen – ${q.host}`), width: 420,
      body: h('div', { class: 'settings-form' }, h('p', { class: 'hint' }, q.text), field('Freigabe', s)),
      buttons: [{ label: 'Abbrechen', click: () => {} }, { label: 'Öffnen', cls: 'primary', click: () => { val = s.value; } }],
      onClose: () => api.fx.answer(q.reqId, val) });
    return;
  }
  const input = inp('secret', '', { type: 'password', autofocus: true });
  let val = null;
  openModal({
    title: tx(`Freigabe – ${q.host}`), width: 420,
    body: h('div', { class: 'settings-form' }, h('p', { class: 'hint' }, 'Das Passwort hat dir der Freigebende genannt.'), field(q.text || 'Passwort:', input)),
    buttons: [{ label: 'Abbrechen', click: () => {} }, { label: 'Verbinden', cls: 'primary', click: () => { val = input.value; } }],
    onClose: () => api.fx.answer(q.reqId, val)
  });
}
