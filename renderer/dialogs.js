'use strict';
/* Modale Dialoge: Session-Editor, Multi-Paste, Einstellungen, Bestätigung */

function openModal({ title, body, buttons, width = 560, onClose }) {
  const root = $('#modal-root');
  const backdrop = h('div', { class: 'modal-backdrop' });
  const footer = h('div', { class: 'modal-foot' });
  const box = h('div', { class: 'modal', style: { width: width + 'px' } },
    h('div', { class: 'modal-head' }, h('span', null, title), h('button', { class: 'x', title: 'Schließen', onclick: () => close() }, '×')),
    h('div', { class: 'modal-body' }, body),
    footer);
  backdrop.appendChild(box);
  root.appendChild(backdrop);
  const prevFocus = document.activeElement;
  function close(result) {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose && onClose(result);
    if (prevFocus && prevFocus.focus) setTimeout(() => prevFocus.focus(), 0);
  }
  for (const b of buttons || []) {
    footer.appendChild(h('button', { class: 'btn ' + (b.cls || ''), onclick: async () => { const r = await b.click(close); if (r !== false && b.closes !== false) close(r); } }, b.label));
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && (e.metaKey || (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox'))) {
      const primary = footer.querySelector('.primary');
      if (primary) { e.preventDefault(); primary.click(); }
    }
  }
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => { const f = box.querySelector('[autofocus], input:not([type=checkbox]), textarea, select'); f && f.focus(); }, 30);
  return { close, box };
}

function confirmDialog(title, text, okLabel = 'OK') {
  return new Promise((resolve) => {
    let ok = false;
    openModal({ title, width: 420, body: h('p', { class: 'confirm-text' }, text),
      buttons: [{ label: 'Abbrechen', click: () => {} }, { label: okLabel, cls: 'primary', click: () => { ok = true; } }],
      onClose: () => resolve(ok) });
  });
}

/* ---------- Formular-Helfer ---------- */
function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}
function inp(name, value, attrs = {}) { return h('input', { name, value: value ?? '', spellcheck: 'false', ...attrs }); }
function sel(name, value, options) {
  const s = h('select', { name });
  for (const o of options) {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    const opt = h('option', { value: v }, l);
    if (String(v) === String(value ?? '')) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}
function chk(name, checked, label) {
  const c = h('input', { type: 'checkbox', name });
  c.checked = !!checked;
  return h('label', { class: 'check' }, c, h('span', null, label));
}
function readForm(root) {
  const o = {};
  for (const el of $$('input[name], select[name], textarea[name]', root)) {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'number') o[el.name] = el.value === '' ? '' : Number(el.value);
    else o[el.name] = el.value;
  }
  return o;
}

const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

/**
 * Session-Editor. mode: 'new' | 'edit' | 'connect'
 * Ergebnis via onSubmit({cfg, save, connect})
 */
