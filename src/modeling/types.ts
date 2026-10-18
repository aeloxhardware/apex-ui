/**
 * Modèle de données du modéliseur paramétrique Apex.
 *
 * L'arbre de features EST la source de vérité : le mesh affiché dans le viewport n'en est
 * qu'un rendu dérivé. Éditer un paramètre revient à muter le nœud concerné puis à rejouer
 * l'arbre entier — c'est ce qui rend le système paramétrique plutôt qu'une géométrie figée.
 */

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

/**
 * Plan de travail d'une esquisse. Repère Babylon (Y vertical) :
 * - 'XZ' : plan du sol, normale Y (vue de dessus).
 * - 'XY' : plan vertical de face, normale Z.
 * - 'YZ' : plan vertical de côté, normale X.
 */
export type SketchPlane = 'XY' | 'XZ' | 'YZ';

/**
 * Référence du plan choisi pour une esquisse : soit l'un des 3 plans principaux
 * (parallèles aux axes), soit un plan dérivé d'une face de corps existant — dans ce
 * dernier cas, origine et normale sont prises directement du point/de la normale de
 * picking Babylon, un vrai plan géométrique même sans kernel B-rep pour l'identifier.
 */
export type SketchPlaneRef =
  | { kind: 'axis'; plane: SketchPlane }
  | { kind: 'face'; origin: Vec3; normal: Vec3 };

/** Formes de base disponibles en esquisse. Leurs sommets sont connectables entre eux. */
export type SketchEntityKind = 'line' | 'rectangle' | 'circle' | 'triangle' | 'curve';

export interface SketchEntity {
  id: string;
  kind: SketchEntityKind;
  /**
   * Points de contrôle, en coordonnées 2D locales au plan d'esquisse.
   * - line      : [début, fin]
   * - rectangle : [coin1, coin2]
   * - circle    : [centre, point sur le rayon]
   * - triangle  : [p1, p2, p3]
   * - curve     : [début, ctrl1, ctrl2, fin] (Bézier cubique)
   */
  points: Vec2[];
  /**
   * Sommets fusionnés avec ceux d'autres entités : `pointIndex` de CETTE entité est
   * contraint à coïncider avec `pointIndex` de l'entité `entityId`. C'est ce qui permet de
   * chaîner des formes en un profil fermé extrudable.
   */
  connections?: { pointIndex: number; entityId: string; targetPointIndex: number }[];
}

export type FeatureKind =
  | 'sketch'
  | 'extrude'
  | 'revolve'
  | 'fillet'
  | 'chamfer'
  | 'mirror';

interface FeatureBase {
  id: string;
  name: string;
  /** Une feature supprimée reste dans l'arbre mais est ignorée au replay. */
  suppressed?: boolean;
  /** Message d'erreur si le kernel a rejeté cette opération lors du dernier replay. */
  error?: string;
}

export interface SketchFeature extends FeatureBase {
  kind: 'sketch';
  planeRef: SketchPlaneRef;
  entities: SketchEntity[];
}

export interface ExtrudeFeature extends FeatureBase {
  kind: 'extrude';
  sketchId: string;
  distance: number;
  /** Extrude de part et d'autre du plan d'esquisse. */
  symmetric: boolean;
  /** Réglages du panneau Extrusion (le kernel ne s'en sert pas encore : seule « Nouveau corps » existe). */
  /** Face plane d'un modèle extrudée directement (sans esquisse) : `sketchId` est alors vide. */
  faceRef?: { origin: Vec3; normal: Vec3; modelName?: string };
  bodyType?: 'solid' | 'surface';
  startFrom?: 'profile' | 'offset';
  operation?: 'new-body' | 'join' | 'cut' | 'intersect';
}

export interface RevolveFeature extends FeatureBase {
  kind: 'revolve';
  sketchId: string;
  axis: Vec3;
  /** Angle de révolution en degrés. */
  angle: number;
}

export interface FilletFeature extends FeatureBase {
  kind: 'fillet';
  /** Identifiants de faces/arêtes CAD stables (voir `faceGroups` renvoyé par le kernel). */
  targetIds: string[];
  radius: number;
}

export interface ChamferFeature extends FeatureBase {
  kind: 'chamfer';
  targetIds: string[];
  distance: number;
}

export interface MirrorFeature extends FeatureBase {
  kind: 'mirror';
  /** Symétrie centrale : chaque point P devient 2*center - P. */
  center: Vec3;
}

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | FilletFeature
  | ChamferFeature
  | MirrorFeature;

export type FeatureTree = Feature[];

/** Granularité de sélection dans le viewport en mode modélisation. */
export type SelectionMode = 'body' | 'face' | 'edge' | 'vertex';

/** Outil actif du mode modélisation. */
export type ModelingTool =
  | 'sketch'
  | 'extrude'
  | 'revolve'
  | 'fillet'
  | 'chamfer'
  | 'mirror';

/**
 * Maillage renvoyé par le kernel CAD. Volontairement sérialisable : le worker ne doit
 * jamais renvoyer d'objet OCCT, uniquement des buffers transférables.
 */
export interface CadMeshPayload {
  vertices: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  /**
   * Mappe des plages de triangles vers un identifiant de face CAD stable. C'est ce qui
   * permet de dire « congé sur CETTE face » de façon persistante entre deux régénérations,
   * là où `scene.pick` ne renvoie qu'un faceId de triangle.
   */
  faceGroups: { faceId: string; start: number; count: number }[];
}

let idCounter = 0;
/** Identifiants courts et stables pour les nœuds de l'arbre (pas besoin d'UUID ici). */
export const nextId = (prefix: string): string => `${prefix}-${++idCounter}`;

/** Libellés FR affichés dans l'arborescence et la barre d'outils. */
export const FEATURE_LABELS: Record<FeatureKind, string> = {
  sketch: 'Esquisse',
  extrude: 'Extrusion',
  revolve: 'Révolution',
  fillet: 'Congé',
  chamfer: 'Chanfrein',
  mirror: 'Symétrie centrale',
};

export const SKETCH_ENTITY_LABELS: Record<SketchEntityKind, string> = {
  line: 'Ligne',
  rectangle: 'Rectangle',
  circle: 'Cercle',
  triangle: 'Triangle',
  curve: 'Courbe',
};
