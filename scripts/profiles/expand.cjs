// Ajoute au catalogue (profiles/) tous les fabricants et modèles d'Orca Slicer qui n'y sont pas encore.
//   node scripts/profiles/expand.cjs [--dry]
const fs = require('node:fs');
const path = require('node:path');
const { load, flatten } = require('./orca-index.cjs');
const { buildMatcher, norm, VENDORS } = require('./match.cjs');
const { build, root } = require('./generate.cjs');

const DRY = process.argv.includes('--dry');
const safe = (n) => n.replace(/\s*\/\s*/g, ' - ').replace(/[<>:"\|?*]/g, '').replace(/\s+/g, ' ').trim();
const NOZZLE = /\s*\(?\s*\d+(\.\d+)?\s*(mm\s*)?([A-Za-z-]+\s+)?nozzle\b.*$/i;
const SKIP_VENDORS = new Set(['Custom', 'OrcaArena', 'OrcaFilamentLibrary']);

// Nom d'affichage des fabricants déjà présents (clé du catalogue) ; les autres gardent le nom Orca.
const display = {};
for (const [catalogName, v] of Object.entries(VENDORS)) for (const d of v.dirs) display[d] = catalogName;
const prefixWords = (orcaDir) => (VENDORS[display[orcaDir]]?.words ?? []).concat(norm(orcaDir));

// Modèles Creality rangés dans les séries existantes du menu.
function crealitySeries(model) {
  const m = model.replace(/^Creality\s+/, '');
  const base = path.join('Autres fabricants', 'Creality');
  if (/^Ender-3/.test(m)) return path.join(base, 'Série Ender', 'Ender-3');
  if (/^Ender-5/.test(m)) return path.join(base, 'Série Ender', 'Ender-5');
  if (/^Ender-[67]/.test(m)) return path.join(base, 'Série Ender', safe('Ender-6 / Ender-7'));
  if (/^K\d/.test(m) || /^K1|^K2/.test(m)) return path.join(base, 'Série K (CoreXY Haute Vitesse)', 'Modèles K');
  if (/^CR-10/.test(m)) return path.join(base, safe('Série CR (Core / Cartésiennes Grand Format)'), 'CR-10');
  if (/^CR-6/.test(m)) return path.join(base, safe('Série CR (Core / Cartésiennes Grand Format)'), 'CR-6');
  if (/^CR-M4/.test(m)) return path.join(base, safe('Série CR (Core / Cartésiennes Grand Format)'), 'CR-M4');
  return base;
}

const all = load();
const find = buildMatcher();

// Profils Orca déjà couverts par le catalogue actuel.
const used = new Set();
(function walk(dir, trail) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name), [...trail, e.name]);
    else if (e.name.endsWith('.json')) {
      const manu = trail[0] === 'Autres fabricants' ? trail[1] : trail[0];
      const hit = find(manu, e.name.slice(0, -5));
      if (hit) used.add(`${hit.vendorDir}|${stripKey(hit.profile.name)}`);
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, e.name), 'utf8') || 'null');
        if (j?.apex?.orca_source) used.add(`src|${j.apex.orca_source}`);
      } catch { /* vide */ }
    }
  }
})(root, []);
function stripKey(n) { return n.replace(NOZZLE, '').trim(); }

let added = 0, vendors = new Set();
const names = new Set();
for (const [dir, profiles] of Object.entries(all)) {
  if (SKIP_VENDORS.has(dir)) continue;
  const groups = new Map();
  for (const p of Object.values(profiles)) {
    if (p.type !== 'machine' || p.instantiation !== 'true') continue;
    const key = stripKey(p.name);
    const nozzle = parseFloat(String(flatten(profiles, p.name).nozzle_diameter?.[0]));
    const score = nozzle === 0.4 ? 0 : 1;
    if (!groups.has(key) || score < groups.get(key).score) groups.set(key, { score, name: p.name });
  }
  for (const [key, g] of groups) {
    if (used.has(`${dir}|${key}`)) continue;
    const flat = flatten(profiles, g.name);
    const words = prefixWords(dir);
    let model = key;
    for (const w of [dir, display[dir]].filter(Boolean)) {
      if (model.toLowerCase().startsWith(w.toLowerCase() + ' ')) { model = model.slice(w.length + 1); break; }
    }
    const manufacturer = display[dir] ?? dir;
    const folder = manufacturer === 'Creality'
      ? crealitySeries(key)
      : path.join('Autres fabricants', safe(manufacturer));
    const file = path.join(root, folder, safe(model));
    if (fs.existsSync(file + '.json')) continue;
    if (names.has(file.toLowerCase())) continue;
    names.add(file.toLowerCase());
    const orca = { profile: flat, vendorDir: dir };
    const trail = folder.split(path.sep);
    const data = build({ manufacturer, model, trail }, orca);
    added++; vendors.add(manufacturer);
    if (!DRY) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.json', JSON.stringify(data, null, 4) + '\n');
      fs.writeFileSync(file + '.png', '');
    }
  }
}
console.log(`${DRY ? '[essai] ' : ''}ajoutés ${added} modèles, ${vendors.size} fabricants concernés`);
