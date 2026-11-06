// Issu de la découpe de createGCodeEditController (gcodeEditController.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (controllerState.ts).
import * as BABYLON from 'babylonjs';
import { editKernel } from '@/utils/editKernelClient';
import { CLICK_SLOP_PX, type EditNodeView, type NodeState } from './controllerShared';
import type { EditControllerState } from './controllerState';

function setupDeactivate(st: EditControllerState) {
  const { clearPreviews, emit, layer, nodes, originalOf, pushTransform, requestWeights, syncPicking } = st;
  // --- nœud -----------------------------------------------------------------------------------

  /** Réduit le nœud actif : il reste posé (poignées, verrouillage), le noyau le libère. */
  const deactivate = () => {
    const n = st.node;
    if (!n) return;
    st.node = null;
    n.translation = BABYLON.Vector3.Zero();
    n.applied = BABYLON.Vector3.Zero();
    n.rotation.angle = 0;
    n.rotation.applied = 0;
    n.rotation.fraction = 1;
    st.dragSeq++;
    n.reach = { scale: 1, growing: false, saturated: false, affected: 0 };
    n.stackAxis = null;
    n.dragTip = null;
    st.handleDrag = null;
    syncPicking();
    st.affected = 0;
    st.delta = null;
    layer.setEditWeights(null);
    clearPreviews();
    pushTransform(null);
    if (st.status === 'ready') void editKernel.cancel().catch((): void => undefined);
    st.updateView(true);
    emit();
  };

  const activate = (n: NodeState) => {
    if (st.node === n || st.status !== 'ready') return;
    deactivate();
    st.node = n;
    n.anchor = layer.getMoveTip(n.index, new BABYLON.Vector3());
    n.original = originalOf(n.index);
    st.delta = null;
    // Déverrouillé : le glisser le long de la trajectoire demande l'index de sélection.
    layer.setPickingEnabled(true);
    requestWeights();
    st.updateView(true);
    emit();
  };

  /** Supprime le nœud actif. */
  const removeNode = () => {
    const n = st.node;
    if (!n) return;
    deactivate();
    nodes.delete(n.id);
    st.updateView(true);
  };
  Object.assign(st, { deactivate, activate, removeNode });
}

function setupClearNodes(st: EditControllerState) {
  const { activate, deactivate, emit, isActive, layer, nodes, originalOf, syncCursor, syncPicking } = st;
  /** Supprime tous les nœuds (autre fichier : ils décrivaient l'ancien). */
  const clearNodes = () => {
    deactivate();
    nodes.clear();
    st.updateView(true);
  };

  const placeNode = (t: number) => {
    const parsed = layer.getParsed();
    if (!parsed) return;
    const index = Math.max(0, Math.min(parsed.moves.length - 1, Math.round(t)));
    const n: NodeState = {
      id: ++st.nodeSeq,
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
    st.placing = active && st.status === 'ready' && isActive();
    if (st.placing && st.lockMode) { st.lockMode = null; }
    // L'index de sélection sert aussi au nœud posé (glissement le long de la trajectoire).
    syncPicking();
    if (!st.placing && !st.lockMode) layer.setPickHighlight(null);
    syncCursor();
    emit();
  };
    st.setPlacing = setPlacing;
  Object.assign(st, { clearNodes, placeNode });
}

function setupPick(st: EditControllerState) {
  const { camera, engine, isActive, layer, lockAt, placeNode, scene } = st;
  /** Point de trajectoire sous un point écran (px de rendu) ; par défaut, sous le pointeur Babylon. */
  const pick = (renderX = scene.pointerX, renderY = scene.pointerY) => {
    const ray = scene.createPickingRay(renderX, renderY, BABYLON.Matrix.Identity(), camera);
    const fov = (camera as BABYLON.TargetCamera).fov ?? 0.8;
    const pxPerUnit = (2 * Math.tan(fov / 2)) / Math.max(1, engine.getRenderHeight());
    return layer.pickAt(ray, pxPerUnit);
  };

  let pointerDown: { x: number; y: number } | null = null;
  const pointerObserver = scene.onPointerObservable.add((info) => {
    if ((!st.placing && !st.lockMode) || !isActive()) return;
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
      if (st.placing) placeNode(hit.t);
      else if (st.lockMode) void lockAt(Math.round(hit.t));
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
  Object.assign(st, { pick, pointerObserver, sameNodeView });
}

function setupViewOf(st: EditControllerState) {
  const { cssScale, isActive, nodeLocal, nodes, pick, project, publishView, sameNodeView } = st;
  const viewOf = (n: NodeState): EditNodeView => {
    const center = nodeLocal(n);
    const screen = project(center);
    const handleOffsets: EditNodeView['handleOffsets'] = {};
    for (const [id, h] of n.handles) {
      const p = project(h.lockPoint ?? center.add(h.v));
      handleOffsets[id] = { dx: p.x - screen.x, dy: p.y - screen.y };
    }
    return {
      id: n.id, visible: screen.z > 0 && screen.z < 1, active: n === st.node, x: screen.x, y: screen.y,
      handleOffsets, busy: n === st.node && st.busyCount > 0, positionLocked: n.positionLocked,
      trimming: n.trimming, occluded: n.occluded, fixedHandles: st.influence.reachMode === 'auto',
    };
  };

  const updateView = (force = false) => {
    const next = isActive() ? [...nodes.values()].map(viewOf) : [];
    const prev = st.lastView.nodes;
    if (force || next.length !== prev.length || next.some((v, i) => !sameNodeView(v, prev[i]))) {
      publishView({ nodes: next });
    }
  };
    st.updateView = updateView;

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
  Object.assign(st, { updateOcclusion });
}

function setupAfterRenderListeners(st: EditControllerState) {
  const { scene, updateOcclusion, updateView } = st;
  const afterRenderListeners = new Set<() => void>();
  const renderObserver = scene.onAfterRenderObservable.add(() => {
    updateOcclusion();
    updateView();
    for (const l of afterRenderListeners) l();
  });
  Object.assign(st, { afterRenderListeners, renderObserver });
}

export function setupEditControllerNodes(st: EditControllerState) {
  setupDeactivate(st);
  setupClearNodes(st);
  setupPick(st);
  setupViewOf(st);
  setupAfterRenderListeners(st);
}
