import { EditInfluenceSettings, EditLockMode, EditSymmetry, EDIT_SET_DELTA_EVENT, EDIT_LOCK_MODE_EVENT, EDIT_CLEAR_LOCKS_EVENT, EDIT_COPY_EVENT, EDIT_PASTE_EVENT, EDIT_SYMMETRY_EVENT, EDIT_LIMITS_EVENT, EDIT_LAYER_LIMITS_EVENT, EDIT_ANALYZE_EVENT, EDIT_PLACE_EVENT, EDIT_INFLUENCE_EVENT, EDIT_UNDO_EVENT, EDIT_REDO_EVENT, EDIT_REMOVE_NODE_EVENT, EDIT_REQUEST_STATE_EVENT } from '../editProtocol';
import { editKernel } from '@/utils/editKernelClient';
import { MachineLimits, saveMachineLimits } from '@/utils/machineLimits';
import { LayerLimits, sanitizeLayerLimits, saveLayerLimits } from '@/utils/layerLimits';
import * as BABYLON from 'babylonjs';
import { getPreviewTab } from '../../PreviewUpperTabs';
import type { EditCtx } from './context';
import type { GCodeEditController } from './shared';

/** Événements du panneau et interface publique du contrôleur. */
export function setupEvents(ctx: EditCtx): GCodeEditController {
  const { setPlacing, updateView, requestWeights, emit, setNumericDelta, setLockMode, refreshLocks, copyDeformation, pasteDeformation, refreshFileValidation, analyzeFile, historyStep, removeNode, isActive, deactivate, layer, nodes, clearNodes, ensureKernel, listeners, afterRenderListeners, activate, onNodeMove, onNodeMoveEnd, togglePositionLock, toggleTrimming, onHandlesChange, onHandleDrag, project, placeNode, scene, pointerObserver, renderObserver, opts } = ctx;


// --- événements du panneau ----------------------------------------------------------------------

const onPlace = (e: Event) => setPlacing(!!(e as CustomEvent<{ active: boolean }>).detail?.active);

const onInfluence = (e: Event) => {
  const next = (e as CustomEvent<{ influence: EditInfluenceSettings }>).detail?.influence;
  if (!next) return;
  // Changement de mode : la portée repart de celle des poignées.
  const modeChanged = next.reachMode !== ctx.influence.reachMode;
  if (ctx.node && modeChanged) ctx.node.reach = { scale: 1, growing: false, saturated: false, affected: 0 };
  ctx.influence = structuredClone(next);
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

const onClearLocks = () => { void editKernel.clearLocks().then(refreshLocks).then(() => { if (ctx.node) requestWeights(); }); };

const onCopy = () => copyDeformation();

const onPaste = () => pasteDeformation();

const onSymmetry = (e: Event) => {
  const next = (e as CustomEvent<{ symmetry: EditSymmetry }>).detail?.symmetry;
  if (!next) return;
  ctx.symmetry = { ...next };
  emit();
};

const onLimits = (e: Event) => {
  const next = (e as CustomEvent<{ limits: MachineLimits }>).detail?.limits;
  if (!next) return;
  ctx.limits = { ...next };
  saveMachineLimits(ctx.limits);
  void refreshFileValidation();
  emit();
};

const onLayerLimits = (e: Event) => {
  const next = (e as CustomEvent<{ layerLimits: Partial<LayerLimits> }>).detail?.layerLimits;
  if (!next) return;
  ctx.layerLimits = sanitizeLayerLimits(next);
  saveLayerLimits(ctx.layerLimits);
  emit();
  if (ctx.status !== 'ready') return;
  // Le noyau garde ses bornes jusqu'à nouvel ordre : les lui donner, puis refaire les poids du nœud actif.
  void editKernel.setLayerLimits(ctx.layerLimits.minMm, ctx.layerLimits.maxMm, ctx.layerLimits.widthFactor)
    .then(() => { if (ctx.node) requestWeights(); })
    .catch(() => undefined);
};

const onAnalyze = (e: Event) => { void analyzeFile(!!(e as CustomEvent<{ collisions: boolean }>).detail?.collisions); };

const onUndo = () => historyStep('undo');

const onRedo = () => historyStep('redo');

const onRemoveNode = () => removeNode();

const onRequestState = () => emit();

const onTab = () => refresh();

const onKeyDown = (e: KeyboardEvent) => {
  if (!isActive() || ctx.status !== 'ready') return;
  const target = e.target as HTMLElement | null;
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); historyStep('undo'); }
  else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); historyStep('redo'); }
  else if (e.key === 'Escape') { if (ctx.placing) setPlacing(false); else deactivate(); }
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
  if (ctx.disposed) return;
  // Onglet Édition : trajectoires en gris neutre, les zones contraintes ressortent en violet.
  layer.setEditNeutral(isActive());
  const parsed = layer.getParsed();
  // Nouveau fichier : le noyau et les nœuds décrivaient l'ancien.
  if (parsed !== ctx.loadedParsed && nodes.size > 0) clearNodes();
  if (!isActive()) {
    // Hors de l'onglet : les nœuds restent posés (réduits) pour y revenir.
    if (ctx.placing) setPlacing(false);
    if (ctx.lockMode) setLockMode(null, ctx.lockRadiusMm);
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
    listener(ctx.lastView);
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
    if (ctx.node?.id === id) deactivate();
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
    previewActive: opts.isPreviewActive(), tab: getPreviewTab(), status: ctx.status, message: ctx.message, nodes: nodes.size, placing: ctx.placing, lockMode: ctx.lockMode,
    parsed: !!layer.getParsed(), kernel: editKernel.available,
  }),
  debugLastDrag: () => ctx.lastDrag,
  async debugTryHandle(index) {
    const res = await editKernel.setHandle(index, { ...ctx.influence, keepShape: true });
    if (ctx.node) requestWeights();
    else await editKernel.cancel();
    return 'refused' in res ? `refus : ${res.refused}` : `accepté : ${res.affected.length} points`;
  },
  dispose() {
    ctx.disposed = true;
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
    window.clearTimeout(ctx.headTimer);
    window.clearTimeout(ctx.validateTimer);
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
