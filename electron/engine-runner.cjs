// Appel du moteur de tranchage (contrat C2/C3, apex/integration/RULES.md §5) : sous-processus
// `<moteur> slice --request <requete.json>` et `<moteur> steps`. Le moteur n'est jamais lié dans
// Electron ; on échange des fichiers et des lignes de texte. Progression = lignes JSON de la sortie
// d'erreur du moteur, rien d'autre (jamais de minuterie). Résultat = dernière ligne de la sortie standard.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');

/** Dossier du moteur : APEX_ENGINE_DIR, sinon le dépôt voisin `slicer_engine` (développement). */
function engineDir() {
  return process.env.APEX_ENGINE_DIR || path.join(__dirname, '..', '..', 'slicer_engine');
}

/**
 * Commande du moteur. Aujourd'hui `python main.py` (environnement `.venv` du moteur s'il existe) ;
 * dans une version publiée ce sera un exécutable natif sans Python (RULES §5.1) : seul cet endroit changera.
 */
function engineCommand(packagedExe) {
  if (packagedExe && fs.existsSync(packagedExe)) return { command: packagedExe, args: [], cwd: path.dirname(packagedExe) };
  const dir = engineDir();
  const venv = process.platform === 'win32'
    ? path.join(dir, '.venv', 'Scripts', 'python.exe')
    : path.join(dir, '.venv', 'bin', 'python');
  if (!fs.existsSync(path.join(dir, 'main.py'))) {
    throw new Error(`Moteur de tranchage introuvable : ${dir} (variable APEX_ENGINE_DIR).`);
  }
  return { command: fs.existsSync(venv) ? venv : 'python', args: ['main.py'], cwd: dir };
}

/**
 * Dossier du module natif `apex_core` : APEX_ENGINE_CPP_LIB, sinon la construction locale du moteur
 * (`cpp/build_dev/lib`, ignorée par git, qui suit le code), sinon `cpp/lib`. Le moteur retombe sinon en
 * silence sur Python (très lent, et pas le chemin mesuré) : voir `requireNative`.
 */
function nativeLibDir(dir) {
  const candidates = [process.env.APEX_ENGINE_CPP_LIB, path.join(dir, 'cpp', 'build_dev', 'lib'), path.join(dir, 'cpp', 'lib')];
  return candidates.find((c) => c && fs.existsSync(c) && fs.readdirSync(c).some((f) => /^apex_core.*\.(pyd|so)$/.test(f))) ?? null;
}

/** Le moteur est toujours lancé avec son noyau C++ (décision de l'utilisateur, 2026-10-27). */
function childEnv(cwd) {
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', APEX_USE_CPP: '1' };
  const lib = cwd ? nativeLibDir(cwd) : null;
  if (lib) env.APEX_CPP_LIB_DIR = lib;
  return env;
}

let nativeChecked = null;

/**
 * Vérifie une fois que le noyau natif est bien chargé ET activé dans le moteur. Sans cela, le moteur
 * tranche en Python sans le dire : on refuse plutôt que de produire un résultat par un autre chemin.
 */
function requireNative({ command, args, cwd }) {
  if (nativeChecked) return nativeChecked;
  nativeChecked = new Promise((resolve, reject) => {
    const code = "import sys; sys.path.insert(0, '.'); from core import _cpp; print('NATIVE' if _cpp.enabled() else 'OFF:' + str(_cpp.load_error()))";
    const py = args.length ? [command, ['-c', code]] : null;  // exécutable natif livré : le noyau y est intégré
    if (!py) return resolve(true);
    execFile(py[0], py[1], { cwd, env: childEnv(cwd), windowsHide: true }, (err, stdout, stderr) => {
      const out = String(stdout).trim();
      if (!err && out === 'NATIVE') return resolve(true);
      nativeChecked = null;  // on réessaie au prochain tranchage (le module a pu être construit entre-temps)
      reject(new Error(`Noyau C++ du moteur indisponible (${out || err?.message || String(stderr).trim().slice(-200)}). `
        + 'Construire : python scripts/build_cpp.py --dev dans le dépôt du moteur.'));
    });
  });
  return nativeChecked;
}

