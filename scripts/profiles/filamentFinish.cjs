// Aspect (brillance) de chaque profil de filament : champ `finish` du catalogue (public/filaments.json).
//
// Les profils d'Orca Slicer n'ont AUCUN champ de brillance : on l'indexe ici, profil par profil, à partir de
//   1. filament-finish-overrides.json : { "<vendor>|<name>": "<finish>" }, valeurs vérifiées une à une (priorité absolue,
//      c'est là qu'on AJOUTE un profil dont l'aspect est connu mais que les règles ne devinent pas) ;
//   2. les règles ci-dessous, qui ne lisent que le NOM et le TYPE du profil (un mot du nom comme « Matte » ou « Silk »,
//      un renfort comme -CF / -GF). Aucune règle ne devine un aspect pour un nom neutre (« PLA Basic », « PETG »…) :
//      le résultat est alors `null` = aspect non renseigné, jamais une valeur inventée.
//
// Valeurs : 'matte' (mat, sans reflet) · 'satin' (reflet doux) · 'glossy' (brillant, reflet net) ·
//           'silk' (soyeux, reflet large nacré) · 'metallic' (reflets métalliques) · 'sparkle' (paillettes).
//   node scripts/profiles/filament-finish.cjs   : (ré)écrit `finish` dans public/filaments.json
const fs = require('node:fs');
const path = require('node:path');

const FINISHES = ['matte', 'satin', 'glossy', 'silk', 'metallic', 'sparkle'];

// Premier motif qui correspond l'emporte (ordre : le plus spécifique d'abord).
const RULES = [
  ['sparkle', /sparkle|glitter|galaxy/i],
  ['metallic', /\bmetal(lic)?\b|-metal\b/i],
  ['silk', /silk|satin/i],
  ['matte', /\bmatt?e\b|\bmat\b/i],
  // Charges minérales ou fibres : filaments mats.
  ['matte', /\b(carbon|marble|stone|granite|rock|wood)\b/i],
  ['glossy', /translucent|transparent|\bclear\b/i],
];
const FILLED_TYPE = /-(CF|GF|LCF)\b/i;

const OVERRIDES_FILE = path.join(__dirname, 'filament-finish-overrides.json');

function loadOverrides(file = OVERRIDES_FILE) {
  if (!fs.existsSync(file)) return {};
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(j)) {
    if (!FINISHES.includes(value)) throw new Error(`filament-finish-overrides.json : « ${key} » → « ${value} » inconnu`);
  }
  return j;
}

/** Aspect déduit du nom et du type du profil (jamais d'une valeur par défaut) : une valeur de FINISHES, ou null. */
function deriveFinish(name, type) {
  const rule = RULES.find(([, re]) => re.test(name));
  if (rule) return rule[0];
  if (type && FILLED_TYPE.test(type)) return 'matte';
  return null;
}

function finishFor(vendor, name, type, overrides = loadOverrides()) {
  return overrides[`${vendor}|${name}`] ?? deriveFinish(name, type);
}

module.exports = { FINISHES, deriveFinish, finishFor, loadOverrides };
