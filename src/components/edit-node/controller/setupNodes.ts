import * as BABYLON from 'babylonjs';
import { editKernel } from '@/utils/editKernelClient';
import { NodeState, CLICK_SLOP_PX } from './shared';
import type { EditCtx } from './context';

/** Nœuds : activation, pose, sélection et pointeur. */
export function setupNodes(ctx: EditCtx) {
  const { syncPicking, layer, clearPreviews, pushTransform, emit, originalOf, requestWeights, nodes, isActive, syncCursor, scene, camera, engine, lockAt } = ctx;


// --- nœud -----------------------------------------------------------------------------------

/** Réduit le nœud actif : il reste posé (poignées, verrouillage), le noyau le libère. */
const deactivate = () => {
  const n = ctx.node;
  if (!n) return;
  ctx.node = null;
  n.translation = BABYLON.Vector3.Zero();
  n.applied = BABYLON.Vector3.Zero();
  n.rotation.angle = 0;
  n.rotation.applied = 0;
  n.rotation.fraction = 1;
  ctx.dragSeq++;
  n.reach = { scale: 1, growing: false, saturated: false, affected: 0 };
  n.stackAxis = null;
  n.dragTip = null;
  ctx.handleDrag = null;
  syncPicking();
  ctx.affected = 0;
  ctx.delta = null;
  layer.setEditWeights(null);
  clearPreviews();
  pushTransform(null);
  if (ctx.status === 'ready') void editKernel.cancel().catch(() => undefined);
  ctx.updateView(true);
  emit();
};
  ctx.deactivate = deactivate;


const activate = (n: NodeState) => {
  if (ctx.node === n || ctx.status !== 'ready') return;
  deactivate();
  ctx.node = n;
  n.anchor = layer.getMoveTip(n.index, new BABYLON.Vector3());
  n.original = originalOf(n.index);
  ctx.delta = null;
  // Déverrouillé : le glisser le long de la trajectoire demande l'index de sélection.
  layer.setPickingEnabled(true);
  requestWeights();
  ctx.updateView(true);
  emit();
};
  ctx.activate = activate;


/** Supprime le nœud actif. */
const removeNode = () => {
  const n = ctx.node;
  if (!n) return;
  deactivate();
  nodes.delete(n.id);
  ctx.updateView(true);
};
  ctx.removeNode = removeNode;


/** Supprime tous les nœuds (autre fichier : ils décrivaient l'ancien). */
const clearNodes = () => {
  deactivate();
  nodes.clear();
  ctx.updateView(true);
};
  ctx.clearNodes = clearNodes;


const placeNode = (t: number) => {
  const parsed = layer.getParsed();
  if (!parsed) return;
  const index = Math.max(0, Math.min(parsed.moves.length - 1, Math.round(t)));
  const n: NodeState = {
    id: ++ctx.nodeSeq,
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
  ctx.placeNode = placeNode;


const setPlacing = (active: boolean) => {
  ctx.placing = active && ctx.status === 'ready' && isActive();
  if (ctx.placing && ctx.lockMode) { ctx.lockMode = null; }
  // L'index de sélection sert aussi au nœud posé (glissement le long de la trajectoire).
  syncPicking();
  if (!ctx.placing && !ctx.lockMode) layer.setPickHighlight(null);
  syncCursor();
  emit();
};
  ctx.setPlacing = setPlacing;


/** Point de trajectoire sous un point écran (px de rendu) ; par défaut, sous le pointeur Babylon. */
const pick = (renderX = scene.pointerX, renderY = scene.pointerY) => {
  const ray = scene.createPickingRay(renderX, renderY, BABYLON.Matrix.Identity(), camera);
  const fov = (camera as BABYLON.TargetCamera).fov ?? 0.8;
  const pxPerUnit = (2 * Math.tan(fov / 2)) / Math.max(1, engine.getRenderHeight());
  return layer.pickAt(ray, pxPerUnit);
};
  ctx.pick = pick;


let pointerDown: { x: number; y: number } | null = null;

const pointerObserver = scene.onPointerObservable.add((info) => {
  if ((!ctx.placing && !ctx.lockMode) || !isActive()) return;
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
    if (ctx.placing) placeNode(hit.t);
    else if (ctx.lockMode) void lockAt(Math.round(hit.t));
  }
});
  ctx.pointerObserver = pointerObserver;
}
