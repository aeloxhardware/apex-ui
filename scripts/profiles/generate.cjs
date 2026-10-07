// Remplit profiles/**/*.json depuis les profils machine d'Orca Slicer (héritage résolu) + un bloc
// `apex` pour ce qu'Orca ne connaît pas. N'écrase jamais un fichier non vide sans --force.
//   node scripts/profiles/generate.cjs [--force]
const fs = require('node:fs');
const path = require('node:path');
const { buildMatcher } = require('./match.cjs');

const FORCE = process.argv.includes('--force');
const root = path.resolve(__dirname, '../../profiles');
const find = buildMatcher();

const DROP = new Set(['__file', 'type', 'instantiation', 'setting_id']);

/** Données propres à Apex que seul le catalogue (ou le constructeur) peut fournir : null = inconnu. */
function apexBlock({ manufacturer, model, trail, orca }) {
  const nozzle = orca ? parseFloat(String(orca.profile.nozzle_diameter?.[0] ?? orca.profile.nozzle_diameter)) : null;
  return {
    generated: true,
    manufacturer,
    model,
    catalog_path: trail.join('/'),
    orca_source: orca ? orca.profile.__file : null,
    axes_count: orca ? 3 : null,
    kinematics: orca ? ['X', 'Y', 'Z'] : null,
    kinematics_preview: { type: orca?.profile.printer_structure && orca.profile.printer_structure !== 'undefine' ? orca.profile.printer_structure : null, image: null },
    motherboard: null,
    motors: { X: null, Y: null, Z: null, E: null },
    drivers: { X: null, Y: null, Z: null, E: null },
    default_nozzle_profile: orca ? { diameter_mm: Number.isFinite(nozzle) ? nozzle : null, profile_id: null } : null,
    auto_leveling: { tool: null },
    ...(orca ? { nonplanar: { max_angle_deg: null, max_distance_mm: null } } : {}),
  };
}

/** Aetheris-4 : données de l'ancienne fiche codée en dur + limites du profil machine du moteur. */
function aetheris() {
  return {
    name: 'Aetheris-4',
    printer_model: 'Aetheris-4',
    printer_technology: 'FFF',
    printer_structure: 'polar',
    gcode_flavor: 'reprapfirmware',
    printable_height: '140',
    apex: {
      generated: true,
      manufacturer: 'Aelox Hardware',
      model: 'Aetheris-4',
      catalog_path: 'Aelox Hardware',
      orca_source: null,
      support_4_axes: true,
      multicolor: false,
      bed_shape: 'circular',
      kinematics_label: 'Polaire à plan de fabrication dynamique',
      build_volume_label: '250 (R) × 140 (H) mm',
      max_nozzle_temp_c: 280,
      max_bed_temp_c: 80,
      max_print_speed_mm_s: 150,
      auto_leveling: { tool: null, available: true },
      connectivity: ['Wi-Fi', 'SD'],
      enclosed_chamber: false,
      axes_count: 4,
      kinematics: ['R', 'C', 'Z', 'B'],
      kinematics_preview: { type: 'polar', image: null },
      pivot_distance_mm: { B: 46 },
      rotary_axes: [
        { axis: 'B', role: 'head_tilt', range_deg: [0, 185], max_speed_deg_s: 1666.7, max_acceleration_deg_s2: 1300, mass_kg: null, size_mm: null },
        { axis: 'C', role: 'bed_rotation', range_deg: null, max_speed_deg_s: null, max_acceleration_deg_s2: null, mass_kg: null, size_mm: null },
      ],
      motherboard: null,
      motors: { R: null, C: null, Z: null, B: null, E: null },
      drivers: { R: null, C: null, Z: null, B: null, E: null },
      default_nozzle_profile: { diameter_mm: null, profile_id: null },
    },
  };
}

function build(ctx, forcedOrca) {
  if (ctx.manufacturer === 'Aelox Hardware') return aetheris();
  const orca = forcedOrca ?? find(ctx.manufacturer, ctx.model);
  const out = {};
  if (orca) {
    for (const k of Object.keys(orca.profile).sort()) {
      if (!DROP.has(k)) out[k] = orca.profile[k];
    }
    out.inherits = '';
    out.name = orca.profile.name;
  } else {
    out.name = ctx.model;
    out.printer_model = ctx.model;
  }
  out.apex = apexBlock({ ...ctx, orca });
  return out;
}

module.exports = { build, root };
if (require.main !== module) return;

let written = 0, skipped = 0, fromOrca = 0;
(function walk(dir, trail) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, [...trail, e.name]); continue; }
    if (!e.name.endsWith('.json')) continue;
    if (!FORCE && fs.statSync(full).size > 0) { skipped++; continue; }
    const model = e.name.slice(0, -5);
    const manufacturer = trail[0] === 'Autres fabricants' ? trail[1] : trail[0];
    const data = build({ manufacturer, model, trail });
    if (data.apex.orca_source) fromOrca++;
    fs.writeFileSync(full, JSON.stringify(data, null, 4) + '\n');
    written++;
  }
})(root, []);
console.log(`écrits ${written} (dont ${fromOrca} depuis Orca), ignorés ${skipped}`);
