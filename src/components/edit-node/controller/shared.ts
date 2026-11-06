import type { EditNodeHandle, HandleDragEvent } from '../EditNode';
import { editKernel, EditHandleRefusal } from '@/utils/editKernelClient';
import * as BABYLON from 'babylonjs';
import { EditDelta } from '../editProtocol';

/**
 * Édition du G-code par nœud (onglet Édition de Prévisualisation, cf. CLAUDE.md « G-code
 * editing ») : relie la vue 3D, le nœud dessiné par-dessus (GCodeEditOverlay) et le noyau C++.
 *
 *  - Clic sur la trajectoire (mode « placer ») : le nœud s'accroche au point de dépôt le plus
 *    proche ; le noyau calcule les poids d'influence, copiés en attribut des cordons.
 *  - Plusieurs nœuds : un seul est actif (développé, chargé dans le noyau) ; poser un autre nœud
 *    ou en réduire un le garde, réduit, avec ses poignées et son verrouillage, pour le reprendre
 *    plus tard d'un clic. Les nœuds réduits suivent la géométrie validée.
 *  - Poignées du nœud : chacune fixe par sa longueur la portée et par son orientation le sens
 *    préféré de l'influence (comme une tangente de Bézier). Elles vivent en 3D, dans le plan face à
 *    la caméra au moment où on les règle : un zoom ne change pas leur portée en mm. Une poignée
 *    verrouillée (orange) est un ancrage : la matière y reste fixe.
 *  - Glissement du nœud : translation dans le plan face à la caméra ; la déformation s'affiche par
 *    le vertex shader (aucune géométrie recalculée par image) pendant que le noyau calcule, en
 *    parallèle, les valeurs firmware exactes (champs ΔR, ΔC, ΔZ, ΔB).
 *  - Relâchement : le noyau valide (seul maître des valeurs du G-code) et la géométrie des seuls
 *    mouvements touchés est réécrite. Annuler / rétablir passent par le noyau.
 *
 * Repères : « local » = repère du plateau Babylon (y vers le haut) ; le noyau est droit, z vers le
 * haut : (x, y, z) local ↔ (x, z, y) noyau.
 */

/** Un nœud tel que l'overlay le dessine (px CSS relatifs au canevas 3D). */
export interface EditNodeView {
  id: number;
  /** Devant la caméra (sinon non dessiné, mais conservé). */
  visible: boolean;
  /** Nœud actif : développé, chargé dans le noyau. Les autres sont réduits. */
  active: boolean;
  x: number;
  y: number;
  handleOffsets: Record<number, { dx: number; dy: number }>;
  busy: boolean;
  /** Point d'attache verrouillé : glisser déforme. Sinon, glisser choisit le point. */
  positionLocked: boolean;
  /** Rognage actif : les couches au-delà de celles que le nœud déforme sont rognées, pas comprimées. */
  trimming: boolean;
  /** Le point du nœud est masqué par la pièce (vu depuis la caméra) : le nœud s'estompe. */
  occluded: boolean;
  /** Mode d'influence Auto : poignées violettes à écartement fixe, seule leur orientation se règle. */
  fixedHandles: boolean;
}


/** Ce que l'overlay dessine : rien hors de l'onglet Édition. */
export interface EditOverlayView {
  nodes: EditNodeView[];
}


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


export interface HandleState {
  /** Vecteur nœud → bouton (local, mm), hors verrouillage. */
  v: BABYLON.Vector3;
  /** Point d'ancrage (local) d'une poignée verrouillée. */
  lockPoint: BABYLON.Vector3 | null;
}


