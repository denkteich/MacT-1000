'use strict';
/* global Terminal, FitAddon, SearchAddon, WebLinksAddon, Layout, THEMES, TYPE_META */

const S = {
  settings: {},
  sessions: [],
  tabs: [],
  activeTabId: null,
  panes: new Map(),      // paneId -> Pane
  bySession: new Map(),  // sessionId -> Pane
  multiInput: false,
  selectedSessionId: null,
  collapsed: new Set(JSON.parse(localStorage.getItem('collapsedFolders') || '[]'))
};

/* =====================================================================
 * Pane – ein Terminal (oder Launcher) innerhalb eines Tabs
 * ===================================================================== */
class Pane {
  constructor(tab, cfg) {
    this.id = uid('p');
    this.tabId = tab.id;
    this.cfg = null;
    this.state = 'launcher'; // launcher | connecting | running | exited
    this.broadcast = false;
    this.termTitle = '';
    this.term = null;
    this.sessionId = null;
    this.macroRun = null;
    S.panes.set(this.id, this);
    this.buildDom();
    if (cfg) this.start(cfg); else this.showLauncher();
  }

  get tab() { return S.tabs.find(t => t.id === this.tabId); }
  get title() {
    if (!this.cfg) return 'Neues Pane';
    if (this.cfg.type === 'local' && this.termTitle && !this.cfg.name) return this.termTitle;
    return sessionTitle(this.cfg);
  }

