'use strict';
// Écran de démarrage, dans un PROCESSUS ELECTRON À PART (lancé par main.cjs avec `--apex-splash`).
//
// Le splash ne doit jamais figer. Dans le processus principal d'Apex, il partageait le processus principal et le processus
// GPU de l'interface : tout travail lourd de celle-ci (chargement, compilation des shaders du viewport) gelait la carte,
// le verre et la sphère. Ici il a son propre processus principal et son propre processus GPU ; rien de ce que fait
// l'interface ne peut plus l'atteindre.
//
// Protocole avec main.cjs (une ligne JSON par message) :
//   entrée (tube nommé `--apex-splash-pipe=`) : { t: 'status', text } texte de l'étape affichée ; { t: 'close' } fermeture.
//   sortie (stdout) : « shown » quand la carte (et sa sphère) est à l'écran ; « closed » à la fermeture.
// Si main.cjs disparaît (tube fermé), le splash se ferme tout seul.
// Pourquoi un tube nommé et pas stdin : sous Windows, Electron voit stdin fermé (fin de fichier) dès son démarrage quand il
// est lancé avec un tube — le splash se fermait aussitôt, sans jamais s'afficher.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const readline = require('node:readline');
const { app, BrowserWindow, nativeImage } = require('electron');
const backdrop = require('./backdrop.cjs');
const { createSphere } = require('./splash-sphere.cjs');

const flat = process.argv.includes('--apex-splash-flat');
const versionArg = process.argv.find((a) => a.startsWith('--apex-splash-version='));
const version = versionArg ? decodeURIComponent(versionArg.slice('--apex-splash-version='.length)) : '';
const SPLASH_GLASS_WAIT_MS = 1500;

// Profil Chromium propre à ce processus : celui de l'application est verrouillé par le processus principal.
const profileDir = path.join(os.tmpdir(), `apex-splash-${process.pid}`);
app.setPath('userData', profileDir);
app.setAppUserModelId('com.aeloxhardware.apexslicer');
app.on('will-quit', () => { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* verrou résiduel : sans conséquence */ } });
// Profils laissés par des lancements précédents (Chromium tient encore des fichiers à l'arrêt, ou processus tué) : nettoyés ici.
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^apex-splash-(\d+)$/.exec(name)?.[1];
  if (!pid || Number(pid) === process.pid) continue;
  let alive = true;
  try { process.kill(Number(pid), 0); } catch { alive = false; }
  if (!alive) { try { fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true }); } catch { /* verrou : au prochain lancement */ } }
}
app.on('window-all-closed', () => { process.stdout.write('closed\n'); app.quit(); });

const send = (line) => { try { process.stdout.write(`${line}\n`); } catch { /* parent parti */ } };

function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 520,
    height: 300,
    frame: false,
    icon: nativeImage.createFromPath(path.join(__dirname, 'icon-256.png')),
    // Interface classique : carte noire pleine, sans transparence ni verre.
    transparent: !flat,
    backgroundColor: flat ? '#000000' : undefined,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,  // le bouton de la barre des tâches est celui de la fenêtre principale
    center: true,
    show: false,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required' },
  });
  return splash;
}

// Fin de la lecture du son (résolue aussi s'il n'a jamais démarré ou a échoué) : le processus ne se termine pas avant,
// pour que le son aille toujours jusqu'au bout, même si l'interface est prête avant sa fin.
let soundDone = Promise.resolve();
const SOUND_MAX_MS = 30000;  // garde-fou : un son qui ne se termine jamais ne retient pas le processus

/** Effet sonore à l'affichage (une fois). Le mp3 est donné à la page en data: (file:// est refusé en média, CSP de splash.html). */
function soundPlayer(splash) {
  let played = false;
  return () => {
    if (played || splash.isDestroyed()) return;
    played = true;
    let src;
    try { src = `data:audio/mpeg;base64,${fs.readFileSync(path.join(__dirname, 'splash-sound.mp3')).toString('base64')}`; }
    catch { return; }
    const js = `(() => { const a = document.getElementById('splash-sound'); a.src = ${JSON.stringify(src)}; a.volume = 1;
      return a.play().then(() => new Promise((r) => { a.onended = r; a.onerror = r; })); })()`;
    soundDone = Promise.race([
      splash.webContents.executeJavaScript(js).catch(() => undefined),
      new Promise((r) => setTimeout(r, SOUND_MAX_MS)),
    ]);
  };
}

/** Fermeture : la carte disparaît tout de suite, le processus attend la fin du son puis s'arrête. */
let finishing = false;
function finish(splash) {
  if (finishing) return;
  finishing = true;
  if (!splash.isDestroyed()) splash.hide();  // les fenêtres filles (sphère) se cachent avec elle
  void soundDone.then(() => { if (!splash.isDestroyed()) splash.close(); else app.quit(); });
}

