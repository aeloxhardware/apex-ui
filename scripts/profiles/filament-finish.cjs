// Ajoute / met à jour le champ `finish` de chaque profil de public/filaments.json (cf. filamentFinish.cjs).
// Sert quand les profils d'Orca ne sont pas sous la main pour régénérer tout le catalogue ; filaments.cjs applique
// les mêmes règles à la régénération.
//   node scripts/profiles/filament-finish.cjs
const fs = require('node:fs');
const path = require('node:path');
const { finishFor, loadOverrides } = require('./filamentFinish.cjs');

const file = path.resolve(__dirname, '../../public/filaments.json');
const json = JSON.parse(fs.readFileSync(file, 'utf8'));
const overrides = loadOverrides();
const unknownOverrides = new Set(Object.keys(overrides));

const counts = {};
for (const f of json.filaments) {
  unknownOverrides.delete(`${f.vendor}|${f.name}`);
  f.finish = finishFor(f.vendor, f.name, f.type, overrides);
  counts[f.finish ?? 'non renseigné'] = (counts[f.finish ?? 'non renseigné'] ?? 0) + 1;
}
fs.writeFileSync(file, JSON.stringify(json));
console.log(`${json.filaments.length} profils indexés :`, counts);
if (unknownOverrides.size) console.warn('Corrections sans profil correspondant :', [...unknownOverrides]);
