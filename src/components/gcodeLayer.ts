import * as BABYLON from 'babylonjs';
import 'babylonjs-loaders';
import { type LineTypeVisibility } from './gcodeLineTypes';
import { type ColorByScope } from './gcodeColormap';

import { type ColorByMode, type ParsedGCode } from './gcodeParse';

// Le parseur (sans Babylon) vit dans gcodeParse.ts pour pouvoir tourner dans un Web Worker ;
// ré-exporté ici pour que les importeurs existants de gcodeLayer ne changent pas.
export * from './gcodeParse';

import { setupGCodeLayerScene } from './gcodeLayerParts/layerScene';
import { setupGCodeLayerBuild } from './gcodeLayerParts/layerBuild';
import { setupGCodeLayerPick } from './gcodeLayerParts/layerPick';
import { setupGCodeLayerEdit } from './gcodeLayerParts/layerEdit';
import { setupGCodeLayerApi } from './gcodeLayerParts/layerApi';
import { createGCodeLayerState } from './gcodeLayerParts/gcodeLayerState';
export { GCODE_MESH_PREFIX } from './gcodeLayerParts/gcodeLayerShared';


export interface GCodeLayer {
  /** Construit le maillage par tranches (l'interface ne gèle pas) ; résolu une fois affiché. */
  load(parsed: ParsedGCode): Promise<void>;
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
  /** Active la sélection d'un point de trajectoire : construit (par tranches) l'index spatial qui
   * rend `pickAt` instantané même sur des millions de mouvements. */
  setPickingEnabled(enabled: boolean): void;
  /** Point de trajectoire visible (déposé, type affiché) le plus proche du rayon monde `ray`, ou
   * null. `pxPerUnit` : taille monde d'un pixel à 1 unité de distance de la caméra (tolérance de
   * visée de quelques pixels ; `fixedDistance` : distance à utiliser à la place de celle du point sur
   * le rayon, pour la vue orthographique où l'échelle ne dépend pas de la distance). `t` : index de mouvement fractionnaire où la tête dépose ce point
   * (cf. `setTime`) ; `local` : sa position dans le repère du plateau. */
  pickAt(ray: BABYLON.Ray, pxPerUnit: number, fixedDistance?: number): { t: number; local: BABYLON.Vector3 } | null;
  /** Surligne un point (repère du plateau, cf. `pickAt`) ; null l'éteint. */
  setPickHighlight(local: BABYLON.Vector3 | null): void;
  setEnabled(enabled: boolean): void;
  /** Rotation courante du plateau autour de Y (radians, repère Babylon), 0 sans G-code. */
  getPlateRotation(): number;
  /** G-code affiché (null tant qu'aucun n'est construit). Ses mouvements sont ceux que l'édition
   * modifie en place (`applyMoveEdits`). */
  getParsed(): ParsedGCode | null;
  /** Repère du plateau (monde ← plateau), pour convertir les positions éditées. */
  getPlateWorldMatrix(): BABYLON.Matrix;
  /** Pointe de buse à la fin du mouvement k, repère du plateau. */
  getMoveTip(k: number, out: BABYLON.Vector3): BABYLON.Vector3;
  /** Édition : poids d'influence par mouvement (indices croissants), appliqués par le vertex shader
   * des cordons ; null les efface. Recalcul une fois par pose / réglage, jamais par image. */
  setEditWeights(indices: Uint32Array | null, weights?: Float32Array | undefined, slideNormals?: Float32Array | undefined, axes?: Float32Array): void;
  /** Onglet Édition : cordons en gris neutre (vrai) ou selon le mode « colorer par » (faux). */
  setEditNeutral(neutral: boolean): void;
  /** Édition : déformation en direct des points pondérés (repère du plateau),
   * p' = pivot + R(w·angle, axe)(p − pivot) + w·translation. */
  setEditTransform(transform: {
    translation: BABYLON.Vector3;
    pivot: BABYLON.Vector3;
    axis: BABYLON.Vector3;
    angle: number;
    /** Mode « empilement » : axe de tête du nœud (local) ; absent ou nul hors de ce mode. */
    stackAxis?: BABYLON.Vector3 | undefined;
  }): void;
  /** Édition : nouvelles valeurs validées par le noyau (R, C, Z, B, E par indice) — met à jour
   * les mouvements, l'extrusion (`eDelta`), la liste des mouvements modifiés (`editedMoves`), et
   * réécrit en place la géométrie des seuls segments touchés. */
  applyMoveEdits(indices: Uint32Array, values: Float64Array, trimmed?: Uint32Array, trimState?: boolean): void;
  /** Édition : des mouvements ont été insérés ou retirés de `parsed` (re-tranchage, indices décalés) :
   * reconstruit les maillages ; l'ancien affichage reste visible jusqu'à la fin, sans clignotement. Les
   * drapeaux, poids et aperçus d'édition décrivaient l'ancienne numérotation : ils sont effacés. */
  replaceMoves(parsed: ParsedGCode): Promise<void>;
  /** Édition : pose (ou retire, avec null) un drapeau d'alerte / d'état sur des mouvements. `bit` : l'un
   * des EDIT_FLAG_* (gcodeEditDeform.ts) ; l'ensemble précédent de ce bit est remplacé. */
  setEditFlagBit(bit: number, indices: Uint32Array | null): void;
  /** Édition : aperçu des déplacements à vide pendant un glissement. `tips` : positions déformées
   * (repère du plateau, x y z par indice) ; null rétablit la géométrie validée. */
  setTravelPreview(indices: Uint32Array | null, tips?: Float32Array): void;
  /** Modèle de la tête échantillonné pour les collisions (repère de la tête, pointe à l'origine, x y z
   * par échantillon) ; null tant que le modèle n'est pas chargé. */
  getHeadSamples(spacingMm?: number): Float32Array | null;
  dispose(): void;
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
  const st = createGCodeLayerState({ scene, parent, onPlateRotation });
  setupGCodeLayerScene(st);
  setupGCodeLayerBuild(st);
  setupGCodeLayerPick(st);
  setupGCodeLayerEdit(st);
  return setupGCodeLayerApi(st);
}
