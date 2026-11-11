// Catalogue des filaments : extrait des profils filament d'Orca Slicer (resources/profiles/*/filament),
// héritage résolu, dédoublonné par nom (les variantes par imprimante/buse ne diffèrent que par
// `compatible_printers` et quelques débits). Écrit public/filaments.json (lu par FilamentBlock).
//   node scripts/profiles/filaments.cjs
// Source : OrcaSlicer (AGPL-3.0), https://github.com/OrcaSlicer/OrcaSlicer — cf. utils/credits.ts.
const fs = require('node:fs');
const path = require('node:path');
const { ORCA } = require('./orca-index.cjs');
const { finishFor, loadOverrides } = require('./filamentFinish.cjs');

const BOM = String.fromCharCode(0xfeff);
const all = {};
const walk = (dir, vendor) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, vendor); continue; }
    if (!e.name.endsWith('.json')) continue;
    try {
      const t = fs.readFileSync(p, 'utf8');
      const j = JSON.parse(t.startsWith(BOM) ? t.slice(1) : t);
      if (j.name) all[j.name] = { ...j, __vendor: vendor };
    } catch { /* illisible : ignoré */ }
  }
};
for (const v of fs.readdirSync(ORCA, { withFileTypes: true })) {
  const d = path.join(ORCA, v.name, 'filament');
  if (v.isDirectory() && fs.existsSync(d)) walk(d, v.name);
}

const flatten = (name, seen = new Set()) => {
  const p = all[name];
  if (!p || seen.has(name)) return {};
  seen.add(name);
  return { ...(p.inherits ? flatten(p.inherits, seen) : {}), ...p };
};
const first = (v) => (Array.isArray(v) ? v[0] : v);
const num = (v) => { const n = parseFloat(first(v)); return Number.isFinite(n) ? n : null; };

const finishOverrides = loadOverrides();
const byKey = new Map();
for (const name of Object.keys(all)) {
  const raw = all[name];
  if (raw.instantiation === 'false') continue; // modèles de base (fdm_filament_*), pas des filaments
  const f = flatten(name);
  const display = name.replace(/\s*@.*$/, '').trim();
  if (/\s\d+(\.\d+)? nozzle$/.test(display)) continue; // variantes par diamètre de buse
  const key = `${raw.__vendor}|${display}`;
  if (byKey.has(key)) continue;
  byKey.set(key, {
    name: display,
    vendor: raw.__vendor,
    type: first(f.filament_type) ?? null,
    density: num(f.filament_density),
    diameter: num(f.filament_diameter),
    cost: num(f.filament_cost),
    nozzle_temp: num(f.nozzle_temperature),
    nozzle_temp_initial_layer: num(f.nozzle_temperature_initial_layer),
    nozzle_temp_range: [num(f.nozzle_temperature_range_low), num(f.nozzle_temperature_range_high)],
    bed_temp: num(f.hot_plate_temp),
    flow_ratio: num(f.filament_flow_ratio),
    max_volumetric_speed: num(f.filament_max_volumetric_speed),
    color: first(f.default_filament_colour) || null,
    // Brillance : absente des profils Orca, indexée par filamentFinish.cjs (règles sur le nom + corrections vérifiées).
    finish: finishFor(raw.__vendor, display, first(f.filament_type) ?? null, finishOverrides),
    orca_source: name,
  });
}
const list = [...byKey.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name, 'fr', { numeric: true }));
const out = path.resolve(__dirname, '../../public/filaments.json');
fs.writeFileSync(out, JSON.stringify({ source: 'OrcaSlicer (AGPL-3.0) — https://github.com/OrcaSlicer/OrcaSlicer', filaments: list }));
console.log(`${list.length} filaments (${(fs.statSync(out).size / 1024).toFixed(0)} Ko) → public/filaments.json`);