/** Arrête le processus et ses enfants (TetGen tourne dans un sous-processus). */
function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try { child.kill('SIGKILL'); } catch { /* déjà terminé */ }
  }
}

/** Liste des étapes du chemin par défaut (C3) : `{ contract, steps: [{ slug, label }] }`. */
function listSteps(packagedExe) {
  const { command, args, cwd } = engineCommand(packagedExe);
  return new Promise((resolve, reject) => {
    execFile(command, [...args, 'steps'], { cwd, env: childEnv(cwd), windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return reject(new Error(`Le moteur n'a pas pu lister ses étapes : ${err.message}`));
      try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).pop())); } catch { reject(new Error('Liste des étapes illisible.')); }
    });
  });
}

let current = null;

function cancelSlice() {
  if (!current) return false;
  current.cancelled = true;
  killTree(current.child);
  return true;
}

/**
 * Tranche un maillage.
 * @param request { contract, stl: Uint8Array, params?, gcode_params?, name? }
 * @param options { packagedExe, onEvent(event) }  `onEvent` reçoit les lignes {type:'step'|'log',…} du moteur.
 * @returns { result, gcodeText }  `result` : objet résultat du moteur (status 'ok' ou refus/erreur typés).
 */
async function runSlice(request, { packagedExe, onEvent }) {
  if (current) throw new Error('Un tranchage est déjà en cours.');
  const { contract, stl, params, gcode_params: gcodeParams, name } = request ?? {};
  if (!Number.isInteger(contract) || !(stl instanceof Uint8Array) || stl.byteLength === 0) {
    throw new Error('Requête de tranchage invalide.');
  }
  const engine = engineCommand(packagedExe);
  const { command, args, cwd } = engine;
  await requireNative(engine);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'apex-slice-'));
  const state = { child: null, cancelled: false };
  current = state;
  try {
    const mesh = path.join(dir, 'plateau.stl');
    await fs.promises.writeFile(mesh, stl);
    const requestFile = path.join(dir, 'requete.json');
    const outName = (typeof name === 'string' && /^[\w .()-]+\.gcode$/i.test(name)) ? name : 'plateau.gcode';
    await fs.promises.writeFile(requestFile, JSON.stringify({
      contract, mesh, output_dir: dir, output_name: outName,
      params: params ?? {}, gcode_params: gcodeParams ?? {},
    }), 'utf8');

    const { stdout, code, tail } = await new Promise((resolve, reject) => {
      // stdin fermé : le moteur n'a rien à demander (exécution entièrement automatique).
      const child = spawn(command, [...args, 'slice', '--request', requestFile], {
        cwd, env: childEnv(cwd), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      state.child = child;
      let out = '';
      let rest = '';
      const tailLines = [];
      child.stdout.setEncoding('utf8').on('data', (chunk) => { out += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk) => {
        const lines = (rest + chunk).split(/\r?\n/);
        rest = lines.pop();
        for (const line of lines) {
          if (!line) continue;
          let event = null;
          if (line.startsWith('{')) { try { event = JSON.parse(line); } catch { /* journal libre */ } }
          if (event && (event.type === 'step' || event.type === 'log')) onEvent?.(event);
          else { tailLines.push(line); if (tailLines.length > 20) tailLines.shift(); }
        }
      });
      child.on('error', reject);
      child.on('close', (exit) => resolve({ stdout: out, code: exit, tail: tailLines }));
    });

    if (state.cancelled) return { result: { status: 'cancelled', message: 'Tranchage annulé.' }, gcodeText: null };
    let result = null;
    try { result = JSON.parse(stdout.trim().split(/\r?\n/).pop()); } catch { /* plantage sans résultat */ }
    if (!result) {
      result = { status: 'error', message: `Le moteur s'est arrêté sans résultat (code ${code}).`, log: tail.join('\n') };
    }
    result.exit_code = code;
    let gcodeText = null;
    if (result.status === 'ok' && result.gcode) gcodeText = await fs.promises.readFile(result.gcode, 'utf8');
    return { result, gcodeText };
  } finally {
    current = null;
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { runSlice, cancelSlice, listSteps };
