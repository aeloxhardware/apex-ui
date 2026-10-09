import * as BABYLON from 'babylonjs';
import type { GCodeLayer } from '../gcodeLayer';
import { NOZZLE_PIVOT_MM, nozzleTip } from '../gcodeParse';
import { LINE_TYPES } from '../gcodeLineTypes';
import {
  EDIT_FLAG_BOUNDS,
  EDIT_FLAG_COLLISION,
  EDIT_FLAG_LOCKED,
  EDIT_FLAG_THICKER,
  EDIT_FLAG_THINNER,
  EDIT_FLAG_TRIM,
  EDIT_FLAG_VIOLATION,
} from '../gcodeEditDeform';
import { getPreviewTab } from '../PreviewUpperTabs';
import {
  editKernel,
  EDIT_VALUES_PER_POINT,
  type EditHandleRefusal,
  type EditHistoryEntry,
  type EditInfluence,
  type EditSplice,
  type EditTransform,
  type EditValidation,
} from '@/utils/editKernelClient';
import { insertMoves, removeMoves, remapMoveIndex } from '@/utils/gcodeSplice';
import { loadLayerLimits, saveLayerLimits, layerFloorMm, sanitizeLayerLimits, type LayerLimits } from '@/utils/layerLimits';
import { loadMachineLimits, saveMachineLimits, toKernelLimits, type MachineLimits } from '@/utils/machineLimits';
import { fingerprintOf, type ApexJournalEntry } from '@/utils/apexHeader';
import type { ParsedGCode } from '../gcodeParse';
import type { EditNodeHandle, HandleDragEvent, HandleDragMode } from './EditNode';
import {
  DEFAULT_EDIT_INFLUENCE,
  DEFAULT_EDIT_SYMMETRY,
  DEFAULT_LOCK_RADIUS_MM,
  EDIT_ANALYZE_EVENT,
  EDIT_CLEAR_LOCKS_EVENT,
  EDIT_COPY_EVENT,
  EDIT_INFLUENCE_EVENT,
  EDIT_LIMITS_EVENT,
  EDIT_LAYER_LIMITS_EVENT,
  EDIT_LOCK_MODE_EVENT,
  EDIT_PASTE_EVENT,
  EDIT_PLACE_EVENT,
  EDIT_REDO_EVENT,
  EDIT_REMOVE_NODE_EVENT,
  EDIT_REQUEST_STATE_EVENT,
  EDIT_SET_DELTA_EVENT,
  EDIT_STATE_EVENT,
  EDIT_SYMMETRY_EVENT,
  EDIT_UNDO_EVENT,
  type EditDelta,
  type EditInfluenceSettings,
  type EditLockMode,
  type EditStateDetail,
  type EditStatus,
  type EditSymmetry,
  type EditThickness,
  type EditValidationSummary,
} from './editProtocol';

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

interface HandleState {
  /** Vecteur nœud → bouton (local, mm), hors verrouillage. */
  v: BABYLON.Vector3;
  /** Point d'ancrage (local) d'une poignée verrouillée. */
  lockPoint: BABYLON.Vector3 | null;
}

interface NodeState {
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
function rotateAbout(v: BABYLON.Vector3, k: BABYLON.Vector3, a: number) {
  const c = Math.cos(a), s = Math.sin(a);
  return v.scale(c).add(BABYLON.Vector3.Cross(k, v).scale(s)).add(k.scale(BABYLON.Vector3.Dot(k, v) * (1 - c)));
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const REFUSAL_MESSAGES: Record<EditHandleRefusal, string> = {
  invalid: "Aucun point de trajectoire ici.",
  locked: 'Ce point est verrouillé.',
  plate: "Ce point est sur le plateau : l'objet garde sa forme, il ne bouge pas. Glissez le nœud plus haut.",
  surface: "Ce point est sur la surface libre de l'objet : il ne bouge pas. Glissez le nœud vers l'intérieur.",
};

/** Déformation copiée, exprimée dans le repère de la tête du nœud source (axe de tête, radial, tangentiel). */
interface DeformationClipboard {
  translation: [number, number, number];
  rotationAxis: [number, number, number];
  rotationAngle: number;
}

const CLICK_SLOP_PX = 5;
// Écarts d'épaisseur affichés : plus fine / plus épaisse au-delà de ±10 %.
const THICKNESS_RATIO_BAND = 0.1;
// Mise à jour de l'aperçu (épaisseurs, dépôts rognés) pendant le glissement : au plus toutes les 150 ms.
const PREVIEW_PERIOD_MS = 150;
const LIVE_VALIDATION_DELAY_MS = 160;
// Portée recommandée (longueur des poignées, distance 3D). Mode Portée : elle n'est jamais dépassée,
// le nœud freine dès que les couches de la portée ne peuvent plus absorber la translation entre ces
// épaisseurs. Mode Auto : elle s'élargit (facteur par pas) ; le nœud ne freine que lorsque l'élargir
// n'apporte plus de points alors qu'elle couvre déjà tout l'objet.
const REACH_GROWTH_MIN = 1.25;
const REACH_GROWTH_MAX = 2;
const ANCHOR_RADIUS_FRACTION = 0.3;
const ANCHOR_MIN_RADIUS_MM = 0.4;

export function createGCodeEditController(opts: {
  scene: BABYLON.Scene;
  engine: BABYLON.AbstractEngine;
  camera: BABYLON.Camera;
  canvas: HTMLCanvasElement;
  layer: GCodeLayer;
  isPreviewActive: () => boolean;
}): GCodeEditController {
  const { scene, engine, camera, canvas, layer } = opts;

  let influence: EditInfluenceSettings = structuredClone(DEFAULT_EDIT_INFLUENCE);
  let status: EditStatus = 'inactive';
  let message: string | null = null;
  let loadedParsed: object | null = null;
  let loadSeq = 0;
  let placing = false;
  /** Tous les nœuds posés ; `node` est l'actif (ou aucun). */
  const nodes = new Map<number, NodeState>();
  let node: NodeState | null = null;
  let nodeSeq = 0;
  let undoDepth = 0;
  let redoDepth = 0;
  // Re-tranchage : couches à insérer dans l'aperçu en cours (cf. updatePreview).
  // Une validation (noyau, puis G-code, calque, symétrie) est en cours : annuler / rétablir attendent sa fin.
  let committing = false;
  let reslicePoints = 0;
  let resliceMaxCount = 0;
  let affected = 0;
  let delta: EditDelta | null = null;
  let busyCount = 0;
  let disposed = false;
  // Aperçu pendant le glissement et validation physique (cf. « Physical validity » de CLAUDE.md).
  let thickness: EditThickness | null = null;
  let trimmedCount = 0;
  let validation: EditValidationSummary | null = null;
  let limits: MachineLimits = loadMachineLimits();
  let layerLimits: LayerLimits = loadLayerLimits();
  let capacityMm: number | null = null;
  let requestedAxialMm: number | null = null;
  let headModel = false;
  let locksCount = 0;
  let lockMode: EditLockMode = null;
  let lockRadiusMm = DEFAULT_LOCK_RADIUS_MM;
  let symmetry: EditSymmetry = { ...DEFAULT_EDIT_SYMMETRY };
  let clipboard: DeformationClipboard | null = null;
  // Annuler / rétablir par groupes : une validation et ses copies par symétrie ne font qu'une étape.
  let undoGroups: number[] = [];
  let redoGroups: number[] = [];

  // --- état publié ------------------------------------------------------------------------------

  const emit = () => {
    if (disposed) return;
    const detail: EditStateDetail = {
      status, message, placing, hasNode: !!node, busy: busyCount > 0,
      undoDepth, redoDepth, affected, delta, influence,
      nodeTrimming: node ? node.trimming : null,
      trimmed: trimmedCount, reslicePoints, resliceMaxCount, thickness, validation,
      locks: locksCount, lockMode, lockRadiusMm,
      canPaste: !!clipboard, symmetry, limits, layerLimits, capacityMm, requestedAxialMm, headModel,
    };
    window.dispatchEvent(new CustomEvent(EDIT_STATE_EVENT, { detail }));
  };

  const listeners = new Set<(view: EditOverlayView) => void>();
  let lastView: EditOverlayView = { nodes: [] };
  const publishView = (view: EditOverlayView) => {
    lastView = view;
    for (const l of listeners) l(view);
  };

  // Opérations longues (chargement, validation, annulation) : les reflets du nœud tournent. Le
  // recalcul des poids, fréquent et court, ne les déclenche pas.
  const busy = async <T>(work: Promise<T>, shown = true): Promise<T> => {
    if (!shown) return work;
    busyCount++;
    emit();
    updateView(true);
    try {
      return await work;
    } finally {
      busyCount--;
      emit();
      updateView(true);
    }
  };

  // --- projections écran ↔ plateau ----------------------------------------------------------------

  const viewport = () => camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const cssScale = () => canvas.clientWidth / Math.max(1, engine.getRenderWidth());
  const scratchWorld = new BABYLON.Vector3();
  const scratchTransform = new BABYLON.Matrix();

  /** Position écran (px CSS) et profondeur (0..1) d'un point local. */
  const project = (local: BABYLON.Vector3) => {
    BABYLON.Vector3.TransformCoordinatesToRef(local, layer.getPlateWorldMatrix(), scratchWorld);
    // Vue × projection de LA caméra de la vue, recalculées ici : la matrice de la scène est celle
    // du dernier rendu (une autre caméra, captures et vignettes), et `getTransformationMatrix` de
    // la caméra n'est pas tenue à jour dans cette scène.
    camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), scratchTransform);
    const p = BABYLON.Vector3.Project(scratchWorld, BABYLON.Matrix.IdentityReadOnly, scratchTransform, viewport());
    const s = cssScale();
    return { x: p.x * s, y: p.y * s, z: p.z };
  };

