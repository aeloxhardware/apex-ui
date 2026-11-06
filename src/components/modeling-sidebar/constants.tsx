import { Feature, FeatureKind, SketchEntityKind, SelectionMode, SketchPlaneRef, SketchEntity } from '@/modeling/types';
import React from 'react';
import { PenLine, RotateCw, FlipHorizontal2, Minus, Square, Circle, Triangle, Waves } from 'lucide-react';
import { ExtrudeIcon, FilletIcon, ChamferIcon } from '../ModelingIcons';



/** Sous-maillage d'un modèle importé, tel que le diffuse `apex-mesh-selected`. */
export interface SubMeshItem {
  id: string;
  name: string;
  color: string;
}


/** Un corps de la scène et les features paramétriques qui lui sont rattachées. */
export interface ModelNode {
  id: string;
  name: string;
  children: SubMeshItem[];
  features: Feature[];
}


export const TOOLS: {
  kind: FeatureKind;
  icon: React.ElementType;
  description: string;
}[] = [
  { kind: 'sketch', icon: PenLine, description: 'Créez des contours géométriques sur un plan ou une surface plane afin de définir la base d\'une conception tridimensionnelle.' },
  { kind: 'extrude', icon: ExtrudeIcon, description: 'Tire le profil d\'un plan surfacique, parallèlement ou non à sa normale pour générer un volume.' },
  { kind: 'revolve', icon: RotateCw, description: 'Faire tourner un profil autour d\'un axe.' },
  { kind: 'fillet', icon: FilletIcon, description: 'Arrondir les arêtes sélectionnées avec un rayon.' },
  { kind: 'chamfer', icon: ChamferIcon, description: 'Biseauter les arêtes sélectionnées.' },
  { kind: 'mirror', icon: FlipHorizontal2, description: 'Dupliquer le corps par symétrie autour d\'un point.' },
];


export const SKETCH_ENTITIES: { kind: SketchEntityKind; icon: React.ElementType }[] = [
  { kind: 'line', icon: Minus },
  { kind: 'rectangle', icon: Square },
  { kind: 'circle', icon: Circle },
  { kind: 'triangle', icon: Triangle },
  { kind: 'curve', icon: Waves },
];


// Provisoire (demande de l'utilisateur, 2026-10-20) : tout le sélecteur est grisé pour l'instant.
// Repasser à false pour le réactiver (Corps et Face redeviennent utilisables).
export const SELECTION_LOCKED = true;


export const SELECTION_MODES: { mode: SelectionMode; label: string; enabled: boolean }[] = [
  { mode: 'body', label: 'Corps', enabled: !SELECTION_LOCKED },
  { mode: 'face', label: 'Face', enabled: !SELECTION_LOCKED },
  { mode: 'edge', label: 'Arête', enabled: false },
  { mode: 'vertex', label: 'Sommet', enabled: false },
];


export const FEATURE_ICONS: Record<FeatureKind, React.ElementType> = {
  sketch: PenLine,
  extrude: ExtrudeIcon,
  revolve: RotateCw,
  fillet: FilletIcon,
  chamfer: ChamferIcon,
  mirror: FlipHorizontal2,
};


// Fraction du morph ('enter' : t croissant de 0 à 1) au-delà de laquelle la silhouette est assez
// proche de sa forme normale pour que le contenu (header, Sélection, Corps) commence à apparaître,
// un groupe après l'autre (cf. contentVariants / CONTENT_STAGGER_MS). En dessous, le contenu reste
// (cf. contentRevealed) invisible plutôt que de montrer un fragment illisible d'un texte/bouton bien
// plus grand que la silhouette qui le découpe. `1` (pas moins) : le contenu ne doit apparaître
// qu'UNE FOIS la déformation entièrement terminée, jamais pendant qu'elle est encore en cours (même
// proche de la fin, la silhouette peut encore être trop étroite/basse pour l'accueillir proprement).
export const CONTENT_REVEAL_THRESHOLD = 1;

export const CONTENT_STAGGER_MS = 0.09;


// Cascade dans les deux sens, toujours du haut vers le bas (header, Sélection, Corps) : apparition
// à la fin d'un morph d'entrée, disparition dès le clic qui quitte Modélisation.
export const contentContainerVariants = {
  hidden: { transition: { staggerChildren: CONTENT_STAGGER_MS } },
  visible: { transition: { staggerChildren: CONTENT_STAGGER_MS } },
};


export const contentGroupVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] } },
};


/** Esquisse « flottante » : tracée sans corps sélectionné, elle attend l'extrusion, qui crée le corps. */
export interface FloatingSketch { id: string; name: string; planeRef: SketchPlaneRef; entities: SketchEntity[] }


export interface ModelingSidebarProps {
  /**
   * Signale une transition d'espace en cours entre Modélisation et la pilule/les panneaux de
   * Prévisualisation, dans un sens ou dans l'autre :
   *  - 'enter' : ce panneau — déjà affiché avec son contenu réel — part de la forme/position de la
   *    pilule (ou des deux panneaux de Prévisualisation si `fromPreview`) et se déforme en un seul
   *    geste vers sa forme normale.
   *  - 'exit' : mouvement inverse — parti de sa forme normale, ce panneau se déforme vers la
   *    pilule ou les panneaux de Prévisualisation, puis Index.tsx le démonte (`onDone`) et affiche
   *    à la place les vrais panneaux slicer, déjà dans leur état final (cf. `initialPreviewActive`
   *    de CategoriesSidebar).
   *
   * Contrairement à l'ancienne approche (un calque de verre animé séparé, remplacé après coup par
   * ce panneau), c'est ICI le même élément DOM, déjà monté avec son contenu réel, qui change de
   * silhouette (`clip-path`, cf. useLiquidGlassClip) — aucun raccord entre deux éléments distincts,
   * donc aucun risque de clignotement à la jonction. Reste monté pendant tout le morph (les effets
   * de montage/démontage — restauration du mode 3D notamment — ne doivent avoir lieu qu'une fois).
   */
  morph?: { direction: 'enter' | 'exit'; fromPreview: boolean; onDone: () => void };
}
