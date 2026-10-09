const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installerApi', {
  chooseDirectory: (defaultPath) => ipcRenderer.invoke('installer:choose-directory', defaultPath),
  getDefaultInstallPath: () => ipcRenderer.invoke('installer:default-install-path'),
  runInstall: (options) => ipcRenderer.invoke('installer:run-install', options),
  onProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('installer:progress', listener);
    return () => ipcRenderer.removeListener('installer:progress', listener);
  },
  launchApp: () => ipcRenderer.invoke('installer:launch-app'),
  openExternal: (url) => ipcRenderer.invoke('installer:open-external', url),
  quit: () => ipcRenderer.invoke('installer:quit'),
  // Fermeture "propre" : le main process cache la fenetre puis demande au
  // renderer si des sons UI sont encore en train de jouer (installer:
  // request-close). Le renderer repond via notifySoundsIdle() une fois
  // qu'ils sont tous termines, et SEULEMENT alors le process se termine
  // vraiment (voir electron/main.cjs).
  onRequestClose: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('installer:request-close', listener);
    return () => ipcRenderer.removeListener('installer:request-close', listener);
  },
  notifySoundsIdle: () => ipcRenderer.send('installer:sounds-idle'),
  // DEBUG UNIQUEMENT : remonte un message de log vers le fichier
  // quit-debug.log cote main process, pour diagnostiquer le blocage de
  // fermeture (la console DevTools ne suffit pas si personne ne regarde
  // au bon moment).
  // Demarrage de l'intro (musique, animations) : le main l'envoie une fois le logo de chargement disparu.
  rendererReady: () => ipcRenderer.send('installer:renderer-ready'),
  onStart: (callback) => ipcRenderer.once('installer:start', () => callback()),
  // Deplacement de la fenetre par glisser sur une zone sans controle (voir renderer.js, initWindowDrag).
  dragStart: () => ipcRenderer.send('installer:drag-start'),
  dragMove: () => ipcRenderer.send('installer:drag-move'),
  debugLog: (message) => ipcRenderer.send('installer:debug-log', message),
});
