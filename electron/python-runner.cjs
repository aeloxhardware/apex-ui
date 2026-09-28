// Exécution du script de conversion polaire (python/gcode_to_polar.py), partagée par le process
// principal Electron (electron/main.cjs) et le serveur de développement Vite (vite.config.ts).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

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

/**
 * Convertit `request.text` (G-code 3 axes) en G-code polaire Apex.
 * @param request { text, mode: 'polar'|'dynamic', centerX, centerY, source }
 * @param options { script, embeddedPython, onProgress(percent) }
 * @returns { text, summary }
 */
async function convertGCode(request, { script, embeddedPython, onProgress }) {
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
    const stdout = await runPython(
      pythonCandidates(embeddedPython),
      [
        script, input, output,
        '--mode', mode,
        '--center-x', String(centerX),
        '--center-y', String(centerY),
        '--source', typeof source === 'string' ? source.slice(0, 200) : '',
        '--drop-outside-radius', String(dropOutsideRadius),
      ],
      (line) => {
        const match = /^PROGRESS (\d+)$/.exec(line);
        if (match) onProgress?.(Number(match[1]));
        return !!match;
      },
    );
    let summary = null;
    try { summary = JSON.parse(stdout.trim().split(/\r?\n/).pop()); } catch { /* résumé facultatif */ }
    return { text: await fs.promises.readFile(output, 'utf8'), summary };
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { convertGCode };
