import * as BABYLON from 'babylonjs';
import 'babylonjs-loaders';
import headModelUrl from '@/assets/models/aetheris-4.glb?url';
import {
  LINE_TYPES,
  DEFAULT_LINE_VISIBILITY,
  resolveLineType,
  type LineTypeId,
  type LineTypeVisibility,
} from './gcodeLineTypes';
import { detectGeneratorSignature, guessGeneratorFromFeature, type GCodeGenerator } from './gcodeGenerator';
import { colorForMode, defaultColorByScope, type ColorByScope } from './gcodeColormap';
import { isColorByDeferred } from '@/utils/gcodeColorByPrefs';

/**
 * Parseur G-code + calque Babylon de prévisualisation. Deux familles de fichiers :
 *
 * 1. G-code polaire 4 axes de l'Apex (reconnu à la présence d'un mot B dans les déplacements) :
 *    `G00 Y<C> X<R> Z<Z> B<B> [E<e>] F<f>`.
 *    - X = R : rayon depuis le centre du plateau (mm, ≥ 0).
 *    - Y = C : angle du plateau (degrés, absolu, JAMAIS replié modulo 360 — le générateur garde
 *      la continuité angulaire, un C > 360 ou négatif est normal).
 *    - Z : hauteur (mm). B : inclinaison de la tête vers +R (à l'opposé de l'axe de rotation), en
 *      degrés.
 *    - R/Z sont les positions machine du PIVOT de l'axe B, pas de la buse : la pointe de buse est
 *      à NOZZLE_PIVOT_MM sous le pivot, le long de l'axe de la tête (cf. `nozzleTip`).
 *    - La matière est stockée en repère plateau sous un noeud dont la rotation suit le C courant :
 *      plateau et matière tournent ensemble, la tête reste dans le demi-plan machine (R, 0, Z).
 *    - Tout est interpolé dans l'espace (R, C, Z, B) du firmware, jamais en cartésien : les
 *      segments sont subdivisés en angle pour suivre l'arc réellement parcouru.
 *
 * 2. G-code cartésien de slicer (Orca, Bambu, Anycubic Slicer Next, Creality Print, PrusaSlicer,
 *    Cura, Simplify3D…) : G0/G1, arcs G2/G3 (I/J ou R), G90/G91, M82/M83, G92, G10/G11, G20/G21,
 *    G28. La pièce est recentrée sur le centre du plateau d'origine (`printable_area`/`bed_shape`
 *    de l'en-tête, sinon centre de la pièce) ; plateau fixe, la tête se déplace en X/Y/Z.
 *
 * Dans les deux cas, les types de ligne (`;TYPE:`, `; FEATURE:`…), essuyages (`;WIPE_START`),
 * rétractions et coutures sont reconnus pour la légende et la coloration (cf. gcodeLineTypes.ts).
 */

export type GCodeKind = 'polar' | 'cartesian';

export interface GCodeMove {
  /** Mot X : rayon R (polaire) ou X recentré sur le plateau (cartésien), en mm. */
  x: number;
  /** Mot Y : angle C du plateau en degrés (polaire) ou Y recentré sur le plateau en mm (cartésien). */
  y: number;
  z: number;
  /** Inclinaison de la tête (degrés) ; toujours 0 en cartésien. */
  b: number;
  extruding: boolean;
  type: LineTypeId;
}

export interface LineTypeStat {
  /** Temps machine (s). */
  time: number;
  /** Filament déposé (mm de filament, hors réinjection après rétraction). */
  filamentMm: number;
  massG: number;
}

export type MarkerTypeId = Extract<LineTypeId, 'retraction' | 'unretraction' | 'seam'>;

/**
 * Critères de coloration continus du calque (cf. gcodeColormap.ts) — tous dérivés de données par
 * mouvement, normalisés sur le min/max du fichier (`ParsedGCode.ranges`). Le type de ligne reste
 * hors de cette liste : coloration catégorielle, jamais un dégradé.
 */
export type ContinuousColorByMode =
  | 'speed' | 'accel' | 'headAngle' | 'segmentLength' | 'elapsedTime'
  | 'extrusionRatio' | 'volumetricFlow' | 'layerSpeedRatio' | 'lineWidth'
  | 'layerHeight' | 'temperature' | 'fanSpeed';

export type ColorByMode = 'lineType' | ContinuousColorByMode;

export interface ColorByRange {
  min: number;
  max: number;
  avg: number;
}

export type ColorByRanges = Record<ContinuousColorByMode, ColorByRange>;

export interface ParsedGCode {
  kind: GCodeKind;
  moves: GCodeMove[];
  /** Temps machine cumulé (s) à l'arrivée de chaque mouvement (`times[0] = 0`), déduit de la
   * distance parcourue par la buse et de l'avance F — cf. `timeAtIndex`/`indexAtTime`. */
  times: Float64Array;
  minZ: number;
  maxZ: number;
  maxR: number;
  minC: number;
  maxC: number;
  extrudingCount: number;
  lineStats: Record<LineTypeId, LineTypeStat>;
  /** Marqueurs ponctuels, par index croissant du mouvement à la FIN duquel ils se trouvent. */
  markers: Record<MarkerTypeId, Uint32Array>;
  /** Logiciel qui a le plus probablement produit le fichier, null si rien ne permet de le dire. */
  generator: GCodeGenerator | null;
  /** Imprimante cible déclarée dans l'en-tête, si présente. */
  printer: string | null;
  /** Cartésien : dépôts à Z variable au sein d'une couche (tranchage courbe, vase…) — l'angle
   * dynamique de la conversion polaire y est utile. */
  nonPlanar: boolean;
  /** Cartésien : centre du plateau d'origine (coordonnées du fichier), soustrait des X/Y. */
  bedCenter: { x: number; y: number };
  /** Fichier issu de la conversion polaire d'Apex (`; apex_conversion_mode = …`), sinon null. */
  conversion: ConversionMode | null;
  /** Cartésien : dépôts qui finissent hors du plateau de l'Apex (PLATE_RADIUS_MM autour du centre)
   * — indices croissants — et nombre de traits (suites continues) qu'ils forment. */
  offPlate: { moves: Uint32Array; traits: number };

  // --- Données par mouvement pour la coloration « colorer par » (cf. gcodeColormap.ts) ---
  // Tableaux parallèles à `moves`/`times` (index 0 inutilisé, comme `times[0] = 0`), remplis une
  // fois par appel à `push()` — donc automatiquement corrects après subdivision d'arc (G2/G3).
  /** Vitesse réellement atteinte (mm/s) : vitesse de croisière après limitation par accélération et
   * jerk en cartésien, distance/dt en polaire (pas de planificateur trapézoïdal séparé). */
  speedMmS: Float32Array;
  /** Accélération modale au mouvement (mm/s²) — celle appliquée par le firmware à ce moment. */
  accelMmS2: Float32Array;
  nozzleTempC: Float32Array;
  bedTempC: Float32Array;
  fanPct: Float32Array;
  /** Épaisseur locale de couche (mm), NaN si indéterminable (premier passage à cet endroit). */
  layerHeightMm: Float32Array;
  /** Largeur de cordon (mm) : commentaire `;WIDTH:` du générateur si présent, sinon estimée depuis
   * le débit et `layerHeightMm`. NaN si ni l'un ni l'autre n'est disponible. */
  widthMm: Float32Array;
  /** Longueur du segment (mm) : corde cartésienne ou longueur d'arc de la pointe de buse en polaire. */
  segLengthMm: Float32Array;
  /** Filament déposé (mm), hors réinjection après rétraction — même valeur que `lineStats[...].filamentMm`
   * accumule, mais par mouvement : sert au débit volumétrique et à la pression d'extrusion relative
   * (cf. gcodeColormap.ts), qui la convertissent en volume via `filamentDiameterMm`. */
  depositMm: Float32Array;
  /** Diamètre de filament utilisé pour convertir `depositMm` en volume (mm, cf. en-tête du fichier
   * ou valeur par défaut) — évite de dupliquer cette constante dans gcodeColormap.ts. */
  filamentDiameterMm: number;
  /** Index de couche (cartésien uniquement, détection par palier Z) ; 0 partout en polaire. */
  layerIndex: Uint32Array;
  /** Vitesse max de la couche courante (mm/s), un par mouvement (valeur répétée dans la couche) —
   * pour `layerSpeedRatio` = speedMmS / layerMaxSpeedMmS. */
  layerMaxSpeedMmS: Float32Array;
  /** Min/max/moyenne par fichier de chaque critère continu, pour normaliser le dégradé (§ légende). */
  ranges: ColorByRanges;
}

/** Rayon du plateau de l'Apex (mm), cf. RADIUS dans Viewport3D.tsx. */
export const PLATE_RADIUS_MM = 125;

export type ConversionMode = 'polar' | 'dynamic';

const DEG2RAD = Math.PI / 180;
// Pas angulaire max d'un sous-segment : au-delà, la corde cartésienne s'écarte visiblement de
// l'arc réellement décrit par le firmware (qui interpole en C, pas en x/y).
const MAX_SUBSEGMENT_DEG = 0.5;
/** Au-delà de cette amplitude totale de C, le fichier vient très probablement de la version
 * boguée du générateur (C qui dérive de tour en tour au lieu d'osciller dans une plage étroite). */
export const SUSPICIOUS_C_RANGE_DEG = 720;

/** Distance entre la pointe de buse et le pivot de l'axe B (mm), le long de l'axe de la tête. */
export const NOZZLE_PIVOT_MM = 46;

/**
 * Pointe de buse (rayon, hauteur) dans le demi-plan machine, depuis la position du pivot (R, Z)
 * et l'inclinaison B (radians). La tête penche vers +R (cf. `headDir` dans `apply`), donc la
 * buse, SOUS le pivot, part vers −R. Z est calé pour que tête droite (B = 0) la buse soit
 * exactement à Z : seul l'écart dû à l'inclinaison, L·(1 − cos B), s'ajoute en hauteur.
 */
function nozzleTip(r: number, z: number, bRad: number, out: { r: number; z: number }) {
  out.r = r - NOZZLE_PIVOT_MM * Math.sin(bRad);
  out.z = z + NOZZLE_PIVOT_MM * (1 - Math.cos(bRad));
  return out;
}

// Points réutilisés par `moveLength` pour éviter une allocation par mouvement (appelé O(n)).
const moveLengthTipA = { r: 0, z: 0 };
const moveLengthTipB = { r: 0, z: 0 };

/** Longueur (mm) parcourue par la pointe de buse entre les mouvements `a` et `b` : corde cartésienne
 * directe, ou longueur de l'arc réellement décrit en (R, C, Z) pour le polaire (même formule que la
 * durée polaire ci-dessous — une seule implémentation pour les deux usages). */