  /** Point local à la profondeur `z` sous le point écran (px CSS). */
  const unproject = (x: number, y: number, z: number) => {
    const s = cssScale();
    const world = BABYLON.Vector3.Unproject(
      new BABYLON.Vector3(x / s, y / s, z),
      engine.getRenderWidth(), engine.getRenderHeight(),
      BABYLON.Matrix.IdentityReadOnly, camera.getViewMatrix(), camera.getProjectionMatrix(),
    );
    const inv = layer.getPlateWorldMatrix().clone().invert();
    return BABYLON.Vector3.TransformCoordinates(world, inv);
  };

  const nodeLocal = (n: NodeState) => n.dragTip ?? n.anchor.add(n.applied);
  const tipScratch = { r: 0, z: 0 };
  /** Pointe (local) de valeurs firmware R, C, Z, B — même formule que le rendu et le noyau. */
  const tipOfFirmware = (v: ArrayLike<number>) => {
    nozzleTip(v[0], v[2], (v[3] * Math.PI) / 180, tipScratch);
    const c = (v[1] * Math.PI) / 180;
    return new BABYLON.Vector3(tipScratch.r * Math.cos(c), tipScratch.z, tipScratch.r * Math.sin(c));
  };

  // --- noyau --------------------------------------------------------------------------------------

  const isActive = () => opts.isPreviewActive() && getPreviewTab() === 'edition';

  // --- validation physique par le noyau (limites de B, collisions, écart tête / normale) ------------
  // Résultats du fichier entier (B seulement : un million de points en quelques dizaines de ms) et de la
  // zone modifiée (collisions et normales, poses échantillonnées). Les points en défaut sont repérés par
  // des drapeaux dans l'attribut des cordons (rouge vif, réservé aux alertes).
  let fileViolations = new Uint32Array(0);
  let fileV: EditValidation | null = null;
  let zoneV: EditValidation | null = null;
  let liveB: Uint32Array | null = null;
  let judgedSet: Set<number> | null = null;
  let validateTimer = 0;
  let validateSeq = 0;
  let lastPreviewAt = 0;

  const kernelLimits = () => toKernelLimits(limits);
  const BITS_B = 1 | 2 | 4;
  const BITS_COLLISION = 8 | 16;
  const splitFlags = (v: EditValidation) => {
    const b: number[] = [], c: number[] = [];
    for (let i = 0; i < v.violations.length; i++) {
      const f = v.violationFlags[i];
      if (f & BITS_B) b.push(v.violations[i]);
      if (f & BITS_COLLISION) c.push(v.violations[i]);
    }
    return { b: Uint32Array.from(b), c: Uint32Array.from(c) };
  };

  const publishValidation = () => {
    if (!fileV && !zoneV) { validation = null; return; }
    validation = {
      bRange: zoneV?.bRange ?? 0, bSpeed: zoneV?.bSpeed ?? 0, bAccel: zoneV?.bAccel ?? 0,
      headPart: zoneV?.headPart ?? 0, headPlate: zoneV?.headPlate ?? 0,
      posesTested: zoneV?.posesTested ?? 0,
      collisionChecked: zoneV?.collisionChecked ?? false,
      timingKnown: (zoneV ?? fileV)?.timingKnown ?? false,
      fileBViolations: fileViolations.length,
      normalIndices: zoneV?.normalIndices ?? new Uint32Array(0),
      normalDeviation: zoneV?.normalDeviation ?? new Float32Array(0),
      normalWorst: zoneV?.normalWorst ?? 0,
    };
  };

  /** Drapeau « hors limites » : points du fichier entier, remplacés dans la zone jugée en direct. */
  const pushViolationFlags = () => {
    let list = fileViolations;
    if (liveB && judgedSet) {
      const merged: number[] = [];
      for (const k of fileViolations) if (!judgedSet.has(k)) merged.push(k);
      for (const k of liveB) merged.push(k);
      merged.sort((a, b) => a - b);
      list = Uint32Array.from(merged);
    }
    layer.setEditFlagBit(EDIT_FLAG_VIOLATION, list.length ? list : null);
  };

  /** Limites de B de tout le fichier (état validé). */
  const refreshFileValidation = async () => {
    if (status !== 'ready') return;
    try {
      const v = await editKernel.validate({ limits: kernelLimits(), collisions: false });
      fileV = v;
      fileViolations = splitFlags(v).b;
      liveB = null;
      judgedSet = null;
      pushViolationFlags();
      publishValidation();
      emit();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      emit();
    }
  };

  /** Collisions et écart tête / normale de la zone qui vient d'être modifiée (état validé). */
  const validateZone = async (indices?: Uint32Array) => {
    if (status !== 'ready' || !indices || !indices.length) return;
    try {
      const v = await editKernel.validate({
        limits: kernelLimits(), collisions: true, lo: indices[0], hi: indices[indices.length - 1] + 1,
      });
      zoneV = v;
      const { c } = splitFlags(v);
      layer.setEditFlagBit(EDIT_FLAG_COLLISION, c.length ? c : null);
      publishValidation();
      emit();
    } catch {
      /* validation indisponible : l'édition elle-même n'en dépend pas */
    }
  };

  /** Pendant le glissement : validation de la déformation en cours, une fois le geste posé. */
  const scheduleLiveValidation = (n: NodeState) => {
    window.clearTimeout(validateTimer);
    validateTimer = window.setTimeout(async () => {
      if (node !== n || status !== 'ready') return;
      const seq = ++validateSeq;
      try {
        const v = await editKernel.validate({ limits: kernelLimits(), collisions: true });
        if (seq !== validateSeq || node !== n) return;
        zoneV = v;
        const { b, c } = splitFlags(v);
        liveB = b;
        const judged = new Set<number>();
        for (const k of n.affectedIdx ?? []) { judged.add(k); judged.add(k + 1); }
        judgedSet = judged;
        pushViolationFlags();
        layer.setEditFlagBit(EDIT_FLAG_COLLISION, c.length ? c : null);
        publishValidation();
        emit();
      } catch {
        /* sans validation, le glissement reste utilisable */
      }
    }, LIVE_VALIDATION_DELAY_MS);
  };

  /** Analyse du fichier entier (limites de B, et collisions échantillonnées si demandé). */
  const analyzeFile = async (collisions: boolean) => {
    if (status !== 'ready') return;
    try {
      const v = await busy(editKernel.validate({
        limits: { ...kernelLimits(), ...(collisions ? { maxPoses: 20000 } : {}) }, collisions,
      }));
      zoneV = v;
      fileV = v;
      const { b, c } = splitFlags(v);
      fileViolations = b;
      liveB = null;
      judgedSet = null;
      pushViolationFlags();
      layer.setEditFlagBit(EDIT_FLAG_COLLISION, c.length ? c : null);
      publishValidation();
      message = collisions && !v.collisionChecked
        ? "Collisions non contrôlées : le modèle de la tête n'est pas chargé."
        : `Analyse : ${b.length.toLocaleString('fr-FR')} point(s) hors limites de B` +
          (collisions ? `, ${c.length.toLocaleString('fr-FR')} en collision (${v.posesTested.toLocaleString('fr-FR')} poses testées).` : '.');
      emit();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      emit();
    }
  };

  /** Le modèle de la tête se charge après le G-code : le rendre au noyau dès qu'il est prêt. */
  let headTimer = 0;
  const refreshHeadSamples = async (attempt = 0) => {
    if (disposed || status !== 'ready') return;
    const samples = layer.getHeadSamples(3);
    if (samples && samples.length >= 30) {
      try {
        await editKernel.setHeadSamples(samples);
        headModel = true;
        emit();
      } catch {
        /* sans modèle de tête, pas de contrôle de collision */
      }
      return;
    }
    if (attempt < 12) headTimer = window.setTimeout(() => void refreshHeadSamples(attempt + 1), 1500);
  };

  // --- verrous de zones de matière -----------------------------------------------------------------

  const refreshLocks = async () => {
    if (status !== 'ready') return;
    try {
      const indices = await editKernel.lockedIndices();
      locksCount = indices.length;
      layer.setEditFlagBit(EDIT_FLAG_LOCKED, indices.length ? indices : null);
      emit();
    } catch {
      /* ignoré : l'état des verrous est relu à la prochaine action */
    }
  };

  const syncPicking = () => layer.setPickingEnabled(placing || !!node || !!lockMode);
  const syncCursor = () => { canvas.style.cursor = placing || lockMode ? 'crosshair' : ''; };

  const setLockMode = (mode: EditLockMode, radiusMm: number) => {
    lockMode = isActive() && status === 'ready' ? mode : null;
    if (Number.isFinite(radiusMm) && radiusMm > 0) lockRadiusMm = radiusMm;
    if (lockMode && placing) setPlacing(false);
    syncPicking();
    syncCursor();
    if (!lockMode) layer.setPickHighlight(null);
    emit();
  };

  const lockAt = async (index: number) => {
    if (!lockMode || status !== 'ready') return;
    try {
      const touched = await editKernel.lockRegion(index, lockRadiusMm, lockMode === 'lock');
      if (touched.length === 0) {
        message = 'Aucune matière à verrouiller ici.';
      } else {
        message = null;
        await refreshLocks();
        // Les poids du nœud actif dépendent des verrous (la matière verrouillée ne bouge pas).
        if (node) requestWeights();
      }
      emit();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      emit();
    }
  };

  // --- aperçu pendant le glissement (épaisseurs, dépôts rognés, trajets à vide) ----------------------

  const PREVIEW_BITS = [EDIT_FLAG_THINNER, EDIT_FLAG_THICKER, EDIT_FLAG_BOUNDS, EDIT_FLAG_TRIM];
  const clearPreviews = () => {
    for (const bit of PREVIEW_BITS) layer.setEditFlagBit(bit, null);
    layer.setTravelPreview(null);
    thickness = null;
    trimmedCount = 0;
    window.clearTimeout(validateTimer);
    validateSeq++;
    if (liveB) {
      // Retour aux défauts du fichier entier.
      liveB = null;
      judgedSet = null;
      pushViolationFlags();
    }
  };

