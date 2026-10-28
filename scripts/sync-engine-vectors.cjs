// Vecteurs de test de la cinématique pivot/pointe (R-008, apex/integration/RULES.md §6) : le moteur les génère
// (`scripts/gen_kinematics_vectors.py`), l'interface les copie et les rejoue.
//   node scripts/sync-engine-vectors.cjs            copie le fichier du moteur dans src/generated/
//   node scripts/sync-engine-vectors.cjs --check    échoue si la copie est en retard sur le moteur
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(process.env.APEX_ENGINE_DIR || path.join(root, '..', 'slicer_engine'), 'tests', 'vectors', 'kinematics_vectors.json');
const copy = path.join(root, 'src', 'generated', 'kinematics_vectors.json');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const fail = (msg) => { console.error(`sync-engine-vectors : ${msg}`); process.exit(1); };

if (!fs.existsSync(source)) fail(`fichier du moteur introuvable : ${source} (variable APEX_ENGINE_DIR)`);
if (process.argv.includes('--check')) {
  if (!fs.existsSync(copy) || read(copy) !== read(source)) fail('la copie est en retard sur le moteur : relancer sans --check');
  console.log('vecteurs de cinématique à jour');
} else {
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.writeFileSync(copy, read(source));
  console.log(`vecteurs copiés : ${path.relative(root, copy)}`);
}
