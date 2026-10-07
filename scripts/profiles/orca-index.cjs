// Index des profils machine d'Orca Slicer (resources/profiles), héritage résolu.
const fs = require('node:fs');
const path = require('node:path');

const ORCA = process.env.ORCA_PROFILES || 'G:/Programmes/OrcaSlicer/resources/profiles';
const BOM = String.fromCharCode(0xfeff);

function load() {
  const byVendor = {};
  for (const vendor of fs.readdirSync(ORCA, { withFileTypes: true })) {
    if (!vendor.isDirectory()) continue;
    const dir = path.join(ORCA, vendor.name, 'machine');
    if (!fs.existsSync(dir)) continue;
    const profiles = {};
    // Les profils peuvent être rangés en sous-dossiers (ex. Elegoo/machine/EN4SERIES).
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) { walk(path.join(d, e.name), `${rel}/${e.name}`); continue; }
        if (!e.name.endsWith('.json')) continue;
        try {
          const text = fs.readFileSync(path.join(d, e.name), 'utf8');
          const j = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text);
          if (j.name) profiles[j.name] = { ...j, __file: `${vendor.name}/${rel}/${e.name}` };
        } catch { /* profil illisible : ignoré */ }
      }
    };
    walk(dir, 'machine');
    byVendor[vendor.name] = profiles;
  }
  return byVendor;
}

/** Profil aplati : parents d'abord, l'enfant écrase. */
function flatten(profiles, name, seen = new Set()) {
  const p = profiles[name];
  if (!p || seen.has(name)) return {};
  seen.add(name);
  const parent = p.inherits ? flatten(profiles, p.inherits, seen) : {};
  return { ...parent, ...p };
}

module.exports = { ORCA, load, flatten };