function moveLength(a: GCodeMove, b: GCodeMove, kind: GCodeKind): number {
  if (kind === 'cartesian') {
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  nozzleTip(a.x, a.z, a.b * DEG2RAD, moveLengthTipA);
  nozzleTip(b.x, b.z, b.b * DEG2RAD, moveLengthTipB);
  const dr = moveLengthTipB.r - moveLengthTipA.r;
  const dz = moveLengthTipB.z - moveLengthTipA.z;
  const arc = ((Math.abs(moveLengthTipA.r) + Math.abs(moveLengthTipB.r)) / 2) * (b.y - a.y) * DEG2RAD;
  return Math.sqrt(dr * dr + dz * dz + arc * arc);
}

/** Avance (mm/min) supposée tant que le fichier n'a pas encore donné de F. */
const DEFAULT_FEED_MM_MIN = 1500;
/** Durée plancher d'un mouvement (s) : un mouvement quasi immobile pour la buse (rotation autour
 * du centre, consigne répétée) prend tout de même un instant. */
const MIN_MOVE_S = 1e-3;
/** Filament par défaut quand l'en-tête ne le précise pas : PLA 1,75 mm. */
const DEFAULT_FILAMENT_DIAMETER_MM = 1.75;
const DEFAULT_FILAMENT_DENSITY_G_CM3 = 1.24;
/** Longueur supposée d'une rétraction firmware (G10) quand l'en-tête ne donne pas `retraction_length`. */
const DEFAULT_FIRMWARE_RETRACT_MM = 1;
/** Découpage des arcs G2/G3 en segments droits : corde et angle maximaux. */
const ARC_MAX_CHORD_MM = 0.5;
const ARC_MAX_STEP_RAD = 10 * DEG2RAD;
const ARC_MAX_SEGMENTS = 720;
/** Variation de E (mm) en dessous de laquelle on la considère nulle (arrondis des fichiers). */
const E_EPS = 1e-6;
/** Cinématique supposée (cartésien) tant que le fichier ne la fixe pas (M204, M205,
 * SET_VELOCITY_LIMIT) : accélération en mm/s², jerk / vitesse de coin en mm/s. */
const DEFAULT_ACCEL = 1000;
const DEFAULT_JERK = 8;
/** Tolérance angulaire (degrés) pour retrouver, en polaire, le dernier dépôt au même angle C
 * (modulo 360°) et en déduire l'épaisseur de couche locale — cf. `layerHeightMm`. */
const POLAR_LAYER_ANGLE_TOLERANCE_DEG = 2;
/** Nombre de secteurs de l'historique angulaire polaire (360° / ce pas). */
const POLAR_LAYER_BUCKETS = Math.round(360 / POLAR_LAYER_ANGLE_TOLERANCE_DEG);
/** Écart de Z (mm) en dessous duquel deux dépôts cartésiens successifs sont dans la même couche. */
const LAYER_Z_EPS = 1e-4;

const COMMAND_RE = /^([GM])(\d+)(?:\.\d+)?/;
const WORD_RE = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
const FEATURE_RE = /^\s*(?:TYPE|FEATURE)\s*[:\s]\s*(.+?)\s*$/i;
/** Largeur de cordon explicite (Orca/Bambu/PrusaSlicer) : `;WIDTH:0.42` ou `; WIDTH = 0.42`. */
const WIDTH_RE = /^\s*WIDTH\s*[:=]\s*([\d.]+)/i;
const WIPE_START_RE = /^\s*WIPE_START/i;
const WIPE_END_RE = /^\s*WIPE_END/i;
const ICESL_LAYER_RE = /^\s*<\/?layer>\s*$/i;
// Réglage d'en-tête `; clé = valeur` (Orca, Prusa), `; clé: valeur` (en-tête Orca), `; clé : valeur`
// (IceSL) ou `;CLÉ:valeur` (Cura).
const HEADER_RE = /^\s*([a-z][a-z0-9_.]*)\s*[:=]\s*(.*?)\s*$/i;
/** Signatures de slicer cherchées dans les commentaires précédant ce nombre de mouvements. */
const GENERATOR_SCAN_MOVES = 200;
// Klipper : SET_VELOCITY_LIMIT [VELOCITY=] [ACCEL=] [SQUARE_CORNER_VELOCITY=].
const VELOCITY_LIMIT_RE = /^SET_VELOCITY_LIMIT\b/i;
const VELOCITY_PARAM_RE = /\b(VELOCITY|ACCEL|ACCEL_TO_DECEL|SQUARE_CORNER_VELOCITY)\s*=\s*([\d.]+)/gi;

const emptyStats = () =>
  Object.fromEntries(LINE_TYPES.map((t) => [t.id, { time: 0, filamentMm: 0, massG: 0 }])) as Record<LineTypeId, LineTypeStat>;

/** Centre du rectangle englobant d'une liste de points « AxB,CxD,… » (printable_area, bed_shape). */
function shapeCenter(value: string) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pt of value.split(',')) {
    const [a, b] = pt.split('x').map(parseFloat);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    minX = Math.min(minX, a); maxX = Math.max(maxX, a);
    minY = Math.min(minY, b); maxY = Math.max(maxY, b);
  }
  return minX <= maxX ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : null;
}

/** Mots d'une ligne de commande (lettre → valeur), NaN si absent. */
interface Words {
  X: number; Y: number; Z: number; B: number; E: number; F: number;
  I: number; J: number; R: number; L: number; P: number; S: number; T: number;
}
const WORD_KEYS = ['X', 'Y', 'Z', 'B', 'E', 'F', 'I', 'J', 'R', 'L', 'P', 'S', 'T'] as const;

/**
 * Temps machine cumulé d'une trajectoire cartésienne, comme le planificateur du firmware :
 * profil trapézoïdal par mouvement (accélération du moment), vitesses de jonction limitées par le
 * jerk (écart de vitesse par axe) puis propagées en arrière et en avant pour que chaque mouvement
 * puisse freiner à temps. Les mouvements d'extrudeur seul se font à l'arrêt, à l'avance F.
 */
function planCartesianTimes(
  moves: GCodeMove[],
  feeds: number[],
  eDeltas: number[],
  accels: number[],
  accelsToDecel: number[],
  jerks: number[],
  maxSpeed: number,
) {
  const n = moves.length;
  const times = new Float64Array(n);
  // Vitesse réellement atteinte par mouvement (mm/s), remplie plus bas avec `vp` — exposée pour la
  // coloration « Vitesse » (cf. ParsedGCode.speedMmS), qui reflète ainsi les ralentissements dans
  // les détails/coins plutôt que la seule avance F commandée.
  const speeds = new Float64Array(n);
  const len = new Float64Array(n);
  const dirs = new Float64Array(n * 3);
  for (let k = 1; k < n; k++) {
    const a = moves[k - 1], m = moves[k];
    const d = moveLength(a, m, 'cartesian');
    len[k] = d;
    if (d > 1e-9) {
      dirs[k * 3] = (m.x - a.x) / d;
      dirs[k * 3 + 1] = (m.y - a.y) / d;
      dirs[k * 3 + 2] = (m.z - a.z) / d;
    }
  }
  const moving = (k: number) => k >= 1 && k < n && len[k] > 1e-9;
  const vmax = (k: number) => Math.min(feeds[k] / 60, maxSpeed);

  // v[k] : vitesse au début du mouvement k (= fin du mouvement k − 1) ; v[n] : arrêt final.
  const v = new Float64Array(n + 1);
  for (let k = 1; k < n; k++) {
    if (!moving(k)) continue;
    let maxDiff = 0;
    let limit = vmax(k);
    for (let i = 0; i < 3; i++) {
      const prev = moving(k - 1) ? dirs[(k - 1) * 3 + i] : 0;
      maxDiff = Math.max(maxDiff, Math.abs(dirs[k * 3 + i] - prev));
    }
    if (moving(k - 1)) limit = Math.min(limit, vmax(k - 1));
    if (maxDiff > 1e-9) limit = Math.min(limit, jerks[k] / maxDiff);
    v[k] = limit;
  }
  for (let k = n - 1; k >= 1; k--) {
    if (moving(k)) v[k] = Math.min(v[k], Math.sqrt(v[k + 1] ** 2 + 2 * accels[k] * len[k]));
  }
  for (let k = 1; k < n; k++) {
    if (moving(k) && moving(k + 1)) v[k + 1] = Math.min(v[k + 1], Math.sqrt(v[k] ** 2 + 2 * accels[k] * len[k]));
  }

  for (let k = 1; k < n; k++) {
    let dt: number;
    if (!moving(k)) {
      const rate = feeds[k] / 60;
      dt = Math.abs(eDeltas[k]) / rate;
      speeds[k] = rate;
    } else {
      const a = accels[k], d = len[k];
      const v0 = v[k];
      const v1 = moving(k + 1) ? v[k + 1] : 0;
      const vm = vmax(k);
      // Klipper (ACCEL_TO_DECEL) : la vitesse de croisière atteignable est plafonnée par une
      // accélération « lissée » plus faible, sans changer les rampes elles-mêmes.
      const reach = Math.min(a, accelsToDecel[k]) * d + (v0 * v0 + v1 * v1) / 2;
      const vp = Math.sqrt(Math.max(Math.min(vm * vm, reach), v0 * v0, v1 * v1));
      const cruise = Math.max(0, d - (vp * vp - v0 * v0) / (2 * a) - (vp * vp - v1 * v1) / (2 * a));
      dt = (vp - v0) / a + (vp - v1) / a + cruise / vp;
      speeds[k] = vp;
    }
    times[k] = times[k - 1] + Math.max(MIN_MOVE_S, dt);
  }
  return { times, speeds };
}

