// Processus principal du banc (lance par launch.cjs). Utilise le VRAI processus utilitaire de
// l'application (electron/edit-process.cjs) et le meme motif de remise du MessagePort a la page.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, MessageChannelMain, utilityProcess } = require('electron');

const root = path.resolve(__dirname, '..', '..');
const addonPath = path.join(root, 'native', 'build', 'apex_edit.node');
const gcodePath = process.argv[process.argv.length - 1];

// Lecteur minimal G0/G1 (X = R, Y = C, Z, B, E absolu, G92 E), comme native/tests/bench_kernel.cpp.
function readGCode(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const r = [], c = [], z = [], b = [], ext = [];
  let R = 0, C = 0, Z = 0, B = 0, E = 0;
  for (const raw of lines) {
    const line = raw.split(';', 1)[0].trim();
    const m = /^G(\d+)/.exec(line);
    if (!m) continue;
    const code = Number(m[1]);
    if (code !== 0 && code !== 1 && code !== 92) continue;
    let pos = false, hasE = false, e = 0;
    for (const w of line.matchAll(/([XYZBE])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g)) {
      const v = Number(w[2]);
      if (w[1] === 'X') { R = v; pos = true; }
      else if (w[1] === 'Y') { C = v; pos = true; }
      else if (w[1] === 'Z') { Z = v; pos = true; }
      else if (w[1] === 'B') { B = v; pos = true; }
      else { e = v; hasE = true; }
    }
    if (code === 92) { if (hasE) E = e; continue; }
    if (pos) {
      r.push(R); c.push(C); z.push(Z); b.push(B);
      ext.push(hasE && e > E + 1e-12 ? 1 : 0);
    }
    if (hasE) E = e;
  }
  return {
    r: Float64Array.from(r), c: Float64Array.from(c), z: Float64Array.from(z), b: Float64Array.from(b),
    extruding: Uint8Array.from(ext),
  };
}

app.whenReady().then(() => {
  const t0 = Date.now();
  const moves = readGCode(gcodePath);
  console.log(`[banc] ${path.basename(gcodePath)} : ${moves.r.length} points lus en ${Date.now() - t0} ms`);

  const child = utilityProcess.fork(path.join(root, 'electron', 'edit-process.cjs'), [addonPath], { stdio: 'inherit' });
  const { port1, port2 } = new MessageChannelMain();
  child.postMessage({ type: 'port' }, [port1]);

  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'bench-preload.cjs'), backgroundThrottling: false },
  });
  win.webContents.on('console-message', (details) => {
    const text = details.message;
    if (!text.startsWith('[banc]')) return;
    console.log(text);
    if (text.includes('[banc] FIN')) app.quit();
  });
  win.loadFile(path.join(__dirname, 'bench.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.postMessage('bench-data', moves);
    win.webContents.postMessage('edit-port', null, [port2]);
  });

  setTimeout(() => {
    console.log('[banc] delai depasse');
    app.exit(2);
  }, 300000);
});
