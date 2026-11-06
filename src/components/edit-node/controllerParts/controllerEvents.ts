// Issu de la découpe de createGCodeEditController (gcodeEditController.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (controllerState.ts).
import * as BABYLON from 'babylonjs';
import { getPreviewTab } from '../../PreviewUpperTabs';
import { editKernel } from '@/utils/editKernelClient';
import { saveLayerLimits, sanitizeLayerLimits, type LayerLimits } from '@/utils/layerLimits';
import { saveMachineLimits, type MachineLimits } from '@/utils/machineLimits';
import { EDIT_ANALYZE_EVENT, EDIT_CLEAR_LOCKS_EVENT, EDIT_COPY_EVENT, EDIT_INFLUENCE_EVENT, EDIT_LIMITS_EVENT, EDIT_LAYER_LIMITS_EVENT, EDIT_LOCK_MODE_EVENT, EDIT_PASTE_EVENT, EDIT_PLACE_EVENT, EDIT_REDO_EVENT, EDIT_REMOVE_NODE_EVENT, EDIT_REQUEST_STATE_EVENT, EDIT_SET_DELTA_EVENT, EDIT_SYMMETRY_EVENT, EDIT_UNDO_EVENT, type EditInfluenceSettings, type EditLockMode, type EditSymmetry } from '../editProtocol';
import type { GCodeEditController } from '../gcodeEditController';
import type { EditControllerState } from './controllerState';

function setupOnPlace(st: EditControllerState) {
  const { copyDeformation, emit, pasteDeformation, refreshFileValidation, refreshLocks, requestWeights, setLockMode, setNumericDelta, setPlacing, updateView } = st;
  // --- événements du panneau ----------------------------------------------------------------------

  const onPlace = (e: Event) => setPlacing(!!(e as CustomEvent<{ active: boolean }>).detail?.active);
  const onInfluence = (e: Event) => {
    const next = (e as CustomEvent<{ influence: EditInfluenceSettings }>).detail?.influence;
    if (!next) return;
    // Changement de mode : la portée repart de celle des poignées.
    const modeChanged = next.reachMode !== st.influence.reachMode;
    if (st.node && modeChanged) st.node.reach = { scale: 1, growing: false, saturated: false, affected: 0 };
    st.influence = structuredClone(next);
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
  const onClearLocks = () => { void editKernel.clearLocks().then(refreshLocks).then(() => { if (st.node) requestWeights(); }); };
  const onCopy = () => copyDeformation();
  const onPaste = () => pasteDeformation();
  const onSymmetry = (e: Event) => {
    const next = (e as CustomEvent<{ symmetry: EditSymmetry }>).detail?.symmetry;
    if (!next) return;
    st.symmetry = { ...next };
    emit();
  };
  const onLimits = (e: Event) => {
    const next = (e as CustomEvent<{ limits: MachineLimits }>).detail?.limits;
    if (!next) return;
    st.limits = { ...next };
    saveMachineLimits(st.limits);
    void refreshFileValidation();
    emit();
  };
  Object.assign(st, { onPlace, onInfluence, onSetDelta, onLockMode, onClearLocks, onCopy, onPaste,
    onSymmetry, onLimits });
}

function setupOnLayerLimits(st: EditControllerState) {
  const { analyzeFile, deactivate, emit, historyStep, isActive, onClearLocks, onCopy, onLimits, onLockMode, onPaste, onSetDelta, onSymmetry, removeNode, requestWeights, setPlacing } = st;
  const onLayerLimits = (e: Event) => {
    const next = (e as CustomEvent<{ layerLimits: Partial<LayerLimits> }>).detail?.layerLimits;
    if (!next) return;
    st.layerLimits = sanitizeLayerLimits(next);
    saveLayerLimits(st.layerLimits);
    emit();
    if (st.status !== 'ready') return;
    // Le noyau garde ses bornes jusqu'à nouvel ordre : les lui donner, puis refaire les poids du nœud actif.
    void editKernel.setLayerLimits(st.layerLimits.minMm, st.layerLimits.maxMm, st.layerLimits.widthFactor)
      .then(() => { if (st.node) requestWeights(); })
      .catch((): void => undefined);
  };
  const onAnalyze = (e: Event) => { void analyzeFile(!!(e as CustomEvent<{ collisions: boolean }>).detail?.collisions); };
  const onUndo = () => historyStep('undo');
  const onRedo = () => historyStep('redo');
  const onRemoveNode = () => removeNode();
  const onRequestState = () => emit();
  const onTab = () => st.refresh();
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isActive() || st.status !== 'ready') return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); historyStep('undo'); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); historyStep('redo'); }
    else if (e.key === 'Escape') { if (st.placing) setPlacing(false); else deactivate(); }
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
  Object.assign(st, { onLayerLimits, onAnalyze, onUndo, onRedo, onRemoveNode, onRequestState, onTab,
    onKeyDown });
}

