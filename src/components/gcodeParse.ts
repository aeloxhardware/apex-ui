import {
  LINE_TYPES,
  DEFAULT_LINE_VISIBILITY,
  resolveLineType,
  type LineTypeId,
  type LineTypeVisibility,
} from './gcodeLineTypes';
import { findAirContours } from './gcodeAirContours';
import { detectGeneratorSignature, guessGeneratorFromFeature, type GCodeGenerator } from './gcodeGenerator';
import type { ApexHeaderPayload, ApexJournal } from '@/utils/apexHeader';
import { hasApexSignature } from '@/utils/apexSignature';
import {
  LEGACY_KINEMATICS, isPreviewSupported, nozzleTipActive, parseKinematicsHeader, setActiveKinematics, type Kinematics,
} from '@/utils/kinematics';

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
 *    Variante multi-axes (Unlayered Slicer : mots B/C + `; TOOL_AXIS:x,y,z`) : X/Y/Z restent
 *    cartésiens, B/C ne sont que l'orientation de l'outil et ne rendent pas le fichier polaire.
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
  /** Inclinaison de la tête (degrés) ; 0 en cartésien sauf fichier à orientation d'outil, où c'est
   * l'écart à la verticale (B + 90 : B = −90 ↔ outil vertical, cf. `toolAxisAt`). */
  b: number;
  /** Azimut de l'inclinaison de l'outil (mot C, degrés) — cartésien à orientation d'outil seulement,
   * 0 sinon. */
  c: number;
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

/** Plage de mouvements insérés par l'édition (re-tranchage), indices courants. */
export interface InsertedRange {
  at: number;
  count: number;
}

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
  /** Cartésien : le fichier pilote l'orientation de l'outil (mots B/C, `; TOOL_AXIS:`) — `moves[k].b`/`c`
   * donnent alors l'inclinaison et l'azimut de la tête. */
  toolOriented: boolean;
  /** Cartésien : centre du plateau d'origine (coordonnées du fichier), soustrait des X/Y. */
  bedCenter: { x: number; y: number };
  /** Fichier issu de la conversion polaire d'Apex (`; apex_conversion_mode = …`), sinon null. */
  conversion: ConversionMode | null;
  /** Cartésien : dépôts qui finissent hors du plateau de l'Apex (PLATE_RADIUS_MM autour du centre)
   * — indices croissants — et nombre de traits (suites continues) qu'ils forment. */
  offPlate: { moves: Uint32Array; traits: number };
  /** Cartésien, PrusaSlicer à couches non planaires : contours imprimés dans l'air (type `airContour`),
   * en paires [premier, dernier] d'indices de mouvement croissants. Vide ailleurs. */
  airContours: Uint32Array;

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

  // --- Correspondance avec le texte du fichier (édition : recalcul et réécriture de E) ---
  /** Ligne du fichier (index à partir de 0) qui produit le mouvement ; un arc G2/G3 découpé partage
   * la ligne de l'arc entre plusieurs mouvements. */
  lineIndex: Uint32Array;
  /** Delta d'extrudeur du mouvement (mm), rétractions comprises (négatif). */
  eDelta: Float64Array;
  /** Position absolue de l'extrudeur (mm) avant le mouvement, en mode absolu (M82) ; NaN en relatif. */
  eAbsBefore: Float64Array;
  /** Le mot E est présent sur la ligne du mouvement. */
  hasEWord: Uint8Array;
  /** Mode d'extrusion relatif (M83 ou G91) au mouvement. */
  eRelative: Uint8Array;
  /** Le fichier passe en pouces (G20) à un moment : la réécriture n'est pas prise en charge. */
  usesInches: boolean;
  /** Mouvements modifiés par l'onglet Édition depuis le chargement (positions dans `moves`,
   * extrusion dans `eDelta`) : les lignes à réécrire à l'enregistrement. */
  editedMoves?: Set<number>;
  /** Plages de mouvements insérées par l'édition (couches interpolées), par indice croissant : sans ligne dans
   * le texte d'origine (`lineIndex` = INSERTED_LINE), elles sont écrites par gcodeWriter.ts. */
  insertedBlocks?: InsertedRange[];
  /** Mouvements dont le dépôt a été rogné par l'édition (rognage) : ils ne déposent plus. */
  trimmedMoves?: Set<number>;
  /** Cinématique pivot/pointe du fichier : celle de la ligne `; apex_kinematics` (R-007), sinon `LEGACY_KINEMATICS`. */
  kinematics: Kinematics;
  /** Vrai si le fichier déclare sa cinématique (sinon `kinematics` est la valeur supposée des anciens fichiers). */
  kinematicsDeclared: boolean;
  /** Bloc d'en-tête chiffré Apex lu au chargement (utils/apexHeader.ts), null s'il n'y en a pas. */
  apexHeader?: ApexHeaderPayload | null;
  /** Journal des modifications courant (piles d'annulation et de rétablissement du noyau),
   * écrit dans l'en-tête chiffré à l'enregistrement si le réglage est activé. */
  editJournal?: ApexJournal;
}

