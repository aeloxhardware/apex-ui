import * as BABYLON from 'babylonjs';
import type { GCodeLayer } from '../gcodeLayer';
import { editKernel } from '@/utils/editKernelClient';
import type { EditNodeHandle, HandleDragEvent } from './EditNode';
import { setupEditControllerState } from './controllerParts/controllerSetup';
import { setupEditControllerProjection } from './controllerParts/controllerProjection';
import { setupEditControllerValidation } from './controllerParts/controllerValidation';
import { setupEditControllerKernel } from './controllerParts/controllerKernel';
import { setupEditControllerJournal } from './controllerParts/controllerJournal';
import { setupEditControllerWeights } from './controllerParts/controllerWeights';
import { setupEditControllerNodes } from './controllerParts/controllerNodes';
import { setupEditControllerDrag } from './controllerParts/controllerDrag';
import { setupEditControllerSymmetry } from './controllerParts/controllerSymmetry';
import { setupEditControllerHistory } from './controllerParts/controllerHistory';
import { setupEditControllerEvents } from './controllerParts/controllerEvents';
import { createEditControllerState } from './controllerParts/controllerState';
export type { EditNodeView, EditOverlayView } from './controllerParts/controllerShared';
import { type EditOverlayView } from './controllerParts/controllerShared';

export interface GCodeEditController {
  /** À rappeler quand l'onglet, l'espace ou le fichier changent. */
  refresh(): void;
  subscribe(listener: (view: EditOverlayView) => void): () => void;
  /** Appelé après chaque rendu de la scène (rendu du verre, synchronisé sur l'image). */
  onAfterRender(listener: () => void): () => void;
  /** Rend le nœud `id` actif (développé) ; l'actif précédent est réduit. */
  activateNode(id: number): void;
  /** Réduit le nœud `id` (il reste posé). */
  deactivateNode(id: number): void;
  onNodeMove(id: number, x: number, y: number): void;
  onNodeMoveEnd(id: number): void;
  togglePositionLock(id: number): void;
  /** Double-clic sur le nœud : bascule son rognage. */
  toggleTrimming(id: number): void;
  onHandlesChange(id: number, handles: EditNodeHandle[]): void;
  onHandleDrag(id: number, e: HandleDragEvent): void;
  /** Essais automatisés (développement) : position écran (px CSS du canevas) du mouvement k. */
  debugProjectMove(k: number): { x: number; y: number } | null;
  /** Essais automatisés (développement) : G-code affiché, modifications comprises. */
  debugParsed(): unknown;
  /** Essais automatisés (développement) : le point `index` peut-il porter un nœud ? (raison du refus
   * ou nombre de points touchés ; l'influence du nœud actif est ensuite recalculée). */
  debugTryHandle(index: number): Promise<string>;
  /** Essais automatisés (développement) : dernière réponse de glissement du noyau. */
  debugLastDrag(): unknown;
  /** Essais automatisés (développement) : état interne (aperçu actif, onglet, statut, nœuds). */
  debugStatus(): unknown;
  /** Essais automatisés (développement) : client du noyau (requêtes directes). */
  debugKernel(): typeof editKernel;
  /** Essais automatisés (développement) : pose un nœud sur le mouvement k sans passer par un clic. */
  debugPlaceNode(k: number): void;
  dispose(): void;
}

export function createGCodeEditController(opts: {
  scene: BABYLON.Scene;
  engine: BABYLON.AbstractEngine;
  camera: BABYLON.Camera;
  canvas: HTMLCanvasElement;
  layer: GCodeLayer;
  isPreviewActive: () => boolean;
}): GCodeEditController {
  const { scene, engine, camera, canvas, layer } = opts;
  const st = createEditControllerState({ camera, engine, canvas, layer, opts, scene });
  setupEditControllerState(st);
  setupEditControllerProjection(st);
  setupEditControllerValidation(st);
  setupEditControllerKernel(st);
  setupEditControllerJournal(st);
  setupEditControllerWeights(st);
  setupEditControllerNodes(st);
  setupEditControllerDrag(st);
  setupEditControllerSymmetry(st);
  setupEditControllerHistory(st);
  return setupEditControllerEvents(st);
}
