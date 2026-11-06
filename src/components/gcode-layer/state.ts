import type * as BABYLON from 'babylonjs';
import { DEFAULT_LINE_VISIBILITY, type LineTypeVisibility } from '../gcodeLineTypes';
import type { ColorByScope } from '../gcodeColormap';
import type { ColorByMode, ParsedGCode } from '../gcodeParse';
import type { LayerHead } from './head';
import type { LayerMaterials } from './materials';
import type { PathSampler } from './sampler';
import type { MarkerEntry, PathEntry } from './types';

/** Dernier jeu de poids d'édition posé (à reposer sur les maillages après une reconstruction). */
export interface EditWeights {
  indices: Uint32Array;
  weights: Float32Array;
  slideNormals?: Float32Array;
  axes?: Float32Array;
}

/**
 * État partagé du calque. Chaque module (lecture, coloration, sélection, édition, construction)
 * lit et modifie ce même objet ; aucun n'en garde de copie.
 */
export interface LayerState {
  scene: BABYLON.Scene;
  plateNode: BABYLON.TransformNode;
  materials: LayerMaterials;
  head: LayerHead;
  disposed: boolean;

  parsed: ParsedGCode | null;
  sampler: PathSampler | null;
  segments: Uint32Array;
  paths: PathEntry[];
  markers: MarkerEntry[];
  offPlatePath: PathEntry | null;
  /** Position de lecture, en index de mouvement fractionnaire. */
  time: number;
  visibility: LineTypeVisibility;

  /** Mode de coloration actif et sa portée affichée (cf. setColorBy). */
  colorBy: ColorByMode;
  colorByScope: ColorByScope;
  /** Longueur max (mm) d'un sous-segment cartésien en mode continu ; null = un anneau par mouvement. */
  renderPrecisionMm: number | null;
  editNeutral: boolean;
  highlightOffPlate: boolean;
  blinkingOffPlate: boolean;

  /** Drapeaux d'édition par mouvement (bits EDIT_FLAG_*), écrits dans l'attribut de poids. */
  moveFlags: Uint8Array | null;
  flagSets: Map<number, Uint32Array>;
  lastWeights: EditWeights | null;
  travelPreviewKeys: Set<number>;
}

export function createLayerState(
  scene: BABYLON.Scene,
  plateNode: BABYLON.TransformNode,
  materials: LayerMaterials,
  head: LayerHead,
): LayerState {
  return {
    scene, plateNode, materials, head,
    disposed: false,
    parsed: null,
    sampler: null,
    segments: new Uint32Array(0),
    paths: [],
    markers: [],
    offPlatePath: null,
    time: 0,
    visibility: { ...DEFAULT_LINE_VISIBILITY },
    colorBy: 'lineType',
    colorByScope: { min: 0, max: 0, grayOutOfScope: false },
    renderPrecisionMm: null,
    editNeutral: false,
    highlightOffPlate: false,
    blinkingOffPlate: false,
    moveFlags: null,
    flagSets: new Map(),
    lastWeights: null,
    travelPreviewKeys: new Set(),
  };
}
