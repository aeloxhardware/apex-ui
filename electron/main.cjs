// Processus de l'écran de démarrage (relancé par createSplash ci-dessous) : il n'exécute que son propre script.
if (process.argv.includes('--apex-splash')) {
  require('./splash-process.cjs');
  return;
}

const { app, BrowserWindow, ipcMain, dialog, shell, utilityProcess, MessageChannelMain, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const prefsStore = require('./prefs-store.cjs');

const isDev = process.env.ELECTRON_START_URL !== undefined;

// Écran de démarrage : fenêtre sans bordure affichée tout de suite, fermée quand l'interface annonce
// (`apex:app-ready`, premier rendu du viewport 3D) qu'elle est prête — la fenêtre principale reste
// cachée pendant tout le chargement au lieu de s'afficher à moitié construite.
// Lancé dès les toutes premières lignes de ce fichier (cf. `pendingSplash` plus bas), avant les autres modules, avant
// `app.whenReady()`, la mise à jour automatique et la détection du GPU : l'utilisateur voit tout de suite qu'Apex démarre.
const SPLASH_MIN_MS = 1200;
const SPLASH_TIMEOUT_MS = 30000;
const SPLASH_SHOWN_WAIT_MS = 6000;  // au plus tard : le splash est annoncé affiché (processus lent à démarrer ou absent)

/** Interface de ce lancement : même priorité que src/utils/interfaceMode.ts (ligne de commande, environnement, réglage mémorisé). */
function isFlatLaunch() {
  const [arg] = launchUiArgument();
  const mode = arg ? arg.slice('--apex-ui='.length) : prefsStore.get('apex-interface-mode');
  return mode === 'classic';
}

/**
 * Tube nommé (socket Unix hors Windows) vers le splash : une ligne JSON par message. Ouvert AVANT le lancement du splash ;
 * les messages envoyés avant sa connexion sont gardés puis livrés. Pas stdin : Electron le voit fermé dès le départ sous
 * Windows (cf. splash-process.cjs). Fermer le tube (`dispose`) fait aussi fermer le splash.
 */
function openSplashPipe() {
  const name = `apex-splash-${process.pid}-${Date.now()}`;
  const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(require('node:os').tmpdir(), `${name}.sock`);
  const queue = [];
  let socket = null;
  const server = require('node:net').createServer((connection) => {
    socket = connection;
    connection.on('error', () => undefined);
    for (const line of queue.splice(0)) connection.write(line);
  });
  server.on('error', () => undefined);
  server.listen(pipePath);
  const send = (message) => {
    const line = `${JSON.stringify(message)}${String.fromCharCode(10)}`;
    if (socket && socket.writable) socket.write(line); else if (!socket) queue.push(line);
  };
  const dispose = () => { try { socket?.destroy(); server.close(); } catch { /* déjà fermé */ } };
  return { path: pipePath, send, dispose };
}

/**
 * Écran de démarrage : un PROCESSUS ELECTRON À PART (electron/splash-process.cjs, relancé avec `--apex-splash`), avec son
 * propre processus principal et son propre processus GPU. Le chargement de l'interface (ce processus et son GPU) ne peut
 * donc plus le figer. Pilotage par un tube nommé (une ligne JSON par message), retour par stdout (`shown`, `closed`).
 * Renvoie une poignée : `setStatus(text)`, `close()` (le son joue jusqu'au bout avant l'arrêt du processus),
 * `isDestroyed()`, `whenShown()` (résolue à l'affichage, au plus tard après un délai) et `shownAt`.
 */
function createSplash() {
  const pipe = openSplashPipe();
  const args = app.isPackaged ? [] : [app.getAppPath()];
  args.push('--apex-splash', `--apex-splash-pipe=${pipe.path}`, `--apex-splash-version=${encodeURIComponent(require('../package.json').apexVersion || `v${app.getVersion()}`)}`);
  if (isFlatLaunch()) args.push('--apex-splash-flat');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;  // sinon le binaire démarre en pur Node.js (cf. scripts/run-electron.cjs)
  const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: false });
  const handle = { shownAt: 0, startedAt: Date.now(), exited: false };
  let onShown;
  const shown = new Promise((resolve) => { onShown = resolve; });
  child.on('error', () => { handle.exited = true; pipe.dispose(); onShown(); });
  child.on('exit', () => { handle.exited = true; pipe.dispose(); onShown(); });
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(String.fromCharCode(10));
    buffer = lines.pop();
    if (lines.includes('shown')) { handle.shownAt = Date.now(); onShown(); }
  });
  const post = (message) => { if (!handle.exited) pipe.send(message); };
  handle.setStatus = (text) => post({ t: 'status', text });
  handle.close = () => post({ t: 'close' });
  handle.isDestroyed = () => handle.exited;
  handle.whenShown = () => Promise.race([shown, new Promise((r) => setTimeout(r, SPLASH_SHOWN_WAIT_MS))]);
  // L'application quitte : le splash n'attend plus rien (il finit son son puis s'arrête de lui-même).
  app.once('before-quit', () => handle.close());
  return handle;
}