async function sessionDialog({ cfg, mode = 'new', folders = [], onSubmit }) {
  cfg = clone(cfg || { type: 'ssh' });
  const typeSel = sel('type', cfg.type, Object.entries(TYPE_META).filter(([k]) => k !== 'command').map(([k, m]) => [k, m.label]).concat([['command', 'Eigener Befehl']]));
  const common = h('div', { class: 'grid2' },
    field('Typ', typeSel),
    field('Name', inp('name', cfg.name, { placeholder: 'optional, z.B. core-sw01' })),
    field('Ordner', (() => {
      const i = inp('folder', cfg.folder, { placeholder: 'optional, z.B. Rechenzentrum', list: 'folder-list' });
      return h('span', { class: 'contents' }, i, h('datalist', { id: 'folder-list' }, folders.map(f => h('option', { value: f }))));
    })()),
    field('Farbe', sel('color', cfg.color || '', [['', 'Standard'], ['#e06c75', 'Rot'], ['#e5c07b', 'Gelb'], ['#98c379', 'Grün'], ['#61afef', 'Blau'], ['#c678dd', 'Lila']])),
    field('Makro nach dem Verbinden', sel('macroId', cfg.macroId || '', [['', '– keins –'], ...(typeof macroList === 'function' ? macroList() : []).map(m => [m.id, m.name])]))
  );
  const specific = h('div', { class: 'specific' });
  const body = h('div', { class: 'session-form' }, common, h('hr'), specific);

  async function renderSpecific(type) {
    specific.textContent = '';
    if (type === 'local') {
      specific.append(h('div', { class: 'grid2' },
        field('Shell', inp('shell', cfg.shell, { placeholder: 'Standard ($SHELL)' })),
        field('Startverzeichnis', inp('cwd', cfg.cwd, { placeholder: '~' })),
      ),
      field('Startbefehl', inp('startupCommand', cfg.startupCommand, { placeholder: 'optional, wird nach dem Start ausgeführt' })),
      chk('loginShell', cfg.loginShell !== false, 'Als Login-Shell starten (-l)'));
    } else if (type === 'ssh') {
      const idInput = inp('identityFile', cfg.identityFile, { placeholder: '~/.ssh/id_ed25519 (optional)' });
      specific.append(h('div', { class: 'grid3' },
        field('Host', inp('host', cfg.host, { placeholder: 'host oder IP', autofocus: true })),
        field('Port', inp('port', cfg.port || 22, { type: 'number', min: 1, max: 65535 })),
        field('Benutzer', inp('username', cfg.username, { placeholder: 'optional' }))),
      h('div', { class: 'grid2' },
        field('Schlüsseldatei', h('span', { class: 'with-btn' }, idInput,
          h('button', { class: 'btn small', type: 'button', onclick: async () => { const f = await api.openFile({ defaultPath: '~/.ssh' }); if (f) idInput.value = f; } }, '…'))),
        field('Jump-Host (-J)', inp('jumpHost', cfg.jumpHost, { placeholder: 'user@bastion:22' }))),
      field('Port-Weiterleitungen', h('textarea', { name: 'forwardsText', rows: 2, spellcheck: 'false', placeholder: 'L 8080:localhost:80\nR 9000:localhost:9000\nD 1080' },
        (cfg.forwards || []).map(f => `${f.type} ${f.spec}`).join('\n')), 'Pro Zeile: L / R / D gefolgt von der ssh-Spezifikation'),
      h('div', { class: 'grid2' },
        field('Zusätzliche ssh-Argumente', inp('extraArgs', cfg.extraArgs, { placeholder: '-o StrictHostKeyChecking=accept-new' })),
        field('Remote-Befehl', inp('remoteCommand', cfg.remoteCommand, { placeholder: 'optional, z.B. tmux new -A -s main' }))),
      h('div', { class: 'checks' },
        chk('useKeychain', cfg.useKeychain !== false, 'Passphrase des Schlüssels im macOS-Schlüsselbund speichern und automatisch nutzen'),
        chk('keepAlive', cfg.keepAlive !== false, 'Keepalive (30 s)'),
        chk('forwardAgent', cfg.forwardAgent, 'Agent-Forwarding (-A)'),
        chk('compression', cfg.compression, 'Kompression (-C)'),
        chk('x11', cfg.x11, 'X11-Forwarding (-Y, XQuartz)'),
        chk('legacyAlgos', cfg.legacyAlgos, 'Alte Algorithmen erlauben (ältere Switches/Router)'),
        chk('shareConnection', cfg.shareConnection !== false, 'Verbindung mit Datei-Browser (SCP) teilen – keine zweite Anmeldung'),
        chk('scpLegacy', cfg.scpLegacy, 'Klassisches SCP-Protokoll (scp -O) für Geräte ohne SFTP-Subsystem')),
      h('div', { class: 'kc-row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => storeKeyInKeychain(idInput.value) }, 'Jetzt im Schlüsselbund hinterlegen…'),
        h('span', { class: 'hint' }, 'Fragt die Passphrase einmal ab und speichert sie (ssh-add --apple-use-keychain).')),
      h('p', { class: 'hint' }, 'Nutzt das System-ssh: ~/.ssh/config, Schlüssel und ssh-agent werden automatisch verwendet. Mit Schlüsselbund-Option wird die Passphrase beim ersten Verbinden gespeichert und danach nicht mehr abgefragt.'));
    } else if (type === 'telnet') {
      specific.append(h('div', { class: 'grid3' },
        field('Host', inp('host', cfg.host, { placeholder: 'host oder IP', autofocus: true })),
        field('Port', inp('port', cfg.port || 23, { type: 'number', min: 1, max: 65535 })),
        field('Enter sendet', sel('enterMode', cfg.enterMode || 'crlf', [['crlf', 'CR LF'], ['cr', 'CR NUL'], ['lf', 'LF']]))),
      h('div', { class: 'grid3' },
        field('Benutzer (Auto-Login)', inp('username', cfg.username, { placeholder: 'optional' })),
        field('Passwort (Auto-Login)', inp('password', cfg.password, { type: 'password', placeholder: 'optional' })),
        field('Lokales Echo', sel('localEcho', cfg.localEcho ?? false, [['false', 'Aus'], ['auto', 'Automatisch'], ['true', 'Ein']])) ),
      h('div', { class: 'grid3' },
        field('Zeichensatz', sel('encoding', cfg.encoding || 'utf8', [['utf8', 'UTF-8'], ['latin1', 'ISO-8859-1']])),
        field('Terminaltyp', inp('termType', cfg.termType, { placeholder: 'XTERM-256COLOR' })),
        field('Timeout (s)', inp('connectTimeout', cfg.connectTimeout || 15, { type: 'number', min: 1 }))),
      h('div', { class: 'checks' },
        chk('autoLogin', cfg.autoLogin, 'Auto-Login bei „login:“/„Password:“-Prompt'),
        chk('rawMode', cfg.rawMode, 'Raw-TCP (keine Telnet-Verhandlung, z.B. Konsolenserver-Ports)')),
      h('p', { class: 'hint' }, 'Passwörter werden verschlüsselt im macOS-Schlüsselbund-Speicher abgelegt.'));
    } else if (type === 'serial') {
      const portSel = h('select', { name: 'path' });
      const refresh = async () => {
        portSel.textContent = '';
        const ports = await api.listSerial();
        const list = ports.filter(p => !p.path.startsWith('/dev/tty.') || !ports.some(q => q.path === p.path.replace('/dev/tty.', '/dev/cu.')));
        if (cfg.path && !list.some(p => p.path === cfg.path)) list.unshift({ path: cfg.path, manufacturer: '(nicht verbunden)' });
        if (!list.length) portSel.appendChild(h('option', { value: '' }, 'Keine seriellen Ports gefunden'));
        for (const p of list) {
          const o = h('option', { value: p.path }, p.path + (p.manufacturer ? `  –  ${p.manufacturer}` : '') + (p.serialNumber ? ` (${p.serialNumber})` : ''));
          if (p.path === cfg.path) o.selected = true;
          portSel.appendChild(o);
        }
      };
      await refresh();
      const baudInput = inp('baudRate', cfg.baudRate || 9600, { type: 'number', list: 'baud-list', min: 50 });
      specific.append(
        field('Schnittstelle', h('span', { class: 'with-btn' }, portSel, h('button', { class: 'btn small', type: 'button', title: 'Neu einlesen', onclick: refresh }, '↻'))),
        h('div', { class: 'grid4' },
          field('Baudrate', h('span', { class: 'contents' }, baudInput, h('datalist', { id: 'baud-list' }, BAUD_RATES.map(b => h('option', { value: b }))))),
          field('Datenbits', sel('dataBits', cfg.dataBits || 8, [5, 6, 7, 8])),
          field('Parität', sel('parity', cfg.parity || 'none', [['none', 'Keine'], ['even', 'Gerade'], ['odd', 'Ungerade'], ['mark', 'Mark'], ['space', 'Space']])),
          field('Stoppbits', sel('stopBits', cfg.stopBits || 1, [1, 1.5, 2]))),
        h('div', { class: 'grid3' },
          field('Flusskontrolle', sel('flowControl', cfg.flowControl || 'none', [['none', 'Keine'], ['rtscts', 'Hardware (RTS/CTS)'], ['xonxoff', 'Software (XON/XOFF)']])),
          field('Enter sendet', sel('enterMode', cfg.enterMode || 'cr', [['cr', 'CR'], ['crlf', 'CR LF'], ['lf', 'LF']])),
          field('Zeichensatz', sel('encoding', cfg.encoding || 'utf8', [['utf8', 'UTF-8'], ['latin1', 'ISO-8859-1']]))),
        h('div', { class: 'checks' },
          chk('localEcho', cfg.localEcho, 'Lokales Echo'),
          chk('addCrToLf', cfg.addCrToLf, 'Empfangenes LF als CR LF darstellen'),
          chk('wakeup', cfg.wakeup !== false, 'Nach dem Öffnen Enter senden')),
        h('p', { class: 'hint' }, 'Typisch für Cisco/HP/Juniper-Konsolen: 9600 8N1 ohne Flusskontrolle. USB-Adapter erscheinen als /dev/cu.usbserial-* bzw. /dev/cu.usbmodem*.'));
    } else if (type === 'rdp') {
      const clients = await api.rdpClients();
      const cOpts = [['auto', 'Automatisch']].concat(clients.map(c => [c.id, c.name]));
      specific.append(h('div', { class: 'grid3' },
        field('Host', inp('host', cfg.host, { placeholder: 'host oder IP', autofocus: true })),
        field('Port', inp('port', cfg.port || 3389, { type: 'number', min: 1, max: 65535 })),
        field('Client', sel('client', cfg.client || 'auto', cOpts))),
      h('div', { class: 'grid3' },
        field('Benutzer', inp('username', cfg.username, { placeholder: 'optional' })),
        field('Domäne', inp('domain', cfg.domain, { placeholder: 'optional' })),
        field('Auflösung', sel('resolution', cfg.resolution || 'dynamic', [['dynamic', 'Dynamisch (Fenster)'], ['fullscreen', 'Vollbild'], '1280x800', '1600x1000', '1920x1080', '2560x1440']))),
      field('RD-Gateway', inp('gateway', cfg.gateway, { placeholder: 'optional, gateway.firma.de' })),
      h('div', { class: 'checks' },
        chk('clipboard', cfg.clipboard !== false, 'Zwischenablage teilen'),
        chk('multimon', cfg.multimon, 'Alle Monitore'),
        chk('audio', cfg.audio, 'Audio lokal wiedergeben'),
        chk('redirectDrives', cfg.redirectDrives, 'Lokale Laufwerke freigeben'),
        chk('ignoreCert', cfg.ignoreCert, 'Zertifikatswarnungen ignorieren'),
        chk('adminSession', cfg.adminSession, 'Admin-/Konsolensitzung')),
      h('p', { class: 'hint' }, clients.length
        ? 'Gefundene Clients: ' + clients.map(c => c.name).join(', ') + '. Die RDP-Sitzung öffnet ein eigenes Fenster; das Pane zeigt Status und Log.'
        : 'Kein RDP-Client gefunden. Installiere „Windows App“ (Mac App Store) oder FreeRDP (brew install freerdp).'));
    } else if (type === 'command') {
      specific.append(field('Befehl', inp('command', cfg.command, { placeholder: 'z.B. mosh user@host  oder  docker exec -it web sh', autofocus: true })));
    }
  }
  typeSel.addEventListener('change', () => { Object.assign(cfg, readForm(specific)); cfg.type = typeSel.value; delete cfg.port; renderSpecific(cfg.type); });
  await renderSpecific(cfg.type);

  const collect = () => {
    const f = readForm(body);
    const out = { ...cfg, ...f };
    if (out.type === 'ssh') {
      out.forwards = String(f.forwardsText || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^([LRD])\s+(.+)$/i);
        return m ? { type: m[1].toUpperCase(), spec: m[2].trim() } : { type: 'L', spec: l };
      });
      delete out.forwardsText;
    }
    if (out.type === 'telnet') out.localEcho = f.localEcho === 'true' ? true : f.localEcho === 'auto' ? 'auto' : false;
    for (const k of ['port', 'baudRate', 'dataBits', 'stopBits', 'connectTimeout']) if (out[k] !== undefined && out[k] !== '') out[k] = Number(out[k]);
    // Felder anderer Typen nicht mitschleppen
    if (!out.name) delete out.name;
    if (!out.macroId || out.type === 'rdp') delete out.macroId;
    return out;
  };
  const validate = (c) => {
    if (['ssh', 'telnet', 'rdp'].includes(c.type) && !c.host) { toast('Bitte einen Host angeben'); return false; }
    if (c.type === 'serial' && !c.path) { toast('Bitte eine serielle Schnittstelle wählen'); return false; }
    if (c.type === 'command' && !c.command) { toast('Bitte einen Befehl angeben'); return false; }
    return true;
  };
  const buttons = [{ label: 'Abbrechen', click: () => {} }];
  if (mode === 'edit') {
    buttons.push({ label: 'Speichern', cls: 'primary', click: () => { const c = collect(); if (!validate(c)) return false; onSubmit({ cfg: c, save: true, connect: false }); } });
  } else {
    buttons.push({ label: 'Speichern', click: () => { const c = collect(); if (!validate(c)) return false; onSubmit({ cfg: c, save: true, connect: false }); } });
    buttons.push({ label: 'Speichern & Verbinden', click: () => { const c = collect(); if (!validate(c)) return false; onSubmit({ cfg: c, save: true, connect: true }); } });
    buttons.push({ label: 'Verbinden', cls: 'primary', click: () => { const c = collect(); if (!validate(c)) return false; onSubmit({ cfg: c, save: false, connect: true }); } });
  }
  openModal({ title: mode === 'edit' ? 'Session bearbeiten' : 'Neue Session', body, buttons, width: 640 });
}

