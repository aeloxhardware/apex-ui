const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execSync, spawn } = require('node:child_process');
const backdrop = require('./backdrop.cjs');
const installer = require('./install.cjs');

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
// Packagee, __dirname est dans app.asar (non inscriptible) et le dossier de l'exe portable disparait a la fermeture :
// le journal va alors dans le dossier personnel.
const QUIT_LOG_PATH = app.isPackaged
  ? path.join(require('node:os').homedir(), 'apex-installer-debug.log')
  : path.join(__dirname, '..', 'quit-debug.log');
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

// --- Question initiale : toute premiere chose affichee, avant l'UAC et meme avant le logo de chargement. Boite
// volontairement laide, facon Windows 95. Oui -> la suite habituelle ; Non / croix / Echap -> on quitte. Le process
// relance en administrateur recoit CONFIRMED_FLAG et ne la reaffiche pas.
const CONFIRMED_FLAG = '--apex-confirmed';
let questionWindow = null;
function showQuestionDialog(onYes) {
  questionWindow = new BrowserWindow({
    width: 360,
    height: 168,
    center: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#c0c0c0',
    title: 'Question',
    roundedCorners: false,  // angles pointus (Windows 11 arrondit sinon les fenetres sans cadre)
    icon: path.join(__dirname, 'icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'question-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  questionWindow.setMenuBarVisibility(false);
  questionWindow.loadFile(path.join(__dirname, 'question.html'));
  questionWindow.once('ready-to-show', () => {
    quitLog('question : affichee');
    questionWindow.show();
    questionWindow.focus();
  });
  ipcMain.once('question:answer', (_event, yes) => {
    quitLog(`question : reponse ${yes ? 'Oui' : 'Non'}`);
    if (!yes) {
      questionWindow?.destroy();
      app.quit();
      return;
    }
    onYes();
    // Deja eleve : la fenetre principale est creee, la question peut partir. Sinon (relance en cours), elle reste
    // masquee jusqu'a la fin de PowerShell (voir relaunchElevatedAndQuit) : fermer ici quitterait l'app trop tot.
    if (questionWindow && !questionWindow.isDestroyed()) {
      if (isRelaunching) questionWindow.hide();
      else questionWindow.destroy();
    }
  });
  questionWindow.on('closed', () => {
    questionWindow = null;
  });
}

function relaunchElevatedAndQuit() {
  isRelaunching = true;
  // Desepinglage avant de declencher l'UAC : garder ces fenetres au niveau
  // 'screen-saver' pendant que Windows presente l'invite d'elevation la
  // ferait passer devant celle-ci, masquant le dialogue que l'utilisateur
  // doit justement valider.
  for (const win of [preflightWindow, gagWindow]) {
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(false);
  }
  // Cible portable : process.execPath est la copie extraite dans %TEMP%, effacee des que le lanceur se ferme ; il faut
  // relancer l'exe d'origine (PORTABLE_EXECUTABLE_FILE), voir limite #3 de CLAUDE_INSTALLER.md.
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
  const exePath = portableExe || process.execPath;
  // En dev, process.execPath pointe vers electron.exe et argv[1] vaut '.'
  // (voir run-electron.cjs) : ce '.' doit se resoudre par rapport au
  // dossier de l'app, d'ou -WorkingDirectory explicite ci-dessous (sinon
  // PowerShell demarre avec son propre cwd et Electron ne trouve pas
  // package.json/main.cjs). En build, execPath est deja l'exe final et les
  // argv suivants sont les arguments reels a repasser tels quels.
  const args = process.argv.slice(1);
  if (!args.includes(CONFIRMED_FLAG)) args.push(CONFIRMED_FLAG);  // le process eleve ne reposera pas la question
  const argList = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
  const workDir = portableExe ? path.dirname(portableExe) : path.join(__dirname, '..');
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
    if (questionWindow && !questionWindow.isDestroyed()) questionWindow.destroy();
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

// Logo Apex seul (moitie de la fenetre), sur fond transparent, tant que la fenetre principale n'est pas visible.
let loadingWindow = null;
function showLoadingLogo() {
  loadingWindow = new BrowserWindow({
    width: 360,
    height: 320,
    center: true,
    frame: false,
    transparent: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  loadingWindow.setIgnoreMouseEvents(true);
  loadingWindow.loadFile(path.join(__dirname, 'loading.html'));
  loadingWindow.once('ready-to-show', () => {
    quitLog('logo de chargement : ready-to-show');
    if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.showInactive();
  });
  loadingWindow.webContents.on('did-fail-load', (_e, code, desc) => quitLog(`logo de chargement : echec ${code} ${desc}`));
}
function closeLoadingLogo() {
  if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
  loadingWindow = null;
}

function createWindow() {
  showLoadingLogo();
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
    // Icone du bouton de barre des taches et d'Alt+Tab (logo Apex, rendu depuis res/logo.svg en 256x256).
    icon: path.join(__dirname, 'icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  // Verre liquide natif (backdrop.cjs, meme addon que l'ecran de demarrage du slicer) : le bureau Windows est
  // refracte derriere la fenetre ; la page ne dessine que son contenu (classe `glass` sur <html>, voir
  // styles.css). Sans addon, la page garde son fond meshique.
  // Sequence : la fenetre se charge SANS etre visible (opacite 0) et le verre se prepare en meme temps, cache
  // (`hold`) ; pendant ce temps le logo Apex seul reste a l'ecran, aucun fond visible. Quand tout est pret ET que le
  // logo est reste au moins LOADING_MIN_MS, le verre est montre, la fenetre revelee et le logo disparait ensemble.
  const LOADING_MIN_MS = 1000;
  const GLASS_FAILSAFE_MS = 3000;
  let glassOn = false;
  let glassReady = false;
  let windowShown = false;
  let minElapsed = false;
  let glassStarted = false;
  let revealed = false;
  const applyGlass = () => {
    if (glassOn && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript("document.documentElement.classList.add('glass')").catch(() => {});
    }
  };
  // La page reste invisible (classe `boot`, voir styles.css) jusqu'a la revelation : setOpacity(0) seul ne cache pas
  // une fenetre transparente de facon fiable, et le fond meshique apparaissait avant le logo.
  const unboot = () => mainWindow.webContents.executeJavaScript("document.documentElement.classList.remove('boot')").catch(() => {});
  const reveal = () => {
    if (revealed || mainWindow.isDestroyed()) return;
    revealed = true;
    if (glassOn) backdrop.release();  // montre le verre retenu
    applyGlass();
    unboot();
    mainWindow.setOpacity(1);
    closeLoadingLogo();
    sendStart();
  };
  const maybeReveal = () => { if (windowShown && minElapsed && glassReady) reveal(); };
  // Musique et animations de l'intro : demarrees APRES la disparition du logo, une fois la page prete a les recevoir.
  let rendererReady = false;
  const sendStart = () => {
    if (revealed && rendererReady && !mainWindow.isDestroyed()) mainWindow.webContents.send('installer:start');
  };
  ipcMain.once('installer:renderer-ready', () => { rendererReady = true; sendStart(); });
  const startGlass = () => {
    if (glassStarted) return;
    glassStarted = true;
    const ok = backdrop.follow(mainWindow, { corner: 20, tint: 0, warp: 4, blur: 10, taskbar: true, hold: true }, () => {
      glassOn = true;
      glassReady = true;
      maybeReveal();
    });
    if (!ok) {  // pas d'addon : verre du systeme (macOS) ou fond meshique de repli
      if (backdrop.systemGlass(mainWindow)) glassOn = true;
      glassReady = true;
      maybeReveal();
      return;
    }
    setTimeout(() => { glassReady = true; maybeReveal(); }, GLASS_FAILSAFE_MS);  // filet : verre jamais pret
  };
  setTimeout(() => { minElapsed = true; maybeReveal(); }, LOADING_MIN_MS);
  mainWindow.setOpacity(0);
  mainWindow.webContents.on('did-finish-load', applyGlass);
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
    windowShown = true;
    startGlass();
    maybeReveal();
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

app.setAppUserModelId('com.aeloxhardware.apexslicer.installer');

process.on('uncaughtException', (error) => quitLog(`uncaughtException : ${error && error.stack}`));
process.on('unhandledRejection', (error) => quitLog(`unhandledRejection : ${error && error.stack}`));
app.on('window-all-closed', () => quitLog('window-all-closed'));
app.on('before-quit', () => quitLog('before-quit'));

app.whenReady().then(() => {
  quitLog(`whenReady, packaged=${app.isPackaged}, argv=${process.argv.join(' ')}`);
  if (!process.argv.includes(CONFIRMED_FLAG)) {
    showQuestionDialog(startInstaller);
    return;
  }
  startInstaller();
});

function startInstaller() {
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
}

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
  // Process eleve : installation pour tous les utilisateurs (le dossier Local\Programs serait celui du compte admin).
  return path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Apex Slicer');
});

// Installation reelle (voir electron/install.cjs) : extraction du paquet embarque, enregistrement dans « Programmes et
// fonctionnalites », raccourcis, desinstalleur. Rend {success, error?} ; l'avancement part sur installer:progress.
ipcMain.handle('installer:run-install', (event, options) =>
  installer.runInstall(options || {}, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('installer:progress', progress);
  }),
);

ipcMain.handle('installer:launch-app', () => {
  installer.launchInstalled();
  requestGracefulQuit();
});

ipcMain.handle('installer:open-external', (_event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('installer:quit', () => {
  requestGracefulQuit();
});

// Glisser la fenetre depuis n'importe quelle zone sans controle. -webkit-app-region: drag sur toute la surface
// rendait hover et clic morts sur les boutons (limite #13) : le deplacement est donc fait a la main, sur le
// curseur reel (memes unites que getBounds, donc sans derive sur ecran a echelle != 100 %). La taille est
// reaffirmee a chaque pas : setBounds ne doit jamais la laisser deriver.
let dragOrigin = null;
ipcMain.on('installer:drag-start', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  dragOrigin = { cursor: screen.getCursorScreenPoint(), bounds: mainWindow.getBounds() };
});
ipcMain.on('installer:drag-move', () => {
  if (!dragOrigin || !mainWindow || mainWindow.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const b = dragOrigin.bounds;
  mainWindow.setBounds({
    x: b.x + cursor.x - dragOrigin.cursor.x,
    y: b.y + cursor.y - dragOrigin.cursor.y,
    width: b.width,
    height: b.height,
  });
});

ipcMain.on('installer:debug-log', (_event, message) => {
  quitLog(`[renderer] ${message}`);
});
