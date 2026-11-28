'use strict';

async function sessionExportDialog() {
  let f;
  try { f = await api.xiPick(); }
  catch (_) { toast('Sitzungsexport konnte nicht gelesen werden.'); return; }
  if (f.canceled) return;
  if (f.error) { toast(f.error); return; }

  const master = h('input', { type: 'password', autocomplete: 'off', maxlength: '4096', spellcheck: 'false' });
  const status = h('div', { class: 'hint', role: 'status' });
  const preview = h('div', { class: 'csv-preview' });
  let ready = false, busy = false, closed = false;
  const modal = openModal({
    title: 'Sitzungsexport importieren', width: 760,
    body: h('div', null,
      h('p', { class: 'hint' }, tx(`Zielordner: ${f.folder}`), ' · ', f.name),
      field('Master-Passwort des Exports', master, 'Ohne Master-Passwort werden nur Sitzungen importiert.'),
      status, preview),
    onClose: () => { closed = true; master.value = ''; api.xiCancel().catch(() => {}); },
    buttons: [
      { label: 'Abbrechen', click: () => {} },
      { label: 'Importvorschau prüfen', cls: 'primary', click: async () => {
        if (busy) return false;
        busy = true; ready = false; updateButton();
        preview.replaceChildren(); status.textContent = '';
        try {
          const task = api.xiAnalyze(master.value);
          master.value = '';
          const result = await task;
          if (closed) return false;
          if (result.error) { status.textContent = tx(result.error); return false; }
          if (!result.recognized) { status.textContent = tx('Nicht unterstütztes Exportformat. Erwartet wird ein textbasierter Sitzungsexport.'); return false; }
          const lines = [tx(`${result.count} neu, ${result.duplicates} vorhanden, ${result.skipped} nicht unterstützt oder ungültig.`)];
          if (result.failed) lines.push(tx('Passwörter konnten nicht entschlüsselt werden. Prüfe das Master-Passwort oder erstelle eine Vorschau ohne Passwort.'));
          else if (!result.passwords && result.encrypted && !result.unmatched) lines.push(tx('Bei diesem Import werden keine Passwörter übernommen.'));
          if (result.unmatched) lines.push(tx(`${result.unmatched} Zugangsdaten konnten nicht eindeutig zugeordnet werden.`));
          if (result.passwords && !result.encryptedStorage) lines.push(tx('Verschlüsselter Passwortspeicher nicht verfügbar.'));
          if (result.passwords && result.encryptedStorage) lines.push(tx('Prüfe die Anmeldung nach dem Import: Das Exportformat erlaubt keine sichere Prüfung des Master-Passworts.'));
          status.replaceChildren(...lines.map(line => h('div', null, line)));
          const table = h('table', { class: 'csv-table' },
            h('tr', null, ['Ordner', 'Name', 'Typ', 'Ziel', 'Passwort'].map(label => h('th', null, label))));
          for (const row of result.preview) table.append(h('tr', null, ...[row.folder, row.name, row.type.toUpperCase(), row.target,
            row.hasPassword ? tx('ja') : ''].map(value => {
            const cell = h('td');
            cell.textContent = value;
            return cell;
          })));
          if (result.preview.length) preview.append(table);
          if (result.count > result.preview.length) preview.append(h('div', { class: 'hint' }, tx(`… und ${result.count - result.preview.length} weitere`)));
          ready = result.count > 0 && !result.failed && (!result.passwords || result.encryptedStorage);
        } catch (_) { status.textContent = tx('Sitzungsexport konnte nicht gelesen werden.'); }
        finally { busy = false; updateButton(); }
        return false;
      } },
      { label: 'Importieren', click: async () => {
        if (busy || !ready) return false;
        busy = true; ready = false; updateButton();
        try {
          const r = await api.xiApply();
          if (r.error) { toast(r.error); return false; }
          S.sessions = await api.getSessions();
          for (const fo of r.folders) folderAncestors(fo).forEach(x => S.collapsed.delete(x));
          localStorage.setItem('collapsedFolders', JSON.stringify([...S.collapsed]));
          renderSidebar();
          checkSaveResult({ ok: !r.pending, pending: r.pending });
          toast(tx(`${r.count} Sitzungen importiert.`));
        } catch (_) { toast('Import konnte nicht gespeichert werden.'); return false; }
        finally { busy = false; updateButton(); }
      } }
    ]
  });
  const buttons = modal.box.querySelectorAll('.modal-foot button');
  function updateButton() { buttons[1].disabled = busy; buttons[2].disabled = !ready || busy; master.disabled = busy; }
  master.addEventListener('input', () => { ready = false; updateButton(); });
  updateButton();
}
