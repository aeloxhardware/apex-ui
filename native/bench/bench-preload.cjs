// Preload sandboxe du banc : relaie le jeu de donnees et le MessagePort recus du processus
// principal vers la page (meme motif que electron/preload.cjs).
const { ipcRenderer } = require('electron');

ipcRenderer.on('bench-data', (_event, moves) => {
  window.postMessage({ type: 'bench-data', moves }, '*');
});
ipcRenderer.on('edit-port', (event) => {
  window.postMessage({ type: 'apex-edit-port' }, '*', event.ports);
});
