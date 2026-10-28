// Rejoue les vecteurs du moteur (src/generated/kinematics_vectors.json, R-008) contre le code de l'interface :
// `nozzleTip` de l'aperçu (src/utils/kinematics.ts) et son inverse. Le noyau natif rejoue les mêmes vecteurs
// dans `native/tests/test_kinematics_vectors.cpp` (node native/build.cjs --test).
//   node scripts/check-kinematics-vectors.cjs
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const doc = JSON.parse(fs.readFileSync(path.join(root, 'src', 'generated', 'kinematics_vectors.json'), 'utf8'));
if (doc.format !== 'apex-kinematics-vectors-1') { console.error(`format de vecteurs inconnu : ${doc.format}`); process.exit(1); }

// kinematics.ts n'importe rien : une simple transpilation suffit, c'est le code que l'application exécute.
const source = fs.readFileSync(path.join(root, 'src', 'utils', 'kinematics.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', js)(mod, mod.exports);
const { tipFromFirmware, isPreviewSupported, parseKinematicsHeader } = mod.exports;

const tol = doc.tolerance_mm;
const rad = Math.PI / 180;
let checked = 0, unsupported = 0, failures = 0;
const out = { r: 0, z: 0 };
for (const [i, v] of doc.vectors.entries()) {
  const k = { pivotToTip: v.pivot_to_tip, bSign: v.b_sign, tiltSign: v.tilt_sign, zReference: v.z_reference };
  // La pointe depuis le firmware : X = R du pivot, Z, B du fichier. Sens inverse du moteur ; au centre Y est hérité.
  tipFromFirmware(k, v.firmware.X, v.firmware.Z, v.firmware.B * rad, out);
  const expectR = Math.hypot(v.tip[0], v.tip[1]);
  const okR = v.inverse_exact ? Math.abs(out.r - expectR) <= tol : true;
  const okZ = Math.abs(out.z - v.tip[2]) <= tol;
  checked++;
  if (!okR || !okZ) {
    failures++;
    console.error(`vecteur ${i} : pointe (${out.r.toFixed(9)}, ${out.z.toFixed(9)}) attendue (${expectR.toFixed(9)}, ${v.tip[2]})`);
  }
  // L'aperçu et le noyau d'édition ne représentent que la configuration par défaut : les autres sont refusées au chargement.
  if (!isPreviewSupported(k)) unsupported++;
}

// Ligne d'en-tête : lecture exacte, refus d'une ligne illisible.
const header = (s) => parseKinematicsHeader(`; apex_sliced = 1\n${s}\nG1 X1 Y0 Z0 B0 F100\n`);
const a = header('; apex_kinematics pivot_to_tip=46 b_sign=1 tilt_sign=1 z_reference=tip');
const assert = (cond, msg) => { checked++; if (!cond) { failures++; console.error(msg); } };
assert(a && a.pivotToTip === 46 && a.bSign === 1 && a.tiltSign === 1 && a.zReference === 'tip', 'en-tête valide mal lu');
assert(header('; autre ligne') === null, 'sans la ligne, la cinématique doit être absente');
assert(parseKinematicsHeader('G1 X1 Y0 Z0 B0\n; apex_kinematics pivot_to_tip=46 b_sign=1 tilt_sign=1 z_reference=tip\n') === null, 'la ligne après le premier mouvement ne compte pas');
let threw = false;
try { header('; apex_kinematics pivot_to_tip=abc b_sign=1 tilt_sign=1 z_reference=tip'); } catch { threw = true; }
assert(threw, 'une ligne illisible doit lever une erreur');

console.log(`${checked} contrôles, ${failures} échec(s) ; ${unsupported} vecteur(s) hors configuration par défaut (refusés au chargement)`);
process.exit(failures ? 1 : 0);