/**
 * Multi-Paste: Text an mehrere Panes senden.
 * panes: [{id, title, tabTitle, checked}], onSend({text, targets, mode, delay, enter})
 */
async function multiPasteDialog({ panes, initialText, history, onSend }) {
  const ta = h('textarea', { name: 'text', rows: 9, autofocus: true, spellcheck: 'false', class: 'mono', placeholder: 'Text oder Befehle, die an alle gewählten Panes gesendet werden…' }, initialText || '');
  const list = h('div', { class: 'target-list' });
  const groups = {};
  for (const p of panes) (groups[p.tabTitle] = groups[p.tabTitle] || []).push(p);
  for (const [tab, ps] of Object.entries(groups)) {
    list.appendChild(h('div', { class: 'target-group' }, tab));
    for (const p of ps) {
      const c = h('input', { type: 'checkbox', 'data-pane': p.id });
      c.checked = p.checked;
      list.appendChild(h('label', { class: 'check target' }, c, h('span', { class: 'badge', style: { color: TYPE_META[p.type]?.color } }, TYPE_META[p.type]?.icon || ''), h('span', null, p.title)));
    }
  }
  if (!panes.length) list.appendChild(h('div', { class: 'empty' }, 'Keine aktiven Sessions.'));
  const setAll = (v, filterTab) => $$('input[data-pane]', list).forEach(c => {
    const p = panes.find(x => x.id === c.dataset.pane);
    if (!filterTab || p.current) c.checked = v; else if (filterTab) c.checked = false;
  });
  const histSel = h('select', { class: 'hist', onchange: (e) => { if (e.target.value !== '') { ta.value = history[Number(e.target.value)]; e.target.value = ''; } } },
    h('option', { value: '' }, history.length ? 'Verlauf…' : 'Kein Verlauf'),
    history.map((t, i) => h('option', { value: i }, t.replace(/\n/g, ' ⏎ ').slice(0, 80))));

  const body = h('div', { class: 'mp' },
    h('div', { class: 'mp-row' },
      h('div', { class: 'mp-text' },
        h('div', { class: 'mp-label' }, h('span', null, 'Text'), histSel),
        ta,
        h('p', { class: 'hint' }, 'Platzhalter pro Pane: {{name}}, {{host}}, {{user}}, {{n}} (laufende Nummer).')),
      h('div', { class: 'mp-targets' },
        h('div', { class: 'mp-label' }, h('span', null, 'Ziele'),
          h('span', { class: 'mini-btns' },
            h('button', { class: 'link', type: 'button', onclick: () => setAll(true) }, 'Alle'),
            h('button', { class: 'link', type: 'button', onclick: () => setAll(true, true) }, 'Tab'),
            h('button', { class: 'link', type: 'button', onclick: () => setAll(false) }, 'Keine'))),
        list)),
    h('div', { class: 'grid3 mp-opts' },
      field('Modus', sel('mode', 'block', [['block', 'Als Block einfügen'], ['lines', 'Zeilenweise senden']])),
      field('Verzögerung pro Zeile (ms)', inp('delay', 150, { type: 'number', min: 0, step: 50 })),
      h('div', { class: 'checks' }, chk('enter', true, 'Enter am Ende senden'), chk('bracketed', true, 'Bracketed Paste nutzen'))));

  openModal({ title: 'Multi-Paste', body, width: 760, buttons: [
    { label: 'Abbrechen', click: () => {} },
    { label: 'Senden', cls: 'primary', click: () => {
      const targets = $$('input[data-pane]', list).filter(c => c.checked).map(c => c.dataset.pane);
      const f = readForm(body);
      if (!f.text) { toast('Kein Text eingegeben'); return false; }
      if (!targets.length) { toast('Keine Ziele ausgewählt'); return false; }
      onSend({ text: f.text, targets, mode: f.mode, delay: Number(f.delay) || 0, enter: f.enter, bracketed: f.bracketed });
    } }
  ]});
}

