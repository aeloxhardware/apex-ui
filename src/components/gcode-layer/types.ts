import type * as BABYLON from 'babylonjs';
import type { LineTypeId } from '../gcodeLineTypes';

export interface PathMesh {
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
  /** Cordons : par ÉCHANTILLON (TUBE_SIDES sommets chacun), mouvement propriétaire, fraction le
   * long de ce mouvement, et début de tube — pour l'édition (poids par sommet interpolés entre les
   * deux points du mouvement, et recalcul local de la géométrie après validation). */
  sampleOwner?: Uint32Array;
  sampleFrac?: Float32Array;
  stripStart?: Uint8Array;
  /** Trajets (LinesMesh) : premier sommet de chaque mouvement retenu (inutilisé sinon). */
  lineStart?: Uint32Array;
  /** Copies CPU des sommets (mêmes tableaux que ceux passés à Babylon) : une mise à jour partielle
   * du tampon GPU fait oublier à Babylon sa propre copie, l'édition garde donc la sienne. */
  positions?: Float32Array;
  normals?: Float32Array;
  /** Poids d'édition par sommet (cordons), alloué au premier usage. */
  editWeights?: Float32Array;
  /** Normale de paroi d'édition par sommet (3 valeurs, repère local ; nulle hors coque). */
  editSlide?: Float32Array;
  /** Axe de tête d'édition par sommet (3 valeurs, repère local ; mode « empilement »). */
  editAxis?: Float32Array;
}

export interface PathEntry extends PathMesh {
  type: LineTypeId;
  include: (k: number) => boolean;
  /** Cordon extrudé (bead) : seul recolorable par sommet en mode « colorer par » continu ; travel
   * et wipe gardent toujours leur couleur fixe (aucun critère ne s'applique à un déplacement à vide). */
  isExtrusion: boolean;
  /** Matériau catégoriel (type de ligne) à restaurer quand on revient au mode `lineType` — n'existe
   * que pour les entrées `isExtrusion`. */
  categoryMaterial?: BABYLON.Material;
}

export interface MarkerEntry {
  type: LineTypeId;
  mesh: BABYLON.Mesh;
  at: Uint32Array;
}
