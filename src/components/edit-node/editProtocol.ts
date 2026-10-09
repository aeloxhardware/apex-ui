import type { EditInfluence } from '@/utils/editKernelClient';
import { DEFAULT_MACHINE_LIMITS, type MachineLimits } from '@/utils/machineLimits';
import { DEFAULT_LAYER_LIMITS, type LayerLimits } from '@/utils/layerLimits';

/**
 * Événements entre le panneau Édition (PreviewUpperTabs) et le contrôleur d'édition de la vue 3D
 * (gcodeEditController.ts), selon le bus `apex-*` de l'application.
 */

/** Mode d'influence : `reach` (Portée) = l'influence ne dépasse pas la portée des poignées, le nœud
 * freine quand elle ne peut plus absorber la déformation ; `auto` = la portée s'élargit autant qu'il
 * faut, jusqu'à tout l'objet, pour atteindre la trajectoire voulue. */
export type EditReachMode = 'reach' | 'auto';

/** Réglages d'influence du panneau ; les poignées du nœud y ajoutent directions et ancrages. */
export type EditInfluenceSettings = Omit<EditInfluence, 'directions' | 'anchors' | 'dragDirection' | 'trim'> & {
  reachMode: EditReachMode;
  /** Couches de chaque côté de celle du nœud qui peuvent se déformer quand le rognage du nœud est actif. */
  trimLayers: number;
};

export const DEFAULT_EDIT_INFLUENCE: EditInfluenceSettings = {
  reachMode: 'auto',
  // Portée minimale (toutes directions) : les poignées l'allongent dans leur sens.
  spatial: { enabled: true, radiusMm: 0.8, falloff: 'cubic' },
  along: { enabled: false, radiusMm: 10, falloff: 'cubic' },
  adjacency: { enabled: false, before: true, after: true, hopsBefore: 3, hopsAfter: 3, falloff: 'linear' },
  combine: 'product',
  directionSharpness: 2,
  // Recalcul de E (D3) : automatique par défaut, facteur manuel 1.
  extrusion: { mode: 'auto', factor: 1 },
  // Lissage automatique de B après une modification : option, désactivée par défaut.
  smoothB: 0,
  smoothBIterations: 8,
  // Barrière d'influence aux changements de type de ligne : option, désactivée.
  typeBarrier: false,
  // Rognage : seule la couche du nœud se déforme par défaut.
  trimLayers: 0,
  // Re-tranchage : au-delà de l'épaisseur maximale, des couches sont interpolées plutôt que de freiner.
  reslice: true,
  resliceMaxLayers: 4,
};

export type EditStatus = 'inactive' | 'unavailable' | 'unsupported' | 'loading' | 'ready' | 'error';

export interface EditDelta {
  r: number;
  c: number;
  z: number;
  b: number;
  /** Rapport E après / E avant du segment qui arrive au point du nœud (NaN sans extrusion). */
  eRatio: number;
}

/** Épaisseurs de couche pendant le glissement (calculées par le noyau, aperçu de la nouvelle hauteur). */
export interface EditThickness {
  /** Épaisseur du point du nœud après déformation (mm) ; null si inconnue. */
  node: number | null;
  /** Épaisseur du nœud avant déformation. */
  nodeBefore: number | null;
  min: number;
  max: number;
  thinner: number;
  thicker: number;
  outOfBounds: number;
  minLimit: number;
  maxLimit: number;
}

/** Validation physique par le noyau (limites de B, collisions, écart tête / normale). */
export interface EditValidationSummary {
  bRange: number;
  bSpeed: number;
  bAccel: number;
  headPart: number;
  headPlate: number;
  posesTested: number;
  collisionChecked: boolean;
  timingKnown: boolean;
  /** Points hors limites dans tout le fichier (B). */
  fileBViolations: number;
  /** Écart tête / normale (°) le long de la zone jugée, échantillonné. */
  normalIndices: Uint32Array;
  normalDeviation: Float32Array;
  normalWorst: number;
}

export type EditSymmetryMode = 'none' | 'cyclic' | 'mirror';
export interface EditSymmetry {
  mode: EditSymmetryMode;
  /** Symétrie cyclique : nombre de répétitions autour de l'axe du plateau (2 à 12). */
  count: number;
  /** Symétrie miroir : angle C (°) du plan qui contient l'axe du plateau. */
  mirrorDeg: number;
}

export type EditLockMode = 'lock' | 'unlock' | null;