function settingsDialog(settings, onSave) {
  const s = settings;
  const body = h('div', { class: 'settings-form' },
    h('div', { class: 'grid2' },
      field('Schriftart', inp('fontFamily', s.fontFamily)),
      field('Schriftgröße', inp('fontSize', s.fontSize, { type: 'number', min: 8, max: 32 }))),
    h('div', { class: 'grid3' },
      field('Farbschema', sel('theme', s.theme, Object.entries(THEMES).map(([k, t]) => [k, t.name]))),
      field('Cursor', sel('cursorStyle', s.cursorStyle, [['block', 'Block'], ['bar', 'Strich'], ['underline', 'Unterstrich']])),
      field('Scrollback (Zeilen)', inp('scrollback', s.scrollback, { type: 'number', min: 100, step: 1000 }))),
    h('div', { class: 'grid2' },
      field('Standard-Shell', inp('defaultShell', s.defaultShell, { placeholder: 'leer = $SHELL (z.B. /bin/zsh)' })),
      field('Download-Ordner (SCP)', inp('downloadDir', s.downloadDir, { placeholder: 'leer = ~/Downloads' }))),
    h('div', { class: 'checks' },
      chk('cursorBlink', s.cursorBlink, 'Cursor blinkt'),
      chk('copyOnSelect', s.copyOnSelect, 'Markierten Text automatisch kopieren'),
      chk('rightClickPaste', s.rightClickPaste, 'Rechtsklick: Kopieren bei Markierung, sonst Einfügen'),
      chk('optionIsMeta', s.optionIsMeta, 'Wahltaste (⌥) als Meta-Taste (Achtung: verhindert @ | ~ { } auf deutscher Tastatur)'),
      chk('closeLocalOnExit', s.closeLocalOnExit !== false, 'Lokales Pane schließen, wenn die Shell sauber beendet wird'),
      chk('confirmCloseActive', s.confirmCloseActive !== false, 'Vor dem Schließen von Pane, Tab, Fenster oder Programm bei aktiven Verbindungen nachfragen'),
      chk('confirmMultiPaste', s.confirmMultiPaste, 'Bei mehrzeiligem Einfügen im Multi-Input-Modus nachfragen'),
      chk('restoreSessions', s.restoreSessions, 'Tabs und Split-Layout beim Start wiederherstellen'),
      chk('loadKeychainKeys', s.loadKeychainKeys !== false, 'Beim Start SSH-Schlüssel aus dem Schlüsselbund in den ssh-agent laden'),
      chk('fxShowHidden', s.fxShowHidden, 'Datei-Browser: versteckte Dateien (.*) anzeigen')),
    h('div', { class: 'grid2', style: { marginTop: '6px' } },
      h('button', { class: 'btn small', type: 'button', onclick: () => { m.close(); runCommand('exportConfig'); } }, 'Gesamte Konfiguration exportieren…'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { m.close(); runCommand('importConfig'); } }, 'Konfiguration importieren…')));
  const m = openModal({ title: 'Einstellungen', body, width: 600, buttons: [
    { label: 'Abbrechen', click: () => {} },
    { label: 'Speichern', cls: 'primary', click: () => { const f = readForm(body); f.fontSize = Number(f.fontSize) || 13; f.scrollback = Number(f.scrollback) || 10000; onSave(f); } }
  ]});
}

