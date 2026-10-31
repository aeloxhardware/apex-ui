// Mise à jour au lancement : vérifie la dernière release GitHub d'`apex` à CHAQUE démarrage de l'application installée et,
// si une version plus récente existe, l'installe sans rien demander (boîte de dialogue en verre liquide « APEX / MISE À JOUR » avec
// progression), puis relance. Seuls les fichiers modifiés sont téléchargés (cf. updater.cjs). Toute
// erreur (réseau, signature, intégrité, droits d'écriture) est journalisée et l'application démarre normalement.
//   --update-demo : affiche l'écran de mise à jour avec une progression factice (essai de l'interface, rien n'est installé).
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const updater = require('./updater.cjs');
const backdrop = require('./backdrop.cjs');
const pkg = require('../package.json');

const DEMO = process.argv.includes('--update-demo');

function log(message) {
  console.log(`[update] ${message}`);
}

// Boîte seule (pas de voile), en verre liquide comme l'écran de démarrage : le bureau derrière est réfracté (backdrop.cjs).
// Invisible (opacité 0) jusqu'au premier verre dessiné ; sans verre (autre OS, pas d'addon), elle apparaît avec son fond de repli.
const GLASS_WAIT_MS = 1500;

function createUpdateWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 470,
    frame: false,
    icon: require('node:path').join(__dirname, 'icon-256.png'),
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setOpacity(0);
  let revealed = false;
  const reveal = (glass) => {
    if (revealed || win.isDestroyed()) return;
    revealed = true;
    const show = () => { if (!win.isDestroyed()) win.setOpacity(1); };
    if (!glass) { show(); return; }
    win.webContents.executeJavaScript("document.querySelector('.card').classList.add('glass')").then(show, show);
  };
  const glass = backdrop.follow(win, { force: true }, () => reveal(true));
  const systemGlass = !glass && backdrop.systemGlass(win);
  win.once('ready-to-show', () => {
    win.show();
    if (glass) setTimeout(() => reveal(false), GLASS_WAIT_MS);
    else reveal(systemGlass);
  });
  return { win, loaded: win.loadFile(path.join(__dirname, 'update.html')) };
}

/** Pousse un état vers la page : { version, percent, label }. */
function push(win, state) {
  if (win.isDestroyed()) return;
  void win.webContents.executeJavaScript(`window.__update(${JSON.stringify(state)})`).catch(() => undefined);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function displayVersion(version) {
  const parsed = updater.parseVersion(version);
  return parsed ? `v${parsed.nums.join('.')}${parsed.pre ? ` (${parsed.pre})` : ''}` : String(version);
}

async function runDemo() {
  const { win, loaded } = createUpdateWindow();
  await loaded;
  for (let i = 0; i <= 100; i += 2) {
    push(win, { version: displayVersion('beta-0.2.3.0.6.0.0.221'), percent: i, label: `Téléversement… ${i} %` });
    await delay(120);
  }
  win.setClosable(true);
  win.destroy();
  return false;
}

/**
 * À appeler avant de créer la fenêtre de l'application. Rend true si l'application relance (ne rien créer), false si
 * elle doit démarrer normalement.
 */
async function runStartupUpdate() {
  if (DEMO) return runDemo();
  // Seule l'application installée se met à jour (pas le développement), pour l'instant sous Windows uniquement.
  if (!app.isPackaged || process.env.ELECTRON_START_URL !== undefined || process.platform !== 'win32') return false;

  const root = path.dirname(process.execPath);
  const config = pkg.apexUpdate ?? {};
  let win = null;
  try {
    updater.cleanupOld(root);
    const found = await updater.checkForUpdate({
      repo: config.repo,
      channel: config.channel,
      currentVersion: pkg.apexVersion,
      publicKeyPem: fs.readFileSync(path.join(__dirname, 'update-public-key.pem'), 'utf8'),
    });
    if (!found) return false;
    const { manifest, release } = found;
    log(`mise à jour ${pkg.apexVersion} → ${manifest.version}`);

    // L'installation doit être inscriptible (dossier d'installation choisi hors de Program Files, ou droits suffisants).
    const stagingDir = path.join(root, updater.STATE_DIR, 'staging');
    fs.mkdirSync(stagingDir, { recursive: true });

    const created = createUpdateWindow();
    win = created.win;
    await created.loaded;
    const version = displayVersion(manifest.version);
    push(win, { version, percent: 0, label: 'Vérification des fichiers…' });

    const plan = await updater.planUpdate(root, manifest, undefined, (done, total) => {
      push(win, { version, percent: 0, label: `Vérification des fichiers… ${done} / ${total}` });
    });
    log(`${plan.changed.length} fichier(s) à télécharger (${plan.bytes} octets), ${plan.removed.length} à retirer`);

    const resolve = updater.createAssetResolver({ repo: config.repo, release });
    const staged = [];
    let received = 0;
    let index = 0;
    for (const entry of plan.changed) {
      const file = path.join(stagingDir, entry.sha256);
      index += 1;
      await updater.downloadVerified(await resolve(entry), file, entry, {
        onBytes: (n) => {
          received += n;
          const percent = plan.bytes ? Math.min(99, Math.round((received / plan.bytes) * 100)) : 0;
          push(win, { version, percent, label: `Téléversement… ${percent} % (${index} / ${plan.changed.length} fichiers)` });
        },
      });
      staged.push({ entry, file });
    }

    push(win, { version, percent: 100, label: 'Installation des fichiers…' });
    updater.applyUpdate(root, staged, plan.removed, manifest);
    push(win, { version, percent: 100, label: 'Redémarrage d’Apex…' });
    await delay(1200);
    if (plan.changed.length === 0) {  // rien de modifié (numéro seul) : pas besoin de relancer
      win.setClosable(true);
      win.destroy();
      return false;
    }
    app.relaunch();
    app.exit(0);
    return true;
  } catch (err) {
    log(`échec, démarrage normal : ${err && err.message ? err.message : err}`);
    if (win && !win.isDestroyed()) { win.setClosable(true); win.destroy(); }
    return false;
  }
}

module.exports = { runStartupUpdate };
