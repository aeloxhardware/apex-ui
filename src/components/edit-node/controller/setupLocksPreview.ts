import { editKernel } from '@/utils/editKernelClient';
import { EDIT_FLAG_LOCKED, EDIT_FLAG_THINNER, EDIT_FLAG_THICKER, EDIT_FLAG_BOUNDS, EDIT_FLAG_TRIM } from '../../gcodeEditDeform';
import { EditLockMode } from '../editProtocol';
import { layerFloorMm } from '@/utils/layerLimits';
import { LINE_TYPES } from '../../gcodeLineTypes';
import { getActiveKinematics } from '@/utils/kinematics';
import { NodeState, PREVIEW_PERIOD_MS, THICKNESS_RATIO_BAND } from './shared';
import type { EditCtx } from './context';

/** Verrous de zones de matière, aperçu pendant le glissement et démarrage du noyau. */
export function setupLocksPreview(ctx: EditCtx) {
  const { layer, emit, canvas, isActive, pushViolationFlags, busy, refreshHeadSamples, refreshFileValidation } = ctx;


// --- verrous de zones de matière -----------------------------------------------------------------

const refreshLocks = async () => {
  if (ctx.status !== 'ready') return;
  try {
    const indices = await editKernel.lockedIndices();
    ctx.locksCount = indices.length;
    layer.setEditFlagBit(EDIT_FLAG_LOCKED, indices.length ? indices : null);
    emit();
  } catch {
    /* ignoré : l'état des verrous est relu à la prochaine action */
  }
};
  ctx.refreshLocks = refreshLocks;


const syncPicking = () => layer.setPickingEnabled(ctx.placing || !!ctx.node || !!ctx.lockMode);
  ctx.syncPicking = syncPicking;

const syncCursor = () => { canvas.style.cursor = ctx.placing || ctx.lockMode ? 'crosshair' : ''; };
  ctx.syncCursor = syncCursor;


const setLockMode = (mode: EditLockMode, radiusMm: number) => {
  ctx.lockMode = isActive() && ctx.status === 'ready' ? mode : null;
  if (Number.isFinite(radiusMm) && radiusMm > 0) ctx.lockRadiusMm = radiusMm;
  if (ctx.lockMode && ctx.placing) ctx.setPlacing(false);
  syncPicking();
  syncCursor();
  if (!ctx.lockMode) layer.setPickHighlight(null);
  emit();
};
  ctx.setLockMode = setLockMode;


const lockAt = async (index: number) => {
  if (!ctx.lockMode || ctx.status !== 'ready') return;
  try {
    const touched = await editKernel.lockRegion(index, ctx.lockRadiusMm, ctx.lockMode === 'lock');
    if (touched.length === 0) {
      ctx.message = 'Aucune matière à verrouiller ici.';
    } else {
      ctx.message = null;
      await refreshLocks();
      // Les poids du nœud actif dépendent des verrous (la matière verrouillée ne bouge pas).
      if (ctx.node) ctx.requestWeights();
    }
    emit();
  } catch (error) {
    ctx.message = error instanceof Error ? error.message : String(error);
    emit();
  }
};
  ctx.lockAt = lockAt;


// --- aperçu pendant le glissement (épaisseurs, dépôts rognés, trajets à vide) ----------------------

const PREVIEW_BITS = [EDIT_FLAG_THINNER, EDIT_FLAG_THICKER, EDIT_FLAG_BOUNDS, EDIT_FLAG_TRIM];

const clearPreviews = () => {
  for (const bit of PREVIEW_BITS) layer.setEditFlagBit(bit, null);
  layer.setTravelPreview(null);
  ctx.thickness = null;
  ctx.trimmedCount = 0;
  window.clearTimeout(ctx.validateTimer);
  ctx.validateSeq++;
  if (ctx.liveB) {
    // Retour aux défauts du fichier entier.
    ctx.liveB = null;
    ctx.judgedSet = null;
    pushViolationFlags();
  }
};
  ctx.clearPreviews = clearPreviews;


const updatePreview = (n: NodeState, res: Awaited<ReturnType<typeof editKernel.drag>> & object) => {
  const now = performance.now();
  if (now - ctx.lastPreviewAt < PREVIEW_PERIOD_MS) return;
  ctx.lastPreviewAt = now;
  const A = n.affectedIdx;
  const D = n.dependentIdx ?? new Uint32Array(0);
  const base = n.baseHeights;
  if (res.heights && A && base && res.heights.length === A.length + D.length) {
    const thinner: number[] = [], thicker: number[] = [], bad: number[] = [];
    const counts = res.layerCounts && res.layerCounts.length === res.heights.length ? res.layerCounts : null;
    let resliceNow = 0, resliceMax = 0;
    // Re-tranchage : un dépassement de quelques pour cent du maximum est toléré (pas de couche insérée).
    const overTolerance = res.layerCounts ? Math.max(0.015, 0.05 * ctx.layerLimits.maxMm) : 0.005;
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
      else if (h < layerFloorMm(ctx.layerLimits) - 0.005 || h > ctx.layerLimits.maxMm + overTolerance) bad.push(k);
      else if (h < b0 * (1 - THICKNESS_RATIO_BAND)) thinner.push(k);
      else if (h > b0 * (1 + THICKNESS_RATIO_BAND)) thicker.push(k);
      if (h < min) min = h;
      if (h > max) max = h;
      if (k === n.index) { nodeNow = h; nodeBefore = b0; }
    }
    ctx.reslicePoints = resliceNow;
    ctx.resliceMaxCount = resliceMax;
    const arr = (v: number[]) => (v.length ? Uint32Array.from(v) : null);
    layer.setEditFlagBit(EDIT_FLAG_THINNER, arr(thinner));
    layer.setEditFlagBit(EDIT_FLAG_THICKER, arr(thicker));
    layer.setEditFlagBit(EDIT_FLAG_BOUNDS, arr(bad));
    ctx.thickness = Number.isFinite(min)
      ? {
        node: nodeNow, nodeBefore, min, max,
        thinner: thinner.length, thicker: thicker.length, outOfBounds: bad.length,
        minLimit: layerFloorMm(ctx.layerLimits), maxLimit: ctx.layerLimits.maxMm,
      }
      : null;
  }
  const trimmed = res.trimmed ?? new Uint32Array(0);
  layer.setEditFlagBit(EDIT_FLAG_TRIM, trimmed.length ? trimmed : null);
  ctx.trimmedCount = trimmed.length;
};
  ctx.updatePreview = updatePreview;