/** Rayon du plateau de l'Apex (mm), cf. RADIUS dans Viewport3D.tsx. */
export const PLATE_RADIUS_MM = 125;

export type ConversionMode = 'polar' | 'dynamic';

export const DEG2RAD = Math.PI / 180;
// Pas angulaire max d'un sous-segment : au-delà, la corde cartésienne s'écarte visiblement de
// l'arc réellement décrit par le firmware (qui interpole en C, pas en x/y).
export const MAX_SUBSEGMENT_DEG = 0.5;
/** Au-delà de cette amplitude totale de C, le fichier vient très probablement de la version
 * boguée du générateur (C qui dérive de tour en tour au lieu d'osciller dans une plage étroite). */
export const SUSPICIOUS_C_RANGE_DEG = 720;

/**
 * Pointe de buse (rayon, hauteur) dans le demi-plan machine, depuis la position du pivot (R, Z)
 * et l'inclinaison B (radians). La tête penche vers +R (cf. `headDir` dans `apply`), donc la
 * buse, SOUS le pivot, part vers −R. Z est calé pour que tête droite (B = 0) la buse soit
 * exactement à Z : seul l'écart dû à l'inclinaison, L·(1 − cos B), s'ajoute en hauteur.
 */
export function nozzleTip(r: number, z: number, bRad: number, out: { r: number; z: number }) {
  return nozzleTipActive(r, z, bRad, out);
}

// Points réutilisés par `moveLength` pour éviter une allocation par mouvement (appelé O(n)).
const moveLengthTipA = { r: 0, z: 0 };
const moveLengthTipB = { r: 0, z: 0 };

/** Longueur (mm) parcourue par la pointe de buse entre les mouvements `a` et `b` : corde cartésienne
 * directe, ou longueur de l'arc réellement décrit en (R, C, Z) pour le polaire (même formule que la
 * durée polaire ci-dessous — une seule implémentation pour les deux usages). */
export function moveLength(a: GCodeMove, b: GCodeMove, kind: GCodeKind): number {
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
const TOOL_AXIS_RE = /^\s*TOOL_AXIS\s*:/i;
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
  X: number; Y: number; Z: number; B: number; C: number; E: number; F: number;
  I: number; J: number; R: number; L: number; P: number; S: number; T: number;
}
const WORD_KEYS = ['X', 'Y', 'Z', 'B', 'C', 'E', 'F', 'I', 'J', 'R', 'L', 'P', 'S', 'T'] as const;

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

/**
 * Machine déclarée par un G-code Apex (R-025) : signature en tête ET ligne `; apex_kinematics_json {...}`
 * (`machine` : « cartesian » ou « apex-polar-4axis »). Null pour un fichier sans signature, ou sans description :
 * l'aperçu garde alors ses heuristiques (présence d'un mot B ou C). Les six mots XYZABC sont écrits sur chaque
 * mouvement des fichiers Apex, donc la seule présence d'un mot C ne dit rien de la machine.
 */
function declaredApexMachine(text: string): 'cartesian' | 'polar' | null {
  if (!hasApexSignature(text)) return null;
  const m = /^; apex_kinematics_json \{[^\r\n]*?"machine":"([^"]+)"/m.exec(text.slice(0, 20000));
  if (!m) return null;
  if (m[1] === 'cartesian') return 'cartesian';
  if (m[1] === 'apex-polar-4axis') return 'polar';
  return null;
}