export function parseGCode(text: string): ParsedGCode {
  const moves: GCodeMove[] = [];
  const feeds: number[] = [];
  const eDeltas: number[] = [];
  const deposits: number[] = [];
  const retractionAt: number[] = [];
  const unretractionAt: number[] = [];
  const seamAt: number[] = [];

  let x = 0, y = 0, z = 0, b = 0;
  let feed = DEFAULT_FEED_MM_MIN; // modal, comme le firmware
  let unit = 1;
  let relativeXYZ = false;
  let relativeE = false;
  // Position E absolue connue (mode M82) ; inconnue avant la première valeur E, comme avant.
  let eAbs: number | null = null;
  let feature: LineTypeId = 'custom';
  let inWipe = false;
  // Filament actuellement rétracté (mm) : la part d'une extrusion qui ne fait que le réinjecter
  // n'est pas du dépôt.
  let retracted = 0;
  let prevRetracting = false;
  let prevRestoring = false;
  let polar = false;
  let extrudingCount = 0;
  let filamentDiameter = DEFAULT_FILAMENT_DIAMETER_MM;
  let filamentDensity = DEFAULT_FILAMENT_DENSITY_G_CM3;
  let firmwareRetract = DEFAULT_FIRMWARE_RETRACT_MM;
  let bedCenter: { x: number; y: number } | null = null;
  // Cinématique courante (cartésien), par mouvement : accélération d'impression/de déplacement
  // (M204 P/T, ou S pour les deux) et jerk / vitesse de coin (M205 X, SQUARE_CORNER_VELOCITY).
  const accels: number[] = [];
  const jerks: number[] = [];
  const accelsToDecel: number[] = [];
  let accelToDecel = Infinity;
  let accelPrint = DEFAULT_ACCEL;
  let accelTravel = DEFAULT_ACCEL;
  let jerk = DEFAULT_JERK;
  let maxSpeed = Infinity;
  let headerMaxSpeed = Infinity;
  // Plateau décrit par dimensions (IceSL : bed_size_x_mm/bed_size_y_mm, origine au centre si rond).
  let bedSizeX = 0;
  let bedSizeY = 0;
  let bedCircular = false;
  let printer: string | null = null;
  let signature: string | null = null;
  let featureStyleGuess: string | null = null;
  let iceSLLayers = false;
  let conversion: ConversionMode | null = null;
  // États modaux pour la coloration « colorer par » (cf. ParsedGCode) : consigne commandée, pas
  // l'état « atteint » (M109/M190 attendent la stabilisation, mais pour une prévisualisation
  // statique seule la consigne importe).
  let nozzleTemp = 0;
  let bedTemp = 0;
  let fanPct = 0;
  /** Largeur de cordon explicite (`;WIDTH:`), modale — NaN si le générateur ne l'écrit pas. */
  let explicitWidth = NaN;
  const temps: number[] = [];
  const bedTemps: number[] = [];
  const fans: number[] = [];
  const widths: number[] = [];
  // Détection de couche cartésienne (palier Z) et polaire (dernier dépôt au même angle C).
  let prevLayerExtrudingZ: number | null = null;
  let layerIdx = 0;
  const polarLayerZByBucket = new Float32Array(POLAR_LAYER_BUCKETS).fill(NaN);
  const layerHeights: number[] = [];
  const layerIndices: number[] = [];

  const handleComment = (comment: string) => {
    if (WIPE_START_RE.test(comment)) { inWipe = true; return; }
    if (WIPE_END_RE.test(comment)) { inWipe = false; return; }
    if (!signature && moves.length < GENERATOR_SCAN_MOVES) signature = detectGeneratorSignature(comment);
    const feat = FEATURE_RE.exec(comment);
    if (feat && !comment.includes('=')) {
      feature = resolveLineType(feat[1]);
      featureStyleGuess ??= guessGeneratorFromFeature(feat[1], !/^\s*(?:TYPE|FEATURE)\s*:/i.test(comment));
      return;
    }
    if (ICESL_LAYER_RE.test(comment)) { iceSLLayers = true; return; }
    const width = WIDTH_RE.exec(comment);
    if (width) { explicitWidth = parseFloat(width[1]); return; }
    const header = HEADER_RE.exec(comment);
    if (!header) return;
    const key = header[1].toLowerCase();
    const raw = header[2];
    const value = parseFloat(raw);
    switch (key) {
      case 'printable_area':
      case 'bed_shape':
        bedCenter = shapeCenter(raw) ?? bedCenter;
        break;
      case 'bed_size_x_mm': if (value > 0) bedSizeX = value; break;
      case 'bed_size_y_mm': if (value > 0) bedSizeY = value; break;
      case 'bed_circular': bedCircular = /^true/i.test(raw); break;
      case 'filament_diameter':
      case 'filament_diameter_mm_0':
        if (value > 0) filamentDiameter = value;
        break;
      case 'filament_density': if (value > 0) filamentDensity = value; break;
      case 'machine_max_speed_x': if (value > 0) headerMaxSpeed = value; break;
      case 'retraction_length': if (value > 0) firmwareRetract = value; break;
      case 'printer_model':
      case 'printer':
      case 'target_machine.name':
        if (!printer && raw) printer = raw;
        break;
      case 'apex_conversion_mode':
        if (raw === 'polar' || raw === 'dynamic') conversion = raw;
        break;
    }
  };

  const push = (nx: number, ny: number, nz: number, nb: number, de: number) => {
    const moved = nx !== x || ny !== y || nz !== z || nb !== b;
    let restore = 0;
    let deposit = 0;
    if (de > E_EPS) {
      restore = Math.min(de, retracted);
      retracted -= restore;
      deposit = de - restore;
    } else if (de < -E_EPS) {
      retracted -= de;
    }

    let type: LineTypeId;
    let extruding = false;
    if (inWipe && moved) type = 'wipe';
    else if (moved && deposit > E_EPS) { type = feature; extruding = true; }
    else if (moved) type = 'travel';
    else if (de < -E_EPS) type = 'retraction';
    else if (de > E_EPS) type = 'unretraction';
    else type = 'travel';

    const k = moves.length;
    const retracting = de < -E_EPS;
    const restoring = restore > E_EPS;
    if (retracting && !prevRetracting) retractionAt.push(k);
    if (restoring && !prevRestoring) unretractionAt.push(k);
    prevRetracting = retracting;
    prevRestoring = restoring;
    // Couture : début d'une boucle de paroi extérieure, à la position d'où part ce mouvement.
    if (type === 'outerWall' && k > 0 && moves[k - 1].type !== 'outerWall') seamAt.push(k - 1);

    if (extruding) extrudingCount++;
    moves.push({ x: nx, y: ny, z: nz, b: nb, extruding, type });
    feeds.push(feed);
    eDeltas.push(de);
    deposits.push(extruding ? deposit : 0);
    accels.push(extruding ? accelPrint : accelTravel);
    jerks.push(jerk);
    accelsToDecel.push(accelToDecel);
    temps.push(nozzleTemp);
    bedTemps.push(bedTemp);
    fans.push(fanPct);
    widths.push(explicitWidth);

    // Épaisseur locale de couche (mm), seulement sur les dépôts : cartésien, palier Z classique
    // (delta avec le dernier Z extrudant vu) ; polaire, delta Z avec le dernier dépôt au même angle
    // C (modulo 360°, à POLAR_LAYER_ANGLE_TOLERANCE_DEG près) — reflète l'épaisseur réellement
    // posée à cet endroit, cohérent avec la nature hélicoïdale de l'impression polaire (pas de
    // palier Z global net). NaN tant qu'aucun repère n'existe encore (premier passage).
    let layerHeight = NaN;
    if (extruding) {
      if (!polar) {
        if (prevLayerExtrudingZ !== null && Math.abs(nz - prevLayerExtrudingZ) > LAYER_Z_EPS) layerIdx++;
        if (prevLayerExtrudingZ !== null) layerHeight = nz - prevLayerExtrudingZ;
        prevLayerExtrudingZ = nz;
      } else {
        const bucket = ((Math.round(ny / POLAR_LAYER_ANGLE_TOLERANCE_DEG) % POLAR_LAYER_BUCKETS) + POLAR_LAYER_BUCKETS) % POLAR_LAYER_BUCKETS;
        const prevZ = polarLayerZByBucket[bucket];
        if (!Number.isNaN(prevZ)) layerHeight = nz - prevZ;
        polarLayerZByBucket[bucket] = nz;
      }
    }
    layerHeights.push(layerHeight);
    layerIndices.push(polar ? 0 : layerIdx);

    x = nx; y = ny; z = nz; b = nb;
  };

  const w = {} as Words;
  const readWords = (args: string) => {
    for (const key of WORD_KEYS) w[key] = NaN;
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(args)) !== null) {
      if (m[1] in w) w[m[1] as keyof Words] = parseFloat(m[2]);
    }
  };
  const has = (v: number) => !Number.isNaN(v);
  const axis = (current: number, word: number, scale: number) =>
    has(word) ? (relativeXYZ ? current + word * scale : word * scale) : current;
  const extrusionDelta = () => {
    if (!has(w.E)) return 0;
    const e = w.E * unit;
    if (relativeXYZ || relativeE) return e;
    const de = eAbs === null ? 0 : e - eAbs;
    eAbs = e;
    return de;
  };

  for (const rawLine of text.split('\n')) {
    const semi = rawLine.indexOf(';');
    if (semi >= 0) handleComment(rawLine.slice(semi + 1));
    let code = semi >= 0 ? rawLine.slice(0, semi) : rawLine;
    if (code.includes('(')) {
      code = code.replace(/\(([^)]*)\)/g, (_, comment: string) => { handleComment(comment); return ' '; });
    }
    code = code.trim().toUpperCase();
    if (!code) continue;
    if (VELOCITY_LIMIT_RE.test(code)) {
      VELOCITY_PARAM_RE.lastIndex = 0;
      let p: RegExpExecArray | null;
      while ((p = VELOCITY_PARAM_RE.exec(code)) !== null) {
        const value = parseFloat(p[2]);
        if (!(value > 0)) continue;
        if (p[1] === 'ACCEL') accelPrint = accelTravel = value;
        else if (p[1] === 'ACCEL_TO_DECEL') accelToDecel = value;
        else if (p[1] === 'VELOCITY') maxSpeed = value;
        else jerk = value;
      }
      continue;
    }
    const cmd = COMMAND_RE.exec(code);
    if (!cmd) continue;
    const num = parseInt(cmd[2], 10);
    readWords(code.slice(cmd[0].length));

    if (cmd[1] === 'M') {
      if (num === 82) relativeE = false;
      else if (num === 83) relativeE = true;
      else if (num === 203 && w.X > 0) maxSpeed = w.X;
      else if (num === 204) {
        if (w.S > 0) accelPrint = accelTravel = w.S;
        if (w.P > 0) accelPrint = w.P;
        if (w.T > 0) accelTravel = w.T;
      } else if (num === 205 && w.X > 0) jerk = w.X;
      // Consigne commandée uniquement (M109/M190 attendent la stabilisation avant de continuer,
      // mais pour une prévisualisation statique seule la valeur cible importe).
      else if ((num === 104 || num === 109) && w.S >= 0) nozzleTemp = w.S;
      else if ((num === 140 || num === 190) && w.S >= 0) bedTemp = w.S;
      else if (num === 106 && w.S >= 0) fanPct = Math.round((w.S / 255) * 100);
      else if (num === 107) fanPct = 0;
      continue;
    }

    switch (num) {
      case 0:
      case 1: {
        if (has(w.B)) polar = true;
        if (has(w.F) && w.F > 0) feed = w.F * unit;
        if (!has(w.X) && !has(w.Y) && !has(w.Z) && !has(w.B) && !has(w.E)) break;
        const nx = axis(x, w.X, unit);
        const ny = axis(y, w.Y, unit);
        const nz = axis(z, w.Z, unit);
        const nb = axis(b, w.B, 1);
        push(nx, ny, nz, nb, extrusionDelta());
        break;
      }
      case 2:
      case 3: {
        if (has(w.F) && w.F > 0) feed = w.F * unit;
        const ex = axis(x, w.X, unit);
        const ey = axis(y, w.Y, unit);
        const ez = axis(z, w.Z, unit);
        const de = extrusionDelta();
        const ccw = num === 3;
        let cx: number, cy: number;
        if (has(w.I) || has(w.J)) {
          cx = x + (has(w.I) ? w.I * unit : 0);
          cy = y + (has(w.J) ? w.J * unit : 0);
        } else if (has(w.R)) {
          const r = w.R * unit;
          const dx = ex - x, dy = ey - y;
          const d = Math.hypot(dx, dy);
          if (d < 1e-9 || Math.abs(r) < d / 2) { push(ex, ey, ez, b, de); break; }
          const h = Math.sqrt(r * r - (d * d) / 4) * (ccw ? 1 : -1) * (r > 0 ? 1 : -1);
          cx = (x + ex) / 2 - (dy / d) * h;
          cy = (y + ey) / 2 + (dx / d) * h;
        } else {
          push(ex, ey, ez, b, de);
          break;
        }
        const radius = Math.hypot(x - cx, y - cy);
        const a0 = Math.atan2(y - cy, x - cx);
        let sweep = Math.atan2(ey - cy, ex - cx) - a0;
        if (ccw) { while (sweep <= 1e-9) sweep += 2 * Math.PI; }
        else { while (sweep >= -1e-9) sweep -= 2 * Math.PI; }
        const n = Math.min(ARC_MAX_SEGMENTS, Math.max(
          1,
          Math.ceil((Math.abs(sweep) * radius) / ARC_MAX_CHORD_MM),
          Math.ceil(Math.abs(sweep) / ARC_MAX_STEP_RAD),
        ));
        const z0 = z;
        for (let i = 1; i <= n; i++) {
          if (i === n) { push(ex, ey, ez, b, de / n); break; }
          const a = a0 + (sweep * i) / n;
          push(cx + radius * Math.cos(a), cy + radius * Math.sin(a), z0 + ((ez - z0) * i) / n, b, de / n);
        }
        break;
      }
      case 10:
        // G10 sans L/P : rétraction firmware (avec L/P : réglage d'origine CNC, ignoré).
        if (!has(w.L) && !has(w.P)) push(x, y, z, b, -firmwareRetract);
        break;
      case 11:
        push(x, y, z, b, firmwareRetract);
        break;
      case 20: unit = 25.4; break;
      case 21: unit = 1; break;
      case 28: {
        const all = !has(w.X) && !has(w.Y) && !has(w.Z);
        if (all || has(w.X)) x = 0;
        if (all || has(w.Y)) y = 0;
        if (all || has(w.Z)) z = 0;
        break;
      }
      case 90: relativeXYZ = false; break;
      case 91: relativeXYZ = true; break;
      case 92:
        if (has(w.X)) x = w.X * unit;
        if (has(w.Y)) y = w.Y * unit;
        if (has(w.Z)) z = w.Z * unit;
        if (has(w.B)) b = w.B;
        if (has(w.E)) eAbs = w.E * unit;
        break;
    }
  }

  const kind: GCodeKind = polar ? 'polar' : 'cartesian';

  let usedCenter = { x: 0, y: 0 };
  let nonPlanar = false;
  const offPlateMoves: number[] = [];
  let offPlateTraits = 0;
  if (kind === 'cartesian' && moves.length) {
    // Non plan : plus de 5 % des dépôts changent de Z en cours de trajet.
    let zVarying = 0;
    for (let k = 1; k < moves.length; k++) {
      if (moves[k].extruding && Math.abs(moves[k].z - moves[k - 1].z) > 1e-4) zVarying++;
    }
    nonPlanar = extrudingCount > 0 && zVarying / extrudingCount > 0.05;

    let center: { x: number; y: number } | null = bedCenter;
    if (!center && bedCircular) center = { x: 0, y: 0 };
    if (!center && bedSizeX > 0 && bedSizeY > 0) center = { x: bedSizeX / 2, y: bedSizeY / 2 };
    if (!center) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const anyExtruding = extrudingCount > 0;
      for (const mv of moves) {
        if (anyExtruding && !mv.extruding) continue;
        minX = Math.min(minX, mv.x); maxX = Math.max(maxX, mv.x);
        minY = Math.min(minY, mv.y); maxY = Math.max(maxY, mv.y);
      }
      center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }
    usedCenter = center;
    for (const mv of moves) {
      mv.x -= center.x;
      mv.y -= center.y;
      mv.b = 0;
    }
    for (let k = 1; k < moves.length; k++) {
      const mv = moves[k];
      if (!mv.extruding || Math.hypot(mv.x, mv.y) <= PLATE_RADIUS_MM) continue;
      if (offPlateMoves[offPlateMoves.length - 1] !== k - 1) offPlateTraits++;
      offPlateMoves.push(k);
    }
  }

  // Durée de chaque mouvement. Sans ça, la lecture avancerait d'un nombre fixe de mouvements par
  // seconde : une longue ligne droite serait franchie aussi vite qu'un segment de 0,1 mm.
  //  - Cartésien : planificateur de vitesses (accélérations, jerk), cf. `planCartesianTimes`.
  //  - Polaire : distance parcourue par la pointe de buse relativement au plateau, à l'avance F.
  // Mouvement d'extrudeur seul : longueur de filament poussée/tirée, à l'avance F.
  let times: Float64Array;
  const speedMmS = new Float32Array(moves.length);
  const segLengthMm = new Float32Array(moves.length);
  if (kind === 'cartesian') {
    const cap = Math.min(maxSpeed, headerMaxSpeed);
    const planned = planCartesianTimes(moves, feeds, eDeltas, accels, accelsToDecel, jerks, cap);
    times = planned.times;
    for (let k = 1; k < moves.length; k++) {
      segLengthMm[k] = moveLength(moves[k - 1], moves[k], 'cartesian');
      speedMmS[k] = planned.speeds[k];
    }
  } else {
    times = new Float64Array(moves.length);
    for (let k = 1; k < moves.length; k++) {
      let dist = moveLength(moves[k - 1], moves[k], 'polar');
      if (dist < 1e-9) dist = Math.abs(eDeltas[k]);
      segLengthMm[k] = dist;
      const rate = feeds[k] / 60;
      times[k] = times[k - 1] + Math.max(MIN_MOVE_S, dist / rate);
      speedMmS[k] = dist > 1e-9 ? dist / Math.max(MIN_MOVE_S, times[k] - times[k - 1]) : rate;
    }
  }

  // Largeur de cordon (mm) : commentaire explicite du générateur (`;WIDTH:`) s'il en pousse un
  // avant ce dépôt (widths[k] non-NaN, cf. push()) ; sinon estimée depuis le débit de matière —
  // largeur = volume déposé / (longueur du segment × épaisseur de couche) — seulement calculable
  // là où layerHeightMm est connu (pas au tout premier passage d'un endroit donné).
  const widthMm = new Float32Array(moves.length);
  for (let k = 1; k < moves.length; k++) {
    if (!moves[k].extruding) { widthMm[k] = NaN; continue; }
    if (!Number.isNaN(widths[k])) { widthMm[k] = widths[k]; continue; }
    const h = layerHeights[k];
    const len = segLengthMm[k];
    if (Number.isNaN(h) || h <= 0 || len <= 1e-6) { widthMm[k] = NaN; continue; }
    const volumeMm3 = deposits[k] * Math.PI * (filamentDiameter / 2) ** 2;
    widthMm[k] = volumeMm3 / (len * h);
  }

  // Vitesse max de la couche courante (mm/s), pour `layerSpeedRatio` = speedMmS / layerMaxSpeedMmS.
  // Cartésien seulement (layerIndex reste à 0 partout en polaire, pas de palier global net).
  const layerMaxSpeedByIndex = new Map<number, number>();
  if (kind === 'cartesian') {
    for (let k = 1; k < moves.length; k++) {
      if (!moves[k].extruding) continue;
      const idx = layerIndices[k];
      layerMaxSpeedByIndex.set(idx, Math.max(layerMaxSpeedByIndex.get(idx) ?? 0, speedMmS[k]));
    }
  }
  const layerMaxSpeedMmS = new Float32Array(moves.length);
  for (let k = 1; k < moves.length; k++) {
    layerMaxSpeedMmS[k] = layerMaxSpeedByIndex.get(layerIndices[k]) ?? 0;
  }

  const lineStats = emptyStats();
  for (let k = 1; k < moves.length; k++) {
    const stat = lineStats[moves[k].type];
    stat.time += times[k] - times[k - 1];
    stat.filamentMm += deposits[k];
  }
  const gPerMm = Math.PI * (filamentDiameter / 2) ** 2 * filamentDensity / 1000;
  for (const stat of Object.values(lineStats)) stat.massG = stat.filamentMm * gPerMm;

  // Bornes en Z/R de la pointe de buse (ce qui est affiché), pas du pivot.
  let minZ = Infinity, maxZ = -Infinity, maxR = 0, minC = Infinity, maxC = -Infinity;
  const tip = { r: 0, z: 0 };
  for (const mv of moves) {
    if (kind === 'polar') {
      nozzleTip(mv.x, mv.z, mv.b * DEG2RAD, tip);
      if (Math.abs(tip.r) > maxR) maxR = Math.abs(tip.r);
      if (mv.y < minC) minC = mv.y;
      if (mv.y > maxC) maxC = mv.y;
    } else {
      tip.z = mv.z;
      maxR = Math.max(maxR, Math.hypot(mv.x, mv.y));
    }
    if (tip.z < minZ) minZ = tip.z;
    if (tip.z > maxZ) maxZ = tip.z;
  }
  if (!moves.length) { minZ = maxZ = 0; }
  if (minC > maxC) { minC = maxC = 0; }

  let generator: GCodeGenerator | null = null;
  if (signature) generator = { name: signature, inferred: false };
  else if (kind === 'polar') generator = { name: 'Générateur Apex 4 axes', inferred: true };
  else if (featureStyleGuess) generator = { name: featureStyleGuess, inferred: true };
  else if (iceSLLayers) generator = { name: 'IceSL', inferred: true };

  const layerHeightMm = Float32Array.from(layerHeights);
  const layerIndex = Uint32Array.from(layerIndices);
  const accelMmS2 = Float32Array.from(accels);
  const nozzleTempC = Float32Array.from(temps);
  const bedTempC = Float32Array.from(bedTemps);
  const fanPctArr = Float32Array.from(fans);

  // Débit volumétrique (mm³/s) et pression d'extrusion relative (E/mm) : purs ratios dérivés,
  // recalculés à la volée plutôt que stockés (cf. plan §1.4) — un seul passage supplémentaire,
  // négligeable à côté des passes déjà faites ci-dessus, réutilisé pour l'agrégation min/max/moy.
  const volumetricFlowAt = (k: number) => {
    const dt = times[k] - times[k - 1];
    if (!moves[k].extruding || dt <= 0) return NaN;
    const volumeMm3 = deposits[k] * Math.PI * (filamentDiameter / 2) ** 2;
    return volumeMm3 / dt;
  };
  const extrusionRatioAt = (k: number) => {
    if (!moves[k].extruding || segLengthMm[k] <= 1e-6) return NaN;
    return deposits[k] / segLengthMm[k];
  };
  const layerSpeedRatioAt = (k: number) => {
    if (!moves[k].extruding || layerMaxSpeedMmS[k] <= 1e-6) return NaN;
    return (speedMmS[k] / layerMaxSpeedMmS[k]) * 100;
  };

  const CONTINUOUS_MODES: ContinuousColorByMode[] = [
    'speed', 'accel', 'headAngle', 'segmentLength', 'elapsedTime', 'extrusionRatio',
    'volumetricFlow', 'layerSpeedRatio', 'lineWidth', 'layerHeight', 'temperature', 'fanSpeed',
  ];
  const valueAt: Record<ContinuousColorByMode, (k: number) => number> = {
    speed: (k) => speedMmS[k],
    accel: (k) => accelMmS2[k],
    headAngle: (k) => Math.abs(moves[k].b),
    segmentLength: (k) => segLengthMm[k],
    elapsedTime: (k) => times[k],
    extrusionRatio: extrusionRatioAt,
    volumetricFlow: volumetricFlowAt,
    layerSpeedRatio: layerSpeedRatioAt,
    lineWidth: (k) => widthMm[k],
    layerHeight: (k) => layerHeightMm[k],
    temperature: (k) => nozzleTempC[k],
    fanSpeed: (k) => fanPctArr[k],
  };
  const ranges = {} as ColorByRanges;
  for (const mode of CONTINUOUS_MODES) {
    const get = valueAt[mode];
    let min = Infinity, max = -Infinity, sum = 0, n = 0;
    for (let k = 1; k < moves.length; k++) {
      const v = get(k);
      if (Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      n++;
    }
    ranges[mode] = n > 0 ? { min, max, avg: sum / n } : { min: 0, max: 0, avg: 0 };
  }

  return {
    kind,
    moves,
    times,
    minZ,
    maxZ,
    maxR,
    minC,
    maxC,
    extrudingCount,
    lineStats,
    generator,
    printer,
    nonPlanar,
    bedCenter: usedCenter,
    conversion,
    offPlate: { moves: Uint32Array.from(offPlateMoves), traits: offPlateTraits },
    markers: {
      retraction: Uint32Array.from(retractionAt),
      unretraction: Uint32Array.from(unretractionAt),
      seam: Uint32Array.from(seamAt),
    },
    speedMmS,
    accelMmS2,
    nozzleTempC,
    bedTempC,
    fanPct: fanPctArr,
    layerHeightMm,
    widthMm,
    segLengthMm,
    depositMm: Float32Array.from(deposits),
    filamentDiameterMm: filamentDiameter,
    layerIndex,
    layerMaxSpeedMmS,
    ranges,
  };
}