export interface EditStateDetail {
  status: EditStatus;
  message: string | null;
  placing: boolean;
  hasNode: boolean;
  busy: boolean;
  undoDepth: number;
  redoDepth: number;
  /** Points déplacés par le nœud courant. */
  affected: number;
  /** Déplacement firmware exact du point du nœud pendant / après le glissement. */
  delta: EditDelta | null;
  influence: EditInfluenceSettings;
  /** Rognage du nœud actif ; null sans nœud. */
  nodeTrimming: boolean | null;
  /** Dépôts que la déformation en cours rogne (aperçu). */
  trimmed: number;
  /** Re-tranchage : points dont la couche sera subdivisée par des couches interpolées (aperçu), et nombre de
   * couches que cela insérera au plus. */
  reslicePoints: number;
  resliceMaxCount: number;
  thickness: EditThickness | null;
  validation: EditValidationSummary | null;
  /** Points de matière verrouillés. */
  locks: number;
  lockMode: EditLockMode;
  lockRadiusMm: number;
  /** Une déformation a été copiée (Coller disponible). */
  canPaste: boolean;
  symmetry: EditSymmetry;
  limits: MachineLimits;
  /** Bornes d'épaisseur de couche (mm) et largeur variable. */
  layerLimits: LayerLimits;
  /** Capacité d'épaisseur du nœud actif le long de l'empilement (mm) ; null : illimitée / inconnue. */
  capacityMm: number | null;
  /** Translation axiale demandée pendant le glissement (mm, valeur absolue). */
  requestedAxialMm: number | null;
  /** Le modèle de la tête est chargé (contrôle des collisions possible). */
  headModel: boolean;
}

/** Contrôleur → panneau. */
export const EDIT_STATE_EVENT = 'apex-edit-state';
/** Panneau → contrôleur. */
export const EDIT_PLACE_EVENT = 'apex-edit-place-mode'; // { active }
export const EDIT_INFLUENCE_EVENT = 'apex-edit-influence'; // { influence }
export const EDIT_UNDO_EVENT = 'apex-edit-undo';
export const EDIT_REDO_EVENT = 'apex-edit-redo';
export const EDIT_REMOVE_NODE_EVENT = 'apex-edit-remove-node';
export const EDIT_REQUEST_STATE_EVENT = 'apex-edit-request-state';
/** Saisie numérique d'un déplacement exact du point du nœud : { values: {r?, c?, z?, b?}, commit } (Δ en mm / °). */
export const EDIT_SET_DELTA_EVENT = 'apex-edit-set-delta';
/** Verrouillage de zones de matière : { mode: 'lock' | 'unlock' | null, radiusMm } ; effacer tout. */
export const EDIT_LOCK_MODE_EVENT = 'apex-edit-lock-mode';
export const EDIT_CLEAR_LOCKS_EVENT = 'apex-edit-clear-locks';
/** Copier la déformation du nœud actif / la coller sur le nœud actif (exprimée dans le repère de la tête). */
export const EDIT_COPY_EVENT = 'apex-edit-copy';
export const EDIT_PASTE_EVENT = 'apex-edit-paste';
export const EDIT_SYMMETRY_EVENT = 'apex-edit-symmetry'; // { symmetry }
export const EDIT_LIMITS_EVENT = 'apex-edit-limits'; // { limits }
export const EDIT_LAYER_LIMITS_EVENT = 'apex-edit-layer-limits'; // { layerLimits }
/** Analyse du fichier entier : limites de B et, si demandé, collisions (échantillonnées). */
export const EDIT_ANALYZE_EVENT = 'apex-edit-analyze'; // { collisions }

export const DEFAULT_EDIT_SYMMETRY: EditSymmetry = { mode: 'none', count: 2, mirrorDeg: 0 };
export const DEFAULT_LOCK_RADIUS_MM = 2;
export { DEFAULT_MACHINE_LIMITS, DEFAULT_LAYER_LIMITS };

/** Panneau → lecteur de G-code (use-gcode-preview, qui détient le texte et le fichier) :
 * enregistrer le G-code modifié, en place (`inplace`) ou en copie (`copy`). */
export const EDIT_SAVE_EVENT = 'apex-edit-save';

export type EditSaveMode = 'inplace' | 'copy';

/** Lecteur de G-code → panneau : le fichier affiché peut-il être modifié en place ? (D4 : tranché
 * par Apex et chemin connu ; sinon EXPORT COPY seulement.) Réémis sur EDIT_REQUEST_STATE_EVENT. */
export const EDIT_FILE_INFO_EVENT = 'apex-edit-file-info';
export interface EditFileInfo {
  name: string | null;
  canSaveInPlace: boolean;
}