function setVersion(splash) {
  splash.webContents.once('did-finish-load', () => {
    void splash.webContents.executeJavaScript(`document.getElementById('version').textContent = ${JSON.stringify(version)}`).catch(() => undefined);
  });
}

/** Interface classique : la carte s'affiche telle quelle, sans verre ni sphère. */
function startFlat(splash, playSound) {
  splash.once('ready-to-show', () => { splash.show(); playSound(); send('shown'); });
  setVersion(splash);
  splash.loadFile(path.join(__dirname, 'splash.html'), { query: { ui: 'flat' } });
}

// Polices chargées (sinon le texte est invisible tant qu'elles ne le sont pas) puis deux images peintes.
const PAINT = 'document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))';

/**
 * LiquidGlass : carte invisible (opacité 0) jusqu'à ce que page (texte compris) et verre soient prêts, puis elle apparaît
 * d'un coup, tout de suite. La sphère n'est lancée qu'APRÈS : sa page compile un gros shader (plus de 3 s sur un GPU modeste)
 * qui occupe le processus GPU ; lancée en même temps, elle retardait la carte et son texte (le verre seul s'affichait).
 * Elle apparaît ensuite en fondu, dès qu'elle est prête.
 */
function startGlass(splash, playSound) {
  splash.setOpacity(0);
  const splashPainted = new Promise((resolve) => {
    splash.webContents.once('did-finish-load', () => { splash.webContents.executeJavaScript(PAINT).then(resolve, resolve); });
  });
  const pageReady = splashPainted;
  let revealed = false;
  const revealSplash = (glass) => {
    if (revealed || splash.isDestroyed()) return;
    revealed = true;
    const reveal = () => {
      if (splash.isDestroyed()) return;
      splash.setOpacity(1); send('shown');
      // Le son (un coup de tonnerre) ne part qu'à l'apparition de la sphère, jamais avant ; sans sphère, jamais.
      const sphere = createSphere(splash);
      void sphere.ready.then((drawn) => { if (drawn && sphere.show()) playSound(); });
    };
    void pageReady.then(() => {
      if (!glass) { reveal(); return; }
      splash.webContents.executeJavaScript("document.querySelector('.card').classList.add('glass')").then(reveal, reveal);
    });
  };
  // `force` : le verre est toujours actif, même sur un GPU jugé faible (décision de l'utilisateur, 2026-10-27).
  const glass = backdrop.follow(splash, { force: true }, () => revealSplash(true));
  const systemGlass = !glass && backdrop.systemGlass(splash);  // macOS : vibrance native
  // Fenêtre « montrée » tout de suite mais à opacité 0 (invisible) : Chromium ne peint pas une fenêtre cachée, d'où une
  // attente de 100 à 150 ms avant `ready-to-show`. Ainsi la page se peint pendant son chargement et `reveal` n'a plus qu'à
  // l'opacifier.
  splash.show();
  if (glass) setTimeout(() => revealSplash(false), SPLASH_GLASS_WAIT_MS);
  else revealSplash(systemGlass);
  setVersion(splash);
  splash.loadFile(path.join(__dirname, 'splash.html'));
}

/** Connexion au tube du parent (qui l'ouvre avant de nous lancer ; quelques essais par prudence). */
function connectParent(pipePath, onSocket, onFail, attemptsLeft = 20) {
  const socket = net.connect(pipePath);
  socket.once('connect', () => onSocket(socket));
  socket.once('error', () => { if (attemptsLeft > 0) setTimeout(() => connectParent(pipePath, onSocket, onFail, attemptsLeft - 1), 50); else onFail(); });
}

function listenParent(splash) {
  const pipeArg = process.argv.find((a) => a.startsWith('--apex-splash-pipe='));
  if (!pipeArg) { finish(splash); return; }
  connectParent(pipeArg.slice('--apex-splash-pipe='.length), (socket) => readParent(splash, socket), () => finish(splash));
}

function readParent(splash, socket) {
  socket.on('error', () => undefined);
  const rl = readline.createInterface({ input: socket });
  // Le parent écrit dès son démarrage, parfois avant que la page du splash soit chargée : on retient la dernière étape
  // et on l'applique au chargement.
  let lastStatus = null;
  const showStatus = () => {
    if (lastStatus === null || splash.isDestroyed()) return;
    void splash.webContents.executeJavaScript(`document.getElementById('status').textContent = ${JSON.stringify(lastStatus)}`).catch(() => undefined);
  };
  splash.webContents.on('did-finish-load', showStatus);
  rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (splash.isDestroyed()) return;
    if (msg.t === 'status' && typeof msg.text === 'string') {
      lastStatus = msg.text;
      showStatus();
    } else if (msg.t === 'close') finish(splash);
  });
  rl.on('close', () => finish(splash));
}

void app.whenReady().then(() => {
  const splash = createSplashWindow();
  const playSound = soundPlayer(splash);
  if (flat) startFlat(splash, playSound); else startGlass(splash, playSound);
  listenParent(splash);
});
