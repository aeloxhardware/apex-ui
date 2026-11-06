import * as BABYLON from 'babylonjs';
import { editKernel } from '@/utils/editKernelClient';
import { NodeState, REACH_GROWTH_MAX, REACH_GROWTH_MIN } from './shared';
import type { EditCtx } from './context';

/** Glissement d'un nœud : demande de déplacement au noyau et mise à jour du calque. */
export function setupDrag(ctx: EditCtx) {
  const { cssScale, pick, layer, originalOf, requestWeights, updateView, emit, nodes, project, unproject, transformOf, fromKernel, tipOfFirmware, pushTransform, updatePreview, scheduleLiveValidation, clearPreviews, refreshFileValidation, validateZone } = ctx;


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
  ctx.delta = null;
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
  ctx.togglePositionLock = togglePositionLock;


ctx.dragSeq = 0;

ctx.lastDrag = null;

const onNodeMove = (id: number, x: number, y: number) => {
  const n = ctx.node;
  // Un nœud réduit ne se déplace pas : un clic le reprend d'abord.
  if (!n || n.id !== id || ctx.status !== 'ready') return;
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
  ctx.onNodeMove = onNodeMove;


/** Valeurs firmware exactes du point du nœud pour la déformation en cours (champs Δ). */
const requestDelta = (n: NodeState): Promise<void> => {
  const seq = ++ctx.dragSeq;
  // Hauteurs demandées : E dépend de l'épaisseur (D3, recalcul dynamique) et l'aperçu de la nouvelle
  // hauteur de dépôt en vient ; trajets à vide : déformés aussi pendant le glissement.
  ctx.requestedAxialMm = n.stackAxis ? Math.abs(BABYLON.Vector3.Dot(n.translation, n.stackAxis)) : null;
  return editKernel.drag(transformOf(n), { heights: true, travel: true }).then((res) => {
    if (!res || ctx.node !== n || seq !== ctx.dragSeq) return;
    ctx.lastDrag = res;
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
    if (ctx.influence.reachMode === 'auto' && res.limitScale !== null && res.limitScale < 1 &&
      !n.reach.growing && !n.reach.saturated) {
      const growth = Math.min(REACH_GROWTH_MAX, Math.max(REACH_GROWTH_MIN, 1 / Math.max(res.limitScale, 1e-6)));
      n.reach.scale *= growth;
      n.reach.growing = true;
      requestWeights();
    }
    pushTransform(n);
    updateView();
    const e0 = n.original.eRatio;
    ctx.delta = {
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
  ctx.requestDelta = requestDelta;


const applyChange = (indices?: Uint32Array, values?: Float64Array, trimmed?: Uint32Array, trimState?: boolean) => {
  // Même image : géométrie validée, déformation et poids remis à zéro (pas de saut visible).
  if (ctx.node) {
    ctx.node.translation = BABYLON.Vector3.Zero();
    ctx.node.applied = BABYLON.Vector3.Zero();
    ctx.node.dragTip = null;
    ctx.node.rotation.angle = 0;
    ctx.node.rotation.applied = 0;
    ctx.node.rotation.fraction = 1;
  }
  pushTransform(null);
  layer.setEditWeights(null);
  ctx.requestedAxialMm = null;
  // Trajets à vide d'abord (ils reprennent la géométrie validée), puis les valeurs validées.
  clearPreviews();
  if (indices && values) layer.applyMoveEdits(indices, values, trimmed, trimState);
  // Tous les nœuds, réduits compris, restent sur leur point de trajectoire.
  for (const m of nodes.values()) m.anchor = layer.getMoveTip(m.index, new BABYLON.Vector3());
};
  ctx.applyChange = applyChange;


/** Après une modification validée : limites de B du fichier, collisions et normales de la zone. */
const afterEdit = async (indices?: Uint32Array) => {
  await refreshFileValidation();
  await validateZone(indices);
};
  ctx.afterEdit = afterEdit;


const onNodeMoveEnd = (id: number) => {
  const n = ctx.node;
  if (n && n.id === id && n.positionLocked) ctx.commitNode(n);
};
  ctx.onNodeMoveEnd = onNodeMoveEnd;
}