export interface NodeState {
  id: number;
  index: number;
  /** Pointe du point du nœud, état validé (local). */
  anchor: BABYLON.Vector3;
  /** Translation demandée par le pointeur (local). */
  translation: BABYLON.Vector3;
  /** Translation appliquée par le noyau (freinée près des limites d'épaisseur, local) : c'est elle
   * que montrent le nœud et le shader. */
  applied: BABYLON.Vector3;
  original: EditDelta;
  positionLocked: boolean;
  /** Rotation en cours autour du point du nœud (local, composantes Babylon), donnée par les poignées.
   * `angle` : demandé par les poignées ; `applied` : réellement appliqué par le noyau (freiné aux
   * bornes d'épaisseur comme la translation) — c'est lui que montrent le shader et le nœud.
   * `fraction` : part de l'angle demandé que le noyau a retenue à sa dernière réponse (le shader l'applique
   * d'avance, sans quoi la rotation sauterait entre demandée et freinée à chaque image). */
  rotation: { axis: BABYLON.Vector3; angle: number; applied: number; fraction: number };
  /** Rognage actif pour ce nœud. */
  trimming: boolean;
  /** Masqué par la pièce (cf. updateOcclusion). */
  occluded: boolean;
  /** Points touchés et immobiles dépendants du nœud actif, et leurs hauteurs avant déformation. */
  affectedIdx: Uint32Array | null;
  dependentIdx: Uint32Array | null;
  baseHeights: Float32Array | null;
  handles: Map<number, HandleState>;
  /** Portée recommandée par les poignées, élargie pendant le glissement quand elle bloque. */
  reach: { scale: number; growing: boolean; saturated: boolean; affected: number };
  /** Mode « empilement » des poids courants : axe de tête du nœud (local), null sinon. */
  stackAxis: BABYLON.Vector3 | null;
  /** Pointe du point du nœud pendant le glissement, calculée par le noyau (local) : le point ne suit
   * pas forcément la translation (empilement : le long de son axe ; coque : sur sa paroi). */
  dragTip: BABYLON.Vector3 | null;
}


/** Rotation de Rodrigues sur les composantes (même formule que le shader). */
export function rotateAbout(v: BABYLON.Vector3, k: BABYLON.Vector3, a: number) {
  const c = Math.cos(a), s = Math.sin(a);
  return v.scale(c).add(BABYLON.Vector3.Cross(k, v).scale(s)).add(k.scale(BABYLON.Vector3.Dot(k, v) * (1 - c)));
}


export const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));


export const REFUSAL_MESSAGES: Record<EditHandleRefusal, string> = {
  invalid: "Aucun point de trajectoire ici.",
  locked: 'Ce point est verrouillé.',
  plate: "Ce point est sur le plateau : l'objet garde sa forme, il ne bouge pas. Glissez le nœud plus haut.",
  surface: "Ce point est sur la surface libre de l'objet : il ne bouge pas. Glissez le nœud vers l'intérieur.",
};


/** Déformation copiée, exprimée dans le repère de la tête du nœud source (axe de tête, radial, tangentiel). */
export interface DeformationClipboard {
  translation: [number, number, number];
  rotationAxis: [number, number, number];
  rotationAngle: number;
}


export const CLICK_SLOP_PX = 5;

// Écarts d'épaisseur affichés : plus fine / plus épaisse au-delà de ±10 %.
export const THICKNESS_RATIO_BAND = 0.1;

// Mise à jour de l'aperçu (épaisseurs, dépôts rognés) pendant le glissement : au plus toutes les 150 ms.
export const PREVIEW_PERIOD_MS = 150;

export const LIVE_VALIDATION_DELAY_MS = 160;

// Portée recommandée (longueur des poignées, distance 3D). Mode Portée : elle n'est jamais dépassée,
// le nœud freine dès que les couches de la portée ne peuvent plus absorber la translation entre ces
// épaisseurs. Mode Auto : elle s'élargit (facteur par pas) ; le nœud ne freine que lorsque l'élargir
// n'apporte plus de points alors qu'elle couvre déjà tout l'objet.
export const REACH_GROWTH_MIN = 1.25;

export const REACH_GROWTH_MAX = 2;

export const ANCHOR_RADIUS_FRACTION = 0.3;

export const ANCHOR_MIN_RADIUS_MM = 0.4;
