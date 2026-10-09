const { app, BrowserWindow, ipcMain, dialog, shell, utilityProcess, MessageChannelMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { convertGCode } = require('./python-runner.cjs');
const backdrop = require('./backdrop.cjs');
const { scanProfiles, readProfile } = require('./profiles.cjs');

const isDev = process.env.ELECTRON_START_URL !== undefined;

// Écran de démarrage : fenêtre sans bordure affichée tout de suite, fermée quand l'interface annonce
// (`apex:app-ready`, premier rendu du viewport 3D) qu'elle est prête — la fenêtre principale reste
// cachée pendant tout le chargement au lieu de s'afficher à moitié construite.
const SPLASH_MIN_MS = 1200;
const SPLASH_TIMEOUT_MS = 30000;

function createSplash() {
  const splash = new BrowserWindow({
    width: 520,
    height: 300,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    show: false,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Verre liquide : le bureau Windows derrière la carte est capturé et réfracté (backdrop.cjs).
  // La carte n'apparaît qu'avec son verre : invisible (opacité 0) jusqu'au premier verre dessiné, puis la page
  // devient transparente derrière son texte et la fenêtre visible d'un coup. Sans verre (pas d'addon, échec, ou
  // rien après SPLASH_GLASS_WAIT_MS), elle apparaît avec son dégradé de repli.
  const SPLASH_GLASS_WAIT_MS = 1500;
  let revealed = false;
  const revealSplash = (glass) => {
    if (revealed || splash.isDestroyed()) return;
    revealed = true;
    const reveal = () => { if (!splash.isDestroyed()) splash.setOpacity(1); };
    if (!glass) { reveal(); return; }
    splash.webContents.executeJavaScript("document.querySelector('.card').classList.add('glass')").then(reveal, reveal);
  };
  // Verre lancé dès maintenant, pendant que la page charge : périphérique GPU et capture du bureau sont prêts
  // quand la fenêtre s'affiche (le premier verre est dessiné à son apparition).
  splash.setOpacity(0);
  const glass = backdrop.follow(splash, {}, () => revealSplash(true));
  const systemGlass = !glass && backdrop.systemGlass(splash);  // macOS : vibrance native
  // Pas d'encre adaptative sur le splash : texte blanc fixe sur un verre fumé légèrement sombre.
  splash.once('ready-to-show', () => {
    splash.show();
    if (glass) setTimeout(() => revealSplash(false), SPLASH_GLASS_WAIT_MS);
    else revealSplash(systemGlass);
  });
  splash.webContents.once('did-finish-load', () => {
    void splash.webContents.executeJavaScript(
      `document.getElementById('version').textContent = ${JSON.stringify(require('../package.json').apexVersion || `v${app.getVersion()}`)}`,
    ).catch(() => undefined);
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  return splash;
}

// Mode dev (réglage de l'interface, relayé par `apex:set-dev-mode`). Désactivé : les raccourcis
// du navigateur (rechargement, outils de développement, zoom, impression…) ne font rien.
let devMode = isDev;
const BROWSER_KEYS_CTRL = new Set(['r', 'u', 'p', 's', 'f', 'g', 'o', 'w', 'n', 't', 'h', 'j', '+', '-', '=', '0']);
function isBrowserShortcut(input) {
  const key = String(input.key || '').toLowerCase();
  if (key === 'f5' || key === 'f12' || key === 'f3' || key === 'f7' || key === 'f11') return true;
  if ((input.control || input.meta) && BROWSER_KEYS_CTRL.has(key)) return true;
  // Ctrl+Maj+I / J / C / R (outils de développement, rechargement forcé).
  if ((input.control || input.meta) && input.shift && ['i', 'j', 'c', 'r'].includes(key)) return true;
  if (input.alt && (key === 'arrowleft' || key === 'arrowright')) return true; // précédent / suivant
  return false;
}
// Desinstallation depuis Paramètres : uninstall.ps1 est posé a cote de l'exe par l'installateur ; absent (développement,
// copie portable) le bouton n'est pas propose. Le script demande confirmation puis l'UAC, et ferme l'application.
function uninstallScriptPath() {
  if (process.platform !== 'win32' || !app.isPackaged) return null;
  const script = path.join(path.dirname(process.execPath), 'uninstall.ps1');
  return fs.existsSync(script) ? script : null;
}
ipcMain.handle('apex:can-uninstall', () => uninstallScriptPath() !== null);
ipcMain.handle('apex:uninstall', () => {
  const script = uninstallScriptPath();
  if (!script) return false;
  spawn(
    path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script],
    { detached: true, stdio: 'ignore', windowsHide: true },
  ).unref();
  return true;
});

ipcMain.on('apex:set-dev-mode', (event, enabled) => {
  devMode = Boolean(enabled);
  if (!devMode && !event.sender.isDestroyed()) event.sender.closeDevTools();
});

// Interface au lancement : « liquid » ou « classic » (cf. src/utils/interfaceMode.ts). Priorité à la ligne de
// commande, puis à la variable d'environnement ; sans l'un ni l'autre, c'est le réglage mémorisé par l'interface.
function launchUiArgument() {
  const fromArgv = process.argv.find((a) => a.startsWith('--ui='));
  const value = String(fromArgv ? fromArgv.slice(5) : process.env.APEX_UI || '').trim().toLowerCase();
  return value === 'liquid' || value === 'classic' ? [`--apex-ui=${value}`] : [];
}

function createWindow() {
  const splash = createSplash();
  const splashShownAt = Date.now();
  const win = new BrowserWindow({
    show: false,
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
      // Interface demandée au lancement (`--ui=classic` ou APEX_UI=classic), relayée au preload.
      additionalArguments: launchUiArgument(),
    },
  });

  // Étape affichée sur la carte de démarrage.
  const setStatus = (text) => {
    if (splash.isDestroyed()) return;
    void splash.webContents.executeJavaScript(`document.getElementById('status').textContent = ${JSON.stringify(text)}`).catch(() => undefined);
  };
  win.webContents.once('dom-ready', () => setStatus("Chargement de l'interface…"));
  win.webContents.once('did-finish-load', () => setStatus("Préparation de l'interface…"));
  // Étapes annoncées par l'interface elle-même (ex. ouverture du viewport 3D quand on démarre en Préparation).
  const onStatus = (event, text) => { if (event.sender === win.webContents && typeof text === 'string') setStatus(text.slice(0, 80)); };
  ipcMain.on('apex:app-status', onStatus);

  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    clearTimeout(failsafe);
    ipcMain.removeListener('apex:app-ready', onReady);
    ipcMain.removeListener('apex:app-status', onStatus);
    if (win.isDestroyed()) { if (!splash.isDestroyed()) splash.close(); return; }
    // Une fenêtre cachée ne présente aucune image : la montrer d'un coup en fermant le splash laisse un
    // écran noir le temps du premier affichage. On la montre donc invisible (opacité 0), on attend que le
    // compositeur ait présenté des images, puis on l'opacifie et on ferme le splash dans la foulée.
    win.setOpacity(0);
    win.show();
    const present = () => {
      if (!win.isDestroyed()) win.setOpacity(1);
      if (!splash.isDestroyed()) splash.close();
    };
    win.webContents
      .executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250))))')
      .then(present, present);
  };
  const onReady = (event) => {
    if (event.sender !== win.webContents) return;
    setStatus('Prêt');
    setTimeout(reveal, Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt)));
  };
  ipcMain.on('apex:app-ready', onReady);
  // Garde-fou : un chargement qui n'annoncerait jamais sa fin ne doit pas laisser l'écran de démarrage
  // à l'écran pour toujours.
  const failsafe = setTimeout(reveal, SPLASH_TIMEOUT_MS);
  win.webContents.on('did-fail-load', reveal);
  win.on('closed', () => {
    clearTimeout(failsafe);
    ipcMain.removeListener('apex:app-ready', onReady);
    ipcMain.removeListener('apex:app-status', onStatus);
    if (!splash.isDestroyed()) splash.close();
  });

  // Alt sert de modificateur (poignées du nœud d'édition : Alt + glisser) : relâcher Alt ne doit
  // pas faire surgir la barre de menu masquée (autoHideMenuBar).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyUp' && input.key === 'Alt') event.preventDefault();
    if (!devMode && input.type === 'keyDown' && isBrowserShortcut(input)) event.preventDefault();
  });

  // Liens externes (Accueil : remerciements) : ouverts dans le navigateur du système, jamais dans l'application.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
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

