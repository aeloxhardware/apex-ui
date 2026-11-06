// Issu de la découpe de createGCodeEditController (gcodeEditController.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (controllerState.ts).
import { loadLayerLimits } from '@/utils/layerLimits';
import { loadMachineLimits } from '@/utils/machineLimits';
import { DEFAULT_EDIT_INFLUENCE, DEFAULT_EDIT_SYMMETRY, DEFAULT_LOCK_RADIUS_MM, EDIT_STATE_EVENT, type EditStateDetail } from '../editProtocol';
import { type EditOverlayView, type NodeState } from './controllerShared';
import type { EditControllerState } from './controllerState';

function setupInfluence(st: EditControllerState) {
  st.influence = structuredClone(DEFAULT_EDIT_INFLUENCE);
  st.status = 'inactive';
  st.message = null;
  st.loadedParsed = null;
  st.loadSeq = 0;
  st.placing = false;
  /** Tous les nœuds posés ; `node` est l'actif (ou aucun). */
  const nodes = new Map<number, NodeState>();
  st.node = null;
  st.nodeSeq = 0;
  st.undoDepth = 0;
  st.redoDepth = 0;
  // Re-tranchage : couches à insérer dans l'aperçu en cours (cf. updatePreview).
  // Une validation (noyau, puis G-code, calque, symétrie) est en cours : annuler / rétablir attendent sa fin.
  st.committing = false;
  st.reslicePoints = 0;
  st.resliceMaxCount = 0;
  st.affected = 0;
  st.delta = null;
  st.busyCount = 0;
  st.disposed = false;
  // Aperçu pendant le glissement et validation physique (cf. « Physical validity » de CLAUDE.md).
  st.thickness = null;
  st.trimmedCount = 0;
  st.validation = null;
  st.limits = loadMachineLimits();
  st.layerLimits = loadLayerLimits();
  st.capacityMm = null;
  st.requestedAxialMm = null;
  Object.assign(st, { nodes });
}

function setupEmit(st: EditControllerState) {
  st.headModel = false;
  st.locksCount = 0;
  st.lockMode = null;
  st.lockRadiusMm = DEFAULT_LOCK_RADIUS_MM;
  st.symmetry = { ...DEFAULT_EDIT_SYMMETRY };
  st.clipboard = null;
  // Annuler / rétablir par groupes : une validation et ses copies par symétrie ne font qu'une étape.
  st.undoGroups = [];
  st.redoGroups = [];

  // --- état publié ------------------------------------------------------------------------------

  const emit = () => {
    if (st.disposed) return;
    const detail: EditStateDetail = {
      status: st.status, message: st.message, placing: st.placing, hasNode: !!st.node, busy: st.busyCount > 0,
      undoDepth: st.undoDepth, redoDepth: st.redoDepth, affected: st.affected, delta: st.delta, influence: st.influence,
      nodeTrimming: st.node ? st.node.trimming : null,
      trimmed: st.trimmedCount, reslicePoints: st.reslicePoints, resliceMaxCount: st.resliceMaxCount, thickness: st.thickness, validation: st.validation,
      locks: st.locksCount, lockMode: st.lockMode, lockRadiusMm: st.lockRadiusMm,
      canPaste: !!st.clipboard, symmetry: st.symmetry, limits: st.limits, layerLimits: st.layerLimits, capacityMm: st.capacityMm, requestedAxialMm: st.requestedAxialMm, headModel: st.headModel,
    };
    window.dispatchEvent(new CustomEvent(EDIT_STATE_EVENT, { detail }));
  };

  const listeners = new Set<(view: EditOverlayView) => void>();
  st.lastView = { nodes: [] };
  const publishView = (view: EditOverlayView) => {
    st.lastView = view;
    for (const l of listeners) l(view);
  };
  Object.assign(st, { emit, listeners, publishView });
}

function setupBusy(st: EditControllerState) {
  const { emit } = st;
  // Opérations longues (chargement, validation, annulation) : les reflets du nœud tournent. Le
  // recalcul des poids, fréquent et court, ne les déclenche pas.
  const busy = async <T>(work: Promise<T>, shown = true): Promise<T> => {
    if (!shown) return work;
    st.busyCount++;
    emit();
    st.updateView(true);
    try {
      return await work;
    } finally {
      st.busyCount--;
      emit();
      st.updateView(true);
    }
  };
  Object.assign(st, { busy });
}

export function setupEditControllerState(st: EditControllerState) {
  setupInfluence(st);
  setupEmit(st);
  setupBusy(st);
}