/* ---------- Gesamte Konfiguration exportieren / importieren ---------- */
function exportConfigDialog({ sessionsCount, pwCount, onExport }) {
  const inclL = chk('includePasswords', false, `Gespeicherte Passwörter mitexportieren (${pwCount} vorhanden) – verschlüsselt mit Export-Passwort`);
  const incl = inclL.querySelector('input');
  const pw1 = inp('passphrase', '', { type: 'password', placeholder: 'mind. 6 Zeichen', disabled: true });
  const pw2 = inp('passphrase2', '', { type: 'password', placeholder: 'wiederholen', disabled: true });
  const err = h('p', { class: 'hint', style: { color: 'var(--danger)', minHeight: '1em' } }, '');
  incl.addEventListener('change', () => { pw1.disabled = pw2.disabled = !incl.checked; if (incl.checked) pw1.focus(); });
  const body = h('div', { class: 'settings-form' },
    h('p', { class: 'hint' }, `Exportiert werden das komplette Adressbuch (${sessionsCount} Sessions mit Ordnern, Farben und allen Verbindungsoptionen), alle Einstellungen, das Tab-/Split-Layout, eingeklappte Ordner und der Multi-Paste-Verlauf in eine JSON-Datei.`),
    h('div', { class: 'checks' }, inclL),
    h('div', { class: 'grid2' }, field('Export-Passwort', pw1), field('Passwort wiederholen', pw2)),
    h('p', { class: 'hint' }, 'Ohne Häkchen enthält die Datei keine Passwörter. SSH-Schlüssel-Passphrasen im macOS-Schlüsselbund werden nicht exportiert (dort einfach erneut hinterlegen).'),
    err);
  openModal({ title: 'Gesamte Konfiguration exportieren', body, width: 600, buttons: [
    { label: 'Abbrechen', click: () => {} },
    { label: 'Exportieren…', cls: 'primary', click: async () => {
      err.textContent = '';
      if (incl.checked) {
        if (pw1.value.length < 6) { err.textContent = 'Export-Passwort muss mindestens 6 Zeichen haben.'; pw1.focus(); return false; }
        if (pw1.value !== pw2.value) { err.textContent = 'Die Passwörter stimmen nicht überein.'; pw2.focus(); return false; }
      }
      try { await onExport({ includePasswords: incl.checked, passphrase: incl.checked ? pw1.value : '' }); }
      catch (e) { err.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); return false; }
    } }
  ]});
}

