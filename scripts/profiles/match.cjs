// Appariement imprimante du catalogue (profiles/) -> profil machine Orca.
const fs = require('node:fs');
const path = require('node:path');
const { load, flatten } = require('./orca-index.cjs');

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+]/g, '');
const stripNozzle = (n) => n.replace(/\s*\(?\s*\d+(\.\d+)?\s*(mm\s*)?nozzle\s*\)?\s*$/i, '').trim();

// Dossier fabricant du catalogue -> dossier(s) Orca + mots de préfixe à ignorer
const VENDORS = {
  'Anycubic': { dirs: ['Anycubic'], words: ['anycubic'] },
  'Artillery 3D': { dirs: ['Artillery'], words: ['artillery'] },
  'Bambu Lab': { dirs: ['BBL'], words: ['bambulab', 'bambu'] },
  'Creality': { dirs: ['Creality'], words: ['creality'] },
  'Dagoma': { dirs: [], words: ['dagoma'] },
  'Elegoo': { dirs: ['Elegoo'], words: ['elegoo'] },
  'Flashforge': { dirs: ['Flashforge'], words: ['flashforge'] },
  'FLSUN': { dirs: ['FLSun'], words: ['flsun'] },
  'Prusa Research': { dirs: ['Prusa'], words: ['prusa', 'originalprusa'] },
  'QIDI Tech': { dirs: ['Qidi'], words: ['qidi', 'qiditech'] },
  'Raise3D': { dirs: ['Raise3D'], words: ['raise3d'] },
  'Snapmaker': { dirs: ['Snapmaker'], words: ['snapmaker'] },
  'Sovol 3D': { dirs: ['Sovol'], words: ['sovol'] },
  'UltiMaker': { dirs: ['UltiMaker'], words: ['ultimaker'] },
  'Volumic 3D': { dirs: ['Volumic'], words: ['volumic'] },
  'Phrozen': { dirs: ['Phrozen'], words: ['phrozen'] },
};

// Même machine sous un autre nom (nom du catalogue -> nom Orca, sans buse). Uniquement des identités
// certaines : une variante proche mais différente (Ender-3 Neo vs V2 Neo, Guider 3 vs 3 Ultra...) n'en est pas une.
const ALIASES = {
  'Anycubic|Kobra 3 Combo': 'Anycubic Kobra 3',
  'Bambu Lab|X1E Enterprise': 'Bambu Lab X1E',
  'Creality|Ender-5 Pro': 'Creality Ender-5 Pro (2019)',
  'Prusa Research|Original Prusa MINI+': 'Prusa MINI',
  'QIDI Tech|QIDI Max 3': 'Qidi X-Max 3',
  'QIDI Tech|QIDI Plus 3': 'Qidi X-Plus 3',
  'Raise3D|Pro3': 'Raise3D Pro3 0.4 nozzle (Dual)',
  'Raise3D|Pro3 Plus': 'Raise3D Pro3 Plus 0.4 nozzle (Dual)',
  'Snapmaker|Artisan 3-in-1': 'Snapmaker Artisan',
};

function stripWords(n, words) {
  for (const w of words) if (n.startsWith(w)) return n.slice(w.length);
  return n;
}

function buildMatcher() {
  const all = load();
  const cache = new Map();
  return function find(manufacturer, model) {
    const v = VENDORS[manufacturer];
    if (!v) return null;
    const wanted = stripWords(norm(model), v.words);
    let best = null;
    const alias = ALIASES[`${manufacturer}|${model}`];
    if (alias) {
      for (const dir of v.dirs) {
        const profiles = all[dir] || {};
        if (profiles[alias]) return { score: 0, vendorDir: dir, profile: flatten(profiles, alias), profiles, alias: true };
        const hit = Object.values(profiles).find((p) => p.type === 'machine' && p.instantiation === 'true' && stripNozzle(p.name) === alias);
        if (hit) return { score: 0, vendorDir: dir, profile: flatten(profiles, hit.name), profiles, alias: true };
      }
    }
    for (const dir of v.dirs) {
      const profiles = all[dir] || {};
      for (const p of Object.values(profiles)) {
        if (p.type !== 'machine' || p.instantiation !== 'true') continue;
        const m = stripWords(norm(stripNozzle(p.name)), v.words);
        if (m !== wanted) continue;
        const flat = flatten(profiles, p.name);
        const nozzle = parseFloat(String(flat.nozzle_diameter).replace(/[^\d.]/g, '')) || 0;
        const score = nozzle === 0.4 ? 0 : 1;
        if (!best || score < best.score) best = { score, vendorDir: dir, profile: flat, profiles };
      }
    }
    return best;
  };
}

module.exports = { buildMatcher, norm, stripNozzle, VENDORS };

if (require.main === module) {
  const find = buildMatcher();
  const root = path.resolve(__dirname, '../../profiles');
  let ok = 0, ko = [];
  (function walk(dir, trail) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), [...trail, e.name]);
      else if (e.name.endsWith('.json')) {
        const model = e.name.slice(0, -5);
        const manu = trail[0] === 'Autres fabricants' ? trail[1] : trail[0];
        const r = find(manu, model);
        if (r) ok++; else ko.push(`${manu} / ${model}`);
      }
    }
  })(root, []);
  console.log('appariés', ok, 'sans correspondance', ko.length);
  console.log(ko.join('\n'));
}
