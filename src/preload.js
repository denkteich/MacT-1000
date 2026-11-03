'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSessions: () => ipcRenderer.invoke('store:getSessions'),
  saveSessions: (l) => ipcRenderer.invoke('store:saveSessions', l),
  getSettings: () => ipcRenderer.invoke('store:getSettings'),
  saveSettings: (s) => ipcRenderer.invoke('store:saveSettings', s),

  open: (id, cfg, size) => ipcRenderer.invoke('session:open', id, cfg, size),
  write: (id, data) => ipcRenderer.send('session:write', id, data),
  resize: (id, c, r) => ipcRenderer.send('session:resize', id, c, r),
  kill: (id) => ipcRenderer.send('session:kill', id),
  action: (id, a, arg) => ipcRenderer.invoke('session:action', id, a, arg),

  listSerial: () => ipcRenderer.invoke('serial:list'),
  rdpClients: () => ipcRenderer.invoke('rdp:clients'),
  openFile: (o) => ipcRenderer.invoke('dialog:openFile', o),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (t) => ipcRenderer.send('clipboard:write', t),
  openExternal: (u) => ipcRenderer.send('shell:openExternal', u),
  info: () => ipcRenderer.invoke('app:info'),
  exportConfig: (o) => ipcRenderer.invoke('config:export', o),
  pickImport: () => ipcRenderer.invoke('config:pickImport'),
  applyImport: (o) => ipcRenderer.invoke('config:applyImport', o),

  fx: {
    list: (cfg, dir) => ipcRenderer.invoke('fx:list', cfg, dir),
    op: (cfg, name, args) => ipcRenderer.invoke('fx:op', cfg, name, args),
    transfer: (jobId, cfg, spec) => ipcRenderer.send('fx:transfer', jobId, cfg, spec),
    cancel: (jobId) => ipcRenderer.send('fx:cancel', jobId),
    pickUpload: () => ipcRenderer.invoke('fx:pickUpload'),
    pickDir: (d) => ipcRenderer.invoke('fx:pickDir', d),
    defaults: () => ipcRenderer.invoke('fx:defaults'),
    localExists: (dir, names) => ipcRenderer.invoke('fx:localExists', dir, names),
    reveal: (p) => ipcRenderer.send('fx:reveal', p),
    openLocal: (p) => ipcRenderer.invoke('fx:openLocal', p),
    answer: (reqId, v) => ipcRenderer.send('fx:answer', reqId, v),
    onAsk: (cb) => ipcRenderer.on('fx:ask', (_e, p) => cb(p)),
    onJob: (cb) => ipcRenderer.on('fx:job', (_e, p) => cb(p)),
    pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch (_) { return ''; } }
  },

  onData: (cb) => ipcRenderer.on('session:data', (_e, p) => cb(p)),
  onExit: (cb) => ipcRenderer.on('session:exit', (_e, p) => cb(p)),
  onStatus: (cb) => ipcRenderer.on('session:status', (_e, p) => cb(p)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd))
});