// Splash lancé AVANT tout le reste (modules lourds ci-dessous, `app.whenReady()`, mise à jour, détection du GPU) : son
// processus démarre en parallèle pendant qu'Apex se charge. `createWindow` le reprend ; sans lui (réactivation macOS), il en crée un.
let pendingSplash = createSplash();

const { convertGCode } = require('./python-runner.cjs');
const engineRunner = require('./engine-runner.cjs');
const { detectLowGpuPower } = require('./gpu-tier.cjs');
const shutdown = require('./shutdown.cjs');
const stash = require('./stash.cjs');
const { scanProfiles, readProfile } = require('./profiles.cjs');

// Icône d'Apex (fenêtres et barre des tâches) : sans elle, Electron affiche la sienne en développement.
const APP_ICON = nativeImage.createFromPath(path.join(__dirname, 'icon-256.png'));

// Raccourcis du navigateur (rechargement, outils de développement, zoom, impression…) : sans effet dans
// l'application livrée, actifs en développement. Indépendant de la variable « dev » de l'interface.
const devMode = isDev;
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

// Interface au lancement : « liquid » ou « classic » (cf. src/utils/interfaceMode.ts). Priorité à la ligne de
// commande, puis à la variable d'environnement ; sans l'un ni l'autre, c'est le réglage mémorisé par l'interface.
function launchUiArgument() {
  const fromArgv = process.argv.find((a) => a.startsWith('--ui='));
  const value = String(fromArgv ? fromArgv.slice(5) : process.env.APEX_UI || '').trim().toLowerCase();
  return value === 'liquid' || value === 'classic' ? [`--apex-ui=${value}`] : [];
}

/** Fenêtre principale, cachée tant que le splash est à l'écran. */
function newMainWindow() {
  return new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0a0f1a',
    autoHideMenuBar: true,
    // Sans cadre système, plein écran : le bandeau flottant d'Apex (TitleBar.tsx) remplace la barre de fenêtre.
    // Barre de titre native masquée (animations, ancrage et dispositions Windows conservés) : le bandeau Apex est dessiné
    // par la page (TitleBar.tsx) et seuls les boutons natifs réduire / agrandir / fermer restent, aux couleurs d'Apex.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0f1a', symbolColor: '#e6f6fa', height: 32 },
    icon: APP_ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      // Interface demandée au lancement (`--ui=classic` ou APEX_UI=classic), relayée au preload.
      additionalArguments: [
        ...launchUiArgument(),
        ...(process.env.low_gpu_pwr === '1' ? ['--apex-low-gpu=1'] : []),
        `--apex-os=${shutdown.osDisplayName()}`,
      ],
    },
  });
}

