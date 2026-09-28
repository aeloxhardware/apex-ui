// Pont minimal entre l'interface (isolée, sans Node) et le process principal : conversion polaire
// d'un G-code par le script Python embarqué, et enregistrement d'un G-code sur disque.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apexDesktop', {
  convertGCode: (request) => ipcRenderer.invoke('apex:convert-gcode', request),
  onConvertProgress: (callback) => {
    const listener = (_event, percent) => callback(percent);
    ipcRenderer.on('apex:convert-progress', listener);
    return () => ipcRenderer.removeListener('apex:convert-progress', listener);
  },
  saveGCode: (request) => ipcRenderer.invoke('apex:save-gcode', request),
});
