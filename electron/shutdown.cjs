// Fermeture d'Apex : l'application ne se ferme jamais d'un coup. Toute demande de fermeture (croix, Alt+F4, quitter) est
// interceptée ; la page joue alors le rideau de fermeture (src/utils/shutdownSequence.ts), qui appelle ici, étape par
// étape, les opérations du processus principal, puis `apex:shutdown-finish`. Le but : aucun processus, fichier
// temporaire, cache ni verrou laissé derrière soi. Les RÉGLAGES de l'utilisateur (apex-settings.json) ne sont PAS une
// trace à effacer : ils sont voulus et conservés.
const { app, BrowserWindow, ipcMain, session, globalShortcut } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pythonRunner = require('./python-runner.cjs');
const backdrop = require('./backdrop.cjs');

const FAILSAFE_MS = 25000;
let state = 'idle';  // idle -> asked (rideau en cours) -> done
let failsafe = null;
let hooks = { stopEditProcess: () => {} };

/** Nom affiché de l'OS (« Windows 11 », « macOS », « Linux »), repris dans les messages de fermeture. */
function osDisplayName() {
  if (process.platform === 'win32') return parseInt(String(os.release()).split('.')[2], 10) >= 22000 ? 'Windows 11' : 'Windows 10';
  if (process.platform === 'darwin') return 'macOS';
  return 'Linux';
}


function finish() {
  if (state === 'done') return;
  state = 'done';
  clearTimeout(failsafe);
  for (const w of BrowserWindow.getAllWindows()) { if (!w.isDestroyed()) w.destroy(); }
  app.quit();
  setTimeout(() => app.exit(0), 3000);  // dernier recours si quelque chose retient la sortie
}

/** Lance le rideau de fermeture dans la fenêtre `win` (une seule fois). */
function ask(win) {
  if (state !== 'idle') return;
  // Fenêtre pas encore montrée, ou page en chargement : personne pour jouer le rideau.
  if (win.isDestroyed() || !win.isVisible() || win.webContents.isLoading()) { finish(); return; }
  state = 'asked';
  failsafe = setTimeout(finish, FAILSAFE_MS);  // une page figée ne doit pas empêcher de quitter
  win.webContents.send('apex:close-requested');
}

/** À brancher sur `win.on('close')` de la fenêtre principale. */
function onWindowClose(event, win) {
  if (state === 'done') return;
  event.preventDefault();
  ask(win);
}

/** Fichiers temporaires d'Apex dans le dossier temporaire du système. */
async function removeTemp() {
  let removed = 0;
  try {
    for (const name of await fs.promises.readdir(os.tmpdir())) {
      if (!name.startsWith('apex-convert-')) continue;
      await fs.promises.rm(path.join(os.tmpdir(), name), { recursive: true, force: true });
      removed++;
    }
  } catch { /* dossier illisible : rien à purger */ }
  return removed;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STEPS = {
  // RAM / vRAM côté processus principal : caches HTTP et de code de Chromium, fichiers temporaires.
  async purge() {
    const ses = session.defaultSession;
    await ses.clearCache();
    await ses.clearCodeCaches({});
    return { temp: await removeTemp() };
  },
  // Tâches en cours : on laisse aux conversions Python le temps de finir proprement avant de les arrêter.
  async tasks() {
    for (let i = 0; i < 20 && pythonRunner.runningCount() > 0; i++) await wait(200);
    return { pending: pythonRunner.runningCount() };
  },
  // Pipeline d'exécution : interpréteurs Python, processus d'édition C++ (utilityProcess), verre natif.
  async pipeline() {
    pythonRunner.stopAll();
    hooks.stopEditProcess();
    backdrop.stop();
    return {};
  },
  // « Autorité » détenue par le logiciel : verrou d'instance, raccourcis globaux, entrée de liste de raccourcis de la
  // barre des tâches, exclusion des fenêtres de la capture d'écran.
  async authority() {
    try { app.releaseSingleInstanceLock(); } catch { /* pas pris */ }
    globalShortcut.unregisterAll();
    if (process.platform === 'win32') app.setUserTasks([]);
    for (const w of BrowserWindow.getAllWindows()) { try { w.setContentProtection(false); } catch { /* fenêtre fermée */ } }
    return {};
  },
  // Fin de session de l'application (pas de l'OS) : stockage écrit sur disque avant de quitter.
  async session() {
    await session.defaultSession.flushStorageData();
    return {};
  },
};

function register(options) {
  hooks = { ...hooks, ...options };
  ipcMain.handle('apex:shutdown-step', async (_event, name) => {
    const step = STEPS[name];
    if (!step) return null;
    try { return await step(); } catch (error) { console.warn(`[apex] fermeture, étape « ${name} » :`, error.message); return null; }
  });
  ipcMain.on('apex:shutdown-finish', finish);
  // Quitter autrement que par la croix (menu, macOS Cmd+Q, arrêt système) : même rideau.
  app.on('before-quit', (event) => {
    if (state === 'done') return;
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible());
    event.preventDefault();
    if (win) ask(win); else finish();
  });
}

module.exports = { register, onWindowClose, osDisplayName };
