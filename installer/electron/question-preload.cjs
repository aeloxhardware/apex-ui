const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('questionApi', {
  answer: (yes) => ipcRenderer.send('question:answer', Boolean(yes)),
});
