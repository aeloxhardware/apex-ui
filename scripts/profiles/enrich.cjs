// Complète le bloc `apex` des profils (carte mère, drivers, moteurs, auto-niveau) depuis des sources
// publiques : configurations d'exemple Marlin et configurations d'origine de Klipper. Une valeur absente
// des sources reste « Inconnu » ; « Propriétaire » seulement pour une électronique non documentée du fabricant.
//   MARLIN_CONFIGS=.../config/examples KLIPPER_CONFIGS=.../config node scripts/profiles/enrich.cjs
const fs = require('node:fs');
const path = require('node:path');
const { norm } = require('./match.cjs');
const marlin = require('./marlin-index.cjs').load();

const KLIPPER = process.env.KLIPPER_CONFIGS;
const root = path.resolve(__dirname, '../../profiles');
const UNKNOWN = 'Inconnu';
const PROPRIETARY = 'Propriétaire';
const UI_VARIANTS = /^(CrealityUI|MarlinUI|ProUI|CrealityUI|BTT_TFT|TFT|LCD|noprobe|bltouch)$/i;
const MARLIN_URL = 'https://github.com/MarlinFirmware/Configurations/tree/import-2.1.x/config/examples/';
const KLIPPER_URL = 'https://github.com/Klipper3d/klipper/blob/master/config/';

const BUS_DRIVERS = /^TMC(2130|2160|2208|2209|2240|2660|5130|5160)$/;
const DRIVER_NAMES = (d) => (d ? d.replace(/_STANDALONE$/, ' (standalone)').replace(BUS_DRIVERS, '$& (UART/SPI)') : null);
const pretty = (b) => b.replace(/_/g, ' ');

// --- Marlin : un modèle = vendeur + 1er dossier ; variantes = sous-dossiers (cartes), hors variantes d'interface.
const marlinModels = new Map();
for (const e of marlin) {
  const seg = e.path.split('/').filter((s) => s !== 'delta');
  if (seg.length < 2) continue;
  const key = norm(seg[0] + seg[1]);
  const rest = seg.slice(2).filter((s) => !UI_VARIANTS.test(s));
  if (!marlinModels.has(key)) marlinModels.set(key, []);
  marlinModels.get(key).push({ ...e, board: rest[0] ?? null });
}
function marlinFor(key, vendorStockHint) {
  const list = marlinModels.get(key);
  if (!list) return null;
  const boards = new Map();
  for (const e of list) boards.set(e.motherboard, e);
  if (boards.size === 1) return [...boards.values()][0];
  // Plusieurs cartes proposées : on ne retient que celle portant le nom de la carte d'origine du fabricant.
  const stock = list.filter((e) => e.board && vendorStockHint.test(e.board));
  const set = new Map(stock.map((e) => [e.motherboard, e]));
  return set.size === 1 ? [...set.values()][0] : null;
}

// --- Klipper : configurations « stock »
const klipper = new Map();
if (KLIPPER) {
  for (const f of fs.readdirSync(KLIPPER)) {
    if (!f.startsWith('printer-') || !f.endsWith('.cfg')) continue;
    const text = fs.readFileSync(path.join(KLIPPER, f), 'utf8');
    const head = text.split('\n').slice(0, 14).join('\n');
    if (!/stock/i.test(head)) continue; // seulement les configs décrites comme matériel d'origine
    const key = norm(f.replace(/^printer-/, '').replace(/\.cfg$/, '').replace(/-\d{4}$/, ''));
    const mcu = (head.match(/\b(STM32[A-Z0-9]+|GD32[A-Z0-9]+|HC32[A-Z0-9]+|AT90USB\d+|atmega\d+|RP2040|LPC17\d+)\b/i) || [])[1] ?? null;
    const drv = (text.match(/^\[(tmc\d+)\s+stepper_x\]/m) || [])[1] ?? null;
    const board = (text.split('\n')[0].match(/\(([^)]*(?:Robin|MKS|board|Board|Nano)[^)]*)\)/) || [])[1] ?? null;
    const probe = /^\[bltouch\]/m.test(text) ? 'BLTouch' : /^\[probe\]/m.test(text) ? 'Sonde Z (type non précisé par la config)' : 'Aucune (config Klipper d\'origine)';
    klipper.set(key, { mcu, drv, board, probe, file: f });
  }
}

const VENDOR_STOCK = { Creality: /^Creality/i, Sovol: /^Creality|^BigTree/i };
// Électronique propriétaire non documentée par le fabricant (décision : « Propriétaire », pas « Inconnu »).
const PROPRIETARY_VENDORS = new Set([
  'Bambu Lab', 'Snapmaker', 'Formlabs', 'Stratasys', 'HP Inc.', 'EOS', '3D Systems', 'Carbon', 'Desktop Metal',
  'Markforged', 'Prodways Group', 'Asiga', 'AddUp', '3DCeram', 'Zortrax', 'Tiertime', 'Afinia', 'UltiMaker',
  'Raise3D', 'Dremel', 'M3D', 'Phrozen', 'Peopoly', 'Lynxter',
]);
const RESIN = /halot|photon|mars|saturn|sonic|form \d|figure 4|sla|ld-0|revo|asiga|moai|prox/i;