/** Splash : étapes affichées, révélation de la fenêtre quand l'interface est prête, fermeture jamais directe. */
function wireSplash(win, splash, splashShownAt) {
  // Étape affichée sur la carte de démarrage.
  const setStatus = (text) => splash.setStatus(text);
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
    if (win.isDestroyed()) { splash.close(); return; }
    // Une fenêtre cachée ne présente aucune image : la montrer d'un coup en fermant le splash laisse un
    // écran noir le temps du premier affichage. On la montre donc invisible (opacité 0), on attend que le
    // compositeur ait présenté des images, puis on l'opacifie et on ferme le splash dans la foulée.
    win.setOpacity(0);
    win.maximize();
    win.show();
    const present = () => {
      if (!win.isDestroyed()) win.setOpacity(1);
      splash.close();
    };
    win.webContents
      .executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250))))')
      .then(present, present);
  };
  const onReady = (event) => {
    if (event.sender !== win.webContents) return;
    setStatus('Prêt');
    // Durée minimale comptée depuis l'affichage réel du splash (le processus à part met un instant à démarrer).
    void splash.whenShown().then(() => setTimeout(reveal, Math.max(0, SPLASH_MIN_MS - (Date.now() - (splash.shownAt || splashShownAt)))));
  };
  ipcMain.on('apex:app-ready', onReady);
  // Garde-fou : un chargement qui n'annoncerait jamais sa fin ne doit pas laisser l'écran de démarrage
  // à l'écran pour toujours.
  const failsafe = setTimeout(reveal, SPLASH_TIMEOUT_MS);
  win.webContents.on('did-fail-load', reveal);
  // Fermeture : jamais directe, le rideau de fermeture joue d'abord (electron/shutdown.cjs).
  win.on('close', (event) => shutdown.onWindowClose(event, win));
  win.webContents.on('before-input-event', shutdown.onInput);
  win.on('closed', () => {
    clearTimeout(failsafe);
    ipcMain.removeListener('apex:app-ready', onReady);
    ipcMain.removeListener('apex:app-status', onStatus);
    splash.close();
  });
}

function createWindow() {
  const splash = pendingSplash ?? createSplash();
  pendingSplash = null;
  const splashShownAt = splash.startedAt;
  const win = newMainWindow();
  win.setIcon(APP_ICON);  // explicite : le bouton de la barre des tâches reprend l'icône d'Apex, pas celle d'Electron

  // Lancement agrandi (animations natives de Windows pour agrandir / restaurer ensuite) : la maximisation est faite
  // à la révélation (cf. wireSplash). `maximize()` AFFICHE la fenêtre sous Windows, même créée avec `show: false` :
  // appelée ici, elle apparaissait pendant le chargement, à côté du splash.
  wireSplash(win, splash, splashShownAt);

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
    // Pas d'ouverture automatique des outils de développement (fenêtre détachée encombrante) : F12 / Ctrl+Maj+I en dev.
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
    nativeExe: app.isPackaged
      ? path.join(process.resourcesPath, 'native', `apex_gcode_to_polar${process.platform === 'win32' ? '.exe' : ''}`)
      : path.join(__dirname, '..', 'native', 'build', `apex_gcode_to_polar${process.platform === 'win32' ? '.exe' : ''}`),
    headSamples: app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'head-samples.bin')
      : path.join(__dirname, '..', 'native', 'data', 'head-samples.bin'),
    embeddedPython: app.isPackaged
      ? path.join(process.resourcesPath, 'python', 'python.exe')
      : path.join(__dirname, '..', 'build', 'python-embed', 'python.exe'),
    onProgress: (percent) => {
      if (!event.sender.isDestroyed()) event.sender.send('apex:convert-progress', percent);
    },
  }));

