'use strict';
// Contrôle de photosensibilité (WCAG 2.3.1) des animations à éclairs d'Apex : fond de l'Accueil
// (src/components/digitalStorm.frag) et sphère de l'écran de démarrage (electron/splash-sphere.html).
// Chaque shader est rendu image par image à 60 i/s, en temps fixe, dans une fenêtre Electron cachée ; les images
// passent par src/utils/photosensitivity.ts, et le contrôle échoue au-delà de 3 flashs dans une seconde quelconque.
//
//   pnpm check:photosensitivity                     les deux animations, 20 s chacune
//   pnpm check:photosensitivity -- --seconds=60     plus long
//   pnpm check:photosensitivity -- --home=autre.frag --splash=autre.html   variantes à comparer
//
// Il faut un GPU ou le rendu logiciel de Chromium (SwiftShader) ; hors CI pour l'instant.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const FPS = 60;
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const SECONDS = Number(arg('seconds', '20'));

const HARNESS = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><canvas id="c"></canvas><script>
let gl, prog, w, h;
window.init = (vert, frag, width, height) => {
  const c = document.getElementById('c');
  w = c.width = width; h = c.height = height;
  gl = c.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderInfoLog(s) || ''; };
  prog = gl.createProgram();
  const errors = [];
  for (const [type, src] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) errors.push(gl.getShaderInfoLog(s));
    gl.attachShader(prog, s);
  }
  gl.bindAttribLocation(prog, 0, 'aPosition');
  gl.bindAttribLocation(prog, 0, 'a');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) errors.push(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, w, h);
  return errors.join('\\n');
};
window.frame = (t) => {
  const u = (name) => gl.getUniformLocation(prog, name);
  if (u('uRes')) gl.uniform2f(u('uRes'), w, h);
  gl.uniform1f(u('uTime'), t);
  gl.uniform1f(u('uPower'), 1);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
};
</script>`;

const HOME_VERT = 'attribute vec2 aPosition; void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }';

/** Fond de l'Accueil : plein écran, rendu en 640 x 360 ; seuil = 25 % du champ de 10° rapporté à l'écran. */
function homeTarget(photo) {
  const frag = fs.readFileSync(path.resolve(ROOT, arg('home', 'src/components/digitalStorm.frag')), 'utf8');
  const width = 640;
  const height = 360;
  return { name: 'Accueil (orage numérique)', vert: HOME_VERT, frag, width, height, areaPx: photo.FLASH_AREA_FRACTION * width * height };
}

/** Sphère du splash : fenêtre de 500 px à taille réelle ; seuil absolu, celui d'un écran de 1024 x 768 (le pire cas). */
function splashTarget(photo) {
  const html = fs.readFileSync(path.resolve(ROOT, arg('splash', 'electron/splash-sphere.html')), 'utf8');
  const literal = (name) => {
    const m = new RegExp(`var ${name} = ("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`[^\`]*\`)`).exec(html);
    if (!m) throw new Error(`${name} introuvable dans splash-sphere.html`);
    return new Function(`return ${m[1]}`)(); // texte du dépôt, pas une entrée extérieure
  };
  const extent = /var EXTENT = ([\d.]+)/.exec(html);
  const vert = literal('VERT').replace('${EXTENT}', Number(extent ? extent[1] : 2.6).toFixed(3));
  return {
    name: 'Écran de démarrage (sphère)',
    vert,
    frag: literal('FRAG'),
    width: 500,
    height: 500,
    areaPx: photo.FLASH_AREA_FRACTION * 1024 * 768,
  };
}

async function measure(win, target, photo) {
  const errors = await win.webContents.executeJavaScript(
    `init(${JSON.stringify(target.vert)}, ${JSON.stringify(target.frag)}, ${target.width}, ${target.height})`,
  );
  if (errors) throw new Error(`${target.name} : le shader ne compile pas\n${errors}`);
  const meter = new photo.FlashMeter(target.width * target.height, target.areaPx, FPS);
  for (let i = 0; i < SECONDS * FPS; i++) meter.push(await win.webContents.executeJavaScript(`frame(${i / FPS})`));
  return meter.report();
}

async function main() {
  const photo = await import(pathToFileURL(path.join(ROOT, 'src/utils/photosensitivity.ts')).href);
  const win = new BrowserWindow({ width: 640, height: 500, show: false });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HARNESS)}`);
  let ok = true;
  for (const target of [homeTarget(photo), splashTarget(photo)]) {
    const r = await measure(win, target, photo);
    ok = ok && r.passes;
    console.log(
      `${r.passes ? 'OK   ' : 'ÉCHEC'} ${target.name} : ${r.maxFlashesPerSecond} flash(s)/s au pire ` +
        `(${r.maxTransitionsPerSecond} transitions, à ${r.worstAt.toFixed(2)} s ; limite 3), ` +
        `rouge saturé ${r.maxRedArea} px (seuil ${Math.round(r.areaPx)} px), ${r.frames} images`,
    );
  }
  return ok;
}

app.whenReady().then(() =>
  main().then(
    (ok) => app.exit(ok ? 0 : 1),
    (error) => {
      console.error(error);
      app.exit(2);
    },
  ),
);