  const updatePreview = (n: NodeState, res: Awaited<ReturnType<typeof editKernel.drag>> & object) => {
    const now = performance.now();
    if (now - lastPreviewAt < PREVIEW_PERIOD_MS) return;
    lastPreviewAt = now;
    const A = n.affectedIdx;
    const D = n.dependentIdx ?? new Uint32Array(0);
    const base = n.baseHeights;
    if (res.heights && A && base && res.heights.length === A.length + D.length) {
      const thinner: number[] = [], thicker: number[] = [], bad: number[] = [];
      const counts = res.layerCounts && res.layerCounts.length === res.heights.length ? res.layerCounts : null;
      let resliceNow = 0, resliceMax = 0;
      // Re-tranchage : un dépassement de quelques pour cent du maximum est toléré (pas de couche insérée).
      const overTolerance = res.layerCounts ? Math.max(0.015, 0.05 * layerLimits.maxMm) : 0.005;
      let min = Infinity, max = -Infinity;
      let nodeNow: number | null = null, nodeBefore: number | null = null;
      for (let i = 0; i < res.heights.length; i++) {
        const h = res.heights[i];
        const b0 = base[i];
        if (!Number.isFinite(h) || !Number.isFinite(b0) || !(b0 > 0)) continue;
        const k = i < A.length ? A[i] : D[i - A.length];
        // Re-tranchage : au-delà du maximum, la couche sera subdivisée (aperçu orange, pas une alerte).
        const subdivided = !!counts && counts[i] > 0;
        if (subdivided) { thicker.push(k); resliceNow++; if (counts[i] > resliceMax) resliceMax = counts[i]; }
        else if (h < layerFloorMm(layerLimits) - 0.005 || h > layerLimits.maxMm + overTolerance) bad.push(k);
        else if (h < b0 * (1 - THICKNESS_RATIO_BAND)) thinner.push(k);
        else if (h > b0 * (1 + THICKNESS_RATIO_BAND)) thicker.push(k);
        if (h < min) min = h;
        if (h > max) max = h;
        if (k === n.index) { nodeNow = h; nodeBefore = b0; }
      }
      reslicePoints = resliceNow;
      resliceMaxCount = resliceMax;
      const arr = (v: number[]) => (v.length ? Uint32Array.from(v) : null);
      layer.setEditFlagBit(EDIT_FLAG_THINNER, arr(thinner));
      layer.setEditFlagBit(EDIT_FLAG_THICKER, arr(thicker));
      layer.setEditFlagBit(EDIT_FLAG_BOUNDS, arr(bad));
      thickness = Number.isFinite(min)
        ? {
          node: nodeNow, nodeBefore, min, max,
          thinner: thinner.length, thicker: thicker.length, outOfBounds: bad.length,
          minLimit: layerFloorMm(layerLimits), maxLimit: layerLimits.maxMm,
        }
        : null;
    }
    const trimmed = res.trimmed ?? new Uint32Array(0);
    layer.setEditFlagBit(EDIT_FLAG_TRIM, trimmed.length ? trimmed : null);
    trimmedCount = trimmed.length;
  };

  const ensureKernel = async () => {
    const parsed = layer.getParsed();
    if (!parsed || parsed.moves.length < 2) {
      status = 'inactive';
      message = 'Aucun G-code affiché.';
      return emit();
    }
    if (parsed.kind !== 'polar') {
      status = 'unsupported';
      message = "Convertissez d'abord le G-Code pour Apex Slicer.";
      return emit();
    }
    if (!editKernel.available) {
      status = 'unavailable';
      message = "L'édition par nœuds n'est disponible que dans l'application de bureau.";
      return emit();
    }
    if (loadedParsed === parsed && status === 'ready') return emit();
    const seq = ++loadSeq;
    status = 'loading';
    message = null;
    emit();
    try {
      if (!(await editKernel.open())) throw new Error("Le noyau d'édition ne répond pas.");
      const n = parsed.moves.length;
      const r = new Float64Array(n), c = new Float64Array(n), z = new Float64Array(n), b = new Float64Array(n);
      const extruding = new Uint8Array(n);
      parsed.moves.forEach((m, k) => {
        r[k] = m.x; c[k] = m.y; z[k] = m.z; b[k] = m.b; extruding[k] = m.extruding ? 1 : 0;
      });
      const e = parsed.eDelta;
      // Type de ligne de chaque point (barrière d'influence), temps machine (vitesse et accélération de B)
      // et modèle de la tête échantillonné (collisions).
      const typeIndex = new Map<string, number>(LINE_TYPES.map((t, i) => [t.id, i]));
      const types = new Uint8Array(n);
      parsed.moves.forEach((m, k) => { types[k] = typeIndex.get(m.type) ?? 0; });
      const times = parsed.times.length === n ? Float64Array.from(parsed.times) : undefined;
      const headSamples = layer.getHeadSamples(3) ?? undefined;
      await busy(editKernel.load(
        { r, c, z, b, e, extruding, times, types, headSamples },
        { pivotMm: NOZZLE_PIVOT_MM, minLayerMm: layerLimits.minMm, maxLayerMm: layerLimits.maxMm, widthFactor: layerLimits.widthFactor },
      ));
      if (seq !== loadSeq) return;
      loadedParsed = parsed;
      status = 'ready';
      undoDepth = 0;
      redoDepth = 0;
      undoGroups = [];
      redoGroups = [];
      locksCount = 0;
      validation = null;
      thickness = null;
      trimmedCount = 0;
      headModel = !!headSamples && headSamples.length >= 30;
      parsed.editJournal = { undo: [], redo: [] };
      await restoreJournal(parsed);
      if (seq !== loadSeq) return;
      if (!headModel) void refreshHeadSamples();
      void refreshFileValidation();
    } catch (error) {
      if (seq !== loadSeq) return;
      status = 'error';
      message = error instanceof Error ? error.message : String(error);
    }
    emit();
  };

  // --- journal (D5) : historique écrit dans l'en-tête chiffré, relu à la réouverture ---------------

  const JOURNAL_PRECISION = 1e7;
  const round = (v: number) => Math.round(v * JOURNAL_PRECISION) / JOURNAL_PRECISION;

  /** Valeurs courantes (R, C, Z, B, E) des points `indices` dans le G-code affiché. */
  const currentValues = (parsed: ParsedGCode, indices: ArrayLike<number>) => {
    const out = new Float64Array(indices.length * EDIT_VALUES_PER_POINT);
    for (let i = 0; i < indices.length; i++) {
      const k = indices[i];
      const m = parsed.moves[k];
      out.set([m.x, m.y, m.z, m.b, parsed.eDelta[k]], i * EDIT_VALUES_PER_POINT);
    }
    return out;
  };

  const toHistory = (e: ApexJournalEntry): EditHistoryEntry => ({
    indices: Uint32Array.from(e.indices),
    before: Float64Array.from(e.before),
    after: Float64Array.from(e.after),
    trimmed: e.trimmed && e.trimmed.length ? Uint32Array.from(e.trimmed) : undefined,
  });

  /** Tailles des groupes d'entrées consécutives de même identifiant de groupe (une validation et ses copies). */
  const groupsOf = (entries: ApexJournalEntry[]) => {
    const out: number[] = [];
    let last: string | undefined;
    for (const e of entries) {
      if (e.group !== undefined && e.group === last) out[out.length - 1]++;
      else out.push(1);
      last = e.group;
    }
    return out;
  };

