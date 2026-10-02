import * as BABYLON from 'babylonjs';
import type { GCodeLayer } from '../gcodeLayer';
import { NOZZLE_PIVOT_MM } from '../gcodeParse';
import { getPreviewTab } from '../PreviewUpperTabs';
import { editKernel, type EditInfluence, type EditTransform } from '@/utils/editKernelClient';
import type { EditNodeHandle } from './EditNode';
import {
  DEFAULT_EDIT_INFLUENCE,
  EDIT_INFLUENCE_EVENT,
  EDIT_PLACE_EVENT,
  EDIT_REDO_EVENT,
  EDIT_REMOVE_NODE_EVENT,
  EDIT_REQUEST_STATE_EVENT,
  EDIT_STATE_EVENT,
  EDIT_UNDO_EVENT,
  type EditDelta,
  type EditInfluenceSettings,
  type EditStateDetail,
  type EditStatus,
} from './editProtocol';

/**
 * Édition du G-code par nœud (onglet Édition de Prévisualisation, cf. CLAUDE.md « G-code
 * editing ») : relie la vue 3D, le nœud dessiné par-dessus (GCodeEditOverlay) et le noyau C++.
 *
 *  - Clic sur la trajectoire (mode « placer ») : le nœud s'accroche au point de dépôt le plus
 *    proche ; le noyau calcule les poids d'influence, copiés en attribut des cordons.
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

/** Ce que l'overlay dessine (px CSS relatifs au canevas 3D). */
export interface EditNodeView {
  visible: boolean;
  nodeId: number;
  x: number;
  y: number;
  handleOffsets: Record<number, { dx: number; dy: number }>;
  busy: boolean;
}

export interface GCodeEditController {
  /** À rappeler quand l'onglet, l'espace ou le fichier changent. */
  refresh(): void;
  subscribe(listener: (view: EditNodeView) => void): () => void;
  /** Appelé après chaque rendu de la scène (rendu du verre, synchronisé sur l'image). */
  onAfterRender(listener: () => void): () => void;
  onNodeMove(x: number, y: number): void;
  onNodeMoveEnd(): void;
  onHandlesChange(handles: EditNodeHandle[]): void;
  /** Essais automatisés (développement) : position écran (px CSS du canevas) du mouvement k. */
  debugProjectMove(k: number): { x: number; y: number } | null;
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
  /** Translation en cours (local). */
  translation: BABYLON.Vector3;
  original: EditDelta;
}