/** Temps machine (s) à l'index de mouvement fractionnaire `t`. */
export function timeAtIndex(times: Float64Array, t: number) {
  const last = times.length - 1;
  const i = Math.max(0, Math.min(last, Math.floor(t)));
  if (i >= last) return times[last];
  return times[i] + (times[i + 1] - times[i]) * (t - i);
}

/** Index de mouvement fractionnaire atteint au temps machine `s` (inverse de `timeAtIndex`). */
export function indexAtTime(times: Float64Array, s: number) {
  const last = times.length - 1;
  if (s <= 0) return 0;
  if (s >= times[last]) return last;
  let lo = 0, hi = last; // times[lo] <= s < times[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= s) lo = mid; else hi = mid;
  }
  return lo + (s - times[lo]) / (times[hi] - times[lo]);
}

/** Position machine (x, y, z, b) interpolée linéairement — comme le firmware — au temps `t`
 * exprimé en index de mouvement fractionnaire. */
export function stateAt(moves: GCodeMove[], t: number) {
  const i = Math.max(0, Math.min(moves.length - 1, Math.floor(t)));
  const a = moves[i];
  const b = moves[Math.min(moves.length - 1, i + 1)];
  const f = Math.max(0, Math.min(1, t - i));
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
    b: a.b + (b.b - a.b) * f,
  };
}

/**
 * Échantillonnage de la trajectoire en repère plateau (Babylon : y vers le haut) : position de la
 * pointe de buse et axe de la buse à la fraction `f` du mouvement `k`, et nombre de sous-segments
 * de chaque mouvement (subdivision angulaire en polaire, segment droit en cartésien).
 */
interface PathSampler {
  segments: Uint32Array;
  tip(k: number, f: number, out: BABYLON.Vector3): void;
  axis(k: number, f: number, out: BABYLON.Vector3): void;
}

/**
 * @param maxSegmentMm Longueur maximale (mm) d'un sous-segment cartésien avant d'être encore
 *   subdivisé — cf. « Précision du rendu » (GCodeLineTypeLegend.tsx), pertinent seulement en mode
 *   de coloration continu : le mode catégoriel garde un anneau par mouvement (`undefined`/`null`),
 *   c'est la géométrie actuelle et la moins coûteuse, suffisante quand la couleur ne varie pas
 *   dans un mouvement. Un mode continu a besoin de plus de points d'échantillonnage le long d'un
 *   long mouvement, sinon la couleur n'y change qu'entre ses deux extrémités (l'interpolation RVB
 *   du GPU produit alors l'effet de moiré observé sur de longs traits). Le polaire garde sa
 *   subdivision angulaire existante (MAX_SUBSEGMENT_DEG) dans tous les cas — déjà assez fine.
 */
function createSampler(parsed: ParsedGCode, maxSegmentMm?: number | null): PathSampler {
  const { moves } = parsed;
  const segments = new Uint32Array(moves.length);
  const from = (k: number) => moves[k > 0 ? k - 1 : 0];

  if (parsed.kind === 'cartesian') {
    if (maxSegmentMm && maxSegmentMm > 0) {
      for (let k = 1; k < moves.length; k++) {
        const len = moveLength(moves[k - 1], moves[k], 'cartesian');
        segments[k] = Math.max(1, Math.ceil(len / maxSegmentMm));
      }
    } else {
      segments.fill(1);
    }
    return {
      segments,
      tip(k, f, out) {
        const a = from(k), m = moves[k];
        out.set(a.x + (m.x - a.x) * f, a.z + (m.z - a.z) * f, a.y + (m.y - a.y) * f);
      },
      axis(_k, _f, out) {
        out.set(0, 1, 0);
      },
    };
  }

  for (let k = 1; k < moves.length; k++) {
    const dc = Math.abs(moves[k].y - moves[k - 1].y);
    segments[k] = Math.max(1, Math.ceil(dc / MAX_SUBSEGMENT_DEG));
  }
  const tipRZ = { r: 0, z: 0 };
  return {
    segments,
    // Interpolation en coordonnées pivot (comme le firmware), puis conversion à la buse.
    tip(k, f, out) {
      const a = from(k), m = moves[k];
      const c = (a.y + (m.y - a.y) * f) * DEG2RAD;
      nozzleTip(a.x + (m.x - a.x) * f, a.z + (m.z - a.z) * f, (a.b + (m.b - a.b) * f) * DEG2RAD, tipRZ);
      out.set(tipRZ.r * Math.cos(c), tipRZ.z, tipRZ.r * Math.sin(c));
    },
    // Axe de buse (vers le haut de la tête) : (sin B, cos B) dans le demi-plan machine, dont la
    // direction radiale est à l'angle C du dépôt.
    axis(k, f, out) {
      const a = from(k), m = moves[k];
      const c = (a.y + (m.y - a.y) * f) * DEG2RAD;
      const b = (a.b + (m.b - a.b) * f) * DEG2RAD;
      out.set(Math.sin(b) * Math.cos(c), Math.cos(b), Math.sin(b) * Math.sin(c));
    },
  };
}

