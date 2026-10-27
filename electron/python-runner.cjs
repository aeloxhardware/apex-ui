// Exécution du script de conversion polaire (python/gcode_to_polar.py), partagée par le process
// principal Electron (electron/main.cjs) et le serveur de développement Vite (vite.config.ts).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

// Interpréteurs en cours d'exécution : arrêtés à la fermeture de l'application (electron/shutdown.cjs).
const running = new Set();
const runningCount = () => running.size;
function stopAll() {
  for (const child of running) { try { child.kill(); } catch { /* déjà terminé */ } }
  running.clear();
}

const CONVERSION_MODES = new Set(['polar', 'dynamic']);

/** Interpréteurs essayés dans l'ordre : Python embarqué s'il existe, puis Python du système. */
function pythonCandidates(embeddedPython) {
  const candidates = [];
  if (embeddedPython && fs.existsSync(embeddedPython)) candidates.push({ command: embeddedPython, args: [] });
  if (process.platform === 'win32') candidates.push({ command: 'py', args: ['-3'] });
  candidates.push({ command: 'python3', args: [] }, { command: 'python', args: [] });
  return candidates;
}

/** Lance le script avec le premier interpréteur disponible ; `onStderrLine` reçoit chaque ligne
 * d'erreur standard et renvoie vrai si elle a été consommée (progression). */
function runPython(candidates, scriptArgs, onStderrLine) {
  return new Promise((resolve, reject) => {
    const attempt = (index) => {
      if (index >= candidates.length) {
        reject(new Error('Aucun interpréteur Python disponible.'));
        return;
      }
      const { command, args } = candidates[index];
      const child = spawn(command, [...args, ...scriptArgs], { shell: false, windowsHide: true });
      running.add(child);
      child.once('close', () => running.delete(child));
      let stdout = '';
      let stderrRest = '';
      const errors = [];
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => {
        const lines = (stderrRest + chunk).split(/\r?\n/);
        stderrRest = lines.pop();
        for (const line of lines) {
          if (!onStderrLine(line)) errors.push(line);
        }
      });
      child.on('error', (err) => {
        if (err.code === 'ENOENT') attempt(index + 1);
        else reject(err);
      });
      child.on('close', (code) => {
        if (code === 0) resolve(stdout);
        // Lanceur `py` sans Python 3, ou alias Microsoft Store sans Python installé : suivant.
        else if (code === 103 || code === 9009) attempt(index + 1);
        else reject(new Error(errors.filter(Boolean).slice(-5).join('\n') || `Python a échoué (code ${code}).`));
      });
    };
    attempt(0);
  });
}

/** Lance le convertisseur natif ; mêmes conventions que `runPython` (progression sur stderr, résumé JSON sur stdout). */
function runExecutable(command, scriptArgs, onStderrLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, scriptArgs, { shell: false, windowsHide: true });
    running.add(child);
    child.once('close', () => running.delete(child));
    let stdout = '';
    let stderrRest = '';
    const errors = [];
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => {
      const lines = (stderrRest + chunk).split(/\r?\n/);
      stderrRest = lines.pop();
      for (const line of lines) if (!onStderrLine(line)) errors.push(line);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(errors.filter(Boolean).slice(-5).join('\n') || `Le convertisseur a échoué (code ${code}).`));
    });
  });
}

/**
 * Convertit `request.text` (G-code 3 axes) en G-code polaire Apex.
 * @param request { text, mode: 'polar'|'dynamic', centerX, centerY, source }
 * @param options { script, embeddedPython, nativeExe, headSamples, onProgress(percent) } — `nativeExe` : convertisseur
 *   C++ (native/src/polar_main.cpp), préféré au script Python quand il existe ; `headSamples` : échantillons du modèle de
 *   tête (float32 x, y, z) pour l'évitement des collisions en mode dynamique.
 * @returns { text, summary }
 */
async function convertGCode(request, { script, embeddedPython, nativeExe, headSamples, onProgress }) {
  const { text, mode, centerX, centerY, source, dropOutsideRadius = 0 } = request ?? {};
  if (
    typeof text !== 'string' || !CONVERSION_MODES.has(mode) || !Number.isFinite(centerX) || !Number.isFinite(centerY)
    || !Number.isFinite(dropOutsideRadius) || dropOutsideRadius < 0
  ) {
    throw new Error('Requête de conversion invalide.');
  }
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'apex-convert-'));
  try {
    const input = path.join(dir, 'input.gcode');
    const output = path.join(dir, 'output.gcode');
    await fs.promises.writeFile(input, text, 'utf8');
    const args = [
      input, output,
      '--mode', mode,
      '--center-x', String(centerX),
      '--center-y', String(centerY),
      '--source', typeof source === 'string' ? source.slice(0, 200) : '',
      '--drop-outside-radius', String(dropOutsideRadius),
    ];
    const onLine = (line) => {
      const match = /^PROGRESS (\d+)$/.exec(line);
      if (match) onProgress?.(Number(match[1]));
      return !!match;
    };
    let stdout;
    if (nativeExe && fs.existsSync(nativeExe)) {
      if (mode === 'dynamic' && headSamples && fs.existsSync(headSamples)) args.push('--head-samples', headSamples);
      stdout = await runExecutable(nativeExe, args, onLine);
    } else {
      stdout = await runPython(pythonCandidates(embeddedPython), [script, ...args], onLine);
    }
    let summary = null;
    try { summary = JSON.parse(stdout.trim().split(/\r?\n/).pop()); } catch { /* résumé facultatif */ }
    return { text: await fs.promises.readFile(output, 'utf8'), summary };
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { convertGCode, runningCount, stopAll };
