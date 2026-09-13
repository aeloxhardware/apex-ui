const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execSync, spawn } = require('node:child_process');

// Interrupteur global du decor "FitGirl Repack" (fenetre de preparation
// imitant un installeur crack + les repliques gag avant l'UAC). A false,
// tout ce decor est court-circuite et l'app passe directement a l'invite
// UAC comme un installeur serieux ordinaire.
const fitgirl = false;

let mainWindow = null;
let preflightWindow = null;

// DEBUG UNIQUEMENT : le process elve tourne dans une console PowerShell
// detachee (Start-Process -Verb RunAs), donc console.log n'est visible
// nulle part - on trace dans un fichier pour diagnostiquer le blocage de
// fermeture (icone taskbar residuelle signalee par l'utilisateur).
const QUIT_LOG_PATH = path.join(__dirname, '..', 'quit-debug.log');
function quitLog(message) {
  try {
    fs.appendFileSync(QUIT_LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // ignore
  }
}

// --- Elevation UAC ---
// L'exe package final porte deja requestedExecutionLevel=requireAdministrator
// (voir package.json -> build.win), ce qui declenche l'invite UAC des le
// double-clic. Mais ca ne joue que sur le binaire signe issu du build ; en
// dev (electron.exe lance via node) Windows ne presente jamais cette invite
// puisque ce n'est pas notre exe. On la force donc nous-memes ici, dans les
// deux cas : si le process courant n'est pas deja admin, on le relance elve
// (PowerShell Start-Process -Verb RunAs, qui declenche l'UAC natif) et on
// quitte l'instance non-elevee sans jamais afficher de fenetre. Une fois
// l'utilisateur accepte le dialogue UAC, le NOUVEAU process (elve) demarre
// et affiche la fenetre au premier plan (voir focus() dans createWindow).
function isRunningElevated() {
  if (process.platform !== 'win32') return true;
  try {
    // "net session" ne reussit (sans erreur) que si le process est admin ;
    // c'est la verification standard la plus fiable sans dependance externe.
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Petite fenetre affichee par le process NON-elve, avant meme le
// declenchement de l'invite UAC (reproduction fidele - textes et disposition
// - d'une fenetre d'installeur Inno Setup classique fournie en reference par
// l'utilisateur). Purement cosmetique, mais le passage a l'etape suivante
// (invite UAC) n'est PLUS automatique : il attend explicitement le clic sur
// "Continue" (voir preflight:continue plus bas), jamais un minuteur. Fermee
// des que le process elve prend le relais, ou immediatement si l'utilisateur
// clique "Cancel"/ferme la fenetre (abandon complet, jamais de relance admin).
function showPreflightWindow() {
  preflightWindow = new BrowserWindow({
    width: 512,
    height: 400,
    resizable: false,
    maximizable: false,
    minimizable: false,
    center: true,
    frame: false,
    backgroundColor: '#f0f0f0',
    // Epinglee au premier plan : cette etape precede l'invite UAC, elle ne
    // doit jamais se retrouver masquee par une autre fenetre (l'utilisateur
    // perdrait de vue l'installeur en cours, et donc le seul bouton qui
    // fait avancer le flux).
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preflight-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Sans ca, Chromium bloque la lecture audio tant que l'utilisateur
      // n'a pas interagi avec la page : la musique de fond ne demarrerait
      // jamais toute seule a l'ouverture.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  preflightWindow.setMenuBarVisibility(false);
  preflightWindow.loadFile(path.join(__dirname, 'preflight.html'));
  preflightWindow.once('ready-to-show', () => {
    if (preflightWindow) {
      // 'screen-saver' est le niveau le plus haut : garde la fenetre au
      // premier plan meme face a d'autres fenetres deja en alwaysOnTop
      // (l'option du constructeur seule ne passe que devant les fenetres
      // normales).
      preflightWindow.setAlwaysOnTop(true, 'screen-saver');
      preflightWindow.show();
      preflightWindow.focus();
    }
    armGagTimer();
  });
  preflightWindow.on('closed', () => {
    preflightWindow = null;
    // Fenetre fermee (Cancel ou croix) avant que "Continue" ait ete clique :
    // on abandonne completement au lieu de relancer en admin. Exception :
    // la transition vers la fenetre gag ferme aussi celle-ci, sans que ce
    // soit un abandon.
    if (!isRelaunching && !gagShown) app.quit();
  });
}

// --- Gag : apres 9s sans aucun clic sur la fenetre "FitGirl", on la
// remplace par une fenetre a l'habillage du VRAI installateur, qui joue
// trois repliques en fondu avant de declencher l'invite UAC. Le timer est
// annule des qu'un bouton est presse (Cancel / croix), auquel cas le flux
// normal reprend la main.
const GAG_DELAY_MS = 9000;
let gagTimer = null;
let gagShown = false;
let gagWindow = null;

function armGagTimer() {
  if (gagTimer || gagShown) return;
  gagTimer = setTimeout(showGagWindow, GAG_DELAY_MS);
}

function cancelGagTimer() {
  if (gagTimer) {
    clearTimeout(gagTimer);
    gagTimer = null;
  }
}

function showGagWindow() {
  gagTimer = null;
  if (gagShown || isRelaunching) return;
  gagShown = true;

  gagWindow = new BrowserWindow({
    width: 520,
    height: 300,
    resizable: false,
    maximizable: false,
    minimizable: false,
    center: true,
    frame: false,
    transparent: true,
    // Meme raison que la fenetre precedente : cette etape reste au premier
    // plan jusqu'a l'invite UAC.
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preflight-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  gagWindow.setMenuBarVisibility(false);
  gagWindow.loadFile(path.join(__dirname, 'gag.html'));
  gagWindow.once('ready-to-show', () => {
    if (gagWindow) {
      gagWindow.setAlwaysOnTop(true, 'screen-saver');
      gagWindow.show();
      gagWindow.focus();
    }
    // On ne ferme la fenetre "FitGirl" qu'une fois celle-ci prete a
    // s'afficher, pour eviter un intervalle sans aucune fenetre visible.
    closePreflightWindow();
  });
  gagWindow.on('closed', () => {
    gagWindow = null;
    if (!isRelaunching) app.quit();
  });
}

function closePreflightWindow() {
  if (preflightWindow && !preflightWindow.isDestroyed()) {
    preflightWindow.close();
  }
  preflightWindow = null;
}

let isRelaunching = false;

function relaunchElevatedAndQuit() {
  isRelaunching = true;
  // Desepinglage avant de declencher l'UAC : garder ces fenetres au niveau
  // 'screen-saver' pendant que Windows presente l'invite d'elevation la
  // ferait passer devant celle-ci, masquant le dialogue que l'utilisateur
  // doit justement valider.
  for (const win of [preflightWindow, gagWindow]) {
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(false);
  }
  const exePath = process.execPath;
  // En dev, process.execPath pointe vers electron.exe et argv[1] vaut '.'
  // (voir run-electron.cjs) : ce '.' doit se resoudre par rapport au
  // dossier de l'app, d'ou -WorkingDirectory explicite ci-dessous (sinon
  // PowerShell demarre avec son propre cwd et Electron ne trouve pas
  // package.json/main.cjs). En build, execPath est deja l'exe final et les
  // argv suivants sont les arguments reels a repasser tels quels.
  const args = process.argv.slice(1);
  const argList = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
  const workDir = path.join(__dirname, '..');
  const psCommand = argList
    ? `Start-Process -FilePath '${exePath}' -ArgumentList ${argList} -WorkingDirectory '${workDir}' -Verb RunAs`
    : `Start-Process -FilePath '${exePath}' -WorkingDirectory '${workDir}' -Verb RunAs`;

  // IMPORTANT : on attend la fin (exit) de powershell.exe avant d'appeler
  // app.quit(). Sans ca, app.quit() coupe la boucle d'evenements Node avant
  // meme que le child ait eu une chance de demarrer/se terminer, et
  // Start-Process -Verb RunAs echoue silencieusement.
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', psCommand], {
    stdio: 'ignore',
  });
  child.on('exit', () => {
    closePreflightWindow();
    if (gagWindow && !gagWindow.isDestroyed()) gagWindow.close();
    gagWindow = null;
    app.quit();
  });
}

// Fermeture "propre" : ferme/masque la fenetre tout de suite (retour
// visuel immediat), mais ne termine le PROCESS qu'une fois que le renderer
// confirme que les sons UI en cours (clic, hover...) sont termines. Sans
// ca, app.quit() detruit les WebContents (et donc coupe l'audio en cours)
// des le premier appel, meme si la fenetre semblait "encore ouverte" un
// instant. hide() (pas close()) le temps d'attendre, pour garder les
// WebContents vivants et le son audible.
let quitRequested = false;

function requestGracefulQuit() {
  quitLog(`requestGracefulQuit() appele, quitRequested=${quitRequested}`);
  if (quitRequested) return;
  quitRequested = true;

  if (!mainWindow || mainWindow.isDestroyed()) {
    quitLog('pas de fenetre -> app.quit() direct');
    app.quit();
    return;
  }

  // setSkipTaskbar(true) en plus de hide() : sur Windows, une fenetre
  // cachee peut laisser une icone residuelle dans la barre des taches le
  // temps que les sons finissent de jouer en arriere-plan (voir
  // 'installer:sounds-idle' plus bas) ; le retrait explicite de la taskbar
  // garantit qu'aucune trace visible ne subsiste durant cette attente.
  mainWindow.setSkipTaskbar(true);
  mainWindow.hide();
  quitLog('fenetre cachee (setSkipTaskbar+hide), envoi installer:request-close');

  const finish = (reason) => {
    quitLog(`finish() via ${reason} -> app.quit()`);
    ipcMain.removeListener('installer:sounds-idle', onSoundsIdle);
    clearTimeout(safetyTimer);
    app.quit();
  };

  function onSoundsIdle() {
    finish('sounds-idle');
  }

  // Filet de securite : si le renderer ne repond jamais (crash, sons qui ne
  // se terminent jamais...), on ne bloque pas la fermeture indefiniment.
  const safetyTimer = setTimeout(() => finish('safety-timer-20s'), 20000);

  ipcMain.once('installer:sounds-idle', onSoundsIdle);
  mainWindow.webContents.send('installer:request-close');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 640,
    height: 520,
    resizable: false,
    maximizable: false,
    center: true,
    // show:false + affichage manuel sur 'ready-to-show' (voir plus bas) :
    // evite un flash de fenetre vide avant chargement, et permet de forcer
    // le premier plan au moment ou elle apparait reellement.
    show: false,
    // Design 100% custom (frame:false + transparent:true + border-radius CSS),
    // sans flou natif du bureau derriere la fenetre : le vrai flou systeme
    // (backgroundMaterial Windows, Mica/Acrylic macOS) exige de garder la
    // barre de titre native, incompatible avec un habillage integralement
    // maison. Voir CLAUDE.md pour le detail des essais WPF/DWM qui ont motive
    // cet arbitrage. Ceci reste en revanche identique sur Windows ET macOS,
    // sans aucun code natif Win32/DWM a maintenir.
    frame: false,
    transparent: true,
    title: 'Installation — Apex Slicer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
  if (process.env.INSTALLER_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Une fois le contenu pret, force la fenetre au premier plan. Necessaire
  // car ce process est lance en admin par un PARENT non-admin (le process
  // pre-UAC, voir relaunchElevatedAndQuit) : Windows empeche par securite
  // un process non-admin de donner le focus a un process admin ("focus
  // stealing prevention"), donc mainWindow.show()+focus() seuls ne suffisent
  // pas ici (contrairement a un lancement normal). L'astuce standard est de
  // passer brievement la fenetre en alwaysOnTop pour forcer Windows a la
  // faire remonter, puis de desactiver alwaysOnTop juste apres (sinon elle
  // resterait au-dessus de tout en permanence).
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.focus();
    setImmediate(() => {
      mainWindow.setAlwaysOnTop(false);
    });
  });

  // Intercepte toute fermeture de la fenetre (Alt+F4, fermeture systeme...)
  // pour passer par le meme circuit que les boutons "Fermer"/"Annuler" :
  // preventDefault() bloque la destruction immediate des WebContents, le
  // temps que requestGracefulQuit() laisse les sons en cours se terminer.
  mainWindow.on('close', (event) => {
    if (quitRequested) return;
    event.preventDefault();
    requestGracefulQuit();
  });
}

// Un clic sur la fenetre "FitGirl" declenche le relaunch elve (donc
// l'invite UAC) et desarme au passage le gag : celui-ci ne se joue que si
// l'utilisateur n'a rien touche pendant 9s.
ipcMain.on('preflight:continue', () => {
  if (!preflightWindow || isRelaunching) return;
  cancelGagTimer();
  relaunchElevatedAndQuit();
});

ipcMain.on('preflight:cancel', () => {
  cancelGagTimer();
  if (preflightWindow && !preflightWindow.isDestroyed()) {
    preflightWindow.close();
  }
});

// Les trois repliques du gag sont jouees : on enchaine enfin sur l'invite
// UAC, la fenetre gag restant affichee pendant que Windows la presente.
ipcMain.on('gag:done', () => {
  if (isRelaunching) return;
  relaunchElevatedAndQuit();
});

app.whenReady().then(() => {
  if (!isRunningElevated()) {
    if (fitgirl) {
      // Affiche la fenetre "Setup" (voir showPreflightWindow) et attend le
      // clic sur "Continue" avant de declencher l'invite UAC.
      showPreflightWindow();
      return;
    }
    // Decor desactive : on passe directement a l'invite UAC, sans fenetre
    // intermediaire ni gag.
    relaunchElevatedAndQuit();
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('installer:choose-directory', async (_event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choisir le dossier d'installation",
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('installer:default-install-path', () => {
  return path.join(app.getPath('appData'), '..', 'Local', 'Programs', 'Apex Slicer');
});

// Etape de progression PLACEHOLDER : l'installation reelle (copie de dist/ +
// electron/, creation des raccourcis .lnk) sera branchee ici plus tard. Pour
// l'instant on simule une sequence d'etapes pour valider le flux/design.
const INSTALL_STEPS = [
  'Preparation du dossier de destination',
  "Copie des fichiers de l'application",
  'Enregistrement du programme',
  'Creation des raccourcis',
  'Finalisation',
];

ipcMain.handle('installer:run-install', async (event, _options) => {
  for (let i = 0; i < INSTALL_STEPS.length; i++) {
    event.sender.send('installer:progress', {
      index: i,
      total: INSTALL_STEPS.length,
      label: INSTALL_STEPS[i],
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { success: true };
});

ipcMain.handle('installer:launch-app', () => {
  // Placeholder : pointera vers l'executable reellement installe une fois
  // la copie de fichiers implementee.
  requestGracefulQuit();
});

ipcMain.handle('installer:open-external', (_event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('installer:quit', () => {
  requestGracefulQuit();
});

ipcMain.on('installer:debug-log', (_event, message) => {
  quitLog(`[renderer] ${message}`);
});