// Profils d'imprimantes : dossier `profiles/` du dépôt, copié dans les ressources à l'empaquetage.
const profilesRoot = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'profiles') : path.join(__dirname, '..', 'profiles');
ipcMain.handle('apex:profiles-scan', () => scanProfiles(profilesRoot()));
ipcMain.handle('apex:profiles-read', (_event, rel) => readProfile(profilesRoot(), rel));

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

// Modification en place d'un G-code édité (onglet Édition) : écriture atomique, fichier temporaire
// voisin puis renommage, pour ne jamais laisser un fichier à moitié écrit. Seules les extensions
// G-code sont acceptées.
ipcMain.handle('apex:write-gcode', async (_event, request) => {
  const { path: target, text } = request ?? {};
  if (typeof target !== 'string' || !path.isAbsolute(target) || typeof text !== 'string') {
    throw new Error("Requête d'écriture invalide.");
  }
  if (!/\.(gcode|gco|g|ngc)$/i.test(target)) throw new Error("Ce n'est pas un fichier G-code.");
  const temp = `${target}.apex-tmp`;
  try {
    await fs.promises.writeFile(temp, text, 'utf8');
    await fs.promises.rename(temp, target);
  } catch (error) {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  return { saved: true, path: target };
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

// Identifiant stable du bouton de barre des taches : requis pour que la liste de raccourcis (clic droit sur le bouton) soit retenue.
app.setAppUserModelId('com.aeloxhardware.apexslicer');

// Application installee par l'installateur (uninstall.ps1 a cote de l'exe) : « Désinstaller Apex Slicer » dans la liste de
// raccourcis de la barre des taches (clic droit sur le bouton), sans passer par « Ajouter ou supprimer des programmes ».
function registerUninstallTask() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const script = path.join(path.dirname(process.execPath), 'uninstall.ps1');
  if (!fs.existsSync(script)) return;
  app.setUserTasks([
    {
      program: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      arguments: `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}"`,
      iconPath: process.execPath,
      iconIndex: 0,
      title: 'Désinstaller Apex Slicer',
      description: 'Désinstalle Apex Slicer de cet ordinateur',
    },
  ]);
}

app.whenReady().then(() => {
  registerUninstallTask();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