interface PathMesh {
  mesh: BABYLON.Mesh | null;
  /** Nombre d'indices à dessiner une fois le mouvement k terminé. */
  cumIndices: Uint32Array;
  /** Nombre d'indices par sous-segment : granularité de l'affichage d'un mouvement partiel. */
  indicesPerStep: number;
  /** Mouvement propriétaire de chaque SOMMET (pas échantillon) du maillage, dans l'ordre de
   * `VertexData.positions` — permet de recalculer les couleurs par sommet (mode « colorer par »
   * continu) sans reconstruire la géométrie : un sommet appartient au même mouvement que
   * l'échantillon dont il est issu (TUBE_SIDES sommets par échantillon pour un cordon, 1 par
   * échantillon pour un LinesMesh). Vide (mesh === null ou mode jamais recoloré) sinon. */
  vertexOwner: Uint32Array;
}

/** Section du cordon déposé (mm) : largeur de part et d'autre de la trajectoire, et épaisseur le
 * long de l'axe de la buse. Valeurs nominales (pas de largeur/hauteur de couche lue). */
export const BEAD_WIDTH_MM = 0.6;
export const BEAD_HEIGHT_MM = 0.3;
/** Nombre de facettes de la section du cordon. */
const TUBE_SIDES = 6;
/** Diamètre des sphères des marqueurs ponctuels (rétractions, coutures). */
const MARKER_DIAMETER_MM = 0.8;

const RING_COS = Float32Array.from({ length: TUBE_SIDES }, (_, i) => Math.cos((i / TUBE_SIDES) * Math.PI * 2));
const RING_SIN = Float32Array.from({ length: TUBE_SIDES }, (_, i) => Math.sin((i / TUBE_SIDES) * Math.PI * 2));

/**
 * Écrit l'anneau n° `ring` du cordon (TUBE_SIDES sommets et normales) : ellipse centrée en c,
 * perpendiculaire à la tangente unitaire t, écrasée le long de l'axe de buse a (BEAD_HEIGHT_MM)
 * et large de BEAD_WIDTH_MM sur le côté.
 */
function writeRing(
  positions: Float32Array,
  normals: Float32Array,
  ring: number,
  cx: number, cy: number, cz: number,
  tx: number, ty: number, tz: number,
  ax: number, ay: number, az: number,
) {
  const halfW = BEAD_WIDTH_MM / 2;
  const halfH = BEAD_HEIGHT_MM / 2;
  // Axe de buse rendu orthogonal à la tangente ; s'il lui est parallèle (déplacement le long
  // de la buse), n'importe quelle perpendiculaire convient.
  let ux = ax, uy = ay, uz = az;
  const dot = ux * tx + uy * ty + uz * tz;
  ux -= dot * tx; uy -= dot * ty; uz -= dot * tz;
  let len = Math.hypot(ux, uy, uz);
  if (len < 1e-6) {
    ux = -ty; uy = tx; uz = 0;
    len = Math.hypot(ux, uy, uz);
    if (len < 1e-6) { ux = 0; uy = -tz; uz = ty; len = Math.hypot(uy, uz); }
  }
  ux /= len; uy /= len; uz /= len;
  // Côté = tangente × axe.
  const sx = ty * uz - tz * uy;
  const sy = tz * ux - tx * uz;
  const sz = tx * uy - ty * ux;

  for (let i = 0; i < TUBE_SIDES; i++) {
    const v = (ring * TUBE_SIDES + i) * 3;
    const cs = RING_COS[i], sn = RING_SIN[i];
    positions[v] = cx + sx * halfW * cs + ux * halfH * sn;
    positions[v + 1] = cy + sy * halfW * cs + uy * halfH * sn;
    positions[v + 2] = cz + sz * halfW * cs + uz * halfH * sn;
    // Normale d'ellipse : gradient (cos/a, sin/b) dans le repère (côté, axe).
    let nx = sx * cs / halfW + ux * sn / halfH;
    let ny = sy * cs / halfW + uy * sn / halfH;
    let nz = sz * cs / halfW + uz * sn / halfH;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    normals[v] = nx;
    normals[v + 1] = ny;
    normals[v + 2] = nz;
  }
}

/** Donne à un sous-maillage affiché par préfixe (`indexCount`) une boîte englobante propre. */
function finalizePathMesh(mesh: BABYLON.Mesh) {
  // Tant que `indexCount` couvre toute la géométrie, Babylon traite le sous-maillage comme
  // « global » et lui prête la boîte englobante du maillage ; dès qu'on n'en affiche qu'un
  // préfixe, il lit sa boîte propre — jamais créée, d'où un crash dans le tri des objets
  // transparents qui arrêtait la boucle de rendu. On lui en donne une une fois pour toutes :
  // celle de la trajectoire complète, qui englobe n'importe quel préfixe (pas de
  // `refreshBoundingInfo`, qui reparcourrait les indices à chaque rotation du plateau).
  const { minimum, maximum } = mesh.getBoundingInfo();
  mesh.subMeshes[0].setBoundingInfo(new BABYLON.BoundingInfo(minimum.clone(), maximum.clone()));
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
}

/**
 * Construit le cordon de matière (repère plateau) : un tube à section elliptique le long des
 * mouvements retenus par `include`, dans l'ordre du fichier. La section est orientée selon l'axe
 * de la buse au moment du dépôt (écrasée le long de cet axe, BEAD_HEIGHT_MM) et centrée une
 * demi-épaisseur sous la pointe de buse, là où la matière est réellement posée. Les mouvements
 * retenus consécutifs partagent leurs anneaux de jonction : un seul tube continu par suite
 * ininterrompue. N'importe quel préfixe s'affiche en changeant `indexCount`, sans reconstruire.
 */
function buildBeadMesh(
  name: string,
  parsed: ParsedGCode,
  sampler: PathSampler,
  include: (k: number) => boolean,
  material: BABYLON.Material,
  scene: BABYLON.Scene,
): PathMesh {
  const { moves } = parsed;
  const { segments } = sampler;
  const indicesPerStep = TUBE_SIDES * 6;
  const cumIndices = new Uint32Array(moves.length);
  const emptyOwner = new Uint32Array(0);

  let capacity = 0;
  for (let k = 1; k < moves.length; k++) {
    if (include(k)) capacity += segments[k] + 1;
  }
  if (capacity === 0) return { mesh: null, cumIndices, indicesPerStep, vertexOwner: emptyOwner };

  // Passe 1 : échantillons le long de la trajectoire — centre du cordon, axe de buse, mouvement
  // propriétaire et début de tube (pas de sous-segment qui le relie au précédent).
  const centers = new Float32Array(capacity * 3);
  const axes = new Float32Array(capacity * 3);
  const owner = new Uint32Array(capacity);
  const stripStart = new Uint8Array(capacity);
  const tip = new BABYLON.Vector3();
  const ax = new BABYLON.Vector3();
  const halfH = BEAD_HEIGHT_MM / 2;
  let count = 0;

  for (let k = 1; k < moves.length; k++) {
    if (!include(k)) continue;
    // Le mouvement précédent était déjà dans ce cordon : son dernier échantillon est notre point
    // de départ, on prolonge le même tube au lieu d'en ouvrir un nouveau.
    const continues = k > 1 && include(k - 1);
    const n = segments[k];
    for (let s = continues ? 1 : 0; s <= n; s++) {
      const f = s / n;
      sampler.tip(k, f, tip);
      sampler.axis(k, f, ax);
      centers[count * 3] = tip.x - ax.x * halfH;
      centers[count * 3 + 1] = tip.y - ax.y * halfH;
      centers[count * 3 + 2] = tip.z - ax.z * halfH;
      axes[count * 3] = ax.x;
      axes[count * 3 + 1] = ax.y;
      axes[count * 3 + 2] = ax.z;
      owner[count] = k;
      stripStart[count] = s === 0 ? 1 : 0;
      count++;
    }
  }

  // Passe 2 : un anneau elliptique par échantillon, dans le repère (côté, axe de buse)
  // perpendiculaire à la tangente, puis les quads entre anneaux consécutifs d'un même tube.
  const positions = new Float32Array(count * TUBE_SIDES * 3);
  const normals = new Float32Array(count * TUBE_SIDES * 3);
  const indices = new Uint32Array(count * indicesPerStep);
  // Dernière tangente valide : reprise pour les échantillons confondus, dont la tangente locale
  // est nulle.
  let tx = 1, ty = 0, tz = 0;
  let idx = 0;

  for (let j = 0; j < count; j++) {
    const p = j * 3;
    const hasPrev = !stripStart[j];
    const hasNext = j + 1 < count && !stripStart[j + 1];
    const from = hasPrev ? p - 3 : p;
    const to = hasNext ? p + 3 : p;
    const dx = centers[to] - centers[from];
    const dy = centers[to + 1] - centers[from + 1];
    const dz = centers[to + 2] - centers[from + 2];
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) {
      tx = dx / len; ty = dy / len; tz = dz / len;
    }
    writeRing(positions, normals, j, centers[p], centers[p + 1], centers[p + 2], tx, ty, tz, axes[p], axes[p + 1], axes[p + 2]);

    if (hasPrev) {
      const a0 = (j - 1) * TUBE_SIDES;
      const b0 = j * TUBE_SIDES;
      for (let i = 0; i < TUBE_SIDES; i++) {
        const i1 = (i + 1) % TUBE_SIDES;
        indices[idx++] = a0 + i;
        indices[idx++] = b0 + i;
        indices[idx++] = a0 + i1;
        indices[idx++] = a0 + i1;
        indices[idx++] = b0 + i;
        indices[idx++] = b0 + i1;
      }
      cumIndices[owner[j]] = idx;
    }
  }
  // Mouvements hors de ce cordon : même compte que le précédent.
  for (let k = 1; k < moves.length; k++) {
    if (cumIndices[k] < cumIndices[k - 1]) cumIndices[k] = cumIndices[k - 1];
  }

  // Mouvement propriétaire de chaque SOMMET (TUBE_SIDES sommets par échantillon j, cf. writeRing) :
  // permet de recalculer les couleurs par sommet (mode « colorer par » continu) sans reconstruire
  // la géométrie, cf. PathMesh.vertexOwner.
  const vertexOwner = new Uint32Array(count * TUBE_SIDES);
  for (let j = 0; j < count; j++) vertexOwner.fill(owner[j], j * TUBE_SIDES, (j + 1) * TUBE_SIDES);

  const mesh = new BABYLON.Mesh(name, scene);
  const data = new BABYLON.VertexData();
  data.positions = positions;
  data.normals = normals;
  data.indices = indices.subarray(0, idx);
  data.applyToMesh(mesh);
  mesh.material = material;
  finalizePathMesh(mesh);
  return { mesh, cumIndices, indicesPerStep, vertexOwner };
}

/** Construit un LinesMesh (repère plateau) des mouvements retenus par `include`, dans l'ordre du
 * fichier. N'importe quel préfixe s'affiche ensuite en changeant `indexCount`. */
function buildPathMesh(
  name: string,
  parsed: ParsedGCode,
  sampler: PathSampler,
  include: (k: number) => boolean,
  color: BABYLON.Color3,
  scene: BABYLON.Scene,
): PathMesh {
  const { moves } = parsed;
  const { segments } = sampler;
  let vertexTotal = 0;
  for (let k = 1; k < moves.length; k++) {
    if (include(k)) vertexTotal += segments[k] + 1;
  }

  const cumIndices = new Uint32Array(moves.length);
  // Travel/wipe restent en couleur fixe même en mode « colorer par » continu (pas de critère
  // applicable à un déplacement à vide) — jamais recolorés, vertexOwner n'a donc pas d'usage ici.
  if (vertexTotal === 0) return { mesh: null, cumIndices, indicesPerStep: 2, vertexOwner: new Uint32Array(0) };

  const positions = new Float32Array(vertexTotal * 3);
  const indices = new Uint32Array((vertexTotal - 1) * 2);
  const tip = new BABYLON.Vector3();
  let v = 0;
  let idx = 0;

  for (let k = 1; k < moves.length; k++) {
    if (include(k)) {
      const n = segments[k];
      for (let s = 0; s <= n; s++) {
        sampler.tip(k, s / n, tip);
        positions[v * 3] = tip.x;
        positions[v * 3 + 1] = tip.y;
        positions[v * 3 + 2] = tip.z;
        if (s > 0) {
          indices[idx++] = v - 1;
          indices[idx++] = v;
        }
        v++;
      }
    }
    cumIndices[k] = idx;
  }

  const mesh = new BABYLON.LinesMesh(name, scene);
  const data = new BABYLON.VertexData();
  data.positions = positions;
  data.indices = indices.subarray(0, idx);
  data.applyToMesh(mesh);
  mesh.color = color;
  mesh.alpha = 0.85;
  finalizePathMesh(mesh);
  return { mesh, cumIndices, indicesPerStep: 2, vertexOwner: new Uint32Array(0) };
}