const CLICK_SLOP_PX = 5;
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
  let node: NodeState | null = null;
  let nodeSeq = 0;
  const handles = new Map<number, HandleState>();
  let undoDepth = 0;
  let redoDepth = 0;
  let affected = 0;
  let delta: EditDelta | null = null;
  let busyCount = 0;
  let disposed = false;

  // --- état publié ------------------------------------------------------------------------------

  const emit = () => {
    if (disposed) return;
    const detail: EditStateDetail = {
      status, message, placing, hasNode: !!node, busy: busyCount > 0,
      undoDepth, redoDepth, affected, delta, influence,
    };
    window.dispatchEvent(new CustomEvent(EDIT_STATE_EVENT, { detail }));
  };

  const listeners = new Set<(view: EditNodeView) => void>();
  let lastView: EditNodeView = { visible: false, nodeId: 0, x: 0, y: 0, handleOffsets: {}, busy: false };
  const publishView = (view: EditNodeView) => {
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

  const nodeLocal = (n: NodeState) => n.anchor.add(n.translation);

  // --- noyau --------------------------------------------------------------------------------------

  const isActive = () => opts.isPreviewActive() && getPreviewTab() === 'edition';

  const ensureKernel = async () => {
    const parsed = layer.getParsed();
    if (!parsed || parsed.moves.length < 2) {
      status = 'inactive';
      message = 'Aucun G-code affiché.';
      return emit();
    }
    if (parsed.kind !== 'polar') {
      status = 'unsupported';
      message = "L'édition par nœuds concerne les G-code polaires de l'Apex.";
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
      await busy(editKernel.load({ r, c, z, b, extruding }, { pivotMm: NOZZLE_PIVOT_MM }));
      if (seq !== loadSeq) return;
      loadedParsed = parsed;
      status = 'ready';
      undoDepth = 0;
      redoDepth = 0;
    } catch (error) {
      if (seq !== loadSeq) return;
      status = 'error';
      message = error instanceof Error ? error.message : String(error);
    }
    emit();
  };

  const toKernel = (v: BABYLON.Vector3) => [v.x, v.z, v.y] as const;

  const transformOf = (t: BABYLON.Vector3): EditTransform => ({
    translation: Float64Array.from(toKernel(t)),
    axis: Float64Array.of(0, 0, 1),
    angleRad: 0,
  });

  const buildInfluence = (n: NodeState): EditInfluence => {
    const dirs: number[] = [];
    const anchors: number[] = [];
    for (const h of handles.values()) {
      const v = h.lockPoint ? h.lockPoint.subtract(n.anchor) : h.v;
      const reach = v.length();
      if (!(reach > 1e-6)) continue;
      const [x, y, z] = toKernel(v.scale(1 / reach));
      dirs.push(x, y, z, reach);
      if (h.lockPoint) {
        const [ax, ay, az] = toKernel(h.lockPoint);
        anchors.push(ax, ay, az, Math.max(ANCHOR_MIN_RADIUS_MM, ANCHOR_RADIUS_FRACTION * reach));
      }
    }
    return { ...influence, directions: Float64Array.from(dirs), anchors: Float64Array.from(anchors) };
  };

  // Poids : une requête en vol, la plus récente remplace celle qui attendait.
  let weightsBusy = false;
  let weightsDirty = false;
  const requestWeights = () => {
    weightsDirty = true;
    void pumpWeights();
  };
  const pumpWeights = async () => {
    if (weightsBusy || !weightsDirty) return;
    const n = node;
    if (!n || status !== 'ready') { weightsDirty = false; return; }
    weightsBusy = true;
    weightsDirty = false;
    try {
      const res = await busy(editKernel.setHandle(n.index, buildInfluence(n)), false);
      if (node === n) {
        if (res) {
          layer.setEditWeights(res.affected, res.weights);
          affected = res.affected.length;
          message = null;
        } else {
          layer.setEditWeights(null);
          affected = 0;
          message = 'Ce point est verrouillé.';
        }
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    weightsBusy = false;
    emit();
    void pumpWeights();
  };

  const originalOf = (index: number): EditDelta => {
    const m = layer.getParsed()!.moves[index];
    return { r: m.x, c: m.y, z: m.z, b: m.b };
  };

  // --- nœud -----------------------------------------------------------------------------------

  const removeNode = () => {
    if (!node) return;
    node = null;
    handles.clear();
    affected = 0;
    delta = null;
    layer.setEditWeights(null);
    layer.setEditTranslation(BABYLON.Vector3.Zero());
    if (status === 'ready') void editKernel.cancel().catch(() => undefined);
    publishView({ ...lastView, visible: false });
    emit();
  };

  const placeNode = (t: number) => {
    const parsed = layer.getParsed();
    if (!parsed) return;
    removeNode();
    const index = Math.max(0, Math.min(parsed.moves.length - 1, Math.round(t)));
    node = {
      id: ++nodeSeq,
      index,
      anchor: layer.getMoveTip(index, new BABYLON.Vector3()),
      translation: BABYLON.Vector3.Zero(),
      original: originalOf(index),
    };
    // Les poignées par défaut arrivent du nœud dès son affichage (onHandlesChange).
    requestWeights();
    setPlacing(false);
    updateView(true);
    emit();
  };

  const setPlacing = (active: boolean) => {
    placing = active && status === 'ready' && isActive();
    layer.setPickingEnabled(placing);
    if (!placing) layer.setPickHighlight(null);
    canvas.style.cursor = placing ? 'crosshair' : '';
    emit();
  };

  const pick = () => {
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
    const fov = (camera as BABYLON.TargetCamera).fov ?? 0.8;
    const pxPerUnit = (2 * Math.tan(fov / 2)) / Math.max(1, engine.getRenderHeight());
    return layer.pickAt(ray, pxPerUnit);
  };

  let pointerDown: { x: number; y: number } | null = null;
  const pointerObserver = scene.onPointerObservable.add((info) => {
    if (!placing || !isActive()) return;
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
      if (hit) placeNode(hit.t);
    }
  });

  // --- vue (projection à chaque image) ------------------------------------------------------------

  const updateView = (force = false) => {
    const n = node;
    if (!n || !isActive()) {
      if (lastView.visible) publishView({ ...lastView, visible: false });
      return;
    }
    const center = nodeLocal(n);
    const screen = project(center);
    const handleOffsets: EditNodeView['handleOffsets'] = {};
    for (const [id, h] of handles) {
      const end = h.lockPoint ?? center.add(h.v);
      const p = project(end);
      handleOffsets[id] = { dx: p.x - screen.x, dy: p.y - screen.y };
    }
    const visible = screen.z > 0 && screen.z < 1;
    const prev = lastView;
    const moved =
      force || prev.visible !== visible || prev.nodeId !== n.id || prev.busy !== busyCount > 0 ||
      Math.abs(prev.x - screen.x) > 0.05 || Math.abs(prev.y - screen.y) > 0.05 ||
      Object.keys(handleOffsets).length !== Object.keys(prev.handleOffsets).length ||
      Object.entries(handleOffsets).some(([id, o]) => {
        const q = prev.handleOffsets[Number(id)];
        return !q || Math.abs(q.dx - o.dx) > 0.05 || Math.abs(q.dy - o.dy) > 0.05;
      });
    if (moved) publishView({ visible, nodeId: n.id, x: screen.x, y: screen.y, handleOffsets, busy: busyCount > 0 });
  };

  const afterRenderListeners = new Set<() => void>();
  const renderObserver = scene.onAfterRenderObservable.add(() => {
    updateView();
    for (const l of afterRenderListeners) l();
  });

  // --- glissement et validation -------------------------------------------------------------------

  let dragSeq = 0;
  const onNodeMove = (x: number, y: number) => {
    const n = node;
    if (!n || status !== 'ready') return;
    const depth = project(n.anchor).z;
    n.translation = unproject(x, y, depth).subtract(n.anchor);
    layer.setEditTranslation(n.translation);
    updateView();
    const seq = ++dragSeq;
    void editKernel.drag(transformOf(n.translation)).then((res) => {
      if (!res || node !== n || seq !== dragSeq) return;
      delta = {
        r: res.handle[0] - n.original.r,
        c: res.handle[1] - n.original.c,
        z: res.handle[2] - n.original.z,
        b: res.handle[3] - n.original.b,
      };
      emit();
    }).catch(() => undefined);
  };

  const applyChange = (indices?: Uint32Array, values?: Float64Array) => {
    // Même image : géométrie validée, translation et poids remis à zéro (pas de saut visible).
    layer.setEditTranslation(BABYLON.Vector3.Zero());
    layer.setEditWeights(null);
    if (indices && values) layer.applyMoveEdits(indices, values);
    if (node) {
      node.anchor = layer.getMoveTip(node.index, new BABYLON.Vector3());
      node.translation = BABYLON.Vector3.Zero();
    }
  };

  const onNodeMoveEnd = () => {
    const n = node;
    if (!n || status !== 'ready') return;
    dragSeq++;
    const t = n.translation.clone();
    void busy(editKernel.commit(transformOf(t))).then((change) => {
      if (node !== n) return;
      undoDepth = change.undoDepth;
      redoDepth = change.redoDepth;
      applyChange(change.ok ? change.indices : undefined, change.ok ? change.values : undefined);
      n.original = originalOf(n.index);
      requestWeights();
      updateView(true);
      emit();
    }).catch((error) => {
      message = error instanceof Error ? error.message : String(error);
      emit();
    });
  };

  const onHandlesChange = (list: EditNodeHandle[]) => {
    const n = node;
    if (!n) return;
    const center = nodeLocal(n);
    const screen = project(center);
    const seen = new Set<number>();
    for (const h of list) {
      seen.add(h.id);
      const end = unproject(screen.x + h.dx, screen.y + h.dy, screen.z);
      handles.set(h.id, { v: end.subtract(center), lockPoint: h.locked ? end : null });
    }
    for (const id of [...handles.keys()]) if (!seen.has(id)) handles.delete(id);
    requestWeights();
  };

  const historyStep = (step: 'undo' | 'redo') => {
    if (status !== 'ready') return;
    void busy(step === 'undo' ? editKernel.undo() : editKernel.redo()).then((change) => {
      undoDepth = change.undoDepth;
      redoDepth = change.redoDepth;
      if (change.ok) {
        applyChange(change.indices, change.values);
        if (node) {
          node.original = originalOf(node.index);
          delta = null;
          requestWeights();
        }
      }
      updateView(true);
      emit();
    }).catch(() => undefined);
  };

  // --- événements du panneau ----------------------------------------------------------------------

  const onPlace = (e: Event) => setPlacing(!!(e as CustomEvent<{ active: boolean }>).detail?.active);
  const onInfluence = (e: Event) => {
    const next = (e as CustomEvent<{ influence: EditInfluenceSettings }>).detail?.influence;
    if (!next) return;
    influence = structuredClone(next);
    requestWeights();
    emit();
  };
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
    else if (e.key === 'Escape') { if (placing) setPlacing(false); else removeNode(); }
  };

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
    const parsed = layer.getParsed();
    // Nouveau fichier : le noyau et le nœud décrivaient l'ancien.
    if (parsed !== loadedParsed && node) removeNode();
    if (!isActive()) {
      if (placing) setPlacing(false);
      if (node) removeNode();
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
    onNodeMove,
    onNodeMoveEnd,
    onHandlesChange,
    debugProjectMove(k) {
      if (!layer.getParsed()) return null;
      const p = project(layer.getMoveTip(k, new BABYLON.Vector3()));
      return { x: p.x, y: p.y };
    },
    dispose() {
      disposed = true;
      scene.onPointerObservable.remove(pointerObserver);
      scene.onAfterRenderObservable.remove(renderObserver);
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