  buildDom() {
    this.badge = h('span', { class: 'badge' }, '··');
    this.titleEl = h('span', { class: 'p-title' }, 'Neues Pane');
    this.bcBtn = h('button', { class: 'p-btn bc-btn', title: 'Dieses Pane in Multi-Input einbeziehen', onclick: (e) => { e.stopPropagation(); this.toggleBroadcast(); } }, '⇶');
    const btn = (label, title, fn, cls = '') => h('button', { class: 'p-btn ' + cls, title, onclick: (e) => { e.stopPropagation(); fn(e); } }, label);
    this.macroEl = h('span', { class: 'macro-ind', hidden: true, onclick: (e) => { e.stopPropagation(); if (isRecording(this)) stopRecording(); else if (this.macroRun) this.macroRun.stop('manuell'); } });
    this.header = h('div', { class: 'pane-header' },
      this.badge, this.titleEl, this.macroEl, h('span', { class: 'grow' }),
      this.bcBtn,
      (this.fxBtn = btn('⇅', 'Dateien per SCP übertragen (⇧⌘F)', () => toggleFiles(this), 'fx-btn')),
      btn('', 'Vertikal teilen – nebeneinander (⌘D)', () => splitPane(this, 'row'), 'ic-split-v'),
      btn('', 'Horizontal teilen – untereinander (⇧⌘D)', () => splitPane(this, 'column'), 'ic-split-h'),
      btn('⤢', 'Maximieren (⇧⌘↩)', () => toggleZoom(this)),
      btn('⋯', 'Pane-Menü', (e) => this.showMenu(e.clientX, e.clientY)),
      btn('×', 'Pane schließen (⌘W)', () => requestClosePane(this), 'close'));
    this.header.addEventListener('dblclick', () => toggleZoom(this));
    // Pane an der Kopfzeile greifen und auf ein anderes Pane / einen anderen Tab ziehen
    this.header.draggable = true;
    this.header.addEventListener('dragstart', (e) => {
      if (e.target.closest && e.target.closest('button')) { e.preventDefault(); return; }
      e.dataTransfer.setData('application/x-macterm-pane', this.id);
      e.dataTransfer.effectAllowed = 'move';
      startDrag({ kind: 'pane', id: this.id });
    });
    this.header.addEventListener('dragend', endDrag);
    this.body = h('div', { class: 'pane-body' });
    this.searchInput = h('input', { type: 'text', placeholder: 'Suchen…', spellcheck: 'false' });
    this.searchBar = h('div', { class: 'pane-search', hidden: true },
      this.searchInput,
      h('button', { class: 'p-btn', title: 'Vorheriges (⇧↩)', onclick: () => this.find(-1) }, '↑'),
      h('button', { class: 'p-btn', title: 'Nächstes (↩)', onclick: () => this.find(1) }, '↓'),
      h('button', { class: 'p-btn', title: 'Schließen (Esc)', onclick: () => this.closeFind() }, '×'));
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.find(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); this.closeFind(); }
    });
    this.searchInput.addEventListener('input', () => this.find(1, true));
    this.el = h('div', { class: 'pane', dataset: { id: this.id } }, this.header, this.body, this.searchBar, h('div', { class: 'drop-overlay' }));
    this.el.addEventListener('mousedown', () => setActivePane(this, false));
    this.el.addEventListener('focusin', () => setActivePane(this, false));
    this.setupDrop();
    this.ro = new ResizeObserver(() => this.scheduleFit());
    this.ro.observe(this.body);
  }

  /* ---------- Terminal ---------- */
  ensureTerm() {
    if (this.term) return;
    const st = S.settings;
    this.termWrap = h('div', { class: 'term-wrap' });
    this.body.textContent = '';
    this.body.appendChild(this.termWrap);
    this.term = new Terminal({
      fontFamily: st.fontFamily, fontSize: st.fontSize, scrollback: st.scrollback,
      cursorStyle: st.cursorStyle, cursorBlink: st.cursorBlink, macOptionIsMeta: !!st.optionIsMeta,
      macOptionClickForcesSelection: true, allowProposedApi: true, drawBoldTextInBrightColors: true,
      theme: THEMES[st.theme] || THEMES.standard
    });
    this.fitAddon = new FitAddon.FitAddon();
    this.searchAddon = new SearchAddon.SearchAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.searchAddon);
    this.term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => { if (e.metaKey) api.openExternal(uri); }));
    this.term.open(this.termWrap);
    this.el.style.setProperty('--tbg', (THEMES[st.theme] || THEMES.standard).background);
    this.term.onData((d) => this.handleInput(d));
    this.term.onBinary((d) => this.handleInput(d));
    this.term.onTitleChange((t) => { this.termTitle = t; this.updateHeader(); });
    this.term.onSelectionChange(() => {
      if (S.settings.copyOnSelect && this.term.hasSelection()) api.writeClipboard(this.term.getSelection());
    });
    this.term.attachCustomKeyEventHandler((e) => this.keyHandler(e));
    this.term.textarea.addEventListener('focus', () => setActivePane(this, false));
    // Mehrzeiliges Einfügen im Multi-Input-Modus bestätigen lassen
    this.term.textarea.addEventListener('paste', (e) => {
      const text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (!text || !S.multiInput || !this.broadcast || !S.settings.confirmMultiPaste || !/\n/.test(text.trim())) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const n = broadcastTargets().length;
      confirmDialog('Mehrzeilig einfügen', `${text.trim().split('\n').length} Zeilen an ${n} Panes senden?`, 'Senden').then(ok => { if (ok) this.term.paste(text); this.focus(); });
    }, true);
    this.termWrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (S.settings.rightClickPaste && !e.ctrlKey) {
        if (this.term.hasSelection()) { api.writeClipboard(this.term.getSelection()); this.term.clearSelection(); toast('Kopiert'); }
        else api.readClipboard().then(t => { if (t) this.term.paste(t); });
      } else this.showMenu(e.clientX, e.clientY);
    });
    this.scheduleFit();
  }

  keyHandler(e) {
    if (e.type !== 'keydown') return true;
    if (e.metaKey) {
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        cyclePaneGlobal(e.key === 'ArrowRight' ? 1 : -1); return false;
      }
      const map = { Backspace: '\x15' };
      if (map[e.key]) { this.handleInput(map[e.key]); return false; }
      return false; // alle anderen ⌘-Kombinationen gehen ans Menü
    }
    if (e.altKey && !S.settings.optionIsMeta && !e.ctrlKey) {
      if (e.key === 'ArrowLeft') { this.handleInput('\x1bb'); return false; }
      if (e.key === 'ArrowRight') { this.handleInput('\x1bf'); return false; }
      if (e.key === 'Backspace') { this.handleInput('\x1b\x7f'); return false; }
    }
    return true;
  }

  scheduleFit() {
    if (this._fitPending) return;
    this._fitPending = true;
    requestAnimationFrame(() => { this._fitPending = false; this.fit(); });
  }
  fit() {
    if (!this.term || !this.body.isConnected || this.body.clientWidth < 20 || this.body.clientHeight < 20) return;
    try { this.fitAddon.fit(); } catch (_) { return; }
    const { cols, rows } = this.term;
    if (this.sessionId && (cols !== this._cols || rows !== this._rows)) {
      this._cols = cols; this._rows = rows;
      api.resize(this.sessionId, cols, rows);
    }
    if (this === activePane()) updateStatus();
  }

  /* ---------- Session ---------- */
  async start(cfg) {
    const prevKey = this.cfg && this.cfg.type === 'ssh' ? sessionSubtitle(this.cfg) : null;
    this.cfg = clone(cfg);
    if (prevKey !== (this.cfg.type === 'ssh' ? sessionSubtitle(this.cfg) : null)) {
      this.fx = null;
      if (FX.pane === this) { if (this.cfg.type === 'ssh') setTimeout(() => fxBind(this), 0); else fxOnPaneClosed(this); }
    }
    if (this.cfg.type === 'local' && !this.cfg.shell && S.settings.defaultShell) this.cfg.shell = S.settings.defaultShell;
    this.ensureTerm();
    this.fit();
    if (this.macroRun) this.macroRun.stop('', true);
    if (this.sessionId) { S.bySession.delete(this.sessionId); api.kill(this.sessionId); }
    this.sessionId = uid('s');
    S.bySession.set(this.sessionId, this);
    this.state = 'connecting';
    this._trigBuf = ''; this._trigState = {};
    this.updateHeader();
    if (this.cfg.macroId) autoStartMacro(this, this.cfg);
    const sid = this.sessionId;
    const size = { cols: this.term.cols, rows: this.term.rows };
    this._cols = size.cols; this._rows = size.rows;
    const r = await api.open(sid, this.cfg, size);
    if (sid !== this.sessionId) return; // inzwischen neu gestartet
    // Größe hat sich während des Verbindungsaufbaus geändert -> nachreichen
    if (r.ok && (this.term.cols !== size.cols || this.term.rows !== size.rows)) {
      this._cols = this.term.cols; this._rows = this.term.rows;
      api.resize(sid, this.term.cols, this.term.rows);
    }
    if (!r.ok) {
      this.term.write(`\r\n\x1b[31mFehler: ${r.error}\x1b[0m\r\n`);
      this.markExited();
    } else {
      this.state = 'running';
    }
    this.updateHeader();
    renderTabBar();
    saveLayoutSoon();
    if (this === activePane()) this.focus();
  }

  restart() {
    if (!this.cfg) return;
    this.term.write('\r\n\x1b[90m── Neu verbinden ──\x1b[0m\r\n');
    this.start(this.cfg);
  }

  handleInput(d) {
    if (this.state === 'exited') {
      if (d === '\r' && this.cfg) this.restart();
      return;
    }
    if (REC.pane === this) recInput(this, d);
    if (S.multiInput && this.broadcast) {
      for (const p of broadcastTargets()) p.sendRaw(d);
    } else this.sendRaw(d);
  }
  sendRaw(d) { if (this.state === 'running' && this.sessionId) api.write(this.sessionId, d); }

  onData(data) {
    if (this.term) this.term.write(data);
    if (REC.pane === this) recOutput(this, data);
    if (this.macroRun || (S.settings.triggers && S.settings.triggers.length)) {
      const t = stripAnsi(data);
      if (this.macroRun) this.macroRun.feed(t);
      runTriggers(this, t);
    }
  }
  updateMacroUi() {
    if (!this.macroEl) return;
    const rec = isRecording(this);
    const run = this.macroRun;
    this.macroEl.hidden = !rec && !run;
    this.macroEl.classList.toggle('rec', !!rec);
    if (rec) { this.macroEl.textContent = '● Aufnahme'; this.macroEl.title = 'Makro-Aufzeichnung läuft – klicken zum Stoppen (⇧⌘R)'; }
    else if (run) {
      const st = run.step;
      this.macroEl.textContent = `▶ ${run.macro.name} ${Math.min(run.idx + 1, run.macro.steps.length)}/${run.macro.steps.length}`;
      this.macroEl.title = (st && st.t === 'expect' ? `Wartet auf „${st.pattern}“` : 'Makro läuft') + ' – klicken zum Stoppen';
    }
  }

  onExit(info) {
    if (this.cfg && this.cfg.type === 'local' && info.code === 0 && S.settings.closeLocalOnExit !== false && !info.keep) {
      closePane(this); return;
    }
    const msg = info.message ? ` – ${info.message}` : (info.code !== undefined && info.code !== null ? ` (Code ${info.code})` : '');
    this.term.write(`\r\n\x1b[33m── Session beendet${msg} ── \x1b[1m[Enter]\x1b[22m neu verbinden · \x1b[1m[⌘W]\x1b[22m schließen\x1b[0m\r\n`);
    this.markExited();
  }
  markExited() {
    if (this.macroRun) this.macroRun.stop('Session beendet');
    if (REC.pane === this) stopRecording();
    this.state = 'exited';
    if (this.sessionId) S.bySession.delete(this.sessionId);
    this.sessionId = null;
    this.updateHeader();
    updateMultiUI();
  }

  /* ---------- Launcher ---------- */
  showLauncher(sourceCfg) {
    this.state = 'launcher';
    const quick = h('input', { class: 'l-quick', type: 'text', spellcheck: 'false', placeholder: 'Quick Connect: user@host · telnet host · /dev/cu.usbserial 9600 · rdp host' });
    quick.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!quick.value.trim()) { this.start({ type: 'local' }); return; }
        const cfg = parseQuick(quick.value);
        if (!cfg) toast('Eingabe nicht erkannt'); else this.start(cfg);
      }
      if (e.key === 'Escape' && this.tab && Layout.leaves(this.tab.root).length > 1) closePane(this);
    });
    const filter = h('input', { class: 'l-filter', type: 'search', placeholder: 'Gespeicherte Sessions filtern…', spellcheck: 'false' });
    const list = h('div', { class: 'l-list' });
    const renderList = () => {
      list.textContent = '';
      const q = filter.value.toLowerCase();
      const items = S.sessions.filter(s => !q || (sessionTitle(s) + ' ' + sessionSubtitle(s) + ' ' + (s.folder || '')).toLowerCase().includes(q));
      if (!items.length) list.appendChild(h('div', { class: 'empty' }, S.sessions.length ? 'Keine Treffer' : 'Noch keine gespeicherten Sessions'));
      for (const s of items.slice(0, 60)) {
        list.appendChild(h('button', { class: 'l-item', onclick: () => this.start(s) },
          h('span', { class: 'badge', style: { color: TYPE_META[s.type]?.color } }, TYPE_META[s.type]?.icon),
          h('span', { class: 'l-name' }, sessionTitle(s)),
          h('span', { class: 'l-sub' }, (s.folder ? s.folder + ' · ' : '') + sessionSubtitle(s))));
      }
    };
    filter.addEventListener('input', renderList);
    renderList();
    const typeBtn = (type) => h('button', { class: 'l-type', onclick: () => {
      if (type === 'local') return this.start({ type: 'local' });
      sessionDialog({ cfg: { type }, folders: folders(), onSubmit: ({ cfg, save, connect }) => { if (save) saveSession(cfg); if (connect) this.start(cfg); } });
    } }, h('span', { class: 'badge big', style: { color: TYPE_META[type].color } }, TYPE_META[type].icon), h('span', null, TYPE_META[type].label));
    const dupBtn = sourceCfg ? h('button', { class: 'l-type dup', onclick: () => this.start(sourceCfg) },
      h('span', { class: 'badge big' }, '⧉'), h('span', null, 'Duplizieren: ' + sessionTitle(sourceCfg))) : null;
    this.body.textContent = '';
    this.body.appendChild(h('div', { class: 'launcher' },
      h('div', { class: 'l-inner' },
        h('div', { class: 'l-types' }, dupBtn, ...['local', 'ssh', 'telnet', 'serial', 'rdp'].map(typeBtn)),
        quick,
        h('div', { class: 'l-hint' }, 'Enter ohne Eingabe öffnet eine lokale Shell. Sessions aus der Seitenleiste können auch per Drag & Drop hierher gezogen werden.'),
        S.sessions.length ? filter : null,
        list)));
    this.launcherQuick = quick;
    this.updateHeader();
  }

  /* ---------- UI ---------- */
  updateHeader() {
    const meta = this.cfg ? TYPE_META[this.cfg.type] : null;
    this.badge.textContent = meta ? meta.icon : '··';
    this.badge.style.color = meta ? meta.color : '';
    this.titleEl.textContent = this.title;
    this.header.style.borderLeftColor = (this.cfg && this.cfg.color) || 'transparent';
    this.el.classList.toggle('exited', this.state === 'exited');
    this.el.classList.toggle('connecting', this.state === 'connecting');
    this.el.classList.toggle('bc', S.multiInput && this.broadcast);
    this.bcBtn.classList.toggle('on', this.broadcast);
    this.fxBtn.hidden = !(this.cfg && this.cfg.type === 'ssh');
    const t = this.tab; if (t) renderTabBarSoon();
    if (this === activePane()) updateStatus();
  }

  toggleBroadcast(v) {
    this.broadcast = v === undefined ? !this.broadcast : v;
    if (this.broadcast && !S.multiInput) setMultiInput(true, false);
    this.updateHeader();
    updateMultiUI();
  }

  focus() {
    if (this.term && this.state !== 'launcher') this.term.focus();
    else if (this.launcherQuick) this.launcherQuick.focus();
  }

  openFind() {
    if (!this.term) return;
    this.searchBar.hidden = false;
    const sel = this.term.getSelection();
    if (sel && !sel.includes('\n')) this.searchInput.value = sel;
    this.searchInput.focus(); this.searchInput.select();
  }
  find(dir, incremental) {
    const q = this.searchInput.value;
    if (!q) return;
    const opts = { incremental: !!incremental, decorations: { matchOverviewRuler: '#e5c07b', activeMatchColorOverviewRuler: '#ff9900', matchBackground: '#5a4a1a', activeMatchBackground: '#a86b00' } };
    if (dir < 0) this.searchAddon.findPrevious(q, opts); else this.searchAddon.findNext(q, opts);
  }
  closeFind() { this.searchBar.hidden = true; this.searchAddon && this.searchAddon.clearDecorations(); this.focus(); }

  showMenu(x, y) {
    const t = this.cfg && this.cfg.type;
    const items = [
      { label: 'Neu verbinden', click: () => this.restart(), disabled: !this.cfg },
      { label: 'Session duplizieren (neues Pane)', click: () => duplicatePane(this), disabled: !this.cfg },
      { label: 'Session speichern…', click: () => sessionDialog({ cfg: this.cfg, mode: 'new', folders: folders(), onSubmit: ({ cfg, save }) => { if (save) saveSession(cfg); } }), disabled: !this.cfg || S.sessions.some(s => s.id === this.cfg.id) },
      { sep: true },
      { label: 'Vertikal teilen (nebeneinander)', click: () => splitPane(this, 'row') },
      { label: 'Horizontal teilen (untereinander)', click: () => splitPane(this, 'column') },
      { label: 'In neuen Tab verschieben', click: () => movePaneToNewTab(this), disabled: Layout.leaves(this.tab.root).length < 2 },
      { sep: true },
      { label: this.broadcast ? 'Aus Multi-Input entfernen' : 'In Multi-Input einbeziehen', click: () => this.toggleBroadcast() },
      { sep: true },
      { label: 'Makro ausführen…', click: () => { setActivePane(this); pickAndRunMacro(); }, disabled: this.state !== 'running' },
      this.macroRun ? { label: `Makro „${this.macroRun.macro.name}“ stoppen`, click: () => this.macroRun && this.macroRun.stop('manuell') }
        : { label: isRecording(this) ? 'Aufzeichnung stoppen…' : 'Makro aufzeichnen', click: () => isRecording(this) ? stopRecording() : startRecording(this), disabled: this.state !== 'running' && !isRecording(this) },
      ...(t === 'ssh' ? [{ sep: true }, { label: 'Dateien übertragen (SCP)…', click: () => toggleFiles(this) },
        { label: 'Dateien hochladen…', click: async () => { await toggleFiles(this); const f = await api.fx.pickUpload(); if (f.length) { await waitCwd(this); fxUpload(f); } } }] : []),
      { sep: true },
      { label: 'Kopieren', click: () => { if (this.term && this.term.hasSelection()) api.writeClipboard(this.term.getSelection()); }, disabled: !this.term },
      { label: 'Einfügen', click: () => api.readClipboard().then(tx => tx && this.term && this.term.paste(tx)), disabled: !this.term },
      { label: 'Suchen…', click: () => this.openFind(), disabled: !this.term },
      { label: 'Terminal leeren', click: () => this.term && this.term.clear(), disabled: !this.term },
      { label: 'Puffer als Textdatei speichern…', click: () => this.saveBuffer(), disabled: !this.term }
    ];
    if (t === 'serial' || t === 'telnet') {
      items.push({ sep: true }, { label: 'Break senden', click: () => api.action(this.sessionId, 'break'), disabled: this.state !== 'running' });
    }
    if (t === 'serial') {
      items.push({ label: 'DTR umschalten', click: async () => toast('DTR: ' + ((await api.action(this.sessionId, 'dtr')) ? 'an' : 'aus')), disabled: this.state !== 'running' });
      items.push({ label: 'RTS umschalten', click: async () => toast('RTS: ' + ((await api.action(this.sessionId, 'rts')) ? 'an' : 'aus')), disabled: this.state !== 'running' });
    }
    if (t === 'telnet') items.push({ label: 'Interrupt (IAC IP) senden', click: () => api.action(this.sessionId, 'ip'), disabled: this.state !== 'running' });
    items.push({ sep: true }, { label: 'Pane schließen', click: () => requestClosePane(this) });
    showContextMenu(x, y, items);
  }

  saveBuffer() {
    const buf = this.term.buffer.active;
    const lines = [];
    for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i).translateToString(true));
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${this.title.replace(/[^\w.@-]+/g, '_')}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log` });
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- Drag & Drop von Sessions aus der Seitenleiste ---------- */
  setupDrop() {
    const overlay = () => this.el.querySelector('.drop-overlay');
    const zoneOf = (e) => {
      const r = this.el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (this.state === 'launcher' || this.state === 'exited') { if (x > 0.25 && x < 0.75 && y > 0.25 && y < 0.75) return 'center'; }
      const d = { left: x, right: 1 - x, top: y, bottom: 1 - y };
      return Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
    };
    this.el.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files') && this.cfg && this.cfg.type === 'ssh') {
        e.preventDefault(); overlay().className = 'drop-overlay show center files'; return;
      }
      if (S.drag && dragTargetOk(S.drag, this)) {
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        const z = moveZone(e);
        overlay().className = 'drop-overlay show ' + z + ' move';
        return;
      }
      if (!e.dataTransfer.types.includes('application/x-macterm-session')) return;
      e.preventDefault();
      const z = zoneOf(e);
      overlay().className = 'drop-overlay show ' + z;
    });
    const moveZone = (e) => {
      const z = zoneOf(e);
      return z === 'center' && this.state !== 'launcher' ? (() => { const r = this.el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; return Object.entries({ left: x, right: 1 - x, top: y, bottom: 1 - y }).sort((a, b) => a[1] - b[1])[0][0]; })() : z;
    };
    this.el.addEventListener('dragleave', (e) => { if (!this.el.contains(e.relatedTarget)) overlay().className = 'drop-overlay'; });
    this.el.addEventListener('drop', async (e) => {
      if (e.dataTransfer.types.includes('Files') && this.cfg && this.cfg.type === 'ssh') {
        e.preventDefault(); overlay().className = 'drop-overlay';
        const paths = droppedPaths(e);
        if (!paths.length) return;
        await toggleFiles(this);
        await waitCwd(this);
        fxUpload(paths);
        return;
      }
      if (S.drag && dragTargetOk(S.drag, this)) {
        e.preventDefault(); overlay().className = 'drop-overlay';
        const d = S.drag; const z = moveZone(e); endDrag();
        if (d.kind === 'tab') mergeTabInto(getTab(d.id), this, z);
        else movePaneTo(S.panes.get(d.id), this, z);
        return;
      }
      const id = e.dataTransfer.getData('application/x-macterm-session');
      overlay().className = 'drop-overlay';
      const s = S.sessions.find(x => x.id === id);
      if (!s) return;
      e.preventDefault();
      const z = zoneOf(e);
      if (z === 'center') { this.start(s); return; }
      splitPane(this, z === 'left' || z === 'right' ? 'row' : 'column', s, z === 'left' || z === 'top');
    });
  }

  destroy() {
    if (this.macroRun) this.macroRun.stop('', true);
    if (REC.pane === this) stopRecording();
    fxOnPaneClosed(this);
    if (this.sessionId) { api.kill(this.sessionId); S.bySession.delete(this.sessionId); }
    this.ro.disconnect();
    if (this.term) this.term.dispose();
    this.el.remove();
    S.panes.delete(this.id);
  }
}

/* =====================================================================
 * Tabs
 * ===================================================================== */
function createTab(rootCfgOrNode) {
  const tab = { id: uid('t'), root: null, activePaneId: null, zoomed: null, customTitle: null, el: h('div', { class: 'workspace' }) };
  S.tabs.push(tab);
  $('#workspaces').appendChild(tab.el);
  if (rootCfgOrNode && rootCfgOrNode.type === 'tree') {
    tab.root = buildRestored(tab, rootCfgOrNode.node);
  } else if (Array.isArray(rootCfgOrNode)) {
    const ids = rootCfgOrNode.map(c => new Pane(tab, c).id);
    tab.root = Layout.grid(ids);
  } else {
    const p = new Pane(tab, rootCfgOrNode || null);
    tab.root = Layout.leaf(p.id);
  }
  tab.activePaneId = Layout.leaves(tab.root)[0];
  renderTab(tab);
  activateTab(tab.id);
  return tab;
}
function buildRestored(tab, n) {
  if (n.type === 'leaf') return Layout.leaf(new Pane(tab, n.cfg || null).id);
  return { type: 'split', dir: n.dir, ratio: n.ratio, a: buildRestored(tab, n.a), b: buildRestored(tab, n.b) };
}

const getTab = (id) => S.tabs.find(t => t.id === id);
const activeTab = () => getTab(S.activeTabId);
function activePane() { const t = activeTab(); return t ? S.panes.get(t.activePaneId) : null; }

function renderTab(tab) {
  const node = tab.zoomed && S.panes.has(tab.zoomed) ? Layout.leaf(tab.zoomed) : tab.root;
  tab.el.classList.toggle('zoomed', !!tab.zoomed);
  Layout.render(tab.el, node, (id) => S.panes.get(id).el, () => { saveLayoutSoon(); });
  for (const id of Layout.leaves(tab.root)) { const p = S.panes.get(id); if (p) { p.scheduleFit(); p.el.classList.toggle('active', id === tab.activePaneId); } }
  renderTabBarSoon();
}

function activateTab(id) {
  S.activeTabId = id;
  for (const t of S.tabs) t.el.classList.toggle('visible', t.id === id);
  const t = activeTab();
  if (t) {
    for (const pid of Layout.leaves(t.root)) S.panes.get(pid)?.scheduleFit();
    const p = activePane();
    if (p) setTimeout(() => p.focus(), 0);
  }
  renderTabBar();
  updateStatus();
}

function setActivePane(pane, focus = true) {
  const tab = pane.tab;
  if (!tab) return;
  if (tab.activePaneId !== pane.id) {
    tab.activePaneId = pane.id;
    for (const id of Layout.leaves(tab.root)) S.panes.get(id)?.el.classList.toggle('active', id === pane.id);
    renderTabBarSoon();
  }
  if (focus) pane.focus();
  updateStatus();
  fxOnActivePane(pane);
}

function tabTitle(t) {
  if (t.customTitle) return t.customTitle;
  const p = S.panes.get(t.activePaneId) || S.panes.get(Layout.leaves(t.root)[0]);
  return p ? p.title : 'Tab';
}

let _tabBarRaf = null;
function renderTabBarSoon() { if (_tabBarRaf) return; _tabBarRaf = requestAnimationFrame(() => { _tabBarRaf = null; renderTabBar(); }); }
function renderTabBar() {
  if (S.drag && S.drag.kind === 'tab') { S._tabBarDirty = true; return; } // Quelle des Ziehens nicht entfernen
  const box = $('#tabs');
  box.textContent = '';
  S.tabs.forEach((t, i) => {
    const leaves = Layout.leaves(t.root);
    const p = S.panes.get(t.activePaneId);
    const meta = p && p.cfg ? TYPE_META[p.cfg.type] : null;
    const dead = leaves.every(id => S.panes.get(id)?.state === 'exited');
    const bc = S.multiInput && leaves.some(id => S.panes.get(id)?.broadcast);
    const titleSpan = h('span', { class: 't-title' }, tabTitle(t));
    const el = h('div', { class: 'tab' + (t.id === S.activeTabId ? ' active' : '') + (dead ? ' dead' : '') + (bc ? ' bc' : ''), title: `${tabTitle(t)} (⌘${i + 1})`,
      style: { borderTopColor: (p && p.cfg && p.cfg.color) || '' } },
      h('span', { class: 'badge', style: { color: meta ? meta.color : '' } }, meta ? meta.icon : '··'),
      titleSpan,
      leaves.length > 1 ? h('span', { class: 't-count' }, String(leaves.length)) : null,
      h('button', { class: 't-close', title: 'Tab schließen (⇧⌘W)', onclick: (e) => { e.stopPropagation(); requestCloseTab(t); } }, '×'));
    el.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); requestCloseTab(t); } });
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-macterm-tab', t.id);
      e.dataTransfer.effectAllowed = 'move';
      startDrag({ kind: 'tab', id: t.id });
      if (S.tabs.length > 1) toast('Über einen anderen Tab halten, dann an den Rand eines Panes ziehen – oder in der Tab-Leiste umsortieren', 3500);
    });
    el.addEventListener('dragend', endDrag);
    el.addEventListener('dragover', (e) => {
      if (!S.drag && !e.dataTransfer.types.includes('application/x-macterm-session')) return;
      e.preventDefault();
      if (S.drag && S.drag.kind === 'tab' && S.drag.id !== t.id) {
        const r = el.getBoundingClientRect();
        const left = e.clientX < r.left + r.width / 2;
        el.classList.toggle('drop-before', left); el.classList.toggle('drop-after', !left);
      }
      // kurz über einem Tab verweilen öffnet ihn (wie im Browser)
      if (t.id !== S.activeTabId && S._hoverTab !== t.id) {
        S._hoverTab = t.id; clearTimeout(S._hoverT);
        S._hoverT = setTimeout(() => { if (S._hoverTab === t.id) activateTab(t.id); }, 450);
      }
    });
    el.addEventListener('dragleave', () => { el.classList.remove('drop-before', 'drop-after'); if (S._hoverTab === t.id) { S._hoverTab = null; clearTimeout(S._hoverT); } });
    el.addEventListener('drop', (e) => {
      el.classList.remove('drop-before', 'drop-after');
      if (!S.drag) return;
      e.preventDefault();
      const d = S.drag;
      const r = el.getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      endDrag();
      if (d.kind === 'tab' && d.id !== t.id) {
        reorderTab(getTab(d.id), t, before);
      } else if (d.kind === 'pane') {
        const p = S.panes.get(d.id);
        if (p && p.tabId !== t.id) movePaneTo(p, S.panes.get(t.activePaneId) || S.panes.get(Layout.leaves(t.root)[0]), 'right');
      }
    });
    el.addEventListener('click', () => activateTab(t.id));
    el.addEventListener('dblclick', () => {
      const input = h('input', { class: 't-rename', value: tabTitle(t) });
      titleSpan.replaceWith(input); input.focus(); input.select();
      const done = (ok) => { if (ok) t.customTitle = input.value.trim() || null; renderTabBar(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
      input.addEventListener('blur', () => done(true));
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Umbenennen', click: () => el.dispatchEvent(new MouseEvent('dblclick')) },
        { label: 'Alle Panes für Multi-Input wählen', click: () => { activateTab(t.id); selectBroadcast('tab'); } },
        { label: 'Panes gleichmäßig verteilen', click: () => { t.root = Layout.equalize(t.root); renderTab(t); } },
        ...S.tabs.filter(x => x !== t).slice(0, 8).map(x => ({ label: `Neben „${tabTitle(x)}“ einfügen (geteilt)`, click: () => mergeTabInto(t, S.panes.get(x.activePaneId) || S.panes.get(Layout.leaves(x.root)[0]), 'right') })),
        { sep: true },
        { label: 'Alle Sessions neu verbinden', click: () => leaves.forEach(id => { const pp = S.panes.get(id); if (pp && pp.cfg) pp.restart(); }) },
        { sep: true },
        { label: 'Tab schließen', click: () => requestCloseTab(t) },
        { label: 'Andere Tabs schließen', click: () => S.tabs.filter(x => x !== t).forEach(closeTab), disabled: S.tabs.length < 2 }
      ]);
    });
    box.appendChild(el);
  });
  document.title = activeTab() ? `${tabTitle(activeTab())} – MacT-1000` : 'MacT-1000';
}

/* =====================================================================
 * Split / Schließen / Navigation
 * ===================================================================== */
function splitPane(pane, dir, cfg = null, before = false, sourceForLauncher = null) {
  pane = pane || activePane();
  if (!pane) return;
  const tab = pane.tab;
  tab.zoomed = null;
  const np = new Pane(tab, cfg);
  if (!cfg && (sourceForLauncher || pane.cfg)) np.showLauncher(sourceForLauncher || pane.cfg);
  tab.root = Layout.split(tab.root, pane.id, np.id, dir, before);
  tab.activePaneId = np.id;
  renderTab(tab);
  setTimeout(() => setActivePane(np), 0);
  saveLayoutSoon();
  return np;
}

async function duplicatePane(pane) {
  pane = pane || activePane();
  if (!pane || !pane.cfg) return;
  const cfg = clone(pane.cfg);
  if (cfg.type === 'local' && pane.sessionId) {
    const cwd = await api.action(pane.sessionId, 'cwd');
    if (cwd) cfg.cwd = cwd;
  }
  const r = pane.el.getBoundingClientRect();
  splitPane(pane, r.width / 2.1 > r.height ? 'row' : 'column', cfg);
}

const REMOTE_TYPES = { ssh: 'SSH', telnet: 'Telnet', serial: 'Seriell' };
function isActiveConnection(p) {
  return !!(p && p.cfg && REMOTE_TYPES[p.cfg.type] && (p.state === 'running' || p.state === 'connecting'));
}
async function confirmCloseActive(panes, what) {
  const act = panes.filter(isActiveConnection);
  if (!act.length || S.settings.confirmCloseActive === false) return true;
  const names = act.slice(0, 8).map(p => `${REMOTE_TYPES[p.cfg.type]}: ${p.title}`).join(', ') + (act.length > 8 ? ', …' : '');
  const msg = act.length === 1 ? `Es besteht noch eine aktive Verbindung (${names}).` : `Es bestehen noch ${act.length} aktive Verbindungen (${names}).`;
  return confirmDialog(what + ' schließen', msg + ` ${what} trotzdem schließen? Die Verbindung wird getrennt.`, 'Schließen');
}
async function requestClosePane(pane) {
  pane = pane || activePane();
  if (!pane) return;
  if (await confirmCloseActive([pane], 'Pane')) closePane(pane);
}
async function requestCloseTab(tab) {
  tab = tab || activeTab();
  if (!tab) return;
  if (await confirmCloseActive(Layout.leaves(tab.root).map(id => S.panes.get(id)), 'Tab')) closeTab(tab);
}

function closePane(pane) {
  pane = pane || activePane();
  if (!pane) return;
  const tab = pane.tab;
  const leaves = Layout.leaves(tab.root);
  const idx = leaves.indexOf(pane.id);
  pane.destroy();
  tab.root = Layout.remove(tab.root, pane.id);
  if (tab.zoomed === pane.id) tab.zoomed = null;
  if (!tab.root) { removeTab(tab); return; }
  const rest = Layout.leaves(tab.root);
  tab.activePaneId = rest[Math.max(0, Math.min(idx - 1, rest.length - 1))] || rest[0];
  renderTab(tab);
  const p = S.panes.get(tab.activePaneId);
  if (p && tab.id === S.activeTabId) setActivePane(p);
  updateMultiUI();
  saveLayoutSoon();
}

function closeTab(tab) {
  tab = tab || activeTab();
  if (!tab) return;
  for (const id of Layout.leaves(tab.root)) S.panes.get(id)?.destroy();
  removeTab(tab);
}
function removeTab(tab) {
  const i = S.tabs.indexOf(tab);
  S.tabs.splice(i, 1);
  tab.el.remove();
  if (!S.tabs.length) { createTab(null); return; }
  if (S.activeTabId === tab.id) activateTab(S.tabs[Math.max(0, i - 1)].id);
  renderTabBar();
  updateMultiUI();
  saveLayoutSoon();
}

function movePaneToNewTab(pane) {
  const old = pane.tab;
  old.root = Layout.remove(old.root, pane.id);
  if (old.zoomed === pane.id) old.zoomed = null;
  old.activePaneId = Layout.leaves(old.root)[0];
  renderTab(old);
  const tab = { id: uid('t'), root: Layout.leaf(pane.id), activePaneId: pane.id, zoomed: null, customTitle: null, el: h('div', { class: 'workspace' }) };
  S.tabs.push(tab);
  $('#workspaces').appendChild(tab.el);
  pane.tabId = tab.id;
  renderTab(tab);
  activateTab(tab.id);
}

/* ---------- Tabs und Panes per Drag & Drop zusammenführen ---------- */
function startDrag(d) { S.drag = d; document.body.classList.add('dragging', 'dragging-' + d.kind); }
function endDrag() {
  S.drag = null; S._hoverTab = null; clearTimeout(S._hoverT);
  document.body.classList.remove('dragging', 'dragging-tab', 'dragging-pane');
  $$('.drop-overlay.show').forEach(o => { o.className = 'drop-overlay'; });
  if (S._tabBarDirty) { S._tabBarDirty = false; }
  renderTabBar();
}
function dragTargetOk(d, pane) {
  if (d.kind === 'tab') return getTab(d.id) && pane.tabId !== d.id;
  if (d.kind === 'pane') { const p = S.panes.get(d.id); return p && p !== pane; }
  return false;
}
const zoneDir = (z) => (z === 'left' || z === 'right' ? 'row' : 'column');
const zoneBefore = (z) => z === 'left' || z === 'top';

/** Kompletten Tab (inkl. seiner Splits) neben/unter ein Pane eines anderen Tabs setzen */
function mergeTabInto(src, target, zone = 'right') {
  if (!src || !target) return;
  const dst = target.tab;
  if (!dst || dst === src) return;
  const ids = Layout.leaves(src.root);
  for (const id of ids) { const p = S.panes.get(id); if (p) p.tabId = dst.id; }
  dst.zoomed = null;
  if (zone === 'center' && target.state === 'launcher') {
    dst.root = Layout.insert(dst.root, target.id, src.root, 'row');
    dst.root = Layout.remove(dst.root, target.id);
    target.destroy();
  } else {
    dst.root = Layout.insert(dst.root, target.id, src.root, zoneDir(zone), zoneBefore(zone));
  }
  dst.activePaneId = src.activePaneId && ids.includes(src.activePaneId) ? src.activePaneId : ids[0];
  // Quell-Tab entfernen, ohne seine Panes zu beenden
  const i = S.tabs.indexOf(src);
  if (i >= 0) S.tabs.splice(i, 1);
  src.el.remove();
  renderTab(dst);
  activateTab(dst.id);
  updateMultiUI();
  saveLayoutSoon();
  toast(`Tab „${src.customTitle || (S.panes.get(ids[0])?.title) || 'Tab'}“ eingefügt`);
}

/** Einzelnes Pane an eine andere Stelle (auch in anderen Tab) verschieben */
function movePaneTo(pane, target, zone = 'right') {
  if (!pane || !target || pane === target) return;
  const old = pane.tab; const dst = target.tab;
  if (!old || !dst) return;
  old.root = Layout.remove(old.root, pane.id);
  if (old.zoomed === pane.id) old.zoomed = null;
  dst.zoomed = null;
  pane.tabId = dst.id;
  if (zone === 'center' && target.state === 'launcher') {
    dst.root = Layout.split(dst.root, target.id, pane.id, 'row');
    dst.root = Layout.remove(dst.root, target.id);
    target.destroy();
  } else {
    dst.root = Layout.split(dst.root, target.id, pane.id, zoneDir(zone), zoneBefore(zone));
  }
  dst.activePaneId = pane.id;
  if (old !== dst) {
    if (!old.root) { const i = S.tabs.indexOf(old); S.tabs.splice(i, 1); old.el.remove(); }
    else { if (!Layout.leaves(old.root).includes(old.activePaneId)) old.activePaneId = Layout.leaves(old.root)[0]; renderTab(old); }
  }
  renderTab(dst);
  activateTab(dst.id);
  setTimeout(() => setActivePane(pane), 0);
  updateMultiUI();
  saveLayoutSoon();
}

function reorderTab(src, ref, before) {
  if (!src || !ref || src === ref) return;
  S.tabs.splice(S.tabs.indexOf(src), 1);
  const j = S.tabs.indexOf(ref);
  S.tabs.splice(before ? j : j + 1, 0, src);
  renderTabBar();
  saveLayoutSoon();
}

function toggleZoom(pane) {
  pane = pane || activePane();
  if (!pane) return;
  const tab = pane.tab;
  tab.zoomed = tab.zoomed === pane.id ? null : pane.id;
  if (Layout.leaves(tab.root).length < 2) tab.zoomed = null;
  tab.activePaneId = pane.id;
  renderTab(tab);
  setTimeout(() => pane.focus(), 0);
}

function cyclePane(dir) {
  const tab = activeTab(); if (!tab) return;
  const leaves = Layout.leaves(tab.root);
  const i = leaves.indexOf(tab.activePaneId);
  const next = S.panes.get(leaves[(i + dir + leaves.length) % leaves.length]);
  if (tab.zoomed) { tab.zoomed = next.id; renderTab(tab); }
  setActivePane(next);
}
// ⌘→ / ⌘← : nächstes/vorheriges Pane über alle Tabs hinweg
function cyclePaneGlobal(dir) {
  const all = [];
  for (const t of S.tabs) for (const id of Layout.leaves(t.root)) if (S.panes.get(id)) all.push(S.panes.get(id));
  if (!all.length) return;
  const cur = activePane();
  const i = Math.max(0, all.indexOf(cur));
  const next = all[(i + dir + all.length) % all.length];
  const tab = next.tab;
  tab.activePaneId = next.id;
  if (tab.zoomed && tab.zoomed !== next.id) { tab.zoomed = next.id; renderTab(tab); }
  if (tab.id !== S.activeTabId) activateTab(tab.id);
  setActivePane(next);
}
function cycleTab(dir) {
  if (!S.tabs.length) return;
  const i = S.tabs.findIndex(t => t.id === S.activeTabId);
  activateTab(S.tabs[(i + dir + S.tabs.length) % S.tabs.length].id);
}

/* =====================================================================
 * Multi-Input & Multi-Paste
 * ===================================================================== */
function broadcastTargets() { return [...S.panes.values()].filter(p => p.broadcast && p.state === 'running'); }

function setMultiInput(on, autoSelect = true) {
  S.multiInput = on;
  if (on && autoSelect && !broadcastTargets().length) selectBroadcast('tab', false);
  for (const p of S.panes.values()) p.updateHeader();
  updateMultiUI();
  toast(on ? 'Multi-Input aktiviert' : 'Multi-Input beendet');
}

function selectBroadcast(scope, ensureOn = true) {
  const tab = activeTab();
  for (const p of S.panes.values()) {
    if (scope === 'none') p.broadcast = false;
    else if (scope === 'all') p.broadcast = p.state !== 'launcher';
    else if (scope === 'tab') p.broadcast = p.tabId === tab.id && p.state !== 'launcher';
  }
  if (ensureOn && scope !== 'none' && !S.multiInput) { S.multiInput = true; toast('Multi-Input aktiviert'); }
  for (const p of S.panes.values()) p.updateHeader();
  updateMultiUI();
}

function updateMultiUI() {
  const n = broadcastTargets().length;
  $('#multi-banner').hidden = !S.multiInput;
  $('#multi-count').textContent = n;
  $('#btn-multi').classList.toggle('on', S.multiInput);
  document.body.classList.toggle('multi-on', S.multiInput);
  $('#st-multi').textContent = S.multiInput ? `Multi-Input: ${n} Panes` : '';
  renderTabBarSoon();
}

async function openMultiPaste() {
  const tab = activeTab();
  const running = [...S.panes.values()].filter(p => p.state === 'running');
  const anyBc = S.multiInput && running.some(p => p.broadcast);
  const panes = running.map(p => ({
    id: p.id, title: p.title, type: p.cfg.type, tabTitle: tabTitle(p.tab), current: p.tabId === tab.id,
    checked: anyBc ? p.broadcast : p.tabId === tab.id
  }));
  const history = JSON.parse(localStorage.getItem('mpHistory') || '[]');
  const sel = activePane()?.term?.getSelection();
  const clip = sel || await api.readClipboard();
  multiPasteDialog({ panes, initialText: clip, history, onSend: (o) => doMultiPaste(o) });
}

async function doMultiPaste({ text, targets, mode, delay, enter, bracketed }) {
  const hist = JSON.parse(localStorage.getItem('mpHistory') || '[]').filter(t => t !== text);
  hist.unshift(text);
  localStorage.setItem('mpHistory', JSON.stringify(hist.slice(0, 20)));
  const panes = targets.map(id => S.panes.get(id)).filter(p => p && p.state === 'running');
  const subst = (t, p, i) => t
    .replace(/\{\{name\}\}/g, p.cfg.name || sessionTitle(p.cfg))
    .replace(/\{\{host\}\}/g, p.cfg.host || p.cfg.path || '')
    .replace(/\{\{user\}\}/g, p.cfg.username || '')
    .replace(/\{\{n\}\}/g, String(i + 1));
  const norm = text.replace(/\r\n/g, '\n');
  if (mode === 'lines') {
    const lines = norm.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    toast(`Sende ${lines.length} Zeilen an ${panes.length} Panes…`);
    for (let li = 0; li < lines.length; li++) {
      const last = li === lines.length - 1;
      panes.forEach((p, i) => p.sendRaw(subst(lines[li], p, i) + (!last || enter ? '\r' : '')));
      if (!last && delay) await sleep(delay);
    }
  } else {
    let bodyText = norm;
    const hadTrailing = bodyText.endsWith('\n');
    if (enter && hadTrailing) bodyText = bodyText.replace(/\n+$/, '');
    panes.forEach((p, i) => {
      let t = subst(bodyText, p, i).replace(/\n/g, '\r');
      if (bracketed && p.term.modes && p.term.modes.bracketedPasteMode) t = '\x1b[200~' + t + '\x1b[201~';
      if (enter) t += '\r';
      p.sendRaw(t);
    });
    toast(`An ${panes.length} Panes gesendet`);
  }
  activePane()?.focus();
}

/* =====================================================================
 * Seitenleiste – gespeicherte Sessions
 * ===================================================================== */
const ROOT_FOLDER = 'Sessions';
// Ordner = alle Ordner aus Sessions + explizit angelegte (auch leere) Ordner aus den Einstellungen
function folders() {
  return [...new Set([...(S.settings.sessionFolders || []), ...S.sessions.map(s => s.folder)].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
}
function saveFolderList(list) { return saveSettings({ sessionFolders: [...new Set(list.filter(f => f && f !== ROOT_FOLDER))] }); }

function newFolderDialog(then) {
  const input = h('input', { placeholder: 'z.B. Rechenzentrum' });
  const create = async () => {
    const v = input.value.trim();
    if (!v) return false;
    if (v === ROOT_FOLDER || folders().includes(v)) { toast(`Ordner „${v}“ existiert bereits`); return false; }
    await saveFolderList([...(S.settings.sessionFolders || []), v]);
    S.collapsed.delete(v);
    renderSidebar();
    toast(`Ordner „${v}“ angelegt – Sessions per Drag & Drop hineinziehen`);
    if (then) then(v);
  };
  openModal({ title: 'Neuer Ordner', width: 380, body: field('Name', input), buttons: [
    { label: 'Abbrechen', click: () => {} },
    { label: 'Anlegen', cls: 'primary', click: () => create() }
  ]});
  setTimeout(() => input.focus(), 30);
}

async function moveSessionsToFolder(ids, folder) {
  const target = folder === ROOT_FOLDER ? '' : (folder || '');
  let n = 0;
  for (const s of S.sessions) if (ids.includes(s.id) && (s.folder || '') !== target) { if (target) s.folder = target; else delete s.folder; n++; }
  if (!n) return;
  if (target) S.collapsed.delete(target);
  // explizit angelegte Ordner bleiben bestehen, auch wenn sie leer werden
  const keep = new Set([...(S.settings.sessionFolders || []), ...S.sessions.map(x => x.folder).filter(Boolean)]);
  await saveFolderList([...keep]);
  await persistSessions();
  toast(n === 1 ? `Session nach „${target || ROOT_FOLDER}“ verschoben` : `${n} Sessions nach „${target || ROOT_FOLDER}“ verschoben`);
}

function moveToFolderDialog(sess) {
  const sel = h('select', {}, h('option', { value: ROOT_FOLDER }, `${ROOT_FOLDER} (ohne Ordner)`), folders().map(f => h('option', { value: f, selected: f === sess.folder }, f)));
  openModal({ title: 'In Ordner verschieben', width: 380, body: field(`„${sessionTitle(sess)}“ verschieben nach`, sel), buttons: [
    { label: 'Neuer Ordner…', click: () => { setTimeout(() => newFolderDialog((v) => moveSessionsToFolder([sess.id], v)), 50); } },
    { label: 'Abbrechen', click: () => {} },
    { label: 'Verschieben', cls: 'primary', click: () => moveSessionsToFolder([sess.id], sel.value) }
  ]});
}

async function deleteFolder(name) {
  const inside = S.sessions.filter(s => s.folder === name);
  if (inside.length && !(await confirmDialog('Ordner löschen', `Der Ordner „${name}“ enthält ${inside.length} Session${inside.length === 1 ? '' : 's'}. Diese werden nicht gelöscht, sondern nach „${ROOT_FOLDER}“ verschoben.`, 'Ordner löschen'))) return;
  inside.forEach(s => { delete s.folder; });
  await saveFolderList((S.settings.sessionFolders || []).filter(f => f !== name));
  await persistSessions();
}

// Drag & Drop von Sessions auf Ordner
function sessionDropTarget(el, folder) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-macterm-session')) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    $$('.drop-folder').forEach(x => x !== el && x.classList.remove('drop-folder'));
    el.classList.add('drop-folder');
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-folder'); });
  el.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData('application/x-macterm-session');
    if (!id) return;
    e.preventDefault(); e.stopPropagation();
    $$('.drop-folder').forEach(x => x.classList.remove('drop-folder'));
    document.body.classList.remove('dragging');
    moveSessionsToFolder([id], folder);
  });
}

async function persistSessions() { await api.saveSessions(S.sessions); renderSidebar(); }

function saveSession(cfg) {
  const c = clone(cfg);
  if (!c.id) c.id = uid('sess');
  const i = S.sessions.findIndex(s => s.id === c.id);
  if (i >= 0) S.sessions[i] = c; else S.sessions.push(c);
  persistSessions();
  toast('Session gespeichert');
  return c;
}

function renderSidebar() {
  const tree = $('#session-tree');
  tree.textContent = '';
  const q = $('#side-filter').value.toLowerCase();
  const items = S.sessions.filter(s => !q || (sessionTitle(s) + ' ' + sessionSubtitle(s) + ' ' + (s.folder || '') + ' ' + s.type).toLowerCase().includes(q));
  const groups = new Map();
  const allFolders = folders();
  // leere/explizite Ordner immer zeigen (außer beim Filtern), damit man hineinziehen kann
  if (!q) for (const f of allFolders) groups.set(f, []);
  for (const s of items) { const f = s.folder || ROOT_FOLDER; if (!groups.has(f)) groups.set(f, []); groups.get(f).push(s); }
  // Wurzel als Ziel anzeigen, sobald es Ordner gibt (zum Herausziehen)
  if (!q && allFolders.length && S.sessions.length && !groups.has(ROOT_FOLDER)) groups.set(ROOT_FOLDER, []);
  const names = [...groups.keys()].sort((a, b) => a === ROOT_FOLDER ? 1 : b === ROOT_FOLDER ? -1 : a.localeCompare(b, 'de', { numeric: true }));
  for (const name of names) {
    const list = groups.get(name).sort((a, b) => sessionTitle(a).localeCompare(sessionTitle(b), 'de', { numeric: true }));
    const collapsed = S.collapsed.has(name) && !q;
    const head = h('div', { class: 'folder' + (collapsed ? ' collapsed' : ''), 'data-folder': name, title: name === ROOT_FOLDER ? 'Sessions ohne Ordner – hierher ziehen, um eine Session aus einem Ordner zu nehmen' : `Ordner „${name}“ – Sessions hierher ziehen` },
      h('span', { class: 'chev' }, '▾'), h('span', { class: 'f-name' }, name === ROOT_FOLDER && allFolders.length ? `${ROOT_FOLDER} (ohne Ordner)` : name), h('span', { class: 'f-count' }, String(list.length)));
    sessionDropTarget(head, name);
    head.addEventListener('click', () => {
      if (S.collapsed.has(name)) S.collapsed.delete(name); else S.collapsed.add(name);
      localStorage.setItem('collapsedFolders', JSON.stringify([...S.collapsed]));
      renderSidebar();
    });
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        { label: `Alle ${list.length} als Kacheln in neuem Tab öffnen`, disabled: !list.length, click: () => openTiled(list) },
        { label: 'Alle als Kacheln + Multi-Input', disabled: !list.length, click: () => { openTiled(list); selectBroadcast('tab'); } },
        { label: 'Alle in eigenen Tabs öffnen', disabled: !list.length, click: () => list.forEach(s => createTab(s)) },
        { sep: true },
        { label: 'Neuer Ordner…', click: () => newFolderDialog() },
        { label: 'Neue Session in diesem Ordner…', click: () => newSessionDialog(undefined, name === ROOT_FOLDER ? '' : name) },
        { label: 'Ordner umbenennen…', disabled: name === ROOT_FOLDER, click: () => renameFolder(name) },
        { label: 'Ordner löschen', disabled: name === ROOT_FOLDER, click: () => deleteFolder(name) }
      ]);
    });
    tree.appendChild(head);
    if (collapsed) continue;
    if (!list.length && name !== ROOT_FOLDER) {
      const empty = h('div', { class: 'folder-empty' }, 'leer – Sessions hierher ziehen');
      sessionDropTarget(empty, name);
      tree.appendChild(empty);
    }
    for (const s of list) {
      const item = h('div', { class: 'sess' + (S.selectedSessionId === s.id ? ' selected' : ''), draggable: 'true', title: `${TYPE_META[s.type]?.label}: ${sessionSubtitle(s)}\nDoppelklick: öffnen · Ziehen auf ein Pane: geteilt öffnen · Ziehen auf einen Ordner: verschieben` },
        h('span', { class: 'badge', style: { color: TYPE_META[s.type]?.color } }, TYPE_META[s.type]?.icon),
        h('span', { class: 's-text' }, h('span', { class: 's-name' }, sessionTitle(s)), h('span', { class: 's-sub' }, sessionSubtitle(s))),
        s.color ? h('span', { class: 's-dot', style: { background: s.color } }) : null);
      item.addEventListener('click', () => { S.selectedSessionId = s.id; $$('.sess.selected').forEach(x => x.classList.remove('selected')); item.classList.add('selected'); });
      item.addEventListener('dblclick', () => openSaved(s, 'tab'));
      item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-macterm-session', s.id); e.dataTransfer.effectAllowed = 'copyMove'; document.body.classList.add('dragging'); });
      item.addEventListener('dragend', () => document.body.classList.remove('dragging'));
      sessionDropTarget(item, name);
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
          { label: 'In neuem Tab öffnen', click: () => openSaved(s, 'tab') },
          { label: 'Im aktiven Pane öffnen', click: () => openSaved(s, 'here') },
          { label: 'Vertikal geteilt öffnen (nebeneinander)', click: () => openSaved(s, 'row') },
          { label: 'Horizontal geteilt öffnen (untereinander)', click: () => openSaved(s, 'column') },
          { sep: true },
          { label: 'Bearbeiten…', click: () => editSession(s) },
          { label: 'In Ordner verschieben…', click: () => moveToFolderDialog(s) },
          { label: 'Neuer Ordner…', click: () => newFolderDialog() },
          { label: 'Duplizieren', click: () => { const c = clone(s); delete c.id; c.name = (c.name || sessionTitle(s)) + ' (Kopie)'; saveSession(c); } },
          { label: 'Löschen', click: async () => { if (await confirmDialog('Session löschen', `„${sessionTitle(s)}“ wirklich löschen?`, 'Löschen')) { S.sessions = S.sessions.filter(x => x.id !== s.id); persistSessions(); } } }
        ]);
      });
      tree.appendChild(item);
    }
  }
  if (!S.sessions.length) tree.appendChild(h('div', { class: 'side-empty' }, 'Noch keine Sessions.', h('br'), h('button', { class: 'btn small', onclick: () => newSessionDialog() }, 'Session anlegen')));
  $('#side-count').textContent = `${S.sessions.length} Sessions`;
}

/** Passphrase eines SSH-Schlüssels per ssh-add im macOS-Schlüsselbund hinterlegen */
function storeKeyInKeychain(keyPath) {
  const k = (keyPath || '').trim();
  const q = (p) => '"' + p.replace(/(["\\])/g, '\\$1') + '"';
  const cmd = '/usr/bin/ssh-add --apple-use-keychain' + (k ? ' ' + q(k) : '');
  createTab({ type: 'command', name: 'Schlüssel → Schlüsselbund', command: cmd });
  toast(k ? 'Passphrase für ' + k + ' eingeben' : 'Passphrase für die Standard-Schlüssel eingeben');
}

function editSession(s) {
  sessionDialog({ cfg: s, mode: 'edit', folders: folders(), onSubmit: ({ cfg }) => saveSession({ ...cfg, id: s.id }) });
}

function renameFolder(name) {
  const input = h('input', { value: name });
  openModal({ title: 'Ordner umbenennen', width: 380, body: field('Neuer Name', input), buttons: [
    { label: 'Abbrechen', click: () => {} },
    { label: 'Umbenennen', cls: 'primary', click: async () => {
      const v = input.value.trim();
      if (!v || v === name) return;
      if (v === ROOT_FOLDER) { toast('Dieser Name ist reserviert'); return false; }
      S.sessions.forEach(s => { if (s.folder === name) s.folder = v; });
      await saveFolderList((S.settings.sessionFolders || []).map(f => f === name ? v : f));
      persistSessions();
    } }
  ]});
}

function openSaved(s, where) {
  const p = activePane();
  if (where === 'tab' || !p) return createTab(s);
  if (where === 'here') {
    if (p.state === 'running' && p.sessionId) { p.term.write('\r\n'); }
    return p.start(s);
  }
  splitPane(p, where, s);
}

function openTiled(list) {
  if (!list.length) return;
  createTab(list.map(clone));
}

function newSessionDialog(type, folder) {
  sessionDialog({ cfg: { type: type || 'ssh', ...(folder ? { folder } : {}) }, folders: folders(), onSubmit: ({ cfg, save, connect }) => {
    const saved = save ? saveSession(cfg) : cfg;
    if (connect) {
      const p = activePane();
      if (p && p.state === 'launcher') p.start(saved); else createTab(saved);
    }
  } });
}

/* =====================================================================
 * Kontextmenü
 * ===================================================================== */
function showContextMenu(x, y, items) {
  const m = $('#ctx-menu');
  m.textContent = '';
  for (const it of items) {
    if (it.sep) { m.appendChild(h('div', { class: 'sep' })); continue; }
    m.appendChild(h('div', { class: 'item' + (it.disabled ? ' disabled' : ''), onclick: () => { if (it.disabled) return; hideContextMenu(); it.click(); } }, it.label));
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
  m.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
}
function hideContextMenu() { $('#ctx-menu').hidden = true; }
document.addEventListener('mousedown', (e) => { if (!$('#ctx-menu').contains(e.target)) hideContextMenu(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideContextMenu();
  if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const t = e.target;
    if (t && t.classList && t.classList.contains('xterm-helper-textarea')) return; // vom Terminal behandelt
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.querySelector('.modal-backdrop')) return;
    e.preventDefault();
    cyclePaneGlobal(e.key === 'ArrowRight' ? 1 : -1);
  }
});
window.addEventListener('blur', hideContextMenu);

/* =====================================================================
 * Status, Einstellungen, Layout speichern
 * ===================================================================== */
function updateStatus() {
  const p = activePane();
  if (!p || !p.cfg) { $('#st-session').textContent = p ? 'Neues Pane – Session wählen' : '–'; $('#st-size').textContent = ''; return; }
  const meta = TYPE_META[p.cfg.type];
  const stateTxt = { connecting: 'verbinde…', running: 'verbunden', exited: 'beendet' }[p.state] || '';
  $('#st-session').textContent = `${meta.label}: ${sessionSubtitle(p.cfg)} · ${stateTxt}`;
  $('#st-size').textContent = p.term ? `${p.term.cols}×${p.term.rows}` : '';
}

function applySettings() {
  const st = S.settings;
  for (const p of S.panes.values()) {
    if (!p.term) continue;
    Object.assign(p.term.options, {
      fontFamily: st.fontFamily, fontSize: st.fontSize, scrollback: st.scrollback, cursorStyle: st.cursorStyle,
      cursorBlink: st.cursorBlink, macOptionIsMeta: !!st.optionIsMeta, theme: THEMES[st.theme] || THEMES.standard
    });
    p.el.style.setProperty('--tbg', (THEMES[st.theme] || THEMES.standard).background);
    p.scheduleFit();
  }
  document.body.dataset.theme = st.theme === 'light' ? 'light' : 'dark';
  $('#sidebar').hidden = st.sidebarVisible === false;
  $('#sidebar-resizer').hidden = st.sidebarVisible === false;
  if (st.sidebarWidth) $('#sidebar').style.width = st.sidebarWidth + 'px';
}
async function saveSettings(patch) {
  S.settings = { ...S.settings, ...patch };
  await api.saveSettings(S.settings);
  applySettings();
}
function changeFont(delta) {
  const size = delta === 0 ? 13 : Math.max(8, Math.min(32, S.settings.fontSize + delta));
  saveSettings({ fontSize: size });
}

function serializeLayout() {
  const ser = (n) => n.type === 'leaf' ? { type: 'leaf', cfg: S.panes.get(n.pane)?.cfg || null } : { type: 'split', dir: n.dir, ratio: n.ratio, a: ser(n.a), b: ser(n.b) };
  return { tabs: S.tabs.map(t => ({ node: ser(t.root), title: t.customTitle })), active: S.tabs.findIndex(t => t.id === S.activeTabId) };
}
let _saveT = null;
function saveLayoutSoon() { clearTimeout(_saveT); _saveT = setTimeout(() => localStorage.setItem('layout', JSON.stringify(serializeLayout())), 500); }
window.addEventListener('beforeunload', () => localStorage.setItem('layout', JSON.stringify(serializeLayout())));

/* =====================================================================
 * Befehle (Menü, Toolbar, Shortcuts)
 * ===================================================================== */
function focusedInput() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && !a.classList.contains('xterm-helper-textarea') ? a : null;
}

const COMMANDS = {
  macroMenu: () => { const b = $('#btn-macros').getBoundingClientRect(); showMacroMenu(b.left, b.bottom + 4); },
  macroRun: () => pickAndRunMacro(),
  macroRecord: () => { if (REC.pane) stopRecording(); else startRecording(); },
  macroManage: () => macroManager(),
  macroTriggers: () => triggerManager(),
  macroStop: () => stopAllMacros(),
  newTab: () => createTab({ type: 'local' }),
  newSession: () => newSessionDialog(),
  quickConnect: () => { const i = $('#quick-input'); i.focus(); i.select(); },
  closePane: () => { if ($('.modal-backdrop')) return; requestClosePane(); },
  closeTab: () => { if ($('.modal-backdrop')) return; requestCloseTab(); },
  nextPaneGlobal: () => cyclePaneGlobal(1),
  prevPaneGlobal: () => cyclePaneGlobal(-1),
  splitV: () => splitPane(activePane(), 'row'),
  splitH: () => splitPane(activePane(), 'column'),
  duplicate: () => duplicatePane(),
  nextPane: () => cyclePane(1),
  prevPane: () => cyclePane(-1),
  nextTab: () => cycleTab(1),
  prevTab: () => cycleTab(-1),
  zoomPane: () => toggleZoom(),
  equalize: () => { const t = activeTab(); if (t) { t.root = Layout.equalize(t.root); renderTab(t); } },
  toggleMultiInput: () => setMultiInput(!S.multiInput),
  broadcastSelectTab: () => selectBroadcast('tab'),
  broadcastSelectAll: () => selectBroadcast('all'),
  broadcastSelectNone: () => selectBroadcast('none', false),
  multiPaste: () => openMultiPaste(),
  keychainKey: async () => { const f = await api.openFile({ defaultPath: '~/.ssh', title: 'SSH-Schlüssel wählen (privater Schlüssel)' }); if (f) storeKeyInKeychain(f); },
  keychainDefault: () => storeKeyInKeychain(''),
  find: () => activePane()?.openFind(),
  clear: () => activePane()?.term?.clear(),
  selectAll: () => { const i = focusedInput(); if (i) i.select(); else activePane()?.term?.selectAll(); },
  settings: () => settingsDialog(S.settings, (f) => saveSettings(f)),
  toggleSidebar: () => saveSettings({ sidebarVisible: S.settings.sidebarVisible === false }),
  toggleFiles: () => { const p = activePane(); toggleFiles(p && p.cfg && p.cfg.type === 'ssh' && p !== FX.pane ? p : null); },
  fontInc: () => changeFont(1),
  fontDec: () => changeFont(-1),
  fontReset: () => changeFont(0),
  sessionsChanged: async () => { S.sessions = await api.getSessions(); renderSidebar(); },
  exportConfig: () => exportConfig(),
  importConfig: () => importConfig()
};
for (let i = 1; i <= 9; i++) COMMANDS['tab' + i] = () => { const t = i === 9 ? S.tabs[S.tabs.length - 1] : S.tabs[i - 1]; if (t) activateTab(t.id); };

/* ---------- Gesamte Konfiguration ---------- */
function exportConfig() {
  const ui = {
    layout: serializeLayout(),
    collapsedFolders: [...S.collapsed],
    mpHistory: JSON.parse(localStorage.getItem('mpHistory') || '[]')
  };
  exportConfigDialog({
    sessionsCount: S.sessions.length,
    pwCount: S.sessions.filter(x => x.password).length,
    onExport: async ({ includePasswords, passphrase }) => {
      const r = await api.exportConfig({ includePasswords, passphrase, ui });
      if (r && !r.canceled) toast(`Konfiguration exportiert: ${r.sessions} Sessions` + (includePasswords ? `, ${r.passwords} Passwörter (verschlüsselt)` : '') + ` → ${r.path.split('/').pop()}`);
    }
  });
}
async function importConfig() {
  let info;
  try { info = await api.pickImport(); }
  catch (e) { toast('Import fehlgeschlagen: ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); return; }
  if (!info || info.canceled) return;
  importConfigDialog(info, async (opts) => {
    const r = await api.applyImport(opts);
    if (r.ui) {
      if (Array.isArray(r.ui.collapsedFolders)) { localStorage.setItem('collapsedFolders', JSON.stringify(r.ui.collapsedFolders)); S.collapsed = new Set(r.ui.collapsedFolders); }
      if (Array.isArray(r.ui.mpHistory)) localStorage.setItem('mpHistory', JSON.stringify(r.ui.mpHistory.slice(0, 20)));
      if (r.ui.layout && r.ui.layout.tabs && r.ui.layout.tabs.length) localStorage.setItem('layoutImport', JSON.stringify(r.ui.layout));
    }
    S.sessions = await api.getSessions();
    if (r.settings) { S.settings = await api.getSettings(); applySettings(); }
    renderSidebar();
    toast(`Import abgeschlossen: ${r.added} neu, ${r.updated} aktualisiert` + (r.passwords ? `, ${r.passwords} Passwörter` : '') + (r.settings ? ', Einstellungen übernommen' : ''));
  });
}

/** wartet, bis der Datei-Browser das Verzeichnis des Panes geladen hat */
async function waitCwd(pane, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (FX.pane === pane && FX.cwd && !FX.loading) return true;
    if (FX.pane === pane && FX.error) return false;
    await sleep(150);
  }
  return false;
}

function runCommand(cmd) { const f = COMMANDS[cmd]; if (f) f(); }

/* =====================================================================
 * Init
 * ===================================================================== */
async function init() {
  S.settings = await api.getSettings();
  if (!THEMES[S.settings.theme]) S.settings.theme = 'standard'; // ältere Theme-IDs
  S.sessions = await api.getSessions();
  applySettings();
  renderSidebar();

  api.onData(({ id, data }) => S.bySession.get(id)?.onData(data));
  api.onExit((info) => { const p = S.bySession.get(info.id); if (p) p.onExit(info); });
  api.onStatus(() => {});
  api.onMenu(runCommand);
  initFiles();

  $$('[data-cmd]').forEach(b => b.addEventListener('click', () => runCommand(b.dataset.cmd)));
  $('#tab-add').addEventListener('click', () => createTab(null));
  // Pane auf freie Fläche der Tab-Leiste / „+“ ziehen = eigener Tab
  const tb = $('#tabbar');
  tb.addEventListener('dragover', (e) => { if (S.drag && S.drag.kind === 'pane' && !e.target.closest('.tab')) { e.preventDefault(); tb.classList.add('drop'); } });
  tb.addEventListener('dragleave', (e) => { if (!tb.contains(e.relatedTarget)) tb.classList.remove('drop'); });
  tb.addEventListener('drop', (e) => {
    tb.classList.remove('drop');
    if (!S.drag || S.drag.kind !== 'pane' || e.target.closest('.tab')) return;
    e.preventDefault();
    const p = S.panes.get(S.drag.id); endDrag();
    if (p && Layout.leaves(p.tab.root).length > 1) movePaneToNewTab(p);
  });
  $('#side-add').addEventListener('click', () => newSessionDialog());
  $('#side-filter').addEventListener('input', renderSidebar);
  // Rechtsklick auf freie Fläche der Session-Liste: Ordner / Session anlegen
  $('#session-tree').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Neuer Ordner…', click: () => newFolderDialog() },
      { label: 'Neue Session…', click: () => newSessionDialog() }
    ]);
  });
  // Drop auf freie Fläche: Session aus dem Ordner nehmen
  sessionDropTarget($('#session-tree'), ROOT_FOLDER);
  $('#side-filter').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = S.sessions.find(s => (sessionTitle(s) + ' ' + sessionSubtitle(s)).toLowerCase().includes(e.target.value.toLowerCase())); if (first) openSaved(first, 'tab'); }
  });
  const quick = $('#quick-input');
  quick.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cfg = parseQuick(quick.value);
      if (!cfg) { toast('Eingabe nicht erkannt – Beispiele: admin@10.0.0.1 · telnet 10.0.0.2 · /dev/cu.usbserial 9600 · rdp server'); return; }
      if (e.shiftKey) splitPane(activePane(), 'row', cfg); else createTab(cfg);
      quick.value = '';
    }
    if (e.key === 'Escape') { quick.blur(); activePane()?.focus(); }
  });

  // Seitenleisten-Breite
  const rz = $('#sidebar-resizer');
  rz.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('resizing', 'col-resize');
    const move = (ev) => { $('#sidebar').style.width = Math.max(160, Math.min(760, ev.clientX)) + 'px'; };
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing', 'col-resize');
      saveSettings({ sidebarWidth: parseInt($('#sidebar').style.width, 10) });
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });

  // Layout wiederherstellen oder Start-Tab
  let restored = false;
  const imported = localStorage.getItem('layoutImport');
  if (imported) localStorage.removeItem('layoutImport');
  if (S.settings.restoreSessions || imported) {
    try {
      const L = JSON.parse(imported || localStorage.getItem('layout') || 'null');
      if (L && L.tabs && L.tabs.length) {
        for (const t of L.tabs) { const tab = createTab({ type: 'tree', node: t.node }); tab.customTitle = t.title || null; }
        if (S.tabs[L.active]) activateTab(S.tabs[L.active].id);
        restored = true;
      }
    } catch (_) { /* ignorieren */ }
  }
  if (!restored) createTab({ type: 'local' });
  updateMultiUI();
}

init();
