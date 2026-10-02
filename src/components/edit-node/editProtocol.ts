import type { EditInfluence } from '@/utils/editKernelClient';

/**
 * Événements entre le panneau Édition (PreviewUpperTabs) et le contrôleur d'édition de la vue 3D
 * (gcodeEditController.ts), selon le bus `apex-*` de l'application.
 */

/** Réglages d'influence du panneau ; les poignées du nœud y ajoutent directions et ancrages. */
export type EditInfluenceSettings = Omit<EditInfluence, 'directions' | 'anchors'>;

export const DEFAULT_EDIT_INFLUENCE: EditInfluenceSettings = {
  // Portée minimale (toutes directions) : les poignées l'allongent dans leur sens.
  spatial: { enabled: true, radiusMm: 0.8, falloff: 'cubic' },
  along: { enabled: false, radiusMm: 10, falloff: 'cubic' },
  adjacency: { enabled: false, before: true, after: true, hopsBefore: 3, hopsAfter: 3, falloff: 'linear' },
  combine: 'product',
  directionSharpness: 2,
};

export type EditStatus = 'inactive' | 'unavailable' | 'unsupported' | 'loading' | 'ready' | 'error';

export interface EditDelta {
  r: number;
  c: number;
  z: number;
  b: number;
}

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
