import type * as BABYLON from 'babylonjs';

export type GridStandardPlane = 'XZ' | 'XY' | 'YZ';

export interface GizmoAxisInternal {
  _coloredMaterial?: BABYLON.StandardMaterial;
  _hoverMaterial?: BABYLON.StandardMaterial;
  gizmoMesh?: BABYLON.Mesh;
}

export interface InspectableMaterial extends BABYLON.Material {
  albedoColor?: BABYLON.Color3;
  diffuseColor?: BABYLON.Color3;
  albedoTexture?: BABYLON.BaseTexture;
}

export interface GridLabel {
  mesh: BABYLON.Mesh; tileValue: number; axis: 'x' | 'z';
  aspect: number; // largeur / hauteur de la texture du texte affiché
}

export type BoxDrawPhase = 'idle' | 'drawing-base' | 'extruding' | 'filling';

export type PyramidPhase = 'idle' | 'drawing-base' | 'extruding' | 'filling';

export interface SketchViewSnapshot {
  alpha: number; beta: number; radius: number; target: BABYLON.Vector3;
  lens: { x: number; y: number };
  frameOrigin: BABYLON.Vector3; frameQuat: BABYLON.Quaternion; standard: GridStandardPlane | null;
}

export interface SketchDimField { locked: boolean; value: number; modified: boolean; lastGood: number }

export interface ExtrudeFace {
  kind: 'sketch' | 'mesh';
  origin: BABYLON.Vector3;
  normal: BABYLON.Vector3;
  modelName?: string;
}

export interface SketchRect { id: string; x1: number; x2: number; z1: number; z2: number }

export interface SketchCell { mesh: BABYLON.Mesh; i: number; j: number; sig: string; corners: BABYLON.Vector3[] }

export interface SketchFaceGroup {
  matrix: BABYLON.Matrix;
  normal: BABYLON.Vector3;
  rects: SketchRect[];
  cells: Map<string, SketchCell>;
}

export interface EdgeCandidate { key: string; points: BABYLON.Vector3[] }

export interface MeshEdgeCache { matrix: number[]; local: number[][]; world: BABYLON.Vector3[][] }