// Faits relevés par recherche web (nom Orca sans buse -> champs), avec leur source. Remplacent les valeurs déduites.
const U = {
  bambuSensors: 'https://all3dp.com/2/bambu-lab-p1s-vs-x1-carbon-differences/',
  bambuBoard: 'https://www.3dprintergear.com.au/bambu-lab-heatbed-sensor-interface-board-compatibl',
  prusaMk4: 'https://3dprintingindustry.com/?p=221601',
  prusaXl: 'https://help.prusa3d.com/article/prusa-core-one-electronics_857793',
  k1: 'https://robu.in/product/creality-auto-leveling-strain-gauge-and-sensor-board',
  k1max: 'https://botland.store/motherboards-and-electronics-for-3d-printers/24553-mainboard-for-creality-k1-max-3d-printer-5904422385385.html',
  neptune4: 'https://3dpros.com/printers/elegoo-neptune-4-pro',
  kobra2: 'https://www.notebookcheck.net/Anycubic-Kobra-2-3D-printer-review-The-perfect-first-layer-thanks-to-LeviQ-2-0.720444.0.html',
  v3se: 'https://www.jbhifi.com.au/products/creality-ender-3-v3-se-3d-printer-250mm-s-printing-speed-fdm-auto-levelling',
  qidiPlus4: 'https://qidi3d.com/pages/qidi-plus-4-techspecs',
};
const bambuLevel = { tool: 'Capteurs de force (jauge de contrainte) sous le plateau', strain_gauge: true };
const OVERRIDES = {
  'Bambu Lab X1 Carbon': { motherboard: PROPRIETARY, auto_leveling: { tool: 'Lidar + capteurs de force analogiques (jauge de contrainte)', strain_gauge: true }, src: [U.bambuSensors, U.bambuBoard] },
  'Bambu Lab X1E': { motherboard: PROPRIETARY, auto_leveling: bambuLevel, src: [U.bambuBoard] },
  'Bambu Lab P1P': { motherboard: PROPRIETARY, auto_leveling: bambuLevel, src: [U.bambuBoard] },
  'Bambu Lab P1S': { motherboard: PROPRIETARY, auto_leveling: bambuLevel, src: [U.bambuSensors, U.bambuBoard] },
  'Prusa MK4': { motherboard: 'Prusa Buddy (32 bits)', driver: 'TMC2209', auto_leveling: { tool: 'Cellule de charge (jauge de contrainte) dans le Nextruder', strain_gauge: true }, src: [U.prusaMk4] },
  'Prusa MK4S': { motherboard: 'Prusa Buddy (32 bits)', driver: 'TMC2209', auto_leveling: { tool: 'Cellule de charge (jauge de contrainte) dans le Nextruder', strain_gauge: true }, src: [U.prusaMk4] },
  'Prusa MK3.5': { motherboard: 'Prusa Buddy (32 bits)', driver: 'TMC2209', src: [U.prusaMk4] },
  'Prusa XL': { motherboard: 'Prusa xBuddy', driver: 'TMC2130', auto_leveling: { tool: 'Cellule de charge (jauge de contrainte) dans le Nextruder', strain_gauge: true }, src: [U.prusaXl] },
  'Prusa XL 5T': { motherboard: 'Prusa xBuddy', driver: 'TMC2130', auto_leveling: { tool: 'Cellule de charge (jauge de contrainte) dans le Nextruder', strain_gauge: true }, src: [U.prusaXl] },
  'Prusa CORE One': { motherboard: 'Prusa xBuddy', src: [U.prusaXl] },
  'Creality K1': { auto_leveling: { tool: 'Jauge de contrainte', strain_gauge: true }, src: [U.k1] },
  'Creality K1C': { auto_leveling: { tool: 'Jauge de contrainte', strain_gauge: true }, src: [U.k1] },
  'Creality K1 Max': { motherboard: 'Creality CR4CU220812S12 (32 bits, 4 drivers)', driver: 'TMC2209', auto_leveling: { tool: 'Jauge de contrainte', strain_gauge: true }, src: [U.k1, U.k1max] },
  'Elegoo Neptune 4 Pro': { motherboard: 'Carte ARM 64 bits quadri-cœur 1,5 GHz, 8 Go eMMC', auto_leveling: { tool: 'Capteur de proximité (121 points)', strain_gauge: false }, src: [U.neptune4] },
  'Anycubic Kobra 2': { motherboard: 'Trigorilla Pro B V1.0.2 (HDSC HC32F460)', driver: 'TMC2209', auto_leveling: { tool: 'LeviQ 2.0 : capteur inductif de proximité', strain_gauge: false }, src: [U.kobra2] },
  'Anycubic Kobra 2 Pro': { auto_leveling: { tool: 'LeviQ 2.0 : capteur inductif de proximité', strain_gauge: false }, src: [U.kobra2] },
  'Creality Ender-3 V3 SE': { auto_leveling: { tool: 'CR-Touch (+ jauge de contrainte pour le Z-offset)', strain_gauge: true }, src: [U.v3se] },
  'Qidi X-Plus 4': { motherboard: 'Carte type MKS Pi (quadri-cœur 1,5 GHz, 1 Go RAM, eMMC 32 Go)', auto_leveling: { tool: 'Capteur inductif + capteur piézoélectrique dans la tête', strain_gauge: false }, src: [U.qidiPlus4] },
};

