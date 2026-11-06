// Issu de la découpe de createGCodeLayer (gcodeLayer.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (gcodeLayerState.ts).
import * as BABYLON from 'babylonjs';
import { type LineTypeId, type LineTypeVisibility } from '../gcodeLineTypes';
import { type ColorByScope } from '../gcodeColormap';
import { type ColorByMode, type ParsedGCode } from '../gcodeParse';
import { type PathSampler } from '../gcodeLayerGeometry';
import type { PickGrid } from './gcodeLayerTypes';
import { type MarkerEntry, type PathEntry } from './gcodeLayerShared';

export interface GCodeLayerState {
  root: BABYLON.TransformNode;
  scene: BABYLON.Scene;
  parent: BABYLON.TransformNode;
  plateNode: BABYLON.TransformNode;
  headNode: BABYLON.TransformNode;
  fullHead: boolean;
  nozzle: BABYLON.Mesh;
  bodyMat: BABYLON.StandardMaterial;
  body: BABYLON.Mesh;
  headModelNozzleMeshes: BABYLON.AbstractMesh[] | null;
  headModelReady: boolean;
  applyHeadVisibility: () => void;
  disposed: boolean;
  colors: Record<LineTypeId, BABYLON.Color3>;
  beadMaterials: Map<LineTypeId, BABYLON.StandardMaterial>;
  vertexColorBeadMat: BABYLON.StandardMaterial;
  neutralBeadMat: BABYLON.StandardMaterial;
  editNeutral: boolean;
  liveColorByMat: BABYLON.StandardMaterial;
  livePositions: Float32Array<ArrayBuffer>;
  liveNormals: Float32Array<ArrayBuffer>;
  liveBead: BABYLON.Mesh;
  livePoints: BABYLON.Vector3[];
  liveLine: BABYLON.LinesMesh;
  liveA: BABYLON.Vector3;
  liveB: BABYLON.Vector3;
  liveAxA: BABYLON.Vector3;
  liveAxB: BABYLON.Vector3;
  parsed: ParsedGCode | null;
  sampler: PathSampler | null;
  segments: Uint32Array<ArrayBuffer>;
  paths: PathEntry[];
  markers: MarkerEntry[];
  renderPrecisionMm: number | null;
  offPlateMat: BABYLON.StandardMaterial;
  offPlateHazardMat: BABYLON.ShaderMaterial;
  offPlatePath: PathEntry | null;
  highlightOffPlate: boolean;
  blinkingOffPlate: boolean;
  offPlateBlinkObserver: BABYLON.Observer<BABYLON.Scene> | null;
  offPlateBlinkStart: number;
  OFF_PLATE_HAZARD_SPEED: number;
  time: number;
  visibility: LineTypeVisibility;
  colorBy: ColorByMode;
  colorByScope: ColorByScope;
  colorScratch: BABYLON.Color3;
  up: BABYLON.Vector3;
  headDir: BABYLON.Vector3;
  headTip: { r: number; z: number; };
  toolAxis: { x: number; y: number; z: number; };
  apply: () => void;
  onPlateRotation: ((rotationY: number) => void) | undefined;
  updateLive: (i: number, next: number, t: number) => void;
  applyVisibility: () => void;
  deferredColorByRaf: number;
  applyColorBy: () => void;
  disposeAll: () => void;
  buildSeq: number;
  buildAll: (next: ParsedGCode, keepOld?: boolean) => Promise<void>;
  pickBuildSeq: number;
  pickGrid: PickGrid | null;
  pickHighlight: BABYLON.Mesh | null;
  moveFlags: Uint8Array | null;
  flagSets: Map<number, Uint32Array<ArrayBufferLike>>;
  lastWeights: {
    indices: Uint32Array; weights: Float32Array; slideNormals?: Float32Array | undefined; axes?: Float32Array | undefined;
  } | null;
  travelPreviewKeys: Set<number>;
  pickWanted: boolean;
  buildPickIndex: () => Promise<void>;
  setEditWeights: (indices: Uint32Array | null, weights?: Float32Array | undefined, slideNormals?: Float32Array | undefined, axes?: Float32Array) => void;
  PICK_CELL_MM: number;
  PICK_MAX_CELLS: number;
  PICK_PAD_MM: number;
  pickQuery: number;
  pickA: BABYLON.Vector3;
  pickB: BABYLON.Vector3;
  buildPickGrid: (p: ParsedGCode, sam: PathSampler) => Generator<void, PickGrid | null, void>;
  pickAt: (ray: BABYLON.Ray, pxPerUnit: number, fixedDistance?: number) => { t: number; local: BABYLON.Vector3; } | null;
  flagOfSample: (k: number, f: number) => number;
  lowerBound: (owner: Uint32Array, k: number) => number;
  setEditFlagBit: (bit: number, indices: Uint32Array | null) => void;
  tmpA: BABYLON.Vector3;
  setTravelPreview: (indices: Uint32Array | null, tips?: Float32Array) => void;
  getHeadSamples: (spacingMm?: number) => Float32Array | null;
  rewriteBeadSamples: (entry: PathEntry, a: number, b: number) => void;
  applyMoveEdits: (indices: Uint32Array, values: Float64Array, trimmed?: Uint32Array, trimState?: boolean) => void;
}

/** Ce que l'appelant fournit au départ (paramètres de createGCodeLayer). */
export type GCodeLayerStateHost = Pick<GCodeLayerState, 'scene' | 'parent' | 'onPlateRotation'>;

/** État partagé entre les morceaux d'initialisation : l'hôte au départ, le reste rempli au fil des morceaux. */
export function createGCodeLayerState(host: GCodeLayerStateHost): GCodeLayerState {
  return { ...host } as GCodeLayerState;
}
