// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';

export type GridStandardPlane = 'XZ' | 'XY' | 'YZ';

// Les gizmos Babylon exposent leur matériau via des champs internes non documentés dans les
// types publics (_coloredMaterial/_hoverMaterial/gizmoMesh) — on décrit juste la forme utilisée
// plutôt que de recourir à `any`.
export interface GizmoAxisInternal {
  _coloredMaterial?: BABYLON.StandardMaterial;
  _hoverMaterial?: BABYLON.StandardMaterial;
  gizmoMesh?: BABYLON.Mesh;
}

// Champs de matériau (PBR/Standard) inspectés pour la fiche texture, absents du type de
// base BABYLON.Material — décrits explicitement plutôt que castés en `any`.
export interface InspectableMaterial extends BABYLON.Material {
  albedoColor?: BABYLON.Color3;
  diffuseColor?: BABYLON.Color3;
  albedoTexture?: BABYLON.BaseTexture;
}

// Une étiquette par graduation : on mémorise son rang `tileValue` (± 1…GRID_TILE_EXTENT) et
// son axe ; sa position monde vaut rang × pas courant `S`. Taille et visibilité sont
// recalculées à chaque frame par `layoutGridLabels`.
export interface GridLabel {
  mesh: BABYLON.Mesh; tileValue: number; axis: 'x' | 'z';
  aspect: number; // largeur / hauteur de la texture du texte affiché
}

// ---------------------------------------------------------------------------------
// Outil « Boîte » (primitive) : dessiner un rectangle au sol, l'extruder en hauteur,
// puis remplir le pavé de voxels un par un avant un scan qui le résout en solide plein.
// Trois états successifs, chacun piloté par le pointer observer déjà en place.
// ---------------------------------------------------------------------------------
export type BoxDrawPhase = 'idle' | 'drawing-base' | 'extruding' | 'filling';

// ---------------------------------------------------------------------------------
// Outil « Pyramide 4 côtés » : même base à deux clics que Boîte, mais l'aperçu montre
// des rectangles imbriqués qui rétrécissent vers le centre (les futurs étages), le
// « ressort » d'extrusion les soulève à des hauteurs croissantes vers le sommet, le
// remplissage transforme chaque étage en couche de cellules, et le scan les résout en
// un vrai maillage pyramidal à faces planes (pas un empilement en escalier).
// ---------------------------------------------------------------------------------
export type PyramidPhase = 'idle' | 'drawing-base' | 'extruding' | 'filling';

// Vue d'avant l'outil Esquisse : prise au clic sur le bouton Esquisse (choix du plan), rendue par
// « Terminer l'esquisse » (`apex-sketch-finished`) — caméra, décalage d'image et repère de la grille.
export interface SketchViewSnapshot {
  alpha: number; beta: number; radius: number; target: BABYLON.Vector3;
  lens: { x: number; y: number };
  frameOrigin: BABYLON.Vector3; frameQuat: BABYLON.Quaternion; standard: GridStandardPlane | null;
}

// --- Champs de saisie longueur / largeur (après le premier clic, outil Rectangle seulement) ---
// Champ 0 = longueur (axe x de la grille), champ 1 = largeur (axe z). Un champ « modifié » porte
// le texte de l'utilisateur, qui prime sur la souris ; « verrouillé » (Tab sur une valeur
// valide) garde sa valeur quoi que fasse la souris. Valeur invalide (négative, non numérique,
// vide ou 0) : contour rouge, et Tab remet l'ancienne valeur au lieu de verrouiller.
export interface SketchDimField { locked: boolean; value: number; modified: boolean; lastGood: number }

export interface ExtrudeFace {
  kind: 'sketch' | 'mesh';
  origin: BABYLON.Vector3;
  normal: BABYLON.Vector3;
  modelName?: string | undefined;
}

/**
 * Profils tracés = plans surfaciques sélectionnables pour l'outil Extrusion. Les rectangles d'un
 * même plan sont découpés selon leurs recouvrements : toutes leurs arêtes forment un quadrillage
 * compressé dont chaque cellule connaît les rectangles qui la couvrent ; une RÉGION est un ensemble
 * connexe de cellules couvertes par les mêmes rectangles. Un rectangle contenu dans un autre donne
 * donc deux régions (l'anneau et l'intérieur), deux rectangles qui se croisent trois, et chaque
 * région se sélectionne indépendamment.
 */
interface SketchRect { id: string; x1: number; x2: number; z1: number; z2: number }

interface SketchCell { mesh: BABYLON.Mesh; i: number; j: number; sig: string; corners: BABYLON.Vector3[] }

export interface SketchFaceGroup {
  matrix: BABYLON.Matrix;
  normal: BABYLON.Vector3;
  rects: SketchRect[];
  cells: Map<string, SketchCell>;
}

export interface EdgeCandidate { key: string; points: BABYLON.Vector3[] }

export interface MeshEdgeCache { matrix: number[]; local: number[][]; world: BABYLON.Vector3[][] }
