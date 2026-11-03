'use strict';
/*
 * Split-Layout als Binärbaum:
 *   { type:'leaf', pane:'<paneId>' }
 *   { type:'split', dir:'row'|'column', ratio:0..1, a:Node, b:Node }
 * dir 'row'    = Panes nebeneinander (vertikale Trennlinie)
 * dir 'column' = Panes untereinander (horizontale Trennlinie)
 */
const Layout = {
  leaf: (pane) => ({ type: 'leaf', pane }),

  leaves(node, out = []) {
    if (!node) return out;
    if (node.type === 'leaf') out.push(node.pane);
    else { Layout.leaves(node.a, out); Layout.leaves(node.b, out); }
    return out;
  },

  /** Ersetzt das Blatt paneId durch einen Split aus altem und neuem Pane */
  split(node, paneId, newPaneId, dir, before = false) {
    if (node.type === 'leaf') {
      if (node.pane !== paneId) return node;
      const a = Layout.leaf(paneId), b = Layout.leaf(newPaneId);
      return { type: 'split', dir, ratio: 0.5, a: before ? b : a, b: before ? a : b };
    }
    return { ...node, a: Layout.split(node.a, paneId, newPaneId, dir, before), b: Layout.split(node.b, paneId, newPaneId, dir, before) };
  },

  /** Ersetzt das Blatt paneId durch einen Split aus altem Blatt und einem ganzen Teilbaum (Tab einfügen) */
  insert(node, paneId, subtree, dir, before = false) {
    if (node.type === 'leaf') {
      if (node.pane !== paneId) return node;
      return { type: 'split', dir, ratio: 0.5, a: before ? subtree : node, b: before ? node : subtree };
    }
    return { ...node, a: Layout.insert(node.a, paneId, subtree, dir, before), b: Layout.insert(node.b, paneId, subtree, dir, before) };
  },

  /** Entfernt ein Blatt; Geschwister rückt an die Stelle des Splits */
  remove(node, paneId) {
    if (!node) return null;
    if (node.type === 'leaf') return node.pane === paneId ? null : node;
    const a = Layout.remove(node.a, paneId), b = Layout.remove(node.b, paneId);
    if (!a) return b;
    if (!b) return a;
    return { ...node, a, b };
  },

  /** Gleichmäßige Verteilung: Verhältnis nach Anzahl Blätter in Split-Richtung */
  equalize(node) {
    if (!node || node.type === 'leaf') return node;
    const count = (n, dir) => (n.type === 'split' && n.dir === dir) ? count(n.a, dir) + count(n.b, dir) : 1;
    const a = Layout.equalize(node.a), b = Layout.equalize(node.b);
    const ca = count(a, node.dir), cb = count(b, node.dir);
    return { ...node, a, b, ratio: ca / (ca + cb) };
  },

  /** Raster für n Panes (für "Alle als Kacheln öffnen") */
  grid(paneIds) {
    const n = paneIds.length;
    if (!n) return null;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = [];
    for (let i = 0; i < n; i += cols) rows.push(paneIds.slice(i, i + cols));
    const chain = (items, dir) => {
      if (items.length === 1) return items[0];
      const k = Math.floor(items.length / 2);
      return { type: 'split', dir, ratio: k / items.length, a: chain(items.slice(0, k), dir), b: chain(items.slice(k), dir) };
    };
    return chain(rows.map(r => chain(r.map(Layout.leaf), 'row')), 'column');
  },

  /**
   * Rendert den Baum in container. paneEl(id) liefert das persistente DOM-Element des Panes.
   * onRatio(node, ratio) wird beim Ziehen eines Trenners aufgerufen.
   */
  render(container, node, paneEl, onResize) {
    container.textContent = '';
    if (!node) return;
    container.appendChild(Layout._build(node, paneEl, onResize));
  },

  _build(node, paneEl, onResize) {
    if (node.type === 'leaf') {
      const el = paneEl(node.pane);
      el.style.flex = '1 1 0';
      return el;
    }
    const wrap = document.createElement('div');
    wrap.className = 'split ' + node.dir;
    const a = document.createElement('div'); a.className = 'split-child';
    const b = document.createElement('div'); b.className = 'split-child';
    const div = document.createElement('div'); div.className = 'divider ' + node.dir;
    const apply = () => {
      a.style.flex = `${node.ratio} 1 0`;
      b.style.flex = `${1 - node.ratio} 1 0`;
    };
    apply();
    a.appendChild(Layout._build(node.a, paneEl, onResize));
    b.appendChild(Layout._build(node.b, paneEl, onResize));
    wrap.append(a, div, b);

    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      document.body.classList.add('resizing', node.dir === 'row' ? 'col-resize' : 'row-resize');
      const move = (ev) => {
        const pos = node.dir === 'row' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
        node.ratio = Math.min(0.95, Math.max(0.05, pos));
        apply();
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('resizing', 'col-resize', 'row-resize');
        onResize && onResize();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    div.addEventListener('dblclick', () => { node.ratio = 0.5; apply(); onResize && onResize(); });
    return wrap;
  }
};

if (typeof module !== 'undefined') module.exports = { Layout };
