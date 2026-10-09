// Pont minimal entre l'interface (isolée, sans Node) et le process principal : conversion polaire
// d'un G-code par le script Python embarqué, enregistrement d'un G-code sur disque, et ouverture
// du canal vers le noyau C++ d'édition.
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

const uiArg = process.argv.find((a) => a.startsWith('--apex-ui='));

contextBridge.exposeInMainWorld('apexDesktop', {
  // Interface imposée au lancement (`--ui=` / APEX_UI), sinon null : cf. src/utils/interfaceMode.ts.
  launchUi: uiArg ? uiArg.slice('--apex-ui='.length) : null,
  // Échelle de l'interface (Paramètres) : zoom natif, le canvas et le pointeur restent justes.
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  // Mode dev (Paramètres) : désactivé, le process principal bloque les raccourcis du navigateur.
  setDevMode: (enabled) => ipcRenderer.send('apex:set-dev-mode', Boolean(enabled)),
  // Desinstallation (application installee par l'installateur seulement).
  canUninstall: () => ipcRenderer.invoke('apex:can-uninstall'),
  uninstall: () => ipcRenderer.invoke('apex:uninstall'),
  convertGCode: (request) => ipcRenderer.invoke('apex:convert-gcode', request),
  onConvertProgress: (callback) => {
    const listener = (_event, percent) => callback(percent);
    ipcRenderer.on('apex:convert-progress', listener);
    return () => ipcRenderer.removeListener('apex:convert-progress', listener);
  },
  saveGCode: (request) => ipcRenderer.invoke('apex:save-gcode', request),
  writeGCode: (request) => ipcRenderer.invoke('apex:write-gcode', request),
  // Chemin réel d'un fichier déposé ou choisi (modification en place d'un G-code édité).
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  scanProfiles: () => ipcRenderer.invoke('apex:profiles-scan'),
  readProfile: (path) => ipcRenderer.invoke('apex:profiles-read', path),
  openEditChannel: () => ipcRenderer.send('apex:edit-open'),
  // L'interface est prête (premier rendu du viewport) : le main ferme l'écran de démarrage.
  appReady: () => ipcRenderer.send('apex:app-ready'),
  appStatus: (text) => ipcRenderer.send('apex:app-status', String(text)),
});

// Un MessagePort ne traverse pas contextBridge : il est remis à la page par window.postMessage
// (motif recommandé par Electron sous isolation de contexte), cf. src/utils/editKernelClient.ts.
ipcRenderer.on('apex:edit-port', (event) => {
  window.postMessage({ type: 'apex-edit-port' }, '*', event.ports);
});
