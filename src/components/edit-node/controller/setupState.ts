import { EditInfluenceSettings, DEFAULT_EDIT_INFLUENCE, EditStatus, EditDelta, EditThickness, EditValidationSummary, EditLockMode, DEFAULT_LOCK_RADIUS_MM, EditSymmetry, DEFAULT_EDIT_SYMMETRY, EditStateDetail, EDIT_STATE_EVENT } from '../editProtocol';
import { MachineLimits, loadMachineLimits } from '@/utils/machineLimits';
import { LayerLimits, loadLayerLimits } from '@/utils/layerLimits';
import * as BABYLON from 'babylonjs';
import { nozzleTip } from '../../gcodeParse';
import { NodeState, DeformationClipboard, EditOverlayView } from './shared';
import type { EditCtx } from './context';

/** État publié du contrôleur, vue vers l'interface, projections écran ↔ plateau. */
export function setupState(ctx: EditCtx) {
  const { opts } = ctx;

const { scene, engine, camera, canvas, layer } = opts;
  ctx.scene = scene;
  ctx.engine = engine;
  ctx.camera = camera;
  ctx.canvas = canvas;
  ctx.layer = layer;


ctx.influence = structuredClone(DEFAULT_EDIT_INFLUENCE);

ctx.status = 'inactive';

ctx.message = null;

ctx.loadedParsed = null;

ctx.loadSeq = 0;

ctx.placing = false;

/** Tous les nœuds posés ; `node` est l'actif (ou aucun). */
const nodes = new Map<number, NodeState>();
  ctx.nodes = nodes;

ctx.node = null;

ctx.nodeSeq = 0;

ctx.undoDepth = 0;

ctx.redoDepth = 0;

// Re-tranchage : couches à insérer dans l'aperçu en cours (cf. updatePreview).
// Une validation (noyau, puis G-code, calque, symétrie) est en cours : annuler / rétablir attendent sa fin.
ctx.committing = false;

ctx.reslicePoints = 0;

ctx.resliceMaxCount = 0;

ctx.affected = 0;

ctx.delta = null;

ctx.busyCount = 0;

ctx.disposed = false;

// Aperçu pendant le glissement et validation physique (cf. « Physical validity » de CLAUDE.md).
ctx.thickness = null;

ctx.trimmedCount = 0;

ctx.validation = null;

ctx.limits = loadMachineLimits();

ctx.layerLimits = loadLayerLimits();

ctx.capacityMm = null;

ctx.requestedAxialMm = null;

ctx.headModel = false;

ctx.locksCount = 0;

ctx.lockMode = null;

ctx.lockRadiusMm = DEFAULT_LOCK_RADIUS_MM;

ctx.symmetry = { ...DEFAULT_EDIT_SYMMETRY };

ctx.clipboard = null;

// Annuler / rétablir par groupes : une validation et ses copies par symétrie ne font qu'une étape.
ctx.undoGroups = [];

ctx.redoGroups = [];


// --- état publié ------------------------------------------------------------------------------

const emit = () => {
  if (ctx.disposed) return;
  const detail: EditStateDetail = {
    status: ctx.status, message: ctx.message, placing: ctx.placing, hasNode: !!ctx.node, busy: ctx.busyCount > 0,
    undoDepth: ctx.undoDepth, redoDepth: ctx.redoDepth, affected: ctx.affected, delta: ctx.delta, influence: ctx.influence,
    nodeTrimming: ctx.node ? ctx.node.trimming : null,
    trimmed: ctx.trimmedCount, reslicePoints: ctx.reslicePoints, resliceMaxCount: ctx.resliceMaxCount, thickness: ctx.thickness, validation: ctx.validation,
    locks: ctx.locksCount, lockMode: ctx.lockMode, lockRadiusMm: ctx.lockRadiusMm,
    canPaste: !!ctx.clipboard, symmetry: ctx.symmetry, limits: ctx.limits, layerLimits: ctx.layerLimits, capacityMm: ctx.capacityMm, requestedAxialMm: ctx.requestedAxialMm, headModel: ctx.headModel,
  };
  window.dispatchEvent(new CustomEvent(EDIT_STATE_EVENT, { detail }));
};
  ctx.emit = emit;


const listeners = new Set<(view: EditOverlayView) => void>();
  ctx.listeners = listeners;

ctx.lastView = { nodes: [] };

const publishView = (view: EditOverlayView) => {
  ctx.lastView = view;
  for (const l of listeners) l(view);
};
  ctx.publishView = publishView;


// Opérations longues (chargement, validation, annulation) : les reflets du nœud tournent. Le
// recalcul des poids, fréquent et court, ne les déclenche pas.
const busy = async <T>(work: Promise<T>, shown = true): Promise<T> => {
  if (!shown) return work;
  ctx.busyCount++;
  emit();
  ctx.updateView(true);
  try {
    return await work;
  } finally {
    ctx.busyCount--;
    emit();
    ctx.updateView(true);
  }
};
  ctx.busy = busy;


// --- projections écran ↔ plateau ----------------------------------------------------------------

const viewport = () => camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());

const cssScale = () => canvas.clientWidth / Math.max(1, engine.getRenderWidth());
  ctx.cssScale = cssScale;

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
  ctx.project = project;


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
  ctx.unproject = unproject;


const nodeLocal = (n: NodeState) => n.dragTip ?? n.anchor.add(n.applied);
  ctx.nodeLocal = nodeLocal;

const tipScratch = { r: 0, z: 0 };

/** Pointe (local) de valeurs firmware R, C, Z, B — même formule que le rendu et le noyau. */
const tipOfFirmware = (v: ArrayLike<number>) => {
  nozzleTip(v[0], v[2], (v[3] * Math.PI) / 180, tipScratch);
  const c = (v[1] * Math.PI) / 180;
  return new BABYLON.Vector3(tipScratch.r * Math.cos(c), tipScratch.z, tipScratch.r * Math.sin(c));
};
  ctx.tipOfFirmware = tipOfFirmware;
}