export function parseGCode(text: string): ParsedGCode {
  const apexMachine = declaredApexMachine(text);
  // Cinématique AVANT toute durée de mouvement (moveLength lit la pointe). Absente : valeur des anciens fichiers.
  const declaredKinematics = parseKinematicsHeader(text);
  if (declaredKinematics && !isPreviewSupported(declaredKinematics)) {
    throw new Error(`Cinématique du G-code non prise en charge par l'aperçu (b_sign=${declaredKinematics.bSign}, tilt_sign=${declaredKinematics.tiltSign}, z_reference=${declaredKinematics.zReference}) : la pointe serait mal relue.`);
  }
  const kinematics = declaredKinematics ?? LEGACY_KINEMATICS;
  setActiveKinematics(kinematics);
  const moves: GCodeMove[] = [];
  const feeds: number[] = [];
  const eDeltas: number[] = [];
  const deposits: number[] = [];
  const retractionAt: number[] = [];
  const unretractionAt: number[] = [];
  const seamAt: number[] = [];

  let x = 0, y = 0, z = 0, b = 0, c = 0;
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
  // Fichier cartésien multi-axes (Unlayered Slicer) : B/C y sont l'orientation de l'outil, pas des
  // axes de position — X/Y/Z restent cartésiens. Reconnu à un mot C (le polaire Apex met l'angle
  // plateau dans Y) ou au marqueur `; TOOL_AXIS:`.
  let toolOriented = false;
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
  let nonplanarFeatures = false;
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
  // Correspondance mouvement → texte (cf. ParsedGCode.lineIndex et suivants).
  const lineIndices: number[] = [];
  const eAbsBefores: number[] = [];
  const eWordFlags: number[] = [];
  const eRelFlags: number[] = [];
  let currentLine = 0;
  let currentHasE = false;
  let currentEAbsBefore = NaN;
  let usesInches = false;

  const handleComment = (comment: string) => {
    if (TOOL_AXIS_RE.test(comment)) { if (!apexMachine) toolOriented = true; return; }
    if (WIPE_START_RE.test(comment)) { inWipe = true; return; }
    if (WIPE_END_RE.test(comment)) { inWipe = false; return; }
    if (!signature && moves.length < GENERATOR_SCAN_MOVES) signature = detectGeneratorSignature(comment);
    const feat = FEATURE_RE.exec(comment);
    if (feat && !comment.includes('=')) {
      feature = resolveLineType(feat[1]);
      if (feature === 'nonplanarSolidInfill' || feature === 'nonplanarTopSurface') nonplanarFeatures = true;
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

  const push = (nx: number, ny: number, nz: number, nb: number, de: number, nc = c) => {
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
    moves.push({ x: nx, y: ny, z: nz, b: nb, c: nc, extruding, type });
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
    lineIndices.push(currentLine);
    eAbsBefores.push(relativeXYZ || relativeE ? NaN : currentEAbsBefore);
    eWordFlags.push(currentHasE ? 1 : 0);
    eRelFlags.push(relativeXYZ || relativeE ? 1 : 0);

    x = nx; y = ny; z = nz; b = nb; c = nc;
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
    currentHasE = has(w.E);
    currentEAbsBefore = eAbs ?? NaN;
    if (!has(w.E)) return 0;
    const e = w.E * unit;
    if (relativeXYZ || relativeE) return e;
    const de = eAbs === null ? 0 : e - eAbs;
    eAbs = e;
    return de;
  };

  const lines = text.split('\n');
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const rawLine = lines[lineNo];
    currentLine = lineNo;
    currentHasE = false;
    currentEAbsBefore = eAbs ?? NaN;
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
        // Fichier Apex qui déclare sa machine : on ne la déduit pas des mots B et C (écrits à 0 sur tous les mouvements).
        if (apexMachine === 'polar') { if (has(w.B)) polar = true; }
        else if (apexMachine === null) {
          if (has(w.C)) toolOriented = true;
          if (has(w.B) && !toolOriented) polar = true;
        }
        if (has(w.F) && w.F > 0) feed = w.F * unit;
        // Orientation d'outil : B = −90 est l'outil vertical, donc l'inclinaison est B + 90.
        const bWord = toolOriented && has(w.B) ? w.B + 90 : w.B;
        if (!has(w.X) && !has(w.Y) && !has(w.Z) && !has(bWord) && !has(w.C) && !has(w.E)) break;
        const nx = axis(x, w.X, unit);
        const ny = axis(y, w.Y, unit);
        const nz = axis(z, w.Z, unit);
        const nb = toolOriented ? (has(bWord) ? bWord : b) : apexMachine === 'cartesian' ? 0 : axis(b, bWord, 1);
        push(nx, ny, nz, nb, extrusionDelta(), toolOriented && has(w.C) ? w.C : c);
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
        // G10 sans L/P/S : rétraction firmware (avec L/P : origine CNC ; avec S : température RRF — ignorés).
        if (!has(w.L) && !has(w.P) && !has(w.S)) push(x, y, z, b, -firmwareRetract);
        break;
      case 11:
        push(x, y, z, b, firmwareRetract);
        break;
      case 20: unit = 25.4; usesInches = true; break;
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
      if (!toolOriented) mv.b = 0;
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

  // Contours émis dans l'air par le PrusaSlicer à couches non planaires : requalifiés (rouge) avant les
  // statistiques, et leurs coutures retirées (une par tronçon : elles masqueraient le tracé).
  const airRanges: number[] = [];
  if (kind === 'cartesian' && nonplanarFeatures) {
    for (const run of findAirContours(moves)) {
      airRanges.push(run.start, run.end);
      for (let k = run.start; k <= run.end; k++) {
        if (moves[k].extruding && (moves[k].type === 'outerWall' || moves[k].type === 'innerWall')) moves[k].type = 'airContour';
      }
    }
    if (airRanges.length) {
      const inAir = (k: number) => {
        for (let r = 0; r < airRanges.length; r += 2) if (k >= airRanges[r] - 1 && k <= airRanges[r + 1]) return true;
        return false;
      };
      for (let i = seamAt.length - 1; i >= 0; i--) if (inAir(seamAt[i])) seamAt.splice(i, 1);
    }
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
  // PrusaSlicer modifié (couches non planaires) : ses marqueurs `;TYPE:Nonplanar …` n'existent pas dans l'original.
  if (generator && nonplanarFeatures && /PrusaSlicer/i.test(generator.name)) generator.name += ' (Non-planar fork)';

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
    kinematics,
    kinematicsDeclared: declaredKinematics !== null,
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
    toolOriented,
    bedCenter: usedCenter,
    conversion,
    offPlate: { moves: Uint32Array.from(offPlateMoves), traits: offPlateTraits },
    airContours: Uint32Array.from(airRanges),
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
    lineIndex: Uint32Array.from(lineIndices),
    eDelta: Float64Array.from(eDeltas),
    eAbsBefore: Float64Array.from(eAbsBefores),
    hasEWord: Uint8Array.from(eWordFlags),
    eRelative: Uint8Array.from(eRelFlags),
    usesInches,
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
    c: a.c + (b.c - a.c) * f,
  };
}


/** Axe de l'outil (vecteur unitaire, repère G-code X/Y/Z, orienté de la buse vers le haut de la tête)
 * au temps `t` d'un fichier à orientation d'outil : (cos C · sin β, sin C · sin β, cos β), β = `b`.
 * β est interpolé linéairement et C par le plus court chemin angulaire (un C qui passe de +179° à
 * −179° tourne de 2°, pas de 358°) : la rotation reste continue, sans passer par un axe nul même
 * pour un demi-tour de C. */
export function toolAxisAt(moves: GCodeMove[], t: number, out: { x: number; y: number; z: number }) {
  const i = Math.max(0, Math.min(moves.length - 1, Math.floor(t)));
  const a = moves[i];
  const m = moves[Math.min(moves.length - 1, i + 1)];
  const f = Math.max(0, Math.min(1, t - i));
  const dc = ((((m.c - a.c) % 360) + 540) % 360) - 180;
  const beta = (a.b + (m.b - a.b) * f) * DEG2RAD;
  const gamma = (a.c + dc * f) * DEG2RAD;
  out.x = Math.cos(gamma) * Math.sin(beta);
  out.y = Math.sin(gamma) * Math.sin(beta);
  out.z = Math.cos(beta);
  return out;
}
