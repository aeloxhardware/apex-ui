// Verre liquide qui réfracte le bureau Windows derrière une fenêtre Electron. Tout est natif
// (native/src/backdrop.cpp) : capture du bureau par le GPU, fenêtre de verre posée sous la fenêtre Electron,
// réfraction en HLSL, redessinée dans le message de déplacement de la fenêtre elle-même (aucun aller-retour
// par JavaScript, donc pas de retard pendant un glissement). La page ne dessine que son texte, sur fond
// transparent. Les deux fenêtres sont exclues de la capture, sinon le verre se capturerait lui-même.
// Sans addon (autre OS, addon non construit) : `follow` renvoie faux et la fenêtre garde son fond de repli.
const { app } = require('electron');
const path = require('node:path');

let addon;
function loadAddon() {
  if (addon !== undefined) return addon;
  addon = null;
  if (process.platform !== 'win32') return addon;
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'apex_backdrop.node')
    : path.join(__dirname, '..', 'native', 'build', 'apex_backdrop.node');
  try {
    addon = require(file);
  } catch (error) {
    console.warn('[apex] verre du bureau indisponible :', error.message);
  }
  return addon;
}

/** Démarre le verre derrière `win` (à appeler une fois la fenêtre affichée) ; il s'arrête à sa fermeture.
 * `tint` : assombrissement 0..1 (0 : aucun, comme l'interface) ; `warp` : intensité de la réfraction de bord, comme les panneaux de l'Accueil
 * (GlassPanelBackdrop) ; `blur` : « Blur Radius » du Liquid Glass Studio (px CSS, sigma = rayon/3), appliqué partout (« Blur Edge » coché). `onReady()` est appelé une fois, quand le premier
 * verre est à l'écran. Renvoie vrai si lancé. */
function follow(win, { corner = 20, tint = 0, warp = 4, blur = 10, taskbar = false, hold = false } = {}, onReady) {
  const native = loadAddon();
  if (!native) return false;
  // Exclusion de la capture de la fenêtre Electron (le verre natif s'exclut lui-même).
  try {
    win.setContentProtection(true);
    const started = native.start(win.getNativeWindowHandle(), { corner, tint, warp, blur, taskbar: taskbar ? 1 : 0, hold: hold ? 1 : 0 }, () => onReady?.());
    if (!started) return false;
    win.once('closed', () => native.stop());
    return true;
  } catch (error) {
    console.warn('[apex] verre du bureau : échec au démarrage —', error.message);
    return false;
  }
}


/** Verre « du système » quand l'addon de réfraction n'est pas disponible (macOS, ou Windows sans addon) : sous macOS,
 * vibrance native (flou du bureau derrière la fenêtre, aucune permission). Renvoie vrai si un verre système est actif ;
 * sinon (Linux, Windows) la page garde son fond de repli. La réfraction complète (même rendu que Windows) demanderait la
 * permission « Enregistrement de l'écran » : volontairement NON demandée par défaut. */
function systemGlass(win) {
  if (process.platform !== 'darwin') return false;
  try {
    win.setVibrancy('under-window');
    return true;
  } catch (error) {
    console.warn('[apex] verre système indisponible :', error.message);
    return false;
  }
}

/** Montre le verre demarre avec `hold: true` (il est alors pret mais cache). */
function release() {
  addon?.release?.();
}

module.exports = { follow, release, systemGlass };
