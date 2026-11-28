'use strict';
/**
 * CSV-Import für Sessions (Lesezeichen) – inklusive Ordnern und Unterordnern.
 *
 * Reine Logik (parseCsv, guessMapping, buildImport) ist auch unter Node testbar;
 * der Dialog (csvImportDialog) läuft nur im Fenster.
 *
 * Ordnerpfade dürfen „/“, „\“, „>“, „›“ oder „»“ als Trenner nutzen,
 * z.B. „Rechenzentrum/Core/Switche“ → drei verschachtelte Ordner.
 */
(function (root) {
  // ---------- CSV lesen ----------
  function detectDelimiter(text) {
    const lines = String(text).split(/\r?\n/).filter(l => l.trim()).slice(0, 10);
    let best = ';'; let bestScore = -1;
    for (const d of [';', ',', '\t', '|']) {
      const counts = lines.map(l => splitLine(l, d).length);
      if (!counts.length) continue;
      const min = Math.min(...counts);
      const same = counts.filter(c => c === counts[0]).length;
      const score = min > 1 ? same * 100 + min : 0;
      if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
  }
  function splitLine(line, d) { return parseCsv(line, d)[0] || []; }

  /** RFC-4180-artig: Anführungszeichen, verdoppelte "" und Zeilenumbrüche in Feldern */
  function parseCsv(text, delim) {
    text = String(text || '').replace(/^\uFEFF/, '');
    const d = delim || detectDelimiter(text);
    const rows = []; let row = []; let f = ''; let q = false; let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
        f += c; i++; continue;
      }
      if (c === '"' && f.trim() === '') { q = true; f = ''; i++; continue; }
      if (c === d) { row.push(f); f = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; continue; }
      f += c; i++;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ''));
  }

  // ---------- Spalten erkennen ----------
  const FIELDS = [
    ['name', 'Name'], ['type', 'Typ'], ['host', 'Host'], ['port', 'Port'], ['username', 'Benutzer'], ['password', 'Passwort'],
    ['folder', 'Ordner'], ['identityFile', 'Schlüsseldatei'], ['jumpHost', 'Jump-Host'], ['path', 'Serielle Schnittstelle'],
    ['baudRate', 'Baudrate'], ['domain', 'Domäne'], ['color', 'Farbe'], ['folderPassword', 'Standard-Passwort (Ordner)']
  ];
  const ALIASES = {
    name: ['name', 'sessionname', 'session', 'bezeichnung', 'anzeigename', 'title', 'titel', 'label', 'bookmark', 'lesezeichen', 'beschreibung', 'description'],
    type: ['typ', 'type', 'protokoll', 'protocol', 'art', 'verbindungstyp', 'connectiontype', 'sessiontype', 'kind'],
    host: ['host', 'hostname', 'ip', 'ipadresse', 'ipaddress', 'adresse', 'address', 'server', 'ziel', 'target', 'rechner', 'remotehost', 'fqdn'],
    port: ['port', 'tcpport'],
    username: ['benutzer', 'benutzername', 'user', 'username', 'login', 'anmeldename', 'loginname', 'konto', 'account'],
    password: ['passwort', 'password', 'kennwort', 'pw', 'pass', 'pwd'],
    folder: ['ordner', 'folder', 'pfad', 'path', 'gruppe', 'group', 'verzeichnis', 'directory', 'kategorie', 'category', 'unterordner', 'subfolder', 'standort', 'location'],
    identityFile: ['schlüssel', 'schluessel', 'schlüsseldatei', 'schluesseldatei', 'key', 'keyfile', 'identityfile', 'privatekey', 'sshkey', 'identity'],
    jumpHost: ['jumphost', 'jump', 'proxyjump', 'sprunghost', 'gateway', 'bastion'],
    path: ['gerät', 'geraet', 'device', 'comport', 'com', 'schnittstelle', 'serialport', 'seriellerport', 'serielleschnittstelle', 'tty', 'line'],
    baudRate: ['baud', 'baudrate', 'speed', 'geschwindigkeit'],
    domain: ['domäne', 'domaene', 'domain'],
    color: ['farbe', 'color', 'colour'],
    folderPassword: ['standardpasswort', 'ordnerpasswort', 'folderpassword', 'defaultpassword', 'standardkennwort', 'ordnerkennwort']
  };
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  const ALIAS_MAP = {};
  for (const [k, list] of Object.entries(ALIASES)) for (const a of list) ALIAS_MAP[norm(a)] = k;
  // „path“ heißt bei Sessions die serielle Schnittstelle; als Spaltenüberschrift „Pfad/Path“ ist aber der Ordner gemeint
  ALIAS_MAP.path = 'folder'; ALIAS_MAP.pfad = 'folder';

  /** Zuordnung Spaltenindex → Feld; header = erste Zeile */
  function guessMapping(header) {
    const used = new Set();
    const map = header.map((h) => {
      const k = ALIAS_MAP[norm(h)];
      if (!k || used.has(k)) return '';
      used.add(k); return k;
    });
    const known = map.filter(Boolean).length;
    return { map, hasHeader: known >= 2 || (known >= 1 && map.includes('host')) };
  }
  /** Standard-Reihenfolge für Dateien ohne Überschrift */
  const DEFAULT_ORDER = ['name', 'type', 'host', 'port', 'username', 'folder', 'password'];
  function defaultMapping(n) { return Array.from({ length: n }, (_, i) => DEFAULT_ORDER[i] || ''); }

  // ---------- Werte umwandeln ----------
  const TYPE_ALIASES = {
    ssh: ['ssh', 'ssh2', 'sftp', 'scp', 'secureshell'],
    telnet: ['telnet', 'tel'],
    rdp: ['rdp', 'mstsc', 'remotedesktop', 'rdesktop', 'xfreerdp', 'windowsremotedesktop', 'remotedesktopprotocol'],
    serial: ['serial', 'seriell', 'serielle', 'com', 'console', 'konsole', 'seriellekonsole', 'serialconsole', 'tty', 'uart'],
    local: ['local', 'lokal', 'lokaleshell', 'localshell', 'shell', 'terminal'],
    folder: ['ordner', 'folder', 'verzeichnis', 'gruppe', 'group', 'directory']
  };
  const TYPE_MAP = {};
  for (const [k, list] of Object.entries(TYPE_ALIASES)) for (const a of list) TYPE_MAP[norm(a)] = k;
  const DEFAULT_PORTS = { ssh: 22, telnet: 23, rdp: 3389 };
  const COLORS = { rot: '#e06c75', red: '#e06c75', gelb: '#e5c07b', yellow: '#e5c07b', grün: '#98c379', gruen: '#98c379', green: '#98c379', blau: '#61afef', blue: '#61afef', lila: '#c678dd', purple: '#c678dd', violett: '#c678dd' };

  function normFolderPath(p) {
    return String(p || '').split(/\s*[\\/>›»]\s*/).map(x => x.trim()).filter(Boolean).join('/');
  }
  function parseType(v, fallback) {
    if (!v) return fallback;
    return TYPE_MAP[norm(v)] || null;
  }
  /** „user@host:port“ zerlegen */
  function splitHost(v) {
    let s = String(v || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
    let user = ''; let port = '';
    const at = s.lastIndexOf('@');
    if (at > 0) { user = s.slice(0, at); s = s.slice(at + 1); }
    const m6 = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (m6) { s = m6[1]; port = m6[2] || ''; }
    else { const m = s.match(/^([^:]+):(\d+)$/); if (m) { s = m[1]; port = m[2]; } }
    return { host: s, user, port };
  }
  const sessKey = (s) => [normFolderPath(s.folder), String(s.name || '').toLowerCase(), s.type, String(s.host || s.path || '').toLowerCase(), Number(s.port) || DEFAULT_PORTS[s.type] || '', String(s.username || '').toLowerCase()].join('|');

  /**
   * Zeilen in Sessions umwandeln.
   * opts: { mapping, hasHeader, baseFolder, defaultType, duplicates: 'skip'|'update'|'add', existing: [Sessions], uid: () => id }
   * → { sessions (komplette neue Liste), added, updated, skipped, errors: [{line, msg}], folders: [neue/benutzte Ordner], folderPasswords: {pfad: pw}, preview }
   */
  function buildImport(rows, opts) {
    const o = Object.assign({ baseFolder: '', defaultType: 'ssh', duplicates: 'skip', existing: [], hasHeader: true }, opts || {});
    const map = o.mapping;
    const base = normFolderPath(o.baseFolder);
    const join = (f) => normFolderPath([base, normFolderPath(f)].filter(Boolean).join('/'));
    const list = (o.existing || []).map(s => Object.assign({}, s));
    const index = new Map(list.map((s, i) => [sessKey(s), i]));
    const out = { added: 0, updated: 0, skipped: 0, errors: [], folders: new Set(), folderPasswords: {}, preview: [], rows: 0 };
    const start = o.hasHeader ? 1 : 0;
    for (let r = start; r < rows.length; r++) {
      const row = rows[r]; const line = r + 1;
      const v = {};
      map.forEach((k, i) => { if (k && row[i] !== undefined && row[i] !== '') v[k] = row[i]; });
      if (!Object.keys(v).length) continue;
      out.rows++;
      const type = parseType(v.type, o.defaultType);
      if (!type) { out.errors.push({ line, msg: `Unbekannter Typ „${v.type}“` }); continue; }
      const folder = join(v.folder);
      if (type === 'folder') {
        // Ordnerzeile: legt (auch leere) Ordner an, optional mit Standard-Passwort
        const f = join(v.folder || v.name);
        if (!f) { out.errors.push({ line, msg: 'Ordnerzeile ohne Ordnernamen' }); continue; }
        out.folders.add(f);
        const pw = v.folderPassword || v.password;
        if (pw) out.folderPasswords[f] = pw;
        out.preview.push({ line, kind: 'folder', folder: f, password: !!pw });
        continue;
      }
      if (folder) out.folders.add(folder);
      if (v.folderPassword && folder) out.folderPasswords[folder] = v.folderPassword;
      const s = { type };
      if (v.name) s.name = v.name;
      if (folder) s.folder = folder;
      if (type === 'ssh' || type === 'telnet' || type === 'rdp') {
        const hp = splitHost(v.host);
        if (!hp.host) { out.errors.push({ line, msg: 'Host fehlt' }); continue; }
        s.host = hp.host;
        const user = v.username || hp.user;
        if (user) s.username = user;
        const port = Number(v.port || hp.port) || DEFAULT_PORTS[type];
        if (!(port > 0 && port < 65536)) { out.errors.push({ line, msg: `Ungültiger Port „${v.port}“` }); continue; }
        s.port = port;
        if (v.password) s.password = v.password;
        if (type === 'ssh') {
          if (v.identityFile) s.identityFile = v.identityFile;
          if (v.jumpHost) s.jumpHost = v.jumpHost;
        }
        if (type === 'telnet' && (s.username || s.password)) s.autoLogin = true;
        if (type === 'rdp' && v.domain) s.domain = v.domain;
      } else if (type === 'serial') {
        const p = v.path || v.host;
        if (!p) { out.errors.push({ line, msg: 'Serielle Schnittstelle fehlt' }); continue; }
        s.path = p;
        s.baudRate = Number(v.baudRate || v.port) || 9600;
      } else if (type === 'local') {
        if (v.host) s.shell = v.host;
      }
      if (v.color) { const c = COLORS[norm(v.color)] || (/^#[0-9a-f]{6}$/i.test(v.color) ? v.color : ''); if (c) s.color = c; }
      const key = sessKey(s);
      if (index.has(key) && o.duplicates !== 'add') {
        if (o.duplicates === 'skip') { out.skipped++; out.preview.push({ line, kind: 'skip', s }); continue; }
        const i = index.get(key); const old = list[i];
        const merged = Object.assign({}, old, s);
        if (!s.password && old.password) merged.password = old.password;
        list[i] = merged; out.updated++; out.preview.push({ line, kind: 'update', s: merged });
        continue;
      }
      s.id = o.uid ? o.uid() : 'sess-' + Math.random().toString(36).slice(2, 10);
      list.push(s); index.set(key, list.length - 1); out.added++;
      out.preview.push({ line, kind: 'add', s });
    }
    out.sessions = list;
    out.folders = [...out.folders];
    return out;
  }

  const TEMPLATE = [
    'Ordner;Name;Typ;Host;Port;Benutzer;Passwort;Schlüsseldatei;Baudrate;Standardpasswort',
    'Rechenzentrum;;Ordner;;;;;;;GeheimesRZ-Passwort',
    'Rechenzentrum/Core/Switche;core-sw01;SSH;10.0.0.1;22;admin;;;;',
    'Rechenzentrum/Core/Switche;core-sw02;SSH;10.0.0.2;;admin;;;;',
    'Rechenzentrum/Core/Router;edge-rt01;Telnet;10.0.1.1;23;admin;EigenesPasswort;;;',
    'Rechenzentrum/Server;jump01;SSH;jump01.example.local;2222;ops;;~/.ssh/id_ed25519;;',
    'Büro;Terminalserver;RDP;ts01.example.local;3389;administrator;;;;',
    'Labor/Konsolen;Konsole COM3;Seriell;COM3;;;;;9600;'
  ].join('\r\n') + '\r\n';

  const TEMPLATE_EN = [
    'Folder;Name;Type;Host;Port;User;Password;Key file;Baud;Default password',
    'Datacenter;;Folder;;;;;;;SecretDC-Password',
    'Datacenter/Core/Switches;core-sw01;SSH;10.0.0.1;22;admin;;;;',
    'Datacenter/Core/Switches;core-sw02;SSH;10.0.0.2;;admin;;;;',
    'Datacenter/Core/Routers;edge-rt01;Telnet;10.0.1.1;23;admin;OwnPassword;;;',
    'Datacenter/Servers;jump01;SSH;jump01.example.local;2222;ops;;~/.ssh/id_ed25519;;',
    'Office;Terminal server;RDP;ts01.example.local;3389;administrator;;;;',
    'Lab/Consoles;Console COM3;Serial;COM3;;;;;9600;'
  ].join('\r\n') + '\r\n';

  const API = { parseCsv, detectDelimiter, guessMapping, defaultMapping, buildImport, normFolderPath, splitHost, parseType, FIELDS, TEMPLATE, TEMPLATE_EN };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.CSVI = API;
})(typeof window !== 'undefined' ? window : globalThis);

// ---------------------------------------------------------------------
// Dialog (nur im Fenster)
// ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  /** CSV-Datei wählen und Import-Vorschau zeigen; folder = vorgewählter Zielordner */
  window.csvImportDialog = async function csvImportDialog(folder = '') {
    const f = await api.csvPick();
    if (!f || f.canceled) return;
    if (f.error) { toast(f.error, 6000); return; }
    const C = window.CSVI;
    let delim = C.detectDelimiter(f.text);
    let rows = C.parseCsv(f.text, delim);
    if (!rows.length) { toast('Die Datei enthält keine Zeilen'); return; }
    let g = C.guessMapping(rows[0]);
    let mapping = g.hasHeader ? g.map : C.defaultMapping(rows[0].length);

    const delimSel = h('select', {}, [[';', 'Semikolon ( ; )'], [',', 'Komma ( , )'], ['\t', 'Tabulator'], ['|', 'Senkrechter Strich']].map(([v, l]) => h('option', { value: v, selected: v === delim }, l)));
    const headerChk = h('input', { type: 'checkbox' }); headerChk.checked = g.hasHeader;
    const baseSel = h('select', {}, h('option', { value: '' }, '— oberste Ebene —'), folderOptions(folder));
    const typeSel = h('select', {}, [['ssh', 'SSH'], ['telnet', 'Telnet'], ['rdp', 'RDP'], ['serial', 'Seriell']].map(([v, l]) => h('option', { value: v }, l)));
    const dupSel = h('select', {}, [['skip', 'überspringen'], ['update', 'aktualisieren'], ['add', 'trotzdem hinzufügen']].map(([v, l]) => h('option', { value: v }, l)));
    const mapBox = h('div', { class: 'csv-map' });
    const preview = h('div', { class: 'csv-preview' });
    const summary = h('div', { class: 'csv-summary hint' });
    let result = null;

    const fieldOpts = () => [['', '– ignorieren –'], ...C.FIELDS];
    const renderMap = () => {
      mapBox.textContent = '';
      const head = rows[0] || [];
      const n = Math.max(...rows.slice(0, 20).map(r => r.length));
      for (let i = 0; i < n; i++) {
        const s = h('select', { onchange: () => { mapping[i] = s.value; recompute(); } }, fieldOpts().map(([v, l]) => h('option', { value: v, selected: (mapping[i] || '') === v }, l)));
        const sample = headerChk.checked ? head[i] || `Spalte ${i + 1}` : `Spalte ${i + 1}`;
        const ex = (rows[headerChk.checked ? 1 : 0] || [])[i] || '';
        mapBox.appendChild(h('div', { class: 'csv-map-row' },
          h('span', { class: 'csv-col', title: sample }, sample),
          h('span', { class: 'csv-ex', title: ex }, mapping[i] === 'password' || mapping[i] === 'folderPassword' ? (ex ? '••••' : '') : ex),
          s));
      }
    };
    const recompute = () => {
      result = C.buildImport(rows, { mapping, hasHeader: headerChk.checked, baseFolder: baseSel.value, defaultType: typeSel.value, duplicates: dupSel.value, existing: S.sessions, uid: () => uid('sess') });
      const existingFolders = new Set(folders());
      const newFolders = new Set();
      for (const fo of result.folders) for (const a of folderAncestors(fo)) if (!existingFolders.has(a)) newFolders.add(a);
      const nFpw = Object.keys(result.folderPasswords).length;
      const nPw = result.preview.filter(p => p.s && p.s.password && p.kind !== 'skip').length;
      summary.textContent = '';
      summary.append(...[
        h('div', null, `${result.added} neue Session(s), ${result.updated} aktualisiert, ${result.skipped} übersprungen (schon vorhanden)`),
        h('div', null, tx(`${newFolders.size} neue(r) Ordner`) + (nPw ? tx(` · ${nPw} mit Passwort`) : '') + (nFpw ? tx(` · ${nFpw} Ordner-Standard-Passwort(e)`) : '')),
        result.errors.length ? h('div', { class: 'csv-err' }, tx(`${result.errors.length} Zeile(n) mit Fehlern:`) + ' ' + result.errors.slice(0, 4).map(e => tx(`Zeile ${e.line}: ${tx(e.msg)}`)).join(' · ') + (result.errors.length > 4 ? ' …' : '')) : null].filter(Boolean));
      preview.textContent = '';
      const tbl = h('table', { class: 'csv-table' }, h('tr', null, ['Ordner', 'Name', 'Typ', 'Ziel', 'Benutzer', 'Passwort', ''].map(x => h('th', null, x))));
      for (const p of result.preview.slice(0, 60)) {
        if (p.kind === 'folder') { tbl.appendChild(h('tr', { class: 'csv-folder' }, h('td', null, folderLabel(p.folder)), h('td', null, '–'), h('td', null, 'Ordner'), h('td'), h('td'), h('td', null, p.password ? 'Standard' : ''), h('td', null, ''))); continue; }
        const s = p.s;
        tbl.appendChild(h('tr', { class: 'csv-' + p.kind },
          h('td', null, s.folder ? folderLabel(s.folder) : '—'), h('td', null, sessionTitle(s)), h('td', null, TYPE_META[s.type] ? TYPE_META[s.type].label : s.type),
          h('td', null, s.type === 'serial' ? `${s.path} @ ${s.baudRate}` : `${s.host}${s.port ? ':' + s.port : ''}`), h('td', null, s.username || ''),
          h('td', null, s.password ? 'ja' : (s.type === 'ssh' || s.type === 'telnet') && (folderPwFor(s.folder) || (s.folder && Object.keys(result.folderPasswords).some(f => s.folder === f || s.folder.startsWith(f + '/'))) ? 'Ordner' : '')),
          h('td', null, p.kind === 'add' ? 'neu' : p.kind === 'update' ? 'aktualisieren' : 'vorhanden')));
      }
      preview.appendChild(tbl);
      if (result.preview.length > 60) preview.appendChild(h('div', { class: 'hint' }, `… und ${result.preview.length - 60} weitere`));
    };
    delimSel.addEventListener('change', () => {
      delim = delimSel.value; rows = C.parseCsv(f.text, delim);
      g = C.guessMapping(rows[0] || []); headerChk.checked = g.hasHeader;
      mapping = g.hasHeader ? g.map : C.defaultMapping((rows[0] || []).length);
      renderMap(); recompute();
    });
    headerChk.addEventListener('change', () => { if (headerChk.checked) { g = C.guessMapping(rows[0] || []); if (g.map.some(Boolean)) mapping = g.map; } renderMap(); recompute(); });
    for (const el of [baseSel, typeSel, dupSel]) el.addEventListener('change', recompute);
    renderMap(); recompute();

    const apply = async () => {
      if (!result || (!result.added && !result.updated && !result.folders.length && !Object.keys(result.folderPasswords).length)) { toast('Nichts zu importieren'); return false; }
      S.sessions = result.sessions;
      const keep = new Set([...(S.settings.sessionFolders || []), ...result.folders]);
      await saveFolderList([...keep]);
      if (Object.keys(result.folderPasswords).length) { S.folderPw = { ...(S.folderPw || {}), ...result.folderPasswords }; await saveFolderPw(); }
      for (const fo of result.folders) folderAncestors(fo).forEach(x => S.collapsed.delete(x));
      localStorage.setItem('collapsedFolders', JSON.stringify([...S.collapsed]));
      await persistSessions();
      toast(tx(`CSV-Import: ${result.added} neu, ${result.updated} aktualisiert, ${result.skipped} übersprungen`) + (result.errors.length ? tx(`, ${result.errors.length} Fehler`) : ''), 5000);
    };
    openModal({ title: 'Sessions aus CSV importieren', width: 860, body: h('div', { class: 'csv-import' },
      h('div', { class: 'hint' }, `Datei: ${f.name} · ${rows.length} Zeile(n) · Zeichensatz ${f.encoding}`),
      h('div', { class: 'grid3' }, field('Trennzeichen', delimSel), field('Zielordner', baseSel, 'Ordner aus der CSV werden darunter angelegt'), field('Typ, falls leer', typeSel)),
      h('div', { class: 'grid3' }, field('Bereits vorhandene Sessions', dupSel), h('label', { class: 'check', style: { alignSelf: 'center', marginTop: '10px' } }, headerChk, h('span', null, 'Erste Zeile enthält Spaltennamen')), h('span')),
      h('h4', null, 'Spalten zuordnen'), mapBox,
      h('h4', null, 'Vorschau'), summary, preview,
      h('p', { class: 'hint' }, 'Unterordner im Feld „Ordner“ mit „/“ trennen (auch „\\“ oder „>“), z.B. „Rechenzentrum/Core/Switche“. Zeilen mit Typ „Ordner“ legen Ordner an und können ein Standard-Passwort für den Ordner setzen. Passwörter werden verschlüsselt gespeichert.')),
    buttons: [
      { label: 'Vorlage speichern…', click: () => { api.csvSaveTemplate(IS_EN() ? C.TEMPLATE_EN : C.TEMPLATE).then(r => { if (r && r.path) toast(tx('Vorlage gespeichert: ') + r.path, 4000); }); return false; } },
      { label: 'Abbrechen', click: () => {} },
      { label: 'Importieren', cls: 'primary', click: () => apply() }
    ] });
  };
}