function importConfigDialog(info, onApply) {
  const fmt = (d) => { try { return new Date(d).toLocaleString('de-DE'); } catch (_) { return d; } };
  const mode = sel('mode', 'merge', [['merge', 'Zusammenführen (gleiche Sessions aktualisieren, neue hinzufügen)'], ['replace', 'Ersetzen (vorhandenes Adressbuch wird überschrieben)']]);
  const cSess = chk('sessions', true, `Adressbuch übernehmen (${info.sessions} Sessions, ${info.folders} Ordner)`);
  const cSet = info.hasSettings ? chk('settings', true, 'Einstellungen übernehmen') : null;
  const cUi = info.kind === 'config' ? chk('ui', true, 'Layout, Ordnerzustand und Multi-Paste-Verlauf übernehmen' + (info.hasLayout ? ' (Layout wird beim nächsten Start geöffnet)' : '')) : null;
  const pw = info.hasSecrets ? inp('passphrase', '', { type: 'password', placeholder: `Export-Passwort für ${info.secretsCount} Passwörter (leer = ohne Passwörter importieren)` }) : null;
  const err = h('p', { class: 'hint', style: { color: 'var(--danger)', minHeight: '1em' } }, '');
  const body = h('div', { class: 'settings-form' },
    h('p', { class: 'hint' }, `Datei: ${info.file}` + (info.kind === 'legacy' ? ' (älteres Sessions-Format)' : ` · exportiert ${fmt(info.exportedAt)}${info.appVersion ? ' mit Version ' + info.appVersion : ''}`)),
    field('Adressbuch', mode),
    h('div', { class: 'checks' }, cSess, cSet, cUi),
    pw ? field('Passwörter entschlüsseln', pw) : null,
    err);
  openModal({ title: 'Konfiguration importieren', body, width: 620, buttons: [
    { label: 'Abbrechen', click: () => {} },
    { label: 'Importieren', cls: 'primary', click: async () => {
      const f = readForm(body);
      if (f.mode === 'replace' && f.sessions && !(await confirmDialog('Adressbuch ersetzen', 'Alle vorhandenen Sessions werden durch die importierten ersetzt. Fortfahren?', 'Ersetzen'))) return false;
      try { await onApply({ mode: f.mode, sessions: !!f.sessions, settings: !!f.settings, ui: !!f.ui, passphrase: f.passphrase || '' }); }
      catch (e) { err.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); return false; }
    } }
  ]});
}