  /** Historique relu dans l'en-tête du fichier : rendu au noyau si le fichier n'a pas changé
   * depuis (empreinte de la dernière modification) ; sinon ignoré, avec un message. */
  const restoreJournal = async (parsed: ParsedGCode) => {
    const journal = parsed.apexHeader?.journal;
    if (!journal || (journal.undo.length === 0 && journal.redo.length === 0)) return;
    const last = journal.undo[journal.undo.length - 1];
    if (last) {
      const now = await fingerprintOf(last.indices, currentValues(parsed, last.indices));
      if (now !== last.fingerprint) {
        message = "Historique du fichier ignoré : le fichier a été modifié hors d'Apex depuis.";
        return;
      }
    }
    try {
      const depths = await editKernel.restoreHistory({ undo: journal.undo.map(toHistory), redo: journal.redo.map(toHistory) });
      undoDepth = depths.undoDepth;
      redoDepth = depths.redoDepth;
      undoGroups = groupsOf(journal.undo);
      redoGroups = groupsOf(journal.redo);
      parsed.editJournal = { undo: [...journal.undo], redo: [...journal.redo] };
    } catch (error) {
      message = `Historique du fichier ignoré : ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  /** Nouvelle entrée du journal pour une validation (avant / après, transformation, influence). */
  const journalCommit = async (
    parsed: ParsedGCode,
    nodeIndex: number,
    transform: EditTransform,
    influenceUsed: EditInfluence,
    indices: Uint32Array,
    before: Float64Array,
    after: Float64Array,
    trimmed?: Uint32Array,
    group?: string,
  ) => {
    if (parsed.insertedBlocks?.length) return;
    const journal = (parsed.editJournal ??= { undo: [], redo: [] });
    const entry: ApexJournalEntry = {
      at: new Date().toISOString(),
      node: nodeIndex,
      transform: {
        translation: Array.from(transform.translation),
        axis: Array.from(transform.axis),
        angleRad: transform.angleRad,
      },
      influence: {
        ...influenceUsed,
        directions: influenceUsed.directions ? Array.from(influenceUsed.directions, round) : [],
        anchors: influenceUsed.anchors ? Array.from(influenceUsed.anchors, round) : [],
      },
      indices: Array.from(indices),
      before: Array.from(before, round),
      after: Array.from(after, round),
      ...(trimmed && trimmed.length ? { trimmed: Array.from(trimmed) } : {}),
      ...(group !== undefined ? { group } : {}),
      fingerprint: '',
    };
    journal.undo.push(entry);
    journal.redo = [];
    entry.fingerprint = await fingerprintOf(indices, after);
  };

  const journalStep = (parsed: ParsedGCode, step: 'undo' | 'redo') => {
    const journal = parsed.editJournal;
    if (!journal) return;
    const from = step === 'undo' ? journal.undo : journal.redo;
    const to = step === 'undo' ? journal.redo : journal.undo;
    const entry = from.pop();
    if (entry) to.push(entry);
  };

  const toKernel = (v: BABYLON.Vector3) => [v.x, v.z, v.y] as const;
  const fromKernel = (v: ArrayLike<number>) => new BABYLON.Vector3(v[0], v[2], v[1]);

  // Repère du noyau = composantes Babylon y ↔ z échangées (une réflexion) : la même rotation s'y
  // écrit avec l'axe échangé et l'angle opposé.
  const transformOf = (n: NodeState): EditTransform => ({
    translation: Float64Array.from(toKernel(n.translation)),
    axis: Float64Array.from(toKernel(n.rotation.axis)),
    angleRad: -n.rotation.angle,
  });

  const pushTransform = (n: NodeState | null) => {
    layer.setEditTransform(n
      ? { translation: n.applied, pivot: n.anchor, axis: n.rotation.axis, angle: n.rotation.applied, stackAxis: n.stackAxis ?? undefined }
      : { translation: BABYLON.Vector3.Zero(), pivot: BABYLON.Vector3.Zero(), axis: BABYLON.Vector3.Up(), angle: 0 });
  };

  const buildInfluence = (n: NodeState): EditInfluence => {
    const dirs: number[] = [];
    const anchors: number[] = [];
    // Mode Auto : les poignées ne règlent que l'orientation de la rotation ; la portée part de la portée
    // minimale (toutes directions) et s'élargit.
    if (influence.reachMode === 'reach') for (const h of n.handles.values()) {
      const v = h.lockPoint ? h.lockPoint.subtract(n.anchor) : h.v;
      const reach = v.length();
      if (!(reach > 1e-6)) continue;
      const [x, y, z] = toKernel(v.scale(1 / reach));
      dirs.push(x, y, z, reach * n.reach.scale);
      if (h.lockPoint) {
        const [ax, ay, az] = toKernel(h.lockPoint);
        anchors.push(ax, ay, az, Math.max(ANCHOR_MIN_RADIUS_MM, ANCHOR_RADIUS_FRACTION * reach));
      }
    }
    return {
      ...influence,
      spatial: { ...influence.spatial, radiusMm: influence.spatial.radiusMm * n.reach.scale },
      dragDirection: Float64Array.from(toKernel(n.translation)),
      directions: Float64Array.from(dirs),
      anchors: Float64Array.from(anchors),
      trim: n.trimming ? { enabled: true, layers: influence.trimLayers } : undefined,
    };
  };

  /** Plus grande portée en cours du nœud (mm) : poignée la plus longue ou portée minimale, élargie. */
  const maxReachOf = (n: NodeState) => {
    let reach = influence.spatial.radiusMm;
    if (influence.reachMode === 'reach') for (const h of n.handles.values()) reach = Math.max(reach, (h.lockPoint ? h.lockPoint.subtract(n.anchor) : h.v).length());
    return reach * n.reach.scale;
  };

  // Diagonale de l'objet (mm), mesurée une fois par fichier : borne de l'élargissement du mode Auto.
  let extentOf: object | null = null;
  let extent = 0;
  const objectExtent = () => {
    const parsed = layer.getParsed();
    if (!parsed) return 0;
    if (extentOf !== parsed) {
      let rMax = 0, zMin = Infinity, zMax = -Infinity;
      // Polaire : X = rayon ; cartésien : X et Y recentrés sur le plateau.
      const cartesian = parsed.kind === 'cartesian';
      for (const m of parsed.moves) {
        const r = cartesian ? Math.hypot(m.x, m.y) : Math.abs(m.x);
        if (r > rMax) rMax = r;
        if (m.z < zMin) zMin = m.z;
        if (m.z > zMax) zMax = m.z;
      }
      extent = Math.hypot(2 * rMax, zMax > zMin ? zMax - zMin : 0);
      extentOf = parsed;
    }
    return extent;
  };

  // Poids : une requête en vol, la plus récente remplace celle qui attendait.
  let weightsBusy = false;
  let weightsDirty = false;
  // Pendant la répétition d'une déformation par symétrie, le noyau sert aux copies : pas de poids du nœud actif.
  let symmetryBusy = false;
  // Message important (résultat d'une symétrie, copie…) : le recalcul des poids ne l'efface pas avant 5 s.
  let heldUntil = 0;
  const hold = (text: string) => { message = text; heldUntil = performance.now() + 5000; };
  const requestWeights = () => {
    weightsDirty = true;
    void pumpWeights();
  };
  const pumpWeights = async () => {
    if (weightsBusy || !weightsDirty || symmetryBusy) return;
    const n = node;
    if (!n || status !== 'ready') { weightsDirty = false; return; }
    weightsBusy = true;
    weightsDirty = false;
    try {
      const res = await busy(editKernel.setHandle(n.index, buildInfluence(n)), false);
      if (node === n) {
        if (!('refused' in res)) {
          layer.setEditWeights(res.affected, res.weights, res.slideNormals, res.axes);
          n.affectedIdx = res.affected;
          n.dependentIdx = res.dependents;
          n.baseHeights = res.baseHeights;
          capacityMm = res.capacityMm;
          n.stackAxis = res.stackSign !== 0 ? fromKernel(res.handleAxis).normalize() : null;
          pushTransform(n);
          affected = res.affected.length;
          if (performance.now() > heldUntil) message = null;
          if (n.reach.growing) {
            // Plus aucun point gagné et la portée couvre tout l'objet : tout ce qui peut bouger bouge déjà.
            // (Sans gain mais plus courte que l'objet : un vide entre deux parties, on continue.)
            if (res.affected.length <= n.reach.affected && maxReachOf(n) >= objectExtent()) n.reach.saturated = true;
            n.reach.growing = false;
          }
          n.reach.affected = res.affected.length;
          // Nouvelle influence : le noyau a oublié la déformation en cours, la redemander.
          if (n.positionLocked && n.translation.lengthSquared() > 0) requestDelta(n);
        } else {
          layer.setEditWeights(null);
          capacityMm = null;
          affected = 0;
          message = REFUSAL_MESSAGES[res.refused];
        }
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    weightsBusy = false;
    emit();
    void pumpWeights();
  };

  /** Valeurs validées du point (le champ `eRatio` y porte l'extrusion d'origine du segment). */
  const originalOf = (index: number): EditDelta => {
    const parsed = layer.getParsed()!;
    const m = parsed.moves[index];
    return { r: m.x, c: m.y, z: m.z, b: m.b, eRatio: parsed.eDelta[index] };
  };

  // --- nœud -----------------------------------------------------------------------------------

  /** Réduit le nœud actif : il reste posé (poignées, verrouillage), le noyau le libère. */
  const deactivate = () => {
    const n = node;
    if (!n) return;
    node = null;
    n.translation = BABYLON.Vector3.Zero();
    n.applied = BABYLON.Vector3.Zero();
    n.rotation.angle = 0;
    n.rotation.applied = 0;
    n.rotation.fraction = 1;
    dragSeq++;
    n.reach = { scale: 1, growing: false, saturated: false, affected: 0 };
    n.stackAxis = null;
    n.dragTip = null;
    handleDrag = null;
    syncPicking();
    affected = 0;
    delta = null;
    layer.setEditWeights(null);
    clearPreviews();
    pushTransform(null);
    if (status === 'ready') void editKernel.cancel().catch(() => undefined);
    updateView(true);
    emit();
  };

  const activate = (n: NodeState) => {
    if (node === n || status !== 'ready') return;
    deactivate();
    node = n;
    n.anchor = layer.getMoveTip(n.index, new BABYLON.Vector3());
    n.original = originalOf(n.index);
    delta = null;
    // Déverrouillé : le glisser le long de la trajectoire demande l'index de sélection.
    layer.setPickingEnabled(true);
    requestWeights();
    updateView(true);
    emit();
  };

  /** Supprime le nœud actif. */
  const removeNode = () => {
    const n = node;
    if (!n) return;
    deactivate();
    nodes.delete(n.id);
    updateView(true);
  };

  /** Supprime tous les nœuds (autre fichier : ils décrivaient l'ancien). */
  const clearNodes = () => {
    deactivate();
    nodes.clear();
    updateView(true);
  };

  const placeNode = (t: number) => {
    const parsed = layer.getParsed();
    if (!parsed) return;
    const index = Math.max(0, Math.min(parsed.moves.length - 1, Math.round(t)));
    const n: NodeState = {
      id: ++nodeSeq,
      index,
      anchor: layer.getMoveTip(index, new BABYLON.Vector3()),
      translation: BABYLON.Vector3.Zero(),
      applied: BABYLON.Vector3.Zero(),
      original: originalOf(index),
      positionLocked: false,
      rotation: { axis: BABYLON.Vector3.Up(), angle: 0, applied: 0, fraction: 1 },
      trimming: false,
      occluded: false,
      affectedIdx: null,
      dependentIdx: null,
      baseHeights: null,
      handles: new Map(),
      reach: { scale: 1, growing: false, saturated: false, affected: 0 },
      stackAxis: null,
      dragTip: null,
    };
    nodes.set(n.id, n);
    // L'actif précédent est réduit, pas retiré : on pourra le reprendre plus tard. Les poignées
    // par défaut arrivent du nouveau nœud dès son affichage (onHandlesChange).
    activate(n);
    setPlacing(false);
  };

  const setPlacing = (active: boolean) => {
    placing = active && status === 'ready' && isActive();
    if (placing && lockMode) { lockMode = null; }
    // L'index de sélection sert aussi au nœud posé (glissement le long de la trajectoire).
    syncPicking();
    if (!placing && !lockMode) layer.setPickHighlight(null);
    syncCursor();
    emit();
  };

  /** Point de trajectoire sous un point écran (px de rendu) ; par défaut, sous le pointeur Babylon. */
  const pick = (renderX = scene.pointerX, renderY = scene.pointerY) => {
    const ray = scene.createPickingRay(renderX, renderY, BABYLON.Matrix.Identity(), camera);
    const fov = (camera as BABYLON.TargetCamera).fov ?? 0.8;
    const pxPerUnit = (2 * Math.tan(fov / 2)) / Math.max(1, engine.getRenderHeight());
    return layer.pickAt(ray, pxPerUnit);
  };

  let pointerDown: { x: number; y: number } | null = null;
  const pointerObserver = scene.onPointerObservable.add((info) => {
    if ((!placing && !lockMode) || !isActive()) return;
    const evt = info.event as PointerEvent;
    if (info.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      if (evt.buttons !== 0) { layer.setPickHighlight(null); return; }
      layer.setPickHighlight(pick()?.local ?? null);
    } else if (info.type === BABYLON.PointerEventTypes.POINTERDOWN && evt.button === 0) {
      pointerDown = { x: evt.clientX, y: evt.clientY };
    } else if (info.type === BABYLON.PointerEventTypes.POINTERUP && evt.button === 0) {
      const down = pointerDown;
      pointerDown = null;
      if (!down || Math.hypot(evt.clientX - down.x, evt.clientY - down.y) > CLICK_SLOP_PX) return;
      const hit = pick();
      if (!hit) return;
      if (placing) placeNode(hit.t);
      else if (lockMode) void lockAt(Math.round(hit.t));
    }
  });

  // --- vue (projection à chaque image) ------------------------------------------------------------

  const OFFSET_EPS_PX = 0.05;
  const sameNodeView = (a: EditNodeView, b: EditNodeView) => {
    if (a.id !== b.id || a.visible !== b.visible || a.active !== b.active || a.busy !== b.busy ||
      a.positionLocked !== b.positionLocked || a.trimming !== b.trimming || a.occluded !== b.occluded) return false;
    if (Math.abs(a.x - b.x) > OFFSET_EPS_PX || Math.abs(a.y - b.y) > OFFSET_EPS_PX) return false;
    const ids = Object.keys(a.handleOffsets);
    if (ids.length !== Object.keys(b.handleOffsets).length) return false;
    return ids.every((id) => {
      const p = a.handleOffsets[Number(id)], q = b.handleOffsets[Number(id)];
      return !!q && Math.abs(p.dx - q.dx) <= OFFSET_EPS_PX && Math.abs(p.dy - q.dy) <= OFFSET_EPS_PX;
    });
  };

  const viewOf = (n: NodeState): EditNodeView => {
    const center = nodeLocal(n);
    const screen = project(center);
    const handleOffsets: EditNodeView['handleOffsets'] = {};
    for (const [id, h] of n.handles) {
      const p = project(h.lockPoint ?? center.add(h.v));
      handleOffsets[id] = { dx: p.x - screen.x, dy: p.y - screen.y };
    }
    return {
      id: n.id, visible: screen.z > 0 && screen.z < 1, active: n === node, x: screen.x, y: screen.y,
      handleOffsets, busy: n === node && busyCount > 0, positionLocked: n.positionLocked,
      trimming: n.trimming, occluded: n.occluded, fixedHandles: influence.reachMode === 'auto',
    };
  };

  const updateView = (force = false) => {
    const next = isActive() ? [...nodes.values()].map(viewOf) : [];
    const prev = lastView.nodes;
    if (force || next.length !== prev.length || next.some((v, i) => !sameNodeView(v, prev[i]))) {
      publishView({ nodes: next });
    }
  };

  // Masquage : un nœud dont le point est caché par une autre partie de la pièce, vu de la caméra, s'estompe.
  // La première trajectoire que le rayon touche (index de sélection, de l'avant vers l'arrière) n'est pas
  // le point du nœud : quelque chose le masque.
  let lastOcclusionAt = 0;
  const OCCLUSION_PERIOD_MS = 220;
  const OCCLUSION_TOLERANCE_MM = 1.0;
  const updateOcclusion = () => {
    const now = performance.now();
    if (now - lastOcclusionAt < OCCLUSION_PERIOD_MS || !isActive() || nodes.size === 0) return;
    lastOcclusionAt = now;
    let changed = false;
    for (const n of nodes.values()) {
      let occluded = false;
      if (n.translation.lengthSquared() === 0 && n.rotation.angle === 0) {
        const p = project(n.anchor);
        if (p.z > 0 && p.z < 1) {
          const s = cssScale();
          const hit = pick(p.x / s, p.y / s);
          occluded = !!hit && BABYLON.Vector3.Distance(hit.local, n.anchor) > OCCLUSION_TOLERANCE_MM;
        }
      }
      if (occluded !== n.occluded) { n.occluded = occluded; changed = true; }
    }
    if (changed) updateView(true);
  };

  const afterRenderListeners = new Set<() => void>();
  const renderObserver = scene.onAfterRenderObservable.add(() => {
    updateOcclusion();
    updateView();
    for (const l of afterRenderListeners) l();
  });

  // --- glissement et validation -------------------------------------------------------------------

  /** Nœud déverrouillé : il suit le point de dépôt sous le curseur, sans rien déformer. */
  const slideAlongToolpath = (n: NodeState, x: number, y: number) => {
    const s = cssScale();
    const hit = pick(x / s, y / s);
    const parsed = layer.getParsed();
    if (!hit || !parsed) return;
    const index = Math.max(0, Math.min(parsed.moves.length - 1, Math.round(hit.t)));
    if (index === n.index) return;
    n.index = index;
    n.anchor = layer.getMoveTip(index, new BABYLON.Vector3());
    n.original = originalOf(index);
    delta = null;
    requestWeights();
    updateView(true);
    emit();
  };

  const togglePositionLock = (id: number) => {
    const n = nodes.get(id);
    if (!n) return;
    n.positionLocked = !n.positionLocked;
    updateView(true);
  };

  let dragSeq = 0;
  let lastDrag: unknown = null;
  const onNodeMove = (id: number, x: number, y: number) => {
    const n = node;
    // Un nœud réduit ne se déplace pas : un clic le reprend d'abord.
    if (!n || n.id !== id || status !== 'ready') return;
    if (!n.positionLocked) {
      slideAlongToolpath(n, x, y);
      return;
    }
    const depth = project(n.anchor).z;
    // Le noyau freine la translation près des limites d'épaisseur : le nœud et le shader suivent
    // la translation qu'il applique, dès sa réponse.
    n.translation = unproject(x, y, depth).subtract(n.anchor);
    requestDelta(n);
  };

  /** Valeurs firmware exactes du point du nœud pour la déformation en cours (champs Δ). */
  const requestDelta = (n: NodeState): Promise<void> => {
    const seq = ++dragSeq;
    // Hauteurs demandées : E dépend de l'épaisseur (D3, recalcul dynamique) et l'aperçu de la nouvelle
    // hauteur de dépôt en vient ; trajets à vide : déformés aussi pendant le glissement.
    requestedAxialMm = n.stackAxis ? Math.abs(BABYLON.Vector3.Dot(n.translation, n.stackAxis)) : null;
    return editKernel.drag(transformOf(n), { heights: true, travel: true }).then((res) => {
      if (!res || node !== n || seq !== dragSeq) return;
      lastDrag = res;
      n.applied = fromKernel(res.appliedTranslation);
      n.rotation.applied = -res.appliedAngleRad;
      if (Math.abs(n.rotation.angle) > 1e-6) n.rotation.fraction = Math.max(0, Math.min(1, n.rotation.applied / n.rotation.angle));
      n.dragTip = tipOfFirmware(res.handle);
      // Sens changé le long de l'empilement : poids à répartir selon l'autre marge.
      if (res.rebuild && !n.reach.growing) {
        n.reach.growing = true;
        n.reach.saturated = false;
        n.reach.affected = 0;
        requestWeights();
        return;
      }
      // Mode Auto, portée recommandée trop courte pour la translation demandée : on la dépasse.
      if (influence.reachMode === 'auto' && res.limitScale !== null && res.limitScale < 1 &&
        !n.reach.growing && !n.reach.saturated) {
        const growth = Math.min(REACH_GROWTH_MAX, Math.max(REACH_GROWTH_MIN, 1 / Math.max(res.limitScale, 1e-6)));
        n.reach.scale *= growth;
        n.reach.growing = true;
        requestWeights();
      }
      pushTransform(n);
      updateView();
      const e0 = n.original.eRatio;
      delta = {
        r: res.handle[0] - n.original.r,
        c: res.handle[1] - n.original.c,
        z: res.handle[2] - n.original.z,
        b: res.handle[3] - n.original.b,
        eRatio: e0 > 0 ? res.handle[4] / e0 : NaN,
      };
      if (res.travelIndices && res.travelTips) {
        // Repère du noyau (x, y, z) → local (x, z, y).
        const tips = new Float32Array(res.travelTips.length);
        for (let i = 0; i + 2 < tips.length; i += 3) {
          tips[i] = res.travelTips[i]; tips[i + 1] = res.travelTips[i + 2]; tips[i + 2] = res.travelTips[i + 1];
        }
        layer.setTravelPreview(res.travelIndices, tips);
      }
      updatePreview(n, res);
      scheduleLiveValidation(n);
      emit();
    }).catch(() => undefined);
  };

  const applyChange = (indices?: Uint32Array, values?: Float64Array, trimmed?: Uint32Array, trimState?: boolean) => {
    // Même image : géométrie validée, déformation et poids remis à zéro (pas de saut visible).
    if (node) {
      node.translation = BABYLON.Vector3.Zero();
      node.applied = BABYLON.Vector3.Zero();
      node.dragTip = null;
      node.rotation.angle = 0;
      node.rotation.applied = 0;
      node.rotation.fraction = 1;
    }
    pushTransform(null);
    layer.setEditWeights(null);
    requestedAxialMm = null;
    // Trajets à vide d'abord (ils reprennent la géométrie validée), puis les valeurs validées.
    clearPreviews();
    if (indices && values) layer.applyMoveEdits(indices, values, trimmed, trimState);
    // Tous les nœuds, réduits compris, restent sur leur point de trajectoire.
    for (const m of nodes.values()) m.anchor = layer.getMoveTip(m.index, new BABYLON.Vector3());
  };

  /** Après une modification validée : limites de B du fichier, collisions et normales de la zone. */
  const afterEdit = async (indices?: Uint32Array) => {
    await refreshFileValidation();
    await validateZone(indices);
  };

  const onNodeMoveEnd = (id: number) => {
    const n = node;
    if (n && n.id === id && n.positionLocked) commitNode(n);
  };

  const newGroupId = () => `g${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

  // --- re-tranchage : couches interpolées insérées dans la trajectoire, en place -----------------------------

  /** Temps machine et types de ligne par mouvement, à redonner au noyau après une insertion de points. */
  const syncKernelMoves = async (parsed: ParsedGCode) => {
    const typeIndex = new Map<string, number>(LINE_TYPES.map((t, i) => [t.id, i]));
    const types = new Uint8Array(parsed.moves.length);
    parsed.moves.forEach((m, k) => { types[k] = typeIndex.get(m.type) ?? 0; });
    await editKernel.setTypes(types);
    await editKernel.setTimes(Float64Array.from(parsed.times));
  };

  /** Points insérés ou retirés par le noyau (re-tranchage) : le G-code affiché, le calque 3D et les nœuds suivent,
   * sans réécrire ni relire le fichier. À l'insertion, avant d'appliquer les valeurs ; au retrait, après. */
  const applySplice = async (splice: EditSplice) => {
    const parsed = layer.getParsed();
    if (!parsed || splice.blocks.length === 0) return;
    const length = parsed.moves.length;
    for (const m of nodes.values()) {
      const k = remapMoveIndex(m.index, splice.blocks, splice.inserted, length);
      m.index = k >= 0 ? k : Math.max(0, splice.blocks[0].at - 1);
    }
    if (splice.inserted) insertMoves(parsed, splice.blocks);
    else removeMoves(parsed, splice.blocks);
    // Le journal du fichier décrivait l'ancienne numérotation (et n'est plus écrit tant que des plages sont insérées).
    parsed.editJournal = { undo: [], redo: [] };
    liveB = null;
    judgedSet = null;
    await layer.replaceMoves(parsed);
    await syncKernelMoves(parsed);
    for (const m of nodes.values()) m.anchor = layer.getMoveTip(m.index, new BABYLON.Vector3());
    void refreshLocks();
  };

  /** Valide la déformation en cours (translation du nœud et rotation des poignées). */
  const commitNode = (n: NodeState) => {
    if (status !== 'ready') return;
    dragSeq++;
    window.clearTimeout(validateTimer);
    validateSeq++;
    // Instantané pour le journal : transformation et influence de cette validation.
    const transform = transformOf(n);
    // Journal : la translation et l'angle appliqués (freinés), pas ceux demandés par le pointeur.
    const journalTransform: EditTransform = {
      ...transform,
      translation: Float64Array.from(toKernel(n.applied)),
      angleRad: -n.rotation.applied,
    };
    const influenceUsed = buildInfluence(n);
    const nodeIndex = n.index;
    const anchorKernel = toKernel(n.anchor);
    const group = newGroupId();
    committing = true;
    void busy(editKernel.commit(transform)).then(async (change) => {
      if (node !== n) return;
      undoDepth = change.undoDepth;
      redoDepth = change.redoDepth;
      // Re-tranchage : des couches sont insérées (indices de `change` = état avec elles).
      if (change.ok && change.splice?.inserted) await applySplice(change.splice);
      const parsed = layer.getParsed();
      if (change.ok && change.indices && change.values && parsed && !parsed.insertedBlocks?.length) {
        // Valeurs d'avant lues AVANT d'appliquer la modification au G-code affiché.
        const before = currentValues(parsed, change.indices);
        void journalCommit(
          parsed, nodeIndex, journalTransform, influenceUsed, change.indices, before, change.values,
          change.trimmed, symmetry.mode !== 'none' ? group : undefined,
        );
        undoGroups.push(1);
        redoGroups = [];
      }
      applyChange(
        change.ok ? change.indices : undefined, change.ok ? change.values : undefined,
        change.ok ? change.trimmed : undefined, change.ok ? change.trimState : undefined,
      );
      n.original = originalOf(n.index);
      // Validée : la portée revient à celle que recommandent les poignées.
      n.reach = { scale: 1, growing: false, saturated: false, affected: 0 };
      requestWeights();
      updateView(true);
      emit();
      if (change.ok) {
        if (symmetry.mode !== 'none') await applySymmetry(journalTransform, influenceUsed, anchorKernel, group);
        void afterEdit(change.indices);
      }
    }).catch((error) => {
      if (import.meta.env.DEV) console.error('[édition] validation :', error);
      message = error instanceof Error ? error.message : String(error);
      emit();
    }).finally(() => { committing = false; });
  };

  // --- symétrie : la déformation validée est répétée en d'autres points (cyclique ou miroir) ---------

  type Vec3k = [number, number, number];
  interface SymmetryMap { point: (v: Vec3k) => Vec3k; axis: (v: Vec3k) => Vec3k }

  /** Applications du repère du noyau (droit, z vers le haut) qui envoient le nœud sur ses copies. */
  const symmetryMaps = (): SymmetryMap[] => {
    const out: SymmetryMap[] = [];
    if (symmetry.mode === 'cyclic') {
      const count = Math.max(2, Math.min(12, Math.round(symmetry.count)));
      for (let i = 1; i < count; i++) {
        const a = (2 * Math.PI * i) / count, c = Math.cos(a), sn = Math.sin(a);
        const rot = (v: Vec3k): Vec3k => [c * v[0] - sn * v[1], sn * v[0] + c * v[1], v[2]];
        out.push({ point: rot, axis: rot });
      }
    } else if (symmetry.mode === 'mirror') {
      // Réflexion par rapport au plan vertical d'angle C0 qui contient l'axe du plateau. Une réflexion
      // envoie un axe de rotation sur l'opposé de son image (pseudo-vecteur), l'angle est conservé.
      const a = (symmetry.mirrorDeg * Math.PI) / 180, c2 = Math.cos(2 * a), s2 = Math.sin(2 * a);
      const mirror = (v: Vec3k): Vec3k => [c2 * v[0] + s2 * v[1], s2 * v[0] - c2 * v[1], v[2]];
      out.push({ point: mirror, axis: (v) => { const m = mirror(v); return [-m[0], -m[1], -m[2]]; } });
    }
    return out;
  };

  const mapInfluence = (infl: EditInfluence, m: SymmetryMap): EditInfluence => {
    const quad = (src: Float64Array | undefined, transform: (v: Vec3k) => Vec3k) => {
      if (!src) return src;
      const out = new Float64Array(src.length);
      for (let i = 0; i + 3 < src.length; i += 4) {
        const v = transform([src[i], src[i + 1], src[i + 2]]);
        out[i] = v[0]; out[i + 1] = v[1]; out[i + 2] = v[2]; out[i + 3] = src[i + 3];
      }
      return out;
    };
    const drag = infl.dragDirection ? m.point([infl.dragDirection[0], infl.dragDirection[1], infl.dragDirection[2]]) : null;
    return {
      ...infl,
      directions: quad(infl.directions, m.point),
      anchors: quad(infl.anchors, m.point),
      dragDirection: drag ? Float64Array.from(drag) : infl.dragDirection,
    };
  };

  const applySymmetry = async (tr: EditTransform, infl: EditInfluence, anchorKernel: readonly number[], group: string) => {
    const maps = symmetryMaps();
    if (maps.length === 0) return;
    symmetryBusy = true;
    let made = 0;
    const skipped: string[] = [];
    try {
      for (const m of maps) {
        const q = m.point([anchorKernel[0], anchorKernel[1], anchorKernel[2]]);
        // Nœud sur le plan de symétrie (ou copie confondue avec lui) : rien à répéter.
        if (Math.hypot(q[0] - anchorKernel[0], q[1] - anchorKernel[1], q[2] - anchorKernel[2]) < 0.25) continue;
        const index = await editKernel.nearest(q[0], q[1], q[2], 1.5);
        if (index < 0) { skipped.push('aucune trajectoire à moins de 1,5 mm'); continue; }
        const infl2 = mapInfluence(infl, m);
        const res = await editKernel.setHandle(index, infl2);
        if ('refused' in res) { skipped.push(REFUSAL_MESSAGES[res.refused]); continue; }
        const tr2: EditTransform = {
          translation: Float64Array.from(m.point([tr.translation[0], tr.translation[1], tr.translation[2]])),
          axis: Float64Array.from(m.axis([tr.axis[0], tr.axis[1], tr.axis[2]])),
          angleRad: tr.angleRad,
        };
        const change = await editKernel.commit(tr2);
        const parsed = layer.getParsed();
        if (!change.ok || !change.indices || !change.values || !parsed) { skipped.push('copie sans effet'); continue; }
        if (change.splice?.inserted) await applySplice(change.splice);
        if (!parsed.insertedBlocks?.length) {
          const before = currentValues(parsed, change.indices);
          void journalCommit(parsed, index, tr2, infl2, change.indices, before, change.values, change.trimmed, group);
        }
        layer.applyMoveEdits(change.indices, change.values, change.trimmed, change.trimState);
        undoDepth = change.undoDepth;
        redoDepth = change.redoDepth;
        if (undoGroups.length === 0) undoGroups.push(0);
        undoGroups[undoGroups.length - 1]++;
        made++;
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      symmetryBusy = false;
    }
    for (const m of nodes.values()) m.anchor = layer.getMoveTip(m.index, new BABYLON.Vector3());
    if (made > 0) hold(`Symétrie : ${made} copie(s) de la déformation.`);
    else if (skipped.length > 0) hold(`Symétrie : aucune copie (${skipped[0]}).`);
    requestWeights();
    updateView(true);
    emit();
  };

  // --- saisie numérique d'un déplacement exact (ΔR, ΔC, ΔZ, ΔB) ---------------------------------------

  const setNumericDelta = (values: Partial<Record<'r' | 'c' | 'z' | 'b', number>>, commit: boolean) => {
    const n = node;
    if (!n || status !== 'ready') return;
    // Un déplacement exact déforme : le point d'attache est donc figé.
    if (!n.positionLocked) { n.positionLocked = true; updateView(true); }
    const o = n.original;
    const cur = delta ?? { r: 0, c: 0, z: 0, b: 0, eRatio: NaN };
    const d = { r: values.r ?? cur.r, c: values.c ?? cur.c, z: values.z ?? cur.z, b: values.b ?? cur.b };
    const from = tipOfFirmware([o.r, o.c, o.z, o.b]);
    // ΔB saisi seul : la tête s'incline AUTOUR DE LA POINTE (la pointe reste où elle est, R et Z
    // s'ajustent et se lisent ensuite dans leurs champs). Sinon, valeurs firmware littérales : la pointe
    // suit R, C, Z et B saisis (B décrit un arc autour du pivot quand R et Z sont gardés).
    const onlyB = values.b !== undefined && values.r === undefined && values.z === undefined && values.c === undefined;
    const to = onlyB
      ? tipOfFirmware([o.r + cur.r, o.c + cur.c, o.z + cur.z, o.b + cur.b])
      : tipOfFirmware([o.r + d.r, o.c + d.c, o.z + d.z, o.b + d.b]);
    n.translation = to.subtract(from);
    // ΔB : l'axe de tête tourne de ΔB autour de la tangente au cercle du point (perpendiculaire au plan
    // radial), repère du noyau ; la pointe, elle, suit la translation ci-dessus.
    const c0 = (o.c * Math.PI) / 180;
    n.rotation.axis = fromKernel([-Math.sin(c0), Math.cos(c0), 0]);
    n.rotation.angle = -(d.b * Math.PI) / 180;
    n.rotation.applied = n.rotation.angle;
    pushTransform(n);
    // Validation : après la réponse du noyau, pour que le journal porte la translation réellement appliquée.
    if (commit) void requestDelta(n).then(() => commitNode(n));
    else void requestDelta(n);
  };

  // --- copier / coller une déformation, exprimée dans le repère de la tête --------------------------

  const headBasis = (index: number) => {
    const parsed = layer.getParsed()!;
    const m = parsed.moves[index];
    const c = (m.y * Math.PI) / 180, b = (m.b * Math.PI) / 180;
    const radial = new BABYLON.Vector3(Math.cos(c), 0, Math.sin(c));
    const tangent = new BABYLON.Vector3(-Math.sin(c), 0, Math.cos(c));
    const head = new BABYLON.Vector3(Math.sin(b) * Math.cos(c), Math.cos(b), Math.sin(b) * Math.sin(c));
    return { head, radial, tangent };
  };
  const toBasis = (v: BABYLON.Vector3, bs: ReturnType<typeof headBasis>): [number, number, number] =>
    [BABYLON.Vector3.Dot(v, bs.head), BABYLON.Vector3.Dot(v, bs.radial), BABYLON.Vector3.Dot(v, bs.tangent)];
  const fromBasis = (c: readonly number[], bs: ReturnType<typeof headBasis>) =>
    bs.head.scale(c[0]).add(bs.radial.scale(c[1])).add(bs.tangent.scale(c[2]));

  const copyDeformation = () => {
    const n = node;
    if (!n || (n.translation.lengthSquared() === 0 && n.rotation.applied === 0)) {
      message = "Rien à copier : déformez d'abord le nœud (avant de valider).";
      emit();
      return;
    }
    const bs = headBasis(n.index);
    clipboard = {
      translation: toBasis(n.applied, bs),
      rotationAxis: toBasis(n.rotation.axis, bs),
      rotationAngle: n.rotation.applied,
    };
    hold('Déformation copiée (repère de la tête).');
    emit();
  };

  const pasteDeformation = () => {
    const n = node;
    if (!n || !clipboard || status !== 'ready') return;
    if (!n.positionLocked) { n.positionLocked = true; updateView(true); }
    const bs = headBasis(n.index);
    n.translation = fromBasis(clipboard.translation, bs);
    const axis = fromBasis(clipboard.rotationAxis, bs);
    if (axis.lengthSquared() > 1e-12) n.rotation.axis = axis.normalize();
    n.rotation.angle = clipboard.rotationAngle;
    n.rotation.applied = clipboard.rotationAngle;
    pushTransform(n);
    void requestDelta(n).then(() => commitNode(n));
  };

  const toggleTrimming = (id: number) => {
    const n = nodes.get(id);
    if (!n) return;
    n.trimming = !n.trimming;
    if (n.trimming) {
      hold(influence.trimLayers > 0
        ? `Rognage actif : seules la couche du nœud et ${influence.trimLayers} couche(s) de chaque côté se déforment ; la matière que la déformation envahit au-delà est rognée.`
        : 'Rognage actif : seule la couche du nœud se déforme ; la matière qu’elle envahit dessous (ou dessus) est rognée.');
    } else {
      message = null;
      heldUntil = 0;
    }
    updateView(true);
    if (n === node) requestWeights();
    emit();
  };

  const onHandlesChange = (nodeId: number, list: EditNodeHandle[]) => {
    const n = nodes.get(nodeId);
    if (!n) return;
    const handles = n.handles;
    const center = nodeLocal(n);
    const screen = project(center);
    const seen = new Set<number>();
    for (const h of list) {
      seen.add(h.id);
      // Rotation seule (Ctrl) : la poignée sert de levier, l'influence ne bouge pas.
      if (handleDrag && n === node && handleDrag.id === h.id && handleDrag.mode === 'rotate' && handles.has(h.id)) continue;
      const end = unproject(screen.x + h.dx, screen.y + h.dy, screen.z);
      const old = handles.get(h.id);
      if (influence.reachMode === 'auto' && old) {
        // Auto : l'écartement affiché est fixe ; seule l'orientation change, la longueur (portée du
        // mode Portée) et le verrouillage sont conservés.
        const prev = old.lockPoint ? old.lockPoint.subtract(center) : old.v;
        const dir = end.subtract(center);
        if (dir.lengthSquared() < 1e-12) continue;
        const v = dir.normalize().scale(prev.length());
        handles.set(h.id, old.lockPoint ? { v: old.v, lockPoint: center.add(v) } : { v, lockPoint: null });
        continue;
      }
      handles.set(h.id, { v: end.subtract(center), lockPoint: h.locked ? end : null });
    }
    for (const id of [...handles.keys()]) if (!seen.has(id)) handles.delete(id);
    if (n === node) requestWeights();
  };

  // --- rotation par les poignées (D2) -------------------------------------------------------------
  // Comme une tangente de Bézier : l'angle dont tourne la poignée saisie autour du nœud, dans le plan
  // face à la caméra, fait tourner la déformation. Glisser seul tourne aussi le sens de l'influence
  // (les autres poignées non verrouillées tournent avec) ; Ctrl : rotation seule ; Alt : influence
  // seule. Seulement nœud verrouillé (déverrouillé, on choisit son point) et poignée non ancrée.
  const MIN_LEVER_PX = 8;
  let handleDrag: { id: number; lastAngle: number; sign: number; mode: HandleDragMode; rotated: boolean } | null = null;
  const screenAngle = (dx: number, dy: number) => Math.atan2(-dy, dx);

  const onHandleDrag = (nodeId: number, e: HandleDragEvent) => {
    const n = node;
    if (!n || n.id !== nodeId) return;
    if (e.phase === 'start') {
      const center = nodeLocal(n);
      const screen = project(center);
      if (n.rotation.angle === 0) {
        const camLocal = BABYLON.Vector3.TransformCoordinates(
          camera.globalPosition, layer.getPlateWorldMatrix().clone().invert(),
        );
        n.rotation.axis = camLocal.subtract(center).normalize();
      }
      // Sens : une petite rotation positive autour de l'axe tourne-t-elle la poignée dans le sens
      // trigonométrique à l'écran ? (dépend de la main du repère et du côté de la caméra)
      const v = unproject(screen.x + e.dx, screen.y + e.dy, screen.z).subtract(center);
      const p1 = project(center.add(v));
      const p2 = project(center.add(rotateAbout(v, n.rotation.axis, 0.01)));
      const turn = wrapPi(screenAngle(p2.x - screen.x, p2.y - screen.y) - screenAngle(p1.x - screen.x, p1.y - screen.y));
      handleDrag = { id: e.id, lastAngle: screenAngle(e.dx, e.dy), sign: turn < 0 ? -1 : 1, mode: e.mode, rotated: false };
      return;
    }
    const drag = handleDrag;
    if (!drag || drag.id !== e.id) return;
    drag.mode = e.mode;
    const angleNow = screenAngle(e.dx, e.dy);
    const turn = wrapPi(angleNow - drag.lastAngle);
    drag.lastAngle = angleNow;
    const lever = Math.hypot(e.dx, e.dy) >= MIN_LEVER_PX;
    // Mode Auto : pas d'ancrage, une poignée verrouillée en Portée tourne comme les autres.
    const anchored = e.locked && influence.reachMode !== 'auto';
    if (e.phase === 'move' && n.positionLocked && !anchored && lever && e.mode !== 'influence' && turn !== 0) {
      const a = turn * drag.sign;
      n.rotation.angle += a;
      n.rotation.applied = n.rotation.angle * n.rotation.fraction;
      drag.rotated = true;
      if (e.mode === 'both') {
        for (const [id, h] of n.handles) {
          if (id !== e.id && !h.lockPoint) h.v = rotateAbout(h.v, n.rotation.axis, a);
        }
        requestWeights();
      }
      pushTransform(n);
      updateView(true);
      requestDelta(n);
    }
    if (e.phase === 'end') {
      handleDrag = null;
      if (drag.rotated && n.positionLocked) commitNode(n);
      else updateView(true);
    }
  };

  let historyBusy = false;
  const historyStep = (step: 'undo' | 'redo') => {
    if (status !== 'ready' || historyBusy || committing) return;
    // Une validation et ses copies par symétrie ne font qu'une étape.
    const groups = step === 'undo' ? undoGroups : redoGroups;
    const other = step === 'undo' ? redoGroups : undoGroups;
    const depth = step === 'undo' ? undoDepth : redoDepth;
    const count = Math.max(1, Math.min(groups.length ? groups[groups.length - 1] : 1, depth || 1));
    historyBusy = true;
    void busy((async () => {
      let touched: Uint32Array | undefined;
      let done = 0;
      for (let i = 0; i < count; i++) {
        const change = await (step === 'undo' ? editKernel.undo() : editKernel.redo());
        undoDepth = change.undoDepth;
        redoDepth = change.redoDepth;
        if (!change.ok) break;
        done++;
        // Couches inserées : rétablir les remet avant les valeurs, annuler les retire après.
        if (change.splice?.inserted) await applySplice(change.splice);
        const parsed = layer.getParsed();
        if (parsed) journalStep(parsed, step);
        applyChange(change.indices, change.values, change.trimmed, change.trimState);
        if (change.splice && !change.splice.inserted) await applySplice(change.splice);
        if (change.indices?.length) touched = change.indices;
      }
      if (done > 0) {
        groups.pop();
        other.push(done);
      }
      return touched;
    })()).then((touched) => {
      historyBusy = false;
      if (node) {
        node.original = originalOf(node.index);
        delta = null;
        requestWeights();
      }
      updateView(true);
      emit();
      void afterEdit(touched);
    }).catch(() => { historyBusy = false; });
  };

  // --- événements du panneau ----------------------------------------------------------------------

  const onPlace = (e: Event) => setPlacing(!!(e as CustomEvent<{ active: boolean }>).detail?.active);
  const onInfluence = (e: Event) => {
    const next = (e as CustomEvent<{ influence: EditInfluenceSettings }>).detail?.influence;
    if (!next) return;
    // Changement de mode : la portée repart de celle des poignées.
    const modeChanged = next.reachMode !== influence.reachMode;
    if (node && modeChanged) node.reach = { scale: 1, growing: false, saturated: false, affected: 0 };
    influence = structuredClone(next);
    // Poignées violettes à écartement fixe (Auto) ou de nouveau réglables (Portée).
    if (modeChanged) updateView(true);
    requestWeights();
    emit();
  };
  const onSetDelta = (e: Event) => {
    const d = (e as CustomEvent<{ values: Partial<Record<'r' | 'c' | 'z' | 'b', number>>; commit: boolean }>).detail;
    if (d) setNumericDelta(d.values ?? {}, !!d.commit);
  };
  const onLockMode = (e: Event) => {
    const d = (e as CustomEvent<{ mode: EditLockMode; radiusMm: number }>).detail;
    if (d) setLockMode(d.mode, d.radiusMm);
  };
  const onClearLocks = () => { void editKernel.clearLocks().then(refreshLocks).then(() => { if (node) requestWeights(); }); };
  const onCopy = () => copyDeformation();
  const onPaste = () => pasteDeformation();
  const onSymmetry = (e: Event) => {
    const next = (e as CustomEvent<{ symmetry: EditSymmetry }>).detail?.symmetry;
    if (!next) return;
    symmetry = { ...next };
    emit();
  };
  const onLimits = (e: Event) => {
    const next = (e as CustomEvent<{ limits: MachineLimits }>).detail?.limits;
    if (!next) return;
    limits = { ...next };
    saveMachineLimits(limits);
    void refreshFileValidation();
    emit();
  };
  const onLayerLimits = (e: Event) => {
    const next = (e as CustomEvent<{ layerLimits: Partial<LayerLimits> }>).detail?.layerLimits;
    if (!next) return;
    layerLimits = sanitizeLayerLimits(next);
    saveLayerLimits(layerLimits);
    emit();
    if (status !== 'ready') return;
    // Le noyau garde ses bornes jusqu'à nouvel ordre : les lui donner, puis refaire les poids du nœud actif.
    void editKernel.setLayerLimits(layerLimits.minMm, layerLimits.maxMm, layerLimits.widthFactor)
      .then(() => { if (node) requestWeights(); })
      .catch(() => undefined);
  };
  const onAnalyze = (e: Event) => { void analyzeFile(!!(e as CustomEvent<{ collisions: boolean }>).detail?.collisions); };
  const onUndo = () => historyStep('undo');
  const onRedo = () => historyStep('redo');
  const onRemoveNode = () => removeNode();
  const onRequestState = () => emit();
  const onTab = () => refresh();
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isActive() || status !== 'ready') return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); historyStep('undo'); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); historyStep('redo'); }
    else if (e.key === 'Escape') { if (placing) setPlacing(false); else deactivate(); }
  };

  window.addEventListener(EDIT_SET_DELTA_EVENT, onSetDelta);
  window.addEventListener(EDIT_LOCK_MODE_EVENT, onLockMode);
  window.addEventListener(EDIT_CLEAR_LOCKS_EVENT, onClearLocks);
  window.addEventListener(EDIT_COPY_EVENT, onCopy);
  window.addEventListener(EDIT_PASTE_EVENT, onPaste);
  window.addEventListener(EDIT_SYMMETRY_EVENT, onSymmetry);
  window.addEventListener(EDIT_LIMITS_EVENT, onLimits);
  window.addEventListener(EDIT_LAYER_LIMITS_EVENT, onLayerLimits);
  window.addEventListener(EDIT_ANALYZE_EVENT, onAnalyze);
  window.addEventListener(EDIT_PLACE_EVENT, onPlace);
  window.addEventListener(EDIT_INFLUENCE_EVENT, onInfluence);
  window.addEventListener(EDIT_UNDO_EVENT, onUndo);
  window.addEventListener(EDIT_REDO_EVENT, onRedo);
  window.addEventListener(EDIT_REMOVE_NODE_EVENT, onRemoveNode);
  window.addEventListener(EDIT_REQUEST_STATE_EVENT, onRequestState);
  window.addEventListener('apex-preview-tab-changed', onTab);
  window.addEventListener('keydown', onKeyDown);

  const refresh = () => {
    if (disposed) return;
    // Onglet Édition : trajectoires en gris neutre, les zones contraintes ressortent en violet.
    layer.setEditNeutral(isActive());
    const parsed = layer.getParsed();
    // Nouveau fichier : le noyau et les nœuds décrivaient l'ancien.
    if (parsed !== loadedParsed && nodes.size > 0) clearNodes();
    if (!isActive()) {
      // Hors de l'onglet : les nœuds restent posés (réduits) pour y revenir.
      if (placing) setPlacing(false);
      if (lockMode) setLockMode(null, lockRadiusMm);
      deactivate();
      updateView();
      return;
    }
    void ensureKernel();
    updateView(true);
  };

  return {
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      listener(lastView);
      return () => listeners.delete(listener);
    },
    onAfterRender(listener) {
      afterRenderListeners.add(listener);
      return () => afterRenderListeners.delete(listener);
    },
    activateNode(id) {
      const n = nodes.get(id);
      if (n) activate(n);
    },
    deactivateNode(id) {
      if (node?.id === id) deactivate();
    },
    onNodeMove,
    onNodeMoveEnd,
    togglePositionLock,
    toggleTrimming,
    onHandlesChange,
    onHandleDrag,
    debugProjectMove(k) {
      if (!layer.getParsed()) return null;
      const p = project(layer.getMoveTip(k, new BABYLON.Vector3()));
      return { x: p.x, y: p.y };
    },
    debugParsed: () => layer.getParsed(),
    debugKernel: () => editKernel,
    debugPlaceNode: (k) => placeNode(k),
    debugStatus: () => ({
      previewActive: opts.isPreviewActive(), tab: getPreviewTab(), status, message, nodes: nodes.size, placing, lockMode,
      parsed: !!layer.getParsed(), kernel: editKernel.available,
    }),
    debugLastDrag: () => lastDrag,
    async debugTryHandle(index) {
      const res = await editKernel.setHandle(index, { ...influence, keepShape: true });
      if (node) requestWeights();
      else await editKernel.cancel();
      return 'refused' in res ? `refus : ${res.refused}` : `accepté : ${res.affected.length} points`;
    },
    dispose() {
      disposed = true;
      layer.setEditNeutral(false);
      scene.onPointerObservable.remove(pointerObserver);
      scene.onAfterRenderObservable.remove(renderObserver);
      window.removeEventListener(EDIT_SET_DELTA_EVENT, onSetDelta);
      window.removeEventListener(EDIT_LOCK_MODE_EVENT, onLockMode);
      window.removeEventListener(EDIT_CLEAR_LOCKS_EVENT, onClearLocks);
      window.removeEventListener(EDIT_COPY_EVENT, onCopy);
      window.removeEventListener(EDIT_PASTE_EVENT, onPaste);
      window.removeEventListener(EDIT_SYMMETRY_EVENT, onSymmetry);
      window.removeEventListener(EDIT_LIMITS_EVENT, onLimits);
      window.removeEventListener(EDIT_LAYER_LIMITS_EVENT, onLayerLimits);
      window.removeEventListener(EDIT_ANALYZE_EVENT, onAnalyze);
      window.clearTimeout(headTimer);
      window.clearTimeout(validateTimer);
      window.removeEventListener(EDIT_PLACE_EVENT, onPlace);
      window.removeEventListener(EDIT_INFLUENCE_EVENT, onInfluence);
      window.removeEventListener(EDIT_UNDO_EVENT, onUndo);
      window.removeEventListener(EDIT_REDO_EVENT, onRedo);
      window.removeEventListener(EDIT_REMOVE_NODE_EVENT, onRemoveNode);
      window.removeEventListener(EDIT_REQUEST_STATE_EVENT, onRequestState);
      window.removeEventListener('apex-preview-tab-changed', onTab);
      window.removeEventListener('keydown', onKeyDown);
      listeners.clear();
      afterRenderListeners.clear();
    },
  };
}