/** Sphères (instances légères) aux positions de fin des mouvements `at`. */
function buildMarkerMesh(
  name: string,
  at: Uint32Array,
  sampler: PathSampler,
  color: BABYLON.Color3,
  scene: BABYLON.Scene,
) {
  if (!at.length) return null;
  const mesh = BABYLON.MeshBuilder.CreateSphere(name, { diameter: MARKER_DIAMETER_MM, segments: 6 }, scene);
  const material = new BABYLON.StandardMaterial(`${name}Mat`, scene);
  material.disableLighting = true;
  material.emissiveColor = color;
  mesh.material = material;
  const matrices = new Float32Array(at.length * 16);
  const p = new BABYLON.Vector3();
  const m = new BABYLON.Matrix();
  for (let j = 0; j < at.length; j++) {
    sampler.tip(at[j], 1, p);
    BABYLON.Matrix.TranslationToRef(p.x, p.y, p.z, m);
    m.copyToArray(matrices, j * 16);
  }
  mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

/** Nombre d'éléments de `sorted` (croissant) inférieurs ou égaux à `t`. */
function countUpTo(sorted: Uint32Array, t: number) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export interface GCodeLayer {
  load(parsed: ParsedGCode): void;
  /** Position de lecture, en index de mouvement fractionnaire. */
  setTime(t: number): void;
  /** Types de ligne affichés (cf. `apex-gcode-line-visibility`). */
  setLineTypeVisibility(visibility: LineTypeVisibility): void;
  /** Surligne en rouge les traits hors plateau (cf. `apex-gcode-highlight-offplate`). */
  setOffPlateHighlight(show: boolean): void;
  /** Fait clignoter le surlignage hors-plateau au lieu d'un rouge fixe (pendant une conversion en
   * cours, cf. `apex-gcode-highlight-offplate` { blinking }) — sans effet si le surlignage est
   * éteint (`setOffPlateHighlight(false)`). */
  setOffPlateBlinking(blinking: boolean): void;
  /** Tête complète (défaut) ou buse seule — masque tous les maillages de la tête sauf ceux nommés
   * « NOZZLE » (cf. `apex-gcode-show-full-head`). */
  setFullHead(show: boolean): void;
  /** Critère de coloration du tracé et sa portée affichée (curseurs min/max de la légende, cf.
   * `apex-gcode-color-by`) : `lineType` (défaut) ou un mode continu recadré sur `scope` — les
   * valeurs comprises dedans s'étalent sur toute la rampe, celles en dehors sont grisées ou
   * écrêtées à l'extrême le plus proche selon `scope.grayOutOfScope` (cf. gcodeColormap.ts).
   * `scope` est ignoré (et peut être omis) quand `mode === 'lineType'`. */
  setColorBy(mode: ColorByMode, scope?: ColorByScope): void;
  /** Longueur maximale (mm) d'un sous-segment cartésien en mode continu (cf. « Précision du
   * rendu » de la légende, createSampler) — `null` restaure le comportement le moins précis (un
   * anneau par mouvement). Reconstruit la géométrie des maillages extrudés ; sans effet en mode
   * catégoriel tant que celui-ci n'est pas actif (appliqué au prochain passage en mode continu). */
  setRenderPrecision(mm: number | null): void;
  setEnabled(enabled: boolean): void;
  /** Rotation courante du plateau autour de Y (radians, repère Babylon), 0 sans G-code. */
  getPlateRotation(): number;
  dispose(): void;
}

/** Préfixe de nom de tous les maillages du calque (cf. exclusion de la capture du flou). */
export const GCODE_MESH_PREFIX = 'gcode';

/** Le glTF est en mètres, la scène en millimètres. */
const GLTF_TO_MM = 1000;
/** Rotation du modèle de tête autour de l'axe de sa buse (radians) : tel qu'exporté, son axe de
 * basculement B est perpendiculaire à celui de la machine (Z du repère tête, la tête penchant
 * dans le plan radial XY). */
const HEAD_MODEL_YAW = Math.PI / 2;


/**
 * Charge le modèle de la tête (aetheris-4.glb) sous `headNode`, pointe de buse à l'origine du
 * noeud et corps vers +Y local. Le fichier est déjà posé debout sur la buse, mais le centre de
 * la face de sortie de la buse (maillage « NOZZLE origin ») est légèrement décalé de son
 * origine : on recale le modèle sur ce point plutôt que de faire confiance à l'origine.
 * Chargé dans un conteneur et renommé AVANT l'ajout à la scène : Viewport3D trie les maillages
 * par nom dès leur arrivée (capture du flou, sélection de modèles) et doit ignorer ceux du calque.
 */
async function loadHeadModel(scene: BABYLON.Scene, headNode: BABYLON.TransformNode, isDisposed: () => boolean) {
  const container = await BABYLON.SceneLoader.LoadAssetContainerAsync('', headModelUrl, scene, null, '.glb');
  if (isDisposed()) {
    container.dispose();
    return { loaded: false as const };
  }
  // Repérés AVANT le renommage ci-dessous (sur le nom d'origine du glTF, jamais reconstruit à
  // partir du nom préfixé/modifié) et renvoyés tels quels à l'appelant (cf. `setFullHead`) : plus
  // sûr qu'un `.includes('NOZZLE')` a posteriori sur des noms qui ont pu être transformés.
  const nozzleMeshes = container.meshes.filter((m) => m.name.includes('NOZZLE'));
  const prefix = `${GCODE_MESH_PREFIX}HeadModel_`;
  for (const mesh of container.meshes) {
    mesh.name = prefix + mesh.name;
    mesh.isPickable = false;
  }
  for (const node of container.transformNodes) node.name = prefix + node.name;

  const model = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}HeadModel`, scene);
  model.scaling.setAll(GLTF_TO_MM);
  for (const node of container.rootNodes) node.parent = model;

  // Pointe de buse mesurée avec le modèle seul (non encore rattaché à la tête) : son repère
  // monde n'est alors que l'échelle, donc la boîte monde est directement en repère tête.
  const nozzle = container.meshes.find((m) => m.name.includes('NOZZLE origin'));
  if (nozzle) {
    const chain: BABYLON.Node[] = [];
    for (let n: BABYLON.Node | null = nozzle; n; n = n.parent) chain.unshift(n);
    for (const n of chain) (n as BABYLON.TransformNode).computeWorldMatrix(true);
    const { minimumWorld: min, maximumWorld: max } = nozzle.getBoundingInfo().boundingBox;
    model.position.set(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
  }
  // Rotation portée par un noeud intermédiaire, APRÈS le recalage : elle tourne autour de l'axe
  // vertical passant par la pointe de buse, qui reste donc à l'origine.
  const mount = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}HeadModelMount`, scene);
  mount.rotation.y = HEAD_MODEL_YAW;
  mount.parent = headNode;
  model.parent = mount;
  container.addAllToScene();
  return { loaded: true as const, nozzleMeshes };
}

interface PathEntry extends PathMesh {
  type: LineTypeId;
  include: (k: number) => boolean;
  /** Cordon extrudé (bead) : seul recolorable par sommet en mode « colorer par » continu ; travel
   * et wipe gardent toujours leur couleur fixe (aucun critère ne s'applique à un déplacement à vide). */
  isExtrusion: boolean;
  /** Matériau catégoriel (type de ligne) à restaurer quand on revient au mode `lineType` — n'existe
   * que pour les entrées `isExtrusion`. */
  categoryMaterial?: BABYLON.Material;
}

interface MarkerEntry {
  type: LineTypeId;
  mesh: BABYLON.Mesh;
  at: Uint32Array;
}

/**
 * Calque de prévisualisation G-code posé dans une scène existante. `parent` est le repère du
 * plateau (origine au centre de sa surface) : Z = 0 du G-code y correspond.
 */
