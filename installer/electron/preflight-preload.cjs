const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('preflightApi', {
  continue: () => ipcRenderer.send('preflight:continue'),
  cancel: () => ipcRenderer.send('preflight:cancel'),
});

// Fenetre gag affichee apres 9s d'inaction (voir gag.html) : previent le
// main process une fois ses trois repliques jouees, pour qu'il enchaine sur
// l'invite UAC.
contextBridge.exposeInMainWorld('gagApi', {
  done: () => ipcRenderer.send('gag:done'),
});