function setupRefresh(st: EditControllerState) {
  const { clearNodes, deactivate, ensureKernel, isActive, layer, nodes, onInfluence, onKeyDown, onPlace, onRedo, onRemoveNode, onRequestState, onTab, onUndo, setLockMode, setPlacing, updateView } = st;
  window.addEventListener(EDIT_PLACE_EVENT, onPlace);
  window.addEventListener(EDIT_INFLUENCE_EVENT, onInfluence);
  window.addEventListener(EDIT_UNDO_EVENT, onUndo);
  window.addEventListener(EDIT_REDO_EVENT, onRedo);
  window.addEventListener(EDIT_REMOVE_NODE_EVENT, onRemoveNode);
  window.addEventListener(EDIT_REQUEST_STATE_EVENT, onRequestState);
  window.addEventListener('apex-preview-tab-changed', onTab);
  window.addEventListener('keydown', onKeyDown);

  const refresh = () => {
    if (st.disposed) return;
    // Onglet Édition : trajectoires en gris neutre, les zones contraintes ressortent en violet.
    layer.setEditNeutral(isActive());
    const parsed = layer.getParsed();
    // Nouveau fichier : le noyau et les nœuds décrivaient l'ancien.
    if (parsed !== st.loadedParsed && nodes.size > 0) clearNodes();
    if (!isActive()) {
      // Hors de l'onglet : les nœuds restent posés (réduits) pour y revenir.
      if (st.placing) setPlacing(false);
      if (st.lockMode) setLockMode(null, st.lockRadiusMm);
      deactivate();
      updateView();
      return;
    }
    void ensureKernel();
    updateView(true);
  };
    st.refresh = refresh;
}

function setupEventsPart4(st: EditControllerState): GCodeEditController {
  const { activate, afterRenderListeners, deactivate, layer, listeners, nodes, onAnalyze, onClearLocks, onCopy, onHandleDrag, onHandlesChange, onInfluence, onKeyDown, onLayerLimits, onLimits, onLockMode, onNodeMove, onNodeMoveEnd, onPaste, onPlace, onRedo, onRemoveNode, onRequestState, onSetDelta, onSymmetry, onTab, onUndo, opts, placeNode, pointerObserver, project, refresh, renderObserver, requestWeights, scene, togglePositionLock, toggleTrimming } = st;
  return {
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      listener(st.lastView);
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
      if (st.node?.id === id) deactivate();
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
      previewActive: opts.isPreviewActive(), tab: getPreviewTab(), status: st.status, message: st.message, nodes: nodes.size, placing: st.placing, lockMode: st.lockMode,
      parsed: !!layer.getParsed(), kernel: editKernel.available,
    }),
    debugLastDrag: () => st.lastDrag,
    async debugTryHandle(index) {
      const res = await editKernel.setHandle(index, { ...st.influence, keepShape: true });
      if (st.node) requestWeights();
      else await editKernel.cancel();
      return 'refused' in res ? `refus : ${res.refused}` : `accepté : ${res.affected.length} points`;
    },
    dispose() {
      st.disposed = true;
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
      window.clearTimeout(st.headTimer);
      window.clearTimeout(st.validateTimer);
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

export function setupEditControllerEvents(st: EditControllerState) {
  setupOnPlace(st);
  setupOnLayerLimits(st);
  setupRefresh(st);
  return setupEventsPart4(st);
}