const ensureKernel = async () => {
  const parsed = layer.getParsed();
  if (!parsed || parsed.moves.length < 2) {
    ctx.status = 'inactive';
    ctx.message = 'Aucun G-code affiché.';
    return emit();
  }
  if (parsed.kind !== 'polar') {
    ctx.status = 'unsupported';
    ctx.message = "Convertissez d'abord le G-Code pour Apex Slicer.";
    return emit();
  }
  if (!editKernel.available) {
    ctx.status = 'unavailable';
    ctx.message = "L'édition par nœuds n'est disponible que dans l'application de bureau.";
    return emit();
  }
  if (ctx.loadedParsed === parsed && ctx.status === 'ready') return emit();
  const seq = ++ctx.loadSeq;
  ctx.status = 'loading';
  ctx.message = null;
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
      { pivotMm: getActiveKinematics().pivotToTip, minLayerMm: ctx.layerLimits.minMm, maxLayerMm: ctx.layerLimits.maxMm, widthFactor: ctx.layerLimits.widthFactor },
    ));
    if (seq !== ctx.loadSeq) return;
    ctx.loadedParsed = parsed;
    ctx.status = 'ready';
    ctx.undoDepth = 0;
    ctx.redoDepth = 0;
    ctx.undoGroups = [];
    ctx.redoGroups = [];
    ctx.locksCount = 0;
    ctx.validation = null;
    ctx.thickness = null;
    ctx.trimmedCount = 0;
    ctx.headModel = !!headSamples && headSamples.length >= 30;
    parsed.editJournal = { undo: [], redo: [] };
    await ctx.restoreJournal(parsed);
    if (seq !== ctx.loadSeq) return;
    if (!ctx.headModel) void refreshHeadSamples();
    void refreshFileValidation();
  } catch (error) {
    if (seq !== ctx.loadSeq) return;
    ctx.status = 'error';
    ctx.message = error instanceof Error ? error.message : String(error);
  }
  emit();
};
  ctx.ensureKernel = ensureKernel;
}
