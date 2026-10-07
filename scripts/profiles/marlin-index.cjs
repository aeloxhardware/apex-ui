// Index des configurations d'exemple de Marlin (MarlinFirmware/Configurations) : carte, drivers, sonde.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.MARLIN_CONFIGS; // .../repo/config/examples

const PROBES = [
  ['BLTOUCH', 'BLTouch'], ['TOUCH_MI_PROBE', 'Touch-MI'], ['SOLENOID_PROBE', 'Sonde à solénoïde'],
  ['Z_PROBE_SLED', 'Sonde sur chariot'], ['RACK_AND_PINION_PROBE', 'Sonde à crémaillère'],
  ['PROBE_MANUALLY', 'Manuel (feuille de papier)'], ['NOZZLE_AS_PROBE', 'Buse'],
  ['FIX_MOUNTED_PROBE', 'Sonde fixe (inductive/capacitive)'], ['Z_MIN_PROBE_USES_Z_MIN_ENDSTOP_PIN', 'Sonde sur la broche Z-min'],
];

const WS = String.fromCharCode(92) + 's'; // "\s", sans dépendre de l'échappement du shell
const defined = (text, name) => new RegExp(`^${WS}*#define${WS}+${name}(?![A-Za-z0-9_])`, 'm').test(text);
const value = (text, name) => (text.match(new RegExp(`^${WS}*#define${WS}+${name}${WS}+([^${WS}/]+)`, 'm')) || [])[1] || null;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name === 'Configuration.h') out.push(full);
  }
}

function load() {
  if (!ROOT) throw new Error('MARLIN_CONFIGS non défini');
  const files = [];
  walk(ROOT, files);
  return files.map((f) => {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, path.dirname(f)).split(path.sep);
    const probe = PROBES.find(([k]) => defined(text, k));
    return {
      path: rel.join('/'),
      vendor: rel[0],
      motherboard: value(text, 'MOTHERBOARD')?.replace(/^BOARD_/, '') ?? null,
      drivers: Object.fromEntries(['X', 'Y', 'Z', 'E0'].map((a) => [a === 'E0' ? 'E' : a, value(text, `${a}_DRIVER_TYPE`)])),
      probe: probe ? probe[1] : null,
      source: `https://github.com/MarlinFirmware/Configurations/tree/import-2.1.x/config/examples/${rel.map(encodeURIComponent).join('/')}`,
    };
  });
}

module.exports = { load };
