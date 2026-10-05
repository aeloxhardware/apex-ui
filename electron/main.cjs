const { app, BrowserWindow, ipcMain, dialog, utilityProcess, MessageChannelMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { convertGCode } = require('./python-runner.cjs');

const isDev = process.env.ELECTRON_START_URL !== undefined;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0a0f1a',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Conversion polaire : script et Python embarqué copiés hors de l'archive asar à l'empaquetage
// (extraResources) ; en dev, ceux du dépôt (Python embarqué seulement après `pnpm python:fetch`).
ipcMain.handle('apex:convert-gcode', (event, request) =>
  convertGCode(request, {
    script: app.isPackaged
      ? path.join(process.resourcesPath, 'python-scripts', 'gcode_to_polar.py')
      : path.join(__dirname, '..', 'python', 'gcode_to_polar.py'),
    embeddedPython: app.isPackaged
      ? path.join(process.resourcesPath, 'python', 'python.exe')
      : path.join(__dirname, '..', 'build', 'python-embed', 'python.exe'),
    onProgress: (percent) => {
      if (!event.sender.isDestroyed()) event.sender.send('apex:convert-progress', percent);
    },
  }));

ipcMain.handle('apex:save-gcode', async (event, request) => {
  const { name, text } = request ?? {};
  if (typeof text !== 'string') throw new Error("Requête d'enregistrement invalide.");
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Exporter le G-code',
    defaultPath: typeof name === 'string' && name ? path.basename(name) : 'apex.gcode',
    filters: [{ name: 'G-code', extensions: ['gcode', 'gco', 'g'] }],
  });
  if (canceled || !filePath) return { saved: false };
  await fs.promises.writeFile(filePath, text, 'utf8');
  return { saved: true, path: filePath };
});

// Édition du G-code : le noyau C++ (addon N-API, native/) tourne dans un processus utilitaire,
// jamais dans l'interface (preload sandboxé) ni ici (un calcul long figerait les fenêtres).
// L'interface reçoit un MessagePort qui la relie directement à ce processus.
let editProcess = null;

function ensureEditProcess() {
  if (editProcess) return editProcess;
  const addonPath = app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'apex_edit.node')
    : path.join(__dirname, '..', 'native', 'build', 'apex_edit.node');
  editProcess = utilityProcess.fork(path.join(__dirname, 'edit-process.cjs'), [addonPath], {
    serviceName: 'Apex - edition G-code',
  });
  editProcess.on('exit', () => {
    editProcess = null;
  });
  return editProcess;
}

ipcMain.on('apex:edit-open', (event) => {
  const { port1, port2 } = new MessageChannelMain();
  ensureEditProcess().postMessage({ type: 'port' }, [port1]);
  event.sender.postMessage('apex:edit-port', null, [port2]);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