export function createGCodeLayer(
  scene: BABYLON.Scene,
  parent: BABYLON.TransformNode,
  /** Appelé à chaque mise à jour de la rotation du plateau (radians), pour y caler du décor. */
  onPlateRotation?: (rotationY: number) => void,
): GCodeLayer {
  const root = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}Root`, scene);
  root.parent = parent;
  root.setEnabled(false);

  // Repère tournant du plateau : toute la matière déposée en est enfant.
  const plateNode = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}Plate`, scene);
  plateNode.parent = root;

  // Tête : pointe de buse à l'origine du noeud, corps qui monte le long de +Y local ; le noeud
  // est ensuite orienté pour que ce corps penche de B vers +R. Primitives provisoires, remplacées
  // par le vrai modèle (loadHeadModel) une fois chargé ; gardées en repli s'il échoue.
  const headNode = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}Head`, scene);
  headNode.parent = root;
  headNode.rotationQuaternion = BABYLON.Quaternion.Identity();

  // Tête complète ou buse seule (cf. `setFullHead`) : simple bascule de visibilité par maillage,
  // « NOZZLE » (nom du modèle réel, cf. loadHeadModel) faisant office de repère — pas de plan de
  // coupe : plus simple, et jamais de coquille ouverte à boucher puisque chaque maillage garde ses
  // propres faces fermées, jamais tronquées à mi-hauteur.
  let fullHead = true;

  const nozzleMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}NozzleMat`, scene);
  nozzleMat.diffuseColor = new BABYLON.Color3(1, 0.55, 0.05);
  nozzleMat.emissiveColor = new BABYLON.Color3(0.35, 0.17, 0);
  const nozzle = BABYLON.MeshBuilder.CreateCylinder(`${GCODE_MESH_PREFIX}Nozzle`, { diameterTop: 7, diameterBottom: 0.6, height: 9, tessellation: 20 }, scene);
  nozzle.position.y = 4.5;
  nozzle.material = nozzleMat;
  nozzle.parent = headNode;
  const bodyMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}HeadBodyMat`, scene);
  bodyMat.diffuseColor = new BABYLON.Color3(0.55, 0.58, 0.64);
  bodyMat.alpha = 0.55;
  const body = BABYLON.MeshBuilder.CreateCylinder(`${GCODE_MESH_PREFIX}HeadBody`, { diameter: 14, height: 26, tessellation: 24 }, scene);
  body.position.y = 9 + 13;
  body.material = bodyMat;
  body.parent = headNode;
  nozzle.isPickable = false;
  body.isPickable = false;
  // `body` (le corps de la tête) n'a pas de contrepartie « NOZZLE » : c'est lui qu'il faut masquer
  // quand `fullHead` est faux, `nozzle` restant visible dans les deux cas (repli du modèle glTF,
  // où seuls les maillages nommés NOZZLE restent visibles — cf. le `.then` ci-dessous).
  body.setEnabled(fullHead);
  headNode.setEnabled(false);

  // Tête complète ou buse seule (cf. `setFullHead`), applicable aux deux états possibles de la
  // tête : primitives de repli (nozzle/body, avant chargement du modèle ou s'il échoue) ou vrai
  // modèle glTF (après, cf. le `.then` ci-dessous) — jamais les deux en même temps, l'un dispose
  // l'autre. Sur le modèle réel, seuls les maillages de `headModelNozzleMeshes` (repérés une fois
  // pour toutes à leur chargement par `loadHeadModel`, cf. plus bas — jamais reconstruits ici par
  // un `.includes('NOZZLE')` sur un nom déjà transformé) restent visibles ; le reste (corps,
  // radiateur, ventilateur, connecteurs…) est simplement désactivé — jamais de plan de coupe ni de
  // bouchon à poser, chaque maillage garde ses propres faces, déjà fermées, intactes.
  let headModelNozzleMeshes: BABYLON.AbstractMesh[] | null = null;
  const applyHeadVisibility = () => {
    if (!headModelNozzleMeshes) {
      // Modèle glTF pas encore chargé (ou échec) : seules les primitives de repli existent.
      if (!body.isDisposed()) body.setEnabled(fullHead);
      return;
    }
    const nozzleSet = new Set<BABYLON.Node>(headModelNozzleMeshes);
    // `isEnabled()` d'un maillage suit toute sa chaîne d'ancêtres (cf. Node.isEnabled) : le loader
    // glTF parente souvent tout sous un noeud technique (`__root__`) — le désactiver, lui, masque
    // aussi ses enfants NOZZLE bien que LEUR propre drapeau reste actif. Jamais désactiver un
    // ancêtre d'un maillage NOZZLE, donc, seulement les branches qui n'en contiennent aucun.
    const ancestorsOfNozzle = new Set<BABYLON.Node>();
    for (const nozzleMesh of headModelNozzleMeshes) {
      for (let n: BABYLON.Node | null = nozzleMesh.parent; n && n !== headNode; n = n.parent) ancestorsOfNozzle.add(n);
    }
    for (const mesh of headNode.getChildMeshes()) {
      if (!nozzleSet.has(mesh) && !ancestorsOfNozzle.has(mesh)) mesh.setEnabled(fullHead);
    }
  };

  let disposed = false;
  loadHeadModel(scene, headNode, () => disposed)
    .then((result) => {
      if (!result.loaded) return;
      nozzle.dispose(false, true);
      body.dispose(false, true);
      headModelNozzleMeshes = result.nozzleMeshes;
      applyHeadVisibility();
    })
    .catch((err) => console.warn('Modèle de tête G-code non chargé, primitives conservées :', err));

  // Un matériau par type de ligne extrudé (couleur de la légende) ; seul l'éclairage varie le long
  // du cordon. Faces arrière dessinées pour ne pas dépendre du sens des triangles, les normales
  // explicites (vers l'extérieur) donnant l'éclairage.
  const colors = Object.fromEntries(
    LINE_TYPES.map((t) => [t.id, BABYLON.Color3.FromHexString(t.color)]),
  ) as Record<LineTypeId, BABYLON.Color3>;
  const beadMaterials = new Map<LineTypeId, BABYLON.StandardMaterial>();
  for (const t of LINE_TYPES) {
    if (t.kind !== 'extrusion') continue;
    const mat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}BeadMat_${t.id}`, scene);
    mat.diffuseColor = colors[t.id];
    mat.emissiveColor = colors[t.id].scale(0.18);
    mat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
    mat.specularPower = 48;
    mat.backFaceCulling = false;
    beadMaterials.set(t.id, mat);
  }
  // Matériau partagé des cordons en mode « colorer par » continu (cf. setColorBy) : couleur par
  // sommet (VertexData.colors), éclairage désactivé pour qu'elle ne soit pas teintée — remplace,
  // maillage par maillage, le matériau par type ci-dessus sans reconstruire la géométrie.
  const vertexColorBeadMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}BeadMatVertexColor`, scene);
  vertexColorBeadMat.disableLighting = true;
  vertexColorBeadMat.emissiveColor = BABYLON.Color3.White();
  vertexColorBeadMat.backFaceCulling = false;
  // Tronçon vivant en mode continu (cf. updateLive) : couleur plate recalculée chaque image, trop
  // petit pour justifier une mise à jour de couleurs par sommet à chaque frame (cf. plan §3).
  const liveColorByMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}LiveBeadMatColorBy`, scene);
  liveColorByMat.disableLighting = true;
  liveColorByMat.backFaceCulling = false;

  // Tronçon « vivant » : portion du mouvement en cours entre la dernière jonction déjà dessinée
  // (préfixe des maillages, au sous-segment près) et la position exacte de la buse, recalculée à
  // chaque image — le tracé avance en continu sous la buse au lieu d'apparaître d'un bloc à la fin
  // de chaque mouvement (ou sous-segment), sans alourdir la géométrie des maillages complets.
  const livePositions = new Float32Array(2 * TUBE_SIDES * 3);
  const liveNormals = new Float32Array(2 * TUBE_SIDES * 3);
  const liveIndices: number[] = [];
  for (let i = 0; i < TUBE_SIDES; i++) {
    const i1 = (i + 1) % TUBE_SIDES;
    liveIndices.push(i, TUBE_SIDES + i, i1, i1, TUBE_SIDES + i, TUBE_SIDES + i1);
  }
  const liveBead = new BABYLON.Mesh(`${GCODE_MESH_PREFIX}LiveBead`, scene);
  const liveData = new BABYLON.VertexData();
  liveData.positions = livePositions;
  liveData.normals = liveNormals;
  liveData.indices = liveIndices;
  liveData.applyToMesh(liveBead, true);
  const livePoints = [new BABYLON.Vector3(), new BABYLON.Vector3(0, 0, 1e-3)];
  let liveLine = BABYLON.MeshBuilder.CreateLines(`${GCODE_MESH_PREFIX}LiveLine`, { points: livePoints, updatable: true }, scene);
  liveLine.alpha = 0.85;
  for (const mesh of [liveBead, liveLine]) {
    mesh.parent = plateNode;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
  }
  const liveA = new BABYLON.Vector3();
  const liveB = new BABYLON.Vector3();
  const liveAxA = new BABYLON.Vector3();
  const liveAxB = new BABYLON.Vector3();

  let parsed: ParsedGCode | null = null;
  let sampler: PathSampler | null = null;
  let segments = new Uint32Array(0);
  let paths: PathEntry[] = [];
  let markers: MarkerEntry[] = [];
  // Longueur max (mm) d'un sous-segment cartésien en mode continu (cf. createSampler, « Précision
  // du rendu » de la légende) ; null = comportement actuel (un anneau par mouvement), utilisé tant
  // que setRenderPrecision n'a jamais été appelé et toujours en mode catégoriel.
  let renderPrecisionMm: number | null = null;
  // Traits hors plateau surlignés en rouge (proposition de suppression avant conversion) : cordon
  // doublé, rendu devant l'original (zOffset) plutôt qu'en remplaçant sa couleur.
  const offPlateMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}OffPlateMat`, scene);
  const OFF_PLATE_EMISSIVE = new BABYLON.Color3(0.75, 0.05, 0.05);
  offPlateMat.diffuseColor = new BABYLON.Color3(1, 0.12, 0.12);
  offPlateMat.emissiveColor = OFF_PLATE_EMISSIVE.clone();
  offPlateMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
  offPlateMat.backFaceCulling = false;
  offPlateMat.zOffset = -2;

  // Clignotement pendant une conversion en cours (cf. setOffPlateBlinking) : bandes « chantier »
  // rouge/jaune en diagonale, défilant dans l'espace monde (comme des puces qui se déplacent),
  // plutôt qu'une simple pulsation de couleur uniforme — motif procédural (pas de texture/UV
  // requis) basé sur vPositionW, dans le même style que boundaryFragmentShader (Viewport3D.tsx).
  BABYLON.Effect.ShadersStore["offPlateHazardVertexShader"] = `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    uniform mat4 worldViewProjection;
    uniform mat4 world;
    varying vec3 vPositionW;
    varying vec3 vNormalW;
    void main(void) {
        gl_Position = worldViewProjection * vec4(position, 1.0);
        vPositionW = vec3(world * vec4(position, 1.0));
        vNormalW = normalize(vec3(world * vec4(normal, 0.0)));
    }
  `;
  BABYLON.Effect.ShadersStore["offPlateHazardFragmentShader"] = `
    precision highp float;
    varying vec3 vPositionW;
    varying vec3 vNormalW;
    uniform float time;
    void main(void) {
        // Ruban de signalisation chantier : jaune citron vif / rouge sang profond, bandes larges et
        // nettes à 45°.
        vec3 red = vec3(0.65, 0.03, 0.02);
        vec3 yellow = vec3(0.98, 0.92, 0.05);
        // Diagonale à 45° dans le plan du plateau (X + Z), défilée par time pour l'effet de
        // déplacement continu (comme des puces qui glissent).
        float diag = (vPositionW.x + vPositionW.z) * 0.22 - time;
        // Bande nette (pas de dégradé lissé, pour l'aspect « bande de signalisation ») : la partie
        // fractionnaire de diag bascule rouge/jaune à mi-cycle.
        float band = step(0.5, fract(diag));
        vec3 stripeColor = mix(red, yellow, band);
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float diffuse = max(dot(normalize(vNormalW), lightDir), 0.6);
        gl_FragColor = vec4(stripeColor * diffuse + stripeColor * 0.35, 1.0);
    }
  `;
  const offPlateHazardMat = new BABYLON.ShaderMaterial(
    `${GCODE_MESH_PREFIX}OffPlateHazardMat`, scene,
    { vertex: "offPlateHazard", fragment: "offPlateHazard" },
    { attributes: ["position", "normal"], uniforms: ["worldViewProjection", "world", "time"] },
  );
  offPlateHazardMat.backFaceCulling = false;
  offPlateHazardMat.zOffset = -2;

  let offPlatePath: PathEntry | null = null;
  let highlightOffPlate = false;
  // N'anime (et n'assigne le matériau chantier) que quand nécessaire (posé/retiré par
  // setOffPlateBlinking), pas en permanence — coût nul le reste du temps.
  let blinkingOffPlate = false;
  let offPlateBlinkObserver: BABYLON.Observer<BABYLON.Scene> | null = null;
  let offPlateBlinkStart = 0;
  // Vitesse de défilement des bandes (unités de `diag` par seconde) — indépendante de la fréquence
  // de clignotement d'origine, purement visuelle ici : à ajuster au ressenti.
  const OFF_PLATE_HAZARD_SPEED = 1.5;
  let time = 0;
  let visibility: LineTypeVisibility = { ...DEFAULT_LINE_VISIBILITY };
  // Mode de coloration actif et sa portée affichée (cf. setColorBy). `lineType` restaure le
  // matériau catégoriel existant sans recalcul ; un mode continu recolore les sommets des cordons
  // (jamais travel/wipe) par le matériau partagé `vertexColorBeadMat`, sans reconstruire la
  // géométrie (cf. plan §3). `colorByScope` n'a de sens que pour un mode continu — recalculée par
  // `defaultColorByScope` sur les bornes du fichier tant que React n'en a pas fourni une (avant le
  // premier appel à `setColorBy` avec un mode continu, ou juste après `load()`).
  let colorBy: ColorByMode = 'lineType';
  let colorByScope: ColorByScope = { min: 0, max: 0, grayOutOfScope: false };
  // Couleur réutilisée à chaque sommet recoloré (évite une allocation par sommet, potentiellement
  // des dizaines de milliers par bascule de mode).
  const colorScratch = new BABYLON.Color3();

  const up = BABYLON.Vector3.Up();
  const headDir = new BABYLON.Vector3();
  const headTip = { r: 0, z: 0 };

  const apply = () => {
    if (!parsed || parsed.moves.length === 0) return;
    const last = parsed.moves.length - 1;
    const t = Math.max(0, Math.min(last, time));
    const state = stateAt(parsed.moves, t);

    if (parsed.kind === 'polar') {
      // Dans le repère main gauche de Babylon, rotation.y = ψ envoie un angle local θ
      // (x = cos θ, z = sin θ) sur θ − ψ. Avec ψ = C courant, un point déposé à C_dépôt est à
      // l'angle machine C_dépôt − C : pile sous la tête (angle 0) au moment de son dépôt, puis
      // entraîné avec le plateau. Le signe opposé ferait apparaître la pièce en miroir.
      plateNode.rotation.y = state.y * DEG2RAD;
      onPlateRotation?.(plateNode.rotation.y);

      const bRad = state.b * DEG2RAD;
      nozzleTip(state.x, state.z, bRad, headTip);
      headNode.position.set(headTip.r, headTip.z, 0);
      // headDir.x positif = tête penchée vers +X, donc vers +R (à l'opposé de l'axe de rotation,
      // situé en X=0) puisque le nœud de tête est lui-même posé en X=+R. Signe vérifié visuellement
      // contre le comportement réel de la machine (le signe opposé penchait la tête vers l'axe).
      headDir.set(Math.sin(bRad), Math.cos(bRad), 0);
      BABYLON.Quaternion.FromUnitVectorsToRef(up, headDir, headNode.rotationQuaternion!);
    } else {
      // Cartésien : plateau fixe, tête droite qui suit la buse en X/Y/Z (Y du G-code → z Babylon).
      plateNode.rotation.y = 0;
      onPlateRotation?.(0);
      headNode.position.set(state.x, state.z, state.y);
      headNode.rotationQuaternion!.set(0, 0, 0, 1);
    }

    // Préfixe affiché : mouvements terminés + fraction du mouvement en cours, au sous-segment
    // près. Chaque mouvement a `segments[k]` sous-segments dans chaque maillage qui le contient.
    const i = Math.floor(t);
    const next = Math.min(last, i + 1);
    const partialSteps = next > i ? Math.floor((t - i) * segments[next]) : 0;
    for (const entry of offPlatePath ? [...paths, offPlatePath] : paths) {
      if (!entry.mesh) continue;
      let count = entry.cumIndices[i];
      if (next > i && entry.include(next)) count += partialSteps * entry.indicesPerStep;
      const sub = entry.mesh.subMeshes?.[0];
      if (sub) sub.indexCount = count;
      entry.mesh.isVisible = count > 0;
    }
    for (const entry of markers) {
      const count = countUpTo(entry.at, t);
      entry.mesh.thinInstanceCount = count;
      entry.mesh.isVisible = count > 0;
    }
    updateLive(i, next, t);
  };

  /** Tronçon vivant du mouvement `next` en cours, de la fin du préfixe dessiné à la buse. */
  const updateLive = (i: number, next: number, t: number) => {
    let showBead = false;
    let showLine = false;
    if (parsed && sampler && next > i) {
      const m = parsed.moves[next];
      const seg = segments[next];
      const f = t - i;
      const f0 = Math.floor(f * seg) / seg;
      const type: LineTypeId = m.extruding ? m.type : m.type === 'wipe' ? 'wipe' : 'travel';
      if (f - f0 > 1e-6 && visibility[type]) {
        sampler.tip(next, f0, liveA);
        sampler.tip(next, f, liveB);
        if (m.extruding) {
          const dx = liveB.x - liveA.x, dy = liveB.y - liveA.y, dz = liveB.z - liveA.z;
          const len = Math.hypot(dx, dy, dz);
          if (len > 1e-6) {
            sampler.axis(next, f0, liveAxA);
            sampler.axis(next, f, liveAxB);
            const halfH = BEAD_HEIGHT_MM / 2;
            const tx = dx / len, ty = dy / len, tz = dz / len;
            writeRing(livePositions, liveNormals, 0,
              liveA.x - liveAxA.x * halfH, liveA.y - liveAxA.y * halfH, liveA.z - liveAxA.z * halfH,
              tx, ty, tz, liveAxA.x, liveAxA.y, liveAxA.z);
            writeRing(livePositions, liveNormals, 1,
              liveB.x - liveAxB.x * halfH, liveB.y - liveAxB.y * halfH, liveB.z - liveAxB.z * halfH,
              tx, ty, tz, liveAxB.x, liveAxB.y, liveAxB.z);
            liveBead.updateVerticesData(BABYLON.VertexBuffer.PositionKind, livePositions);
            liveBead.updateVerticesData(BABYLON.VertexBuffer.NormalKind, liveNormals);
            if (colorBy === 'lineType') {
              liveBead.material = beadMaterials.get(m.type) ?? null;
            } else {
              colorForMode(colorBy as ContinuousColorByMode, next, parsed, colorByScope, colorScratch);
              liveColorByMat.emissiveColor.copyFrom(colorScratch);
              liveBead.material = liveColorByMat;
            }
            showBead = true;
          }
        } else {
          livePoints[0].copyFrom(liveA);
          livePoints[1].copyFrom(liveB);
          liveLine = BABYLON.MeshBuilder.CreateLines(liveLine.name, { points: livePoints, instance: liveLine });
          liveLine.color = colors[type];
          showLine = true;
        }
      }
    }
    liveBead.setEnabled(showBead);
    liveLine.setEnabled(showLine);
  };

  const applyVisibility = () => {
    for (const entry of paths) entry.mesh?.setEnabled(visibility[entry.type]);
    for (const entry of markers) entry.mesh.setEnabled(visibility[entry.type]);
    offPlatePath?.mesh?.setEnabled(highlightOffPlate);
  };

  // Recalcul différé (réglage Paramètres, cf. utils/gcodeColorByPrefs.ts) : un changement de mode
  // qui arrive avant l'image différée annule la précédente, jamais deux recalculs empilés.
  let deferredColorByRaf = 0;

  /** Recolore (ou restaure) les cordons extrudés selon `colorBy`, sans reconstruire leur géométrie
   * (cf. plan §3) : `lineType` réapplique le matériau catégoriel déjà construit à `load()` ;
   * un mode continu bascule le maillage sur le matériau partagé `vertexColorBeadMat` et met à jour
   * son tampon de couleurs par sommet via `updateVerticesData`, jamais un `VertexData.applyToMesh`
   * complet (qui retoucherait aussi positions/indices/normales, inutile ici). */
  const applyColorBy = () => {
    if (deferredColorByRaf) {
      cancelAnimationFrame(deferredColorByRaf);
      deferredColorByRaf = 0;
    }
    const run = () => {
      if (!parsed) return;
      const isContinuous = colorBy !== 'lineType';
      for (const entry of paths) {
        if (!entry.isExtrusion || !entry.mesh) continue;
        if (!isContinuous) {
          entry.mesh.material = entry.categoryMaterial ?? entry.mesh.material;
          continue;
        }
        entry.mesh.material = vertexColorBeadMat;
        const { vertexOwner } = entry;
        const vertexColors = new Float32Array(vertexOwner.length * 4);
        for (let v = 0; v < vertexOwner.length; v++) {
          colorForMode(colorBy as ContinuousColorByMode, vertexOwner[v], parsed, colorByScope, colorScratch);
          vertexColors[v * 4] = colorScratch.r;
          vertexColors[v * 4 + 1] = colorScratch.g;
          vertexColors[v * 4 + 2] = colorScratch.b;
          vertexColors[v * 4 + 3] = 1;
        }
        // `updateVerticesData` une fois le tampon de couleurs déjà créé (bascules suivantes entre
        // modes continus) ; sinon `setVerticesData` le crée la première fois (premier passage en
        // mode continu pour ce maillage) — ni l'un ni l'autre ne retouche positions/indices/normales.
        if (entry.mesh.isVerticesDataPresent(BABYLON.VertexBuffer.ColorKind)) {
          entry.mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind, vertexColors);
        } else {
          entry.mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, vertexColors, true);
        }
      }
    };
    if (isColorByDeferred()) {
      deferredColorByRaf = requestAnimationFrame(() => { deferredColorByRaf = 0; run(); });
    } else {
      run();
    }
  };

  const disposeAll = () => {
    for (const entry of paths) entry.mesh?.dispose(false, false);
    for (const entry of markers) entry.mesh.dispose(false, true);
    offPlatePath?.mesh?.dispose(false, false);
    paths = [];
    markers = [];
    offPlatePath = null;
  };

  /** (Re)construit tous les maillages du calque pour `next`, avec la précision cartésienne
   * courante (`renderPrecisionMm`, ignorée en mode catégoriel — cf. createSampler). Utilisée par
   * `load()` (nouveau fichier) et `setRenderPrecision()` (même fichier, juste une géométrie plus
   * ou moins fine) — ne touche jamais `time`, laissé à l'appelant. */
  const buildAll = (next: ParsedGCode) => {
    disposeAll();
    parsed = next;
    const { moves } = next;
    const precisionMm = colorBy !== 'lineType' ? renderPrecisionMm : null;
    const pathSampler = createSampler(next, precisionMm);
    sampler = pathSampler;
    segments = pathSampler.segments;

    for (const t of LINE_TYPES) {
      if (t.kind !== 'extrusion') continue;
      const include = (k: number) => moves[k].type === t.id;
      const material = beadMaterials.get(t.id)!;
      const built = buildBeadMesh(`${GCODE_MESH_PREFIX}Bead_${t.id}`, next, pathSampler, include, material, scene);
      paths.push({ ...built, type: t.id, include, isExtrusion: true, categoryMaterial: material });
    }
    // Trajets à vide : tout mouvement sans dépôt hors essuyage (rétractions sur place comprises,
    // de longueur nulle).
    const travelInclude = (k: number) => !moves[k].extruding && moves[k].type !== 'wipe';
    const wipeInclude = (k: number) => moves[k].type === 'wipe';
    for (const [type, include] of [['travel', travelInclude], ['wipe', wipeInclude]] as const) {
      const built = buildPathMesh(`${GCODE_MESH_PREFIX}Path_${type}`, next, pathSampler, include, colors[type], scene);
      paths.push({ ...built, type, include, isExtrusion: false });
    }
    for (const [type, at] of Object.entries(next.markers) as [LineTypeId, Uint32Array][]) {
      const mesh = buildMarkerMesh(`${GCODE_MESH_PREFIX}Marker_${type}`, at, pathSampler, colors[type], scene);
      if (mesh) markers.push({ type, mesh, at });
    }
    if (next.offPlate.moves.length) {
      const flags = new Uint8Array(moves.length);
      for (const k of next.offPlate.moves) flags[k] = 1;
      const include = (k: number) => flags[k] === 1;
      const built = buildBeadMesh(`${GCODE_MESH_PREFIX}OffPlate`, next, pathSampler, include, offPlateMat, scene);
      offPlatePath = { ...built, type: 'custom', include, isExtrusion: false };
      if (offPlatePath.mesh) {
        offPlatePath.mesh.parent = plateNode;
        // Un rechargement pendant un clignotement déjà en cours (rare) doit reconstruire avec le
        // bon matériau, pas retomber sur le rouge fixe de buildBeadMesh ci-dessus.
        if (blinkingOffPlate) offPlatePath.mesh.material = offPlateHazardMat;
      }
    }
    for (const entry of [...paths, ...markers]) {
      if (entry.mesh) entry.mesh.parent = plateNode;
    }
    applyVisibility();
    applyColorBy();
    headNode.setEnabled(moves.length > 0);
  };

  return {
    load(next) {
      buildAll(next);
      time = next.moves.length - 1;
      apply();
    },
    setRenderPrecision(mm) {
      renderPrecisionMm = mm;
      if (!parsed || colorBy === 'lineType') return;
      buildAll(parsed);
      apply();
    },
    setTime(t) {
      time = t;
      apply();
    },
    setLineTypeVisibility(next) {
      visibility = { ...next };
      applyVisibility();
    },
    setColorBy(mode, scope) {
      // Un réglage de précision cartésienne (renderPrecisionMm) change la géométrie elle-même
      // (plus de sous-segments par mouvement, cf. createSampler) SEULEMENT en mode continu — passer
      // de/vers `lineType` alors qu'une précision est déjà réglée doit donc reconstruire, pas
      // seulement recolorer, sans quoi le mode catégoriel hériterait de la géométrie subdivisée (ou
      // l'inverse) au lieu de celle qui lui correspond.
      const needsRebuild = renderPrecisionMm != null && (mode === 'lineType') !== (colorBy === 'lineType');
      colorBy = mode;
      if (scope) colorByScope = scope;
      else if (mode !== 'lineType' && parsed) colorByScope = defaultColorByScope(parsed.ranges[mode]);
      if (needsRebuild && parsed) {
        buildAll(parsed);
        apply();
      } else {
        applyColorBy();
      }
    },
    setOffPlateHighlight(show) {
      highlightOffPlate = show;
      applyVisibility();
    },
    setOffPlateBlinking(blinking) {
      blinkingOffPlate = blinking;
      if (blinking && !offPlateBlinkObserver) {
        // Bascule vers le matériau « chantier » (bandes diagonales défilantes) tant que le
        // clignotement est actif ; jamais de trou (ni éteint ni immobile) — cf. demande d'origine
        // (« les laisser en rouge... mais les faire clignoter »), étendue à un motif qui se déplace
        // sur toute la surface visible plutôt qu'une simple pulsation de couleur uniforme.
        if (offPlatePath?.mesh) offPlatePath.mesh.material = offPlateHazardMat;
        offPlateBlinkStart = performance.now();
        offPlateBlinkObserver = scene.onBeforeRenderObservable.add(() => {
          const elapsed = (performance.now() - offPlateBlinkStart) / 1000;
          offPlateHazardMat.setFloat('time', elapsed * OFF_PLATE_HAZARD_SPEED);
        });
      } else if (!blinking && offPlateBlinkObserver) {
        scene.onBeforeRenderObservable.remove(offPlateBlinkObserver);
        offPlateBlinkObserver = null;
        if (offPlatePath?.mesh) offPlatePath.mesh.material = offPlateMat;
      }
    },
    setFullHead(show) {
      fullHead = show;
      applyHeadVisibility();
    },
    setEnabled(enabled) {
      root.setEnabled(enabled);
    },
    getPlateRotation() {
      return plateNode.rotation.y;
    },
    dispose() {
      disposed = true;
      if (deferredColorByRaf) cancelAnimationFrame(deferredColorByRaf);
      if (offPlateBlinkObserver) scene.onBeforeRenderObservable.remove(offPlateBlinkObserver);
      disposeAll();
      root.dispose(false, true);
    },
  };
}
