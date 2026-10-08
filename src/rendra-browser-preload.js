/*! Rendra IDE v1.8.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Preload só da barra do Rendra Browser (conteúdo local da IDE). A página visitada NÃO carrega este arquivo.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rb', {
  comando: c => ipcRenderer.send('rb:comando', String(c)),
  onEstado: cb => ipcRenderer.on('rb:estado', (_e, s) => cb(s)),
});
