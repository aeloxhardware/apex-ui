import type { LineTypeId } from '../gcodeLineTypes';
import type { ConversionMode, GCodeMove } from './types';
import {
  DEFAULT_ACCEL, DEFAULT_FEED_MM_MIN, DEFAULT_FILAMENT_DENSITY_G_CM3, DEFAULT_FILAMENT_DIAMETER_MM,
  DEFAULT_FIRMWARE_RETRACT_MM, DEFAULT_JERK, POLAR_LAYER_BUCKETS,
} from './constants';

/** Mots d'une ligne de commande (lettre → valeur), NaN si absent. */
export interface Words {
  X: number; Y: number; Z: number; B: number; C: number; E: number; F: number;
  I: number; J: number; R: number; L: number; P: number; S: number; T: number;
}
export const WORD_KEYS = ['X', 'Y', 'Z', 'B', 'C', 'E', 'F', 'I', 'J', 'R', 'L', 'P', 'S', 'T'] as const;

export type ApexMachine = 'cartesian' | 'polar' | null;

/**
 * État mutable d'une passe de lecture : modal du firmware (position, unités, modes d'extrusion),
 * réglages lus dans les commentaires, et colonnes parallèles aux mouvements. Passé explicitement à
 * chaque étape (commentaires, émission, commandes) ; aucun état global.
 */
export interface ParserState {
  apexMachine: ApexMachine;
  moves: GCodeMove[];
  feeds: number[];
  eDeltas: number[];
  deposits: number[];
  retractionAt: number[];
  unretractionAt: number[];
  seamAt: number[];

  x: number; y: number; z: number; b: number; c: number;
  feed: number;
  unit: number;
  relativeXYZ: boolean;
  relativeE: boolean;
  /** Position E absolue connue (mode M82) ; inconnue avant la première valeur E. */
  eAbs: number | null;
  feature: LineTypeId;
  inWipe: boolean;
  /** Filament actuellement rétracté (mm) : la part d'une extrusion qui ne fait que le réinjecter
   * n'est pas du dépôt. */
  retracted: number;
  prevRetracting: boolean;
  prevRestoring: boolean;
  polar: boolean;
  /** Fichier cartésien multi-axes (Unlayered Slicer) : B/C y sont l'orientation de l'outil. */
  toolOriented: boolean;
  extrudingCount: number;
  filamentDiameter: number;
  filamentDensity: number;
  firmwareRetract: number;
  bedCenter: { x: number; y: number } | null;

  accels: number[];
  jerks: number[];
  accelsToDecel: number[];
  accelToDecel: number;
  accelPrint: number;
  accelTravel: number;
  jerk: number;
  maxSpeed: number;
  headerMaxSpeed: number;

  /** Plateau décrit par dimensions (IceSL : bed_size_x_mm/bed_size_y_mm, origine au centre si rond). */
  bedSizeX: number;
  bedSizeY: number;
  bedCircular: boolean;
  printer: string | null;
  signature: string | null;
  featureStyleGuess: string | null;
  nonplanarFeatures: boolean;
  iceSLLayers: boolean;
  conversion: ConversionMode | null;

  /** Consignes commandées (pas l'état « atteint »), pour la coloration « colorer par ». */
  nozzleTemp: number;
  bedTemp: number;
  fanPct: number;
  /** Largeur de cordon explicite (`;WIDTH:`), modale — NaN si le générateur ne l'écrit pas. */
  explicitWidth: number;
  temps: number[];
  bedTemps: number[];
  fans: number[];
  widths: number[];

  /** Détection de couche cartésienne (palier Z) et polaire (dernier dépôt au même angle C). */
  prevLayerExtrudingZ: number | null;
  layerIdx: number;
  polarLayerZByBucket: Float32Array;
  layerHeights: number[];
  layerIndices: number[];

  /** Correspondance mouvement → texte (cf. ParsedGCode.lineIndex et suivants). */
  lineIndices: number[];
  eAbsBefores: number[];
  eWordFlags: number[];
  eRelFlags: number[];
  currentLine: number;
  currentHasE: boolean;
  currentEAbsBefore: number;
  usesInches: boolean;

  /** Mots de la ligne en cours. */
  w: Words;
}

export function createParserState(apexMachine: ApexMachine): ParserState {
  return {
    apexMachine,
    moves: [], feeds: [], eDeltas: [], deposits: [],
    retractionAt: [], unretractionAt: [], seamAt: [],
    x: 0, y: 0, z: 0, b: 0, c: 0,
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
    accels: [], jerks: [], accelsToDecel: [],
    accelToDecel: Infinity,
    accelPrint: DEFAULT_ACCEL,
    accelTravel: DEFAULT_ACCEL,
    jerk: DEFAULT_JERK,
    maxSpeed: Infinity,
    headerMaxSpeed: Infinity,
    bedSizeX: 0, bedSizeY: 0, bedCircular: false,
    printer: null,
    signature: null,
    featureStyleGuess: null,
    nonplanarFeatures: false,
    iceSLLayers: false,
    conversion: null,
    nozzleTemp: 0, bedTemp: 0, fanPct: 0,
    explicitWidth: NaN,
    temps: [], bedTemps: [], fans: [], widths: [],
    prevLayerExtrudingZ: null,
    layerIdx: 0,
    polarLayerZByBucket: new Float32Array(POLAR_LAYER_BUCKETS).fill(NaN),
    layerHeights: [], layerIndices: [],
    lineIndices: [], eAbsBefores: [], eWordFlags: [], eRelFlags: [],
    currentLine: 0,
    currentHasE: false,
    currentEAbsBefore: NaN,
    usesInches: false,
    w: {} as Words,
  };
}
