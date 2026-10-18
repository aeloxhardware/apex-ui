// Pont minimal entre l'interface (isolée, sans Node) et le process principal : conversion polaire
// d'un G-code par le script Python embarqué, enregistrement d'un G-code sur disque, et ouverture
// du canal vers le noyau C++ d'édition.
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

const uiArg = process.argv.find((a) => a.startsWith('--apex-ui='));

contextBridge.exposeInMainWorld('apexDesktop', {
  // Interface imposée au lancement (`--ui=` / APEX_UI), sinon null : cf. src/utils/interfaceMode.ts.
  launchUi: uiArg ? uiArg.slice('--apex-ui='.length) : null,
  // GPU moins puissant qu'une RTX 3080 (low_gpu_pwr=1, cf. electron/gpu-tier.cjs) : effets coûteux remplacés par du statique.
  lowGpuPower: process.argv.includes('--apex-low-gpu=1'),
  // Nom de l'OS (« Windows 11 »…) pour les messages de fermeture, et fermeture en étapes (electron/shutdown.cjs).
  osName: (process.argv.find((a) => a.startsWith('--apex-os=')) || '').slice('--apex-os='.length) || null,
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('apex:close-requested', listener);
    return () => ipcRenderer.removeListener('apex:close-requested', listener);
  },
  shutdownStep: (name) => ipcRenderer.invoke('apex:shutdown-step', String(name)),
  shutdownFinish: () => ipcRenderer.send('apex:shutdown-finish'),
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

// Réglages persistants (electron/prefs-store.cjs) : le fichier du dossier utilisateur fait foi et est recopié dans
// localStorage AVANT le chargement de la page ; les clés `apex-*` déjà présentes dans localStorage mais pas dans le
// fichier y sont versées (migration). Chaque écriture ultérieure de la page est relayée au fichier.
try {
  const saved = ipcRenderer.sendSync('apex:prefs-load') || {};
  for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('apex-') && !(key in saved)) ipcRenderer.send('apex:prefs-set', key, localStorage.getItem(key));
  }
  // Le preload (monde isolé) ne voit pas les appels de la page : on enveloppe Storage côté page, qui poste un message.
  webFrame.executeJavaScript(`(() => {
    const proto = Storage.prototype, set = proto.setItem, remove = proto.removeItem;
    const relay = (key, value) => window.postMessage({ __apexPref: [String(key), value] }, '*');
    proto.setItem = function (key, value) { set.apply(this, arguments); if (this === window.localStorage) relay(key, String(value)); };
    proto.removeItem = function (key) { remove.apply(this, arguments); if (this === window.localStorage) relay(key, null); };
  })()`);
  window.addEventListener('message', (event) => {
    const pref = event.source === window && event.data && event.data.__apexPref;
    if (Array.isArray(pref)) ipcRenderer.send('apex:prefs-set', pref[0], pref[1]);
  });
} catch (error) {
  console.warn('[apex] réglages persistants indisponibles :', error.message);
}

// Un MessagePort ne traverse pas contextBridge : il est remis à la page par window.postMessage
// (motif recommandé par Electron sous isolation de contexte), cf. src/utils/editKernelClient.ts.
ipcRenderer.on('apex:edit-port', (event) => {
  window.postMessage({ type: 'apex-edit-port' }, '*', event.ports);
});
