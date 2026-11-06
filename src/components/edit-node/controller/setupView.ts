import * as BABYLON from 'babylonjs';
import { EditNodeView, NodeState } from './shared';
import type { EditCtx } from './context';

/** Vue à chaque image : projection des nœuds et occultation par la pièce. */
export function setupView(ctx: EditCtx) {
  const { nodeLocal, project, isActive, nodes, publishView, cssScale, pick, scene } = ctx;


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
    id: n.id, visible: screen.z > 0 && screen.z < 1, active: n === ctx.node, x: screen.x, y: screen.y,
    handleOffsets, busy: n === ctx.node && ctx.busyCount > 0, positionLocked: n.positionLocked,
    trimming: n.trimming, occluded: n.occluded, fixedHandles: ctx.influence.reachMode === 'auto',
  };
};


const updateView = (force = false) => {
  const next = isActive() ? [...nodes.values()].map(viewOf) : [];
  const prev = ctx.lastView.nodes;
  if (force || next.length !== prev.length || next.some((v, i) => !sameNodeView(v, prev[i]))) {
    publishView({ nodes: next });
  }
};
  ctx.updateView = updateView;


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
  ctx.afterRenderListeners = afterRenderListeners;

const renderObserver = scene.onAfterRenderObservable.add(() => {
  updateOcclusion();
  updateView();
  for (const l of afterRenderListeners) l();
});
  ctx.renderObserver = renderObserver;
}
