// Pont minimal entre l'interface (isolée, sans Node) et le process principal : conversion polaire
// d'un G-code par le script Python embarqué, enregistrement d'un G-code sur disque, et ouverture
// du canal vers le noyau C++ d'édition.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apexDesktop', {
  convertGCode: (request) => ipcRenderer.invoke('apex:convert-gcode', request),
  onConvertProgress: (callback) => {
    const listener = (_event, percent) => callback(percent);
    ipcRenderer.on('apex:convert-progress', listener);
    return () => ipcRenderer.removeListener('apex:convert-progress', listener);
  },
  saveGCode: (request) => ipcRenderer.invoke('apex:save-gcode', request),
  openEditChannel: () => ipcRenderer.send('apex:edit-open'),
});

// Un MessagePort ne traverse pas contextBridge : il est remis à la page par window.postMessage
// (motif recommandé par Electron sous isolation de contexte), cf. src/utils/editKernelClient.ts.
ipcRenderer.on('apex:edit-port', (event) => {
  window.postMessage({ type: 'apex-edit-port' }, '*', event.ports);
});
