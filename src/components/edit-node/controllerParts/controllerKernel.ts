// Issu de la découpe de createGCodeEditController (gcodeEditController.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (controllerState.ts).
import { getActiveKinematics } from '@/utils/kinematics';
import { LINE_TYPES } from '../../gcodeLineTypes';
import { EDIT_FLAG_BOUNDS, EDIT_FLAG_THICKER, EDIT_FLAG_THINNER, EDIT_FLAG_TRIM } from '../../gcodeEditDeform';
import { editKernel } from '@/utils/editKernelClient';
import { layerFloorMm } from '@/utils/layerLimits';
import { PREVIEW_PERIOD_MS, THICKNESS_RATIO_BAND, type NodeState } from './controllerShared';
import type { EditControllerState } from './controllerState';

function setupClearPreviews(st: EditControllerState) {
  const { layer, pushViolationFlags } = st;
  // --- aperçu pendant le glissement (épaisseurs, dépôts rognés, trajets à vide) ----------------------

  const PREVIEW_BITS = [EDIT_FLAG_THINNER, EDIT_FLAG_THICKER, EDIT_FLAG_BOUNDS, EDIT_FLAG_TRIM];
  const clearPreviews = () => {
    for (const bit of PREVIEW_BITS) layer.setEditFlagBit(bit, null);
    layer.setTravelPreview(null);
    st.thickness = null;
    st.trimmedCount = 0;
    window.clearTimeout(st.validateTimer);
    st.validateSeq++;
    if (st.liveB) {
      // Retour aux défauts du fichier entier.
      st.liveB = null;
      st.judgedSet = null;
      pushViolationFlags();
    }
  };
  Object.assign(st, { clearPreviews });
}

function setupUpdatePreview(st: EditControllerState) {
  const { layer } = st;
  const updatePreview = (n: NodeState, res: Awaited<ReturnType<typeof editKernel.drag>> & object) => {
    const now = performance.now();
    if (now - st.lastPreviewAt < PREVIEW_PERIOD_MS) return;
    st.lastPreviewAt = now;
    const A = n.affectedIdx;
    const D = n.dependentIdx ?? new Uint32Array(0);
    const base = n.baseHeights;
    if (res.heights && A && base && res.heights.length === A.length + D.length) {
      const thinner: number[] = [], thicker: number[] = [], bad: number[] = [];
      const counts = res.layerCounts && res.layerCounts.length === res.heights.length ? res.layerCounts : null;
      let resliceNow = 0, resliceMax = 0;
      // Re-tranchage : un dépassement de quelques pour cent du maximum est toléré (pas de couche insérée).
      const overTolerance = res.layerCounts ? Math.max(0.015, 0.05 * st.layerLimits.maxMm) : 0.005;
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
        else if (h < layerFloorMm(st.layerLimits) - 0.005 || h > st.layerLimits.maxMm + overTolerance) bad.push(k);
        else if (h < b0 * (1 - THICKNESS_RATIO_BAND)) thinner.push(k);
        else if (h > b0 * (1 + THICKNESS_RATIO_BAND)) thicker.push(k);
        if (h < min) min = h;
        if (h > max) max = h;
        if (k === n.index) { nodeNow = h; nodeBefore = b0; }
      }
      st.reslicePoints = resliceNow;
      st.resliceMaxCount = resliceMax;
      const arr = (v: number[]) => (v.length ? Uint32Array.from(v) : null);
      layer.setEditFlagBit(EDIT_FLAG_THINNER, arr(thinner));
      layer.setEditFlagBit(EDIT_FLAG_THICKER, arr(thicker));
      layer.setEditFlagBit(EDIT_FLAG_BOUNDS, arr(bad));
      st.thickness = Number.isFinite(min)
        ? {
          node: nodeNow, nodeBefore, min, max,
          thinner: thinner.length, thicker: thicker.length, outOfBounds: bad.length,
          minLimit: layerFloorMm(st.layerLimits), maxLimit: st.layerLimits.maxMm,
        }
        : null;
    }
    const trimmed = res.trimmed ?? new Uint32Array(0);
    layer.setEditFlagBit(EDIT_FLAG_TRIM, trimmed.length ? trimmed : null);
    st.trimmedCount = trimmed.length;
  };
  Object.assign(st, { updatePreview });
}

function setupEnsureKernel(st: EditControllerState) {
  const { busy, emit, layer, refreshFileValidation, refreshHeadSamples } = st;
  const ensureKernel = async () => {
    const parsed = layer.getParsed();
    if (!parsed || parsed.moves.length < 2) {
      st.status = 'inactive';
      st.message = 'Aucun G-code affiché.';
      return emit();
    }
    if (parsed.kind !== 'polar') {
      st.status = 'unsupported';
      st.message = "Convertissez d'abord le G-Code pour Apex Slicer.";
      return emit();
    }
    if (!editKernel.available) {
      st.status = 'unavailable';
      st.message = "L'édition par nœuds n'est disponible que dans l'application de bureau.";
      return emit();
    }
    if (st.loadedParsed === parsed && st.status === 'ready') return emit();
    const seq = ++st.loadSeq;
    st.status = 'loading';
    st.message = null;
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
        { pivotMm: getActiveKinematics().pivotToTip, minLayerMm: st.layerLimits.minMm, maxLayerMm: st.layerLimits.maxMm, widthFactor: st.layerLimits.widthFactor },
      ));
      if (seq !== st.loadSeq) return;
      st.loadedParsed = parsed;
      st.status = 'ready';
      st.undoDepth = 0;
      st.redoDepth = 0;
      st.undoGroups = [];
      st.redoGroups = [];
      st.locksCount = 0;
      st.validation = null;
      st.thickness = null;
      st.trimmedCount = 0;
      st.headModel = !!headSamples && headSamples.length >= 30;
      parsed.editJournal = { undo: [], redo: [] };
      await st.restoreJournal(parsed);
      if (seq !== st.loadSeq) return;
      if (!st.headModel) void refreshHeadSamples();
      void refreshFileValidation();
    } catch (error) {
      if (seq !== st.loadSeq) return;
      st.status = 'error';
      st.message = error instanceof Error ? error.message : String(error);
    }
    emit();
  };
  Object.assign(st, { ensureKernel });
}

export function setupEditControllerKernel(st: EditControllerState) {
  setupClearPreviews(st);
  setupUpdatePreview(st);
  setupEnsureKernel(st);
}