// Tranchage par le moteur (contrat C2/C3) : sous-processus, voir electron/engine-runner.cjs. L'exécutable
// natif du moteur sera livré dans les ressources (resources/engine/apex-engine.exe) ; en développement,
// `python main.py` du dépôt voisin `slicer_engine`.
const packagedEngineExe = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'engine', `apex-engine${process.platform === 'win32' ? '.exe' : ''}`) : null;
ipcMain.handle('apex:slice-steps', (_event, algorithm) => engineRunner.listSteps(packagedEngineExe(), algorithm));
ipcMain.handle('apex:slice', (event, request) => {
  // La page qui a demandé le tranchage se recharge ou se ferme : personne ne l'attend plus, on l'arrête
  // (sinon il bloque le suivant : un seul tranchage à la fois).
  const stop = (details) => { if (!details || (details.isMainFrame && !details.isSameDocument)) engineRunner.cancelSlice(); };
  event.sender.on('did-start-navigation', stop);
  event.sender.once('destroyed', () => stop());
  return engineRunner.runSlice(request, {
    packagedExe: packagedEngineExe(),
    onEvent: (engineEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send('apex:slice-progress', engineEvent);
    },
  }).finally(() => { if (!event.sender.isDestroyed()) event.sender.removeListener('did-start-navigation', stop); });
});
ipcMain.handle('apex:slice-cancel', () => engineRunner.cancelSlice());
app.on('before-quit', () => { engineRunner.cancelSlice(); });
app.on('will-quit', () => { stash.purge(); });

// Projet (3MF : modèles + G-code) : répertoire dédié Documents/Apex/Projets, un fichier horodaté par enregistrement.
ipcMain.handle('apex:save-project', async (_event, request) => {
  const { name, bytes } = request ?? {};
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error("Requête d'enregistrement de projet invalide.");
  const dir = path.join(app.getPath('documents'), 'Apex', 'Projets');
  await fs.promises.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const base = (typeof name === 'string' ? name : 'Projet').replace(/[^\p{L}\p{N} _.-]/gu, '_').slice(0, 80) || 'Projet';
  const target = path.join(dir, `${base}_${stamp}.3mf`);
  await fs.promises.writeFile(target, bytes);
  return { path: target };
});

// Projets récents : les .3mf du répertoire dédié, du plus récent au plus ancien. La lecture est bornée à ce répertoire.
const projectsDir = () => path.join(app.getPath('documents'), 'Apex', 'Projets');
ipcMain.handle('apex:projects-list', async (_event, limit) => {
  const dir = projectsDir();
  const count = Math.min(Math.max(Number(limit) || 12, 1), 50);
  let names;
  try {
    names = (await fs.promises.readdir(dir)).filter((n) => n.toLowerCase().endsWith('.3mf'));
  } catch {
    return [];
  }
  const stats = await Promise.all(
    names.map(async (name) => ({ name, path: path.join(dir, name), modified: (await fs.promises.stat(path.join(dir, name))).mtimeMs })),
  );
  return stats.sort((a, b) => b.modified - a.modified).slice(0, count);
});
ipcMain.handle('apex:projects-read', async (_event, file) => {
  const target = path.resolve(String(file ?? ''));
  const inside = path.relative(projectsDir(), target);
  if (inside.startsWith('..') || path.isAbsolute(inside) || !target.toLowerCase().endsWith('.3mf')) {
    throw new Error('Projet hors du répertoire dédié.');
  }
  return new Uint8Array(await fs.promises.readFile(target));
});

// Réserve temporaire des espaces quittés (cf. stash.cjs, src/utils/spaceStash.ts).
ipcMain.handle('apex:stash-write', (_event, key, bytes) => stash.write(key, bytes));
ipcMain.handle('apex:stash-read', (_event, key) => stash.read(key));
ipcMain.handle('apex:stash-drop', (_event, key) => stash.drop(key));

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

app.whenReady().then(async () => {
  pendingSplash?.setStatus('Lancement des dépendances logicielles…');
  prefsStore.register();
  shutdown.register({ stopEditProcess: () => { try { editProcess?.kill(); } catch { /* déjà arrêté */ } editProcess = null; } });
  registerUninstallTask();
  // Mise à jour automatique à chaque lancement (installation seulement) : si elle s'applique, l'application relance.
  if (await require('./update-flow.cjs').runStartupUpdate()) { pendingSplash?.close(); return; }
  await detectLowGpuPower();  // renseigne low_gpu_pwr avant le splash (verre liquide désactivé si GPU < RTX 3080)
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