let stats = { total: 0, marlin: 0, klipper: 0, proprietary: 0 };
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!e.name.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    const a = data.apex;
    if (!a || a.manufacturer === 'Aelox Hardware') continue;
    stats.total++;

    const orcaName = data.name ? data.name.replace(/\s*\(?\s*\d+(\.\d+)?\s*(mm\s*)?([A-Za-z-]+\s+)?nozzle\b.*$/i, '') : '';
    const keys = [norm(orcaName), norm(a.manufacturer + a.model), norm(a.model)].filter(Boolean);
    const stockHint = VENDOR_STOCK[a.manufacturer] ?? /^$/;
    let m = null, k = null;
    for (const key of keys) { m = m ?? marlinFor(key, stockHint); k = k ?? klipper.get(key); }

    const sources = [];
    let board = null, drivers = null, probe = null;
    if (k) {
      board = k.board ?? null;
      if (k.mcu) board = `${board ?? 'Carte d\'origine'} (MCU ${k.mcu})`;
      drivers = k.drv ? `${k.drv.toUpperCase()} (UART)` : null;
      probe = k.probe;
      sources.push(KLIPPER_URL + k.file);
      stats.klipper++;
    }
    if (m) {
      board = board ?? pretty(m.motherboard);
      if (!drivers && m.drivers.X) drivers = DRIVER_NAMES(m.drivers.X);
      sources.push(m.source);
      stats.marlin++;
    }

    const prop = PROPRIETARY_VENDORS.has(a.manufacturer) || RESIN.test(a.model);
    if (!board) board = prop ? PROPRIETARY : UNKNOWN;
    if (board === PROPRIETARY) stats.proprietary++;
    const axes = a.motors ? Object.keys(a.motors) : ['X', 'Y', 'Z', 'E'];
    const driverValue = (axis) => {
      if (m && m.drivers[axis]) return DRIVER_NAMES(m.drivers[axis]);
      if (k?.drv && axis !== 'E') return `${k.drv.toUpperCase()} (UART)`;
      if (k?.drv) return `${k.drv.toUpperCase()} (UART)`;
      return UNKNOWN;
    };
    a.motherboard = board;
    a.motors = Object.fromEntries(axes.map((x) => [x, UNKNOWN]));
    a.drivers = Object.fromEntries(axes.map((x) => [x, driverValue(x)]));
    a.auto_leveling = { tool: probe ?? UNKNOWN };
    a.hardware_sources = sources;
    delete a.hardware_note;
    if (m && !k) a.hardware_note = "Source : configuration d'exemple Marlin (communautaire), qui peut différer de la carte d'origine.";
    const ov = OVERRIDES[orcaName];
    if (ov) {
      if (ov.motherboard) a.motherboard = ov.motherboard;
      if (ov.driver) a.drivers = Object.fromEntries(Object.keys(a.drivers).map((x) => [x, ov.driver]));
      if (ov.auto_leveling) a.auto_leveling = ov.auto_leveling;
      a.hardware_sources = [...sources, ...ov.src];
      delete a.hardware_note;
      stats.web = (stats.web ?? 0) + 1;
    }
    fs.writeFileSync(full, JSON.stringify(data, null, 4) + '\n');
  }
})(root);
console.log(stats);

// --- Passe finale : tout champ matériel encore vide devient « Inconnu » (jamais deviné).
(function finalize(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { finalize(full); continue; }
    if (!e.name.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    const a = data.apex;
    if (!a) continue;
    const fill = (obj, key) => { if (obj[key] === null || obj[key] === undefined) obj[key] = UNKNOWN; };
    for (const key of ['axes_count', 'kinematics', 'motherboard']) fill(a, key);
    if (a.kinematics_preview) fill(a.kinematics_preview, 'type');
    if (a.auto_leveling) fill(a.auto_leveling, 'tool');
    for (const group of ['motors', 'drivers']) {
      if (!a[group]) continue;
      for (const axis of Object.keys(a[group])) fill(a[group], axis);
    }
    for (const axisInfo of a.rotary_axes ?? []) {
      for (const key of ['range_deg', 'max_speed_deg_s', 'max_acceleration_deg_s2', 'mass_kg', 'size_mm']) fill(axisInfo, key);
    }
    if (a.default_nozzle_profile) fill(a.default_nozzle_profile, 'diameter_mm');
    fs.writeFileSync(full, JSON.stringify(data, null, 4) + '\n');
  }
})(root);
console.log('passe finale terminée');
