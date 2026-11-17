'use strict';
// Sphère d'énergie de l'écran de démarrage : une fenêtre transparente, sans souris, posée par-dessus le splash
// (splash-sphere.html) pour que son éclat et son ombre débordent de la carte, que le verre natif découperait.
// Elle suit le splash (glisser), n'apparaît qu'avec lui et se ferme avec lui.
const path = require('path');
const { BrowserWindow } = require('electron');

const SIZE = 500;                 // côté du carré de la sphère (px) : le rayon vaut SIZE / 5,2
const CENTER = { x: 415, y: 200 }; // centre de la sphère, dans le repère de la carte (520 x 300)

/** Crée la fenêtre de la sphère pour `splash` ; renvoie `{ show }` (à appeler quand le splash devient visible). */
function createSphere(splash, { protect = true } = {}) {
  const place = () => {
    const b = splash.getBounds();
    return { x: b.x + CENTER.x - SIZE / 2, y: b.y + CENTER.y - SIZE / 2, width: SIZE, height: SIZE };
  };
  const win = new BrowserWindow({
    ...place(),
    parent: splash,   // une fenêtre fille reste toujours au-dessus de sa mère (Windows)
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setIgnoreMouseEvents(true);
  // Exclue de la capture du bureau, comme le splash : sinon le verre réfracterait la sphère par-dessus lui.
  if (protect) win.setContentProtection(true);
  win.loadFile(path.join(__dirname, 'splash-sphere.html'));
  const follow = () => { if (!win.isDestroyed()) win.setBounds(place()); };
  splash.on('move', follow);
  splash.once('closed', () => { if (!win.isDestroyed()) win.close(); });
  // Le splash se cache (fin du démarrage) : la sphère se cache avec lui, même si sa page finit de charger après coup.
  splash.on('hide', () => { if (!win.isDestroyed()) win.hide(); });
  // Créée APRÈS l'affichage de la carte (cf. splash-process.cjs) : sa page compile un gros shader, plus de 3 s sur un GPU
  // modeste (compilé en tâche de fond, cf. splash-sphere.html). Préparée à opacité 0 ; `ready` se résout (à `true`) quand la
  // page a dessiné sa première image, puis `show()` la fait apparaître en fondu. Bornée dans le temps : une sphère qui ne
  // répond pas (ou sans WebGL) se résout à `false` et n'est jamais montrée.
  const PREPARE_MAX_MS = 15000;
  const POLL_MS = 40;
  const FADE_MS = 450;
  const prepared = new Promise((resolve) => {
    const deadline = Date.now() + PREPARE_MAX_MS;
    win.setOpacity(0);
    const poll = () => {
      if (win.isDestroyed() || !splash.isVisible() || Date.now() > deadline) { resolve(false); return; }
      win.webContents.executeJavaScript('window.__sphereDrawn === true')
        .then((drawn) => { if (drawn) resolve(true); else setTimeout(poll, POLL_MS); }, () => setTimeout(poll, POLL_MS));
    };
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed() || !splash.isVisible()) { resolve(false); return; }  // splash déjà caché : jamais de sphère seule
      win.showInactive();
      poll();
    });
    win.once('closed', () => resolve(false));
  });
  return {
    ready: prepared,
    /** Fait apparaître la sphère ; renvoie faux si le splash est déjà caché (rien n'est montré). */
    show: () => {
      if (win.isDestroyed() || !splash.isVisible()) return false;
      win.showInactive();
      const start = Date.now();
      const step = setInterval(() => {
        if (win.isDestroyed() || !splash.isVisible()) { clearInterval(step); return; }
        const k = Math.min(1, (Date.now() - start) / FADE_MS);
        win.setOpacity(k);
        if (k >= 1) clearInterval(step);
      }, 30);
      return true;
    },
  };
}

module.exports = { createSphere };
