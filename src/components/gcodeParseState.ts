import { LINE_TYPES, type LineTypeId } from './gcodeLineTypes';
import { hasApexSignature } from '@/utils/apexSignature';
import { LEGACY_KINEMATICS, isPreviewSupported, parseKinematicsHeader, setActiveKinematics, type Kinematics } from '@/utils/kinematics';
import type { GCodeMove, LineTypeStat } from './gcodeTypes';
import {
  DEFAULT_ACCEL, DEFAULT_FEED_MM_MIN, DEFAULT_FILAMENT_DENSITY_G_CM3, DEFAULT_FILAMENT_DIAMETER_MM,
  DEFAULT_FIRMWARE_RETRACT_MM, DEFAULT_JERK, POLAR_LAYER_BUCKETS, type ConversionMode,
} from './gcodeParseConstants';

/** Cumul de lignes de statistiques vides, une par type de ligne. */
export const emptyStats = () =>
  Object.fromEntries(LINE_TYPES.map((t) => [t.id, { time: 0, filamentMm: 0, massG: 0 }])) as Record<LineTypeId, LineTypeStat>;

/** Mots d'une ligne de commande (lettre → valeur), NaN si absent. */
export interface Words {
  X: number; Y: number; Z: number; B: number; C: number; E: number; F: number;
  I: number; J: number; R: number; L: number; P: number; S: number; T: number;
}
export const WORD_KEYS = ['X', 'Y', 'Z', 'B', 'C', 'E', 'F', 'I', 'J', 'R', 'L', 'P', 'S', 'T'] as const;


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

/** Tout l'état mutable d'un passage d'analyse : modes modaux, position, tableaux par mouvement, en-têtes lus. */
export interface ParseState {
  readonly apexMachine: 'cartesian' | 'polar' | null;
  readonly declaredKinematics: Kinematics | null;
  readonly kinematics: Kinematics;
  readonly moves: GCodeMove[];
  readonly feeds: number[];
  readonly eDeltas: number[];
  readonly deposits: number[];
  readonly retractionAt: number[];
  readonly unretractionAt: number[];
  readonly seamAt: number[];
  x: number;
  y: number;
  z: number;
  b: number;
  c: number;
  feed: number;
  unit: number;
  relativeXYZ: boolean;
  relativeE: boolean;
  eAbs: number | null;
  feature: LineTypeId;
  inWipe: boolean;
  retracted: number;
  prevRetracting: boolean;
  prevRestoring: boolean;
  polar: boolean;
  toolOriented: boolean;
  extrudingCount: number;
  filamentDiameter: number;
  filamentDensity: number;
  firmwareRetract: number;
  bedCenter: { x: number; y: number } | null;
  readonly accels: number[];
  readonly jerks: number[];
  readonly accelsToDecel: number[];
  accelToDecel: number;
  accelPrint: number;
  accelTravel: number;
  jerk: number;
  maxSpeed: number;
  headerMaxSpeed: number;
  bedSizeX: number;
  bedSizeY: number;
  bedCircular: boolean;
  printer: string | null;
  signature: string | null;
  featureStyleGuess: string | null;
  nonplanarFeatures: boolean;
  iceSLLayers: boolean;
  conversion: ConversionMode | null;
  nozzleTemp: number;
  bedTemp: number;
  fanPct: number;
  explicitWidth: number;
  readonly temps: number[];
  readonly bedTemps: number[];
  readonly fans: number[];
  readonly widths: number[];
  prevLayerExtrudingZ: number | null;
  layerIdx: number;
  readonly polarLayerZByBucket: Float32Array;
  readonly layerHeights: number[];
  readonly layerIndices: number[];
  readonly lineIndices: number[];
  readonly eAbsBefores: number[];
  readonly eWordFlags: number[];
  readonly eRelFlags: number[];
  currentLine: number;
  currentHasE: boolean;
  currentEAbsBefore: number;
  usesInches: boolean;
  /** Mots de la ligne de commande courante. */
  readonly w: Words;
}

/** État initial ; lit d'abord la cinématique déclarée (avant toute durée de mouvement : moveLength lit la pointe). */
export function createParseState(text: string): ParseState {
  const apexMachine = declaredApexMachine(text);
  const declaredKinematics = parseKinematicsHeader(text);
  if (declaredKinematics && !isPreviewSupported(declaredKinematics)) {
    throw new Error(`Cinématique du G-code non prise en charge par l'aperçu (b_sign=${declaredKinematics.bSign}, tilt_sign=${declaredKinematics.tiltSign}, z_reference=${declaredKinematics.zReference}) : la pointe serait mal relue.`);
  }
  const kinematics = declaredKinematics ?? LEGACY_KINEMATICS; setActiveKinematics(kinematics);
  return {
    apexMachine, declaredKinematics, kinematics,
    moves: [],
    feeds: [],
    eDeltas: [],
    deposits: [],
    retractionAt: [],
    unretractionAt: [],
    seamAt: [],
    x: 0,
    y: 0,
    z: 0,
    b: 0,
    c: 0,
    feed: DEFAULT_FEED_MM_MIN,
    unit: 1,
    relativeXYZ: false,
    relativeE: false,
    eAbs: null,
    feature: 'custom',
    inWipe: false,
    retracted: 0,
    prevRetracting: false,
    prevRestoring: false,
    polar: false,
    toolOriented: false,
    extrudingCount: 0,
    filamentDiameter: DEFAULT_FILAMENT_DIAMETER_MM,
    filamentDensity: DEFAULT_FILAMENT_DENSITY_G_CM3,
    firmwareRetract: DEFAULT_FIRMWARE_RETRACT_MM,
    bedCenter: null,
    accels: [],
    jerks: [],
    accelsToDecel: [],
    accelToDecel: Infinity,
    accelPrint: DEFAULT_ACCEL,
    accelTravel: DEFAULT_ACCEL,
    jerk: DEFAULT_JERK,
    maxSpeed: Infinity,
    headerMaxSpeed: Infinity,
    bedSizeX: 0,
    bedSizeY: 0,
    bedCircular: false,
    printer: null,
    signature: null,
    featureStyleGuess: null,
    nonplanarFeatures: false,
    iceSLLayers: false,
    conversion: null,
    nozzleTemp: 0,
    bedTemp: 0,
    fanPct: 0,
    explicitWidth: NaN,
    temps: [],
    bedTemps: [],
    fans: [],
    widths: [],
    prevLayerExtrudingZ: null,
    layerIdx: 0,
    polarLayerZByBucket: new Float32Array(POLAR_LAYER_BUCKETS).fill(NaN),
    layerHeights: [],
    layerIndices: [],
    lineIndices: [],
    eAbsBefores: [],
    eWordFlags: [],
    eRelFlags: [],
    currentLine: 0,
    currentHasE: false,
    currentEAbsBefore: NaN,
    usesInches: false,
    w: {} as Words,
  };
}
