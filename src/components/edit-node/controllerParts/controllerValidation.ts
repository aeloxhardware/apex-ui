// Issu de la découpe de createGCodeEditController (gcodeEditController.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (controllerState.ts).
import { EDIT_FLAG_COLLISION, EDIT_FLAG_LOCKED, EDIT_FLAG_VIOLATION } from '../../gcodeEditDeform';
import { getPreviewTab } from '../../PreviewUpperTabs';
import { editKernel, type EditValidation } from '@/utils/editKernelClient';
import { toKernelLimits } from '@/utils/machineLimits';
import { type EditLockMode } from '../editProtocol';
import { LIVE_VALIDATION_DELAY_MS, type NodeState } from './controllerShared';
import type { EditControllerState } from './controllerState';

function setupIsActive(st: EditControllerState) {
  const { opts } = st;
  // --- noyau --------------------------------------------------------------------------------------

  const isActive = () => opts.isPreviewActive() && getPreviewTab() === 'edition';

  // --- validation physique par le noyau (limites de B, collisions, écart tête / normale) ------------
  // Résultats du fichier entier (B seulement : un million de points en quelques dizaines de ms) et de la
  // zone modifiée (collisions et normales, poses échantillonnées). Les points en défaut sont repérés par
  // des drapeaux dans l'attribut des cordons (rouge vif, réservé aux alertes).
  st.fileViolations = new Uint32Array(0);
  st.fileV = null;
  st.zoneV = null;
  st.liveB = null;
  st.judgedSet = null;
  st.validateTimer = 0;
  st.validateSeq = 0;
  st.lastPreviewAt = 0;

  const kernelLimits = () => toKernelLimits(st.limits);
  const BITS_B = 1 | 2 | 4;
  const BITS_COLLISION = 8 | 16;
  const splitFlags = (v: EditValidation) => {
    const b: number[] = [], c: number[] = [];
    for (let i = 0; i < v.violations.length; i++) {
      const f = v.violationFlags[i];
      if (f & BITS_B) b.push(v.violations[i]);
      if (f & BITS_COLLISION) c.push(v.violations[i]);
    }
    return { b: Uint32Array.from(b), c: Uint32Array.from(c) };
  };
  Object.assign(st, { isActive, kernelLimits, splitFlags });
}

function setupPublishValidation(st: EditControllerState) {
  const { emit, kernelLimits, layer, splitFlags } = st;
  const publishValidation = () => {
    if (!st.fileV && !st.zoneV) { st.validation = null; return; }
    st.validation = {
      bRange: st.zoneV?.bRange ?? 0, bSpeed: st.zoneV?.bSpeed ?? 0, bAccel: st.zoneV?.bAccel ?? 0,
      headPart: st.zoneV?.headPart ?? 0, headPlate: st.zoneV?.headPlate ?? 0,
      posesTested: st.zoneV?.posesTested ?? 0,
      collisionChecked: st.zoneV?.collisionChecked ?? false,
      timingKnown: (st.zoneV ?? st.fileV)?.timingKnown ?? false,
      fileBViolations: st.fileViolations.length,
      normalIndices: st.zoneV?.normalIndices ?? new Uint32Array(0),
      normalDeviation: st.zoneV?.normalDeviation ?? new Float32Array(0),
      normalWorst: st.zoneV?.normalWorst ?? 0,
    };
  };

  /** Drapeau « hors limites » : points du fichier entier, remplacés dans la zone jugée en direct. */
  const pushViolationFlags = () => {
    let list = st.fileViolations;
    if (st.liveB && st.judgedSet) {
      const merged: number[] = [];
      for (const k of st.fileViolations) if (!st.judgedSet.has(k)) merged.push(k);
      for (const k of st.liveB) merged.push(k);
      merged.sort((a, b) => a - b);
      list = Uint32Array.from(merged);
    }
    layer.setEditFlagBit(EDIT_FLAG_VIOLATION, list.length ? list : null);
  };

  /** Limites de B de tout le fichier (état validé). */
  const refreshFileValidation = async () => {
    if (st.status !== 'ready') return;
    try {
      const v = await editKernel.validate({ limits: kernelLimits(), collisions: false });
      st.fileV = v;
      st.fileViolations = splitFlags(v).b;
      st.liveB = null;
      st.judgedSet = null;
      pushViolationFlags();
      publishValidation();
      emit();
    } catch (error) {
      st.message = error instanceof Error ? error.message : String(error);
      emit();
    }
  };
  Object.assign(st, { publishValidation, pushViolationFlags, refreshFileValidation });
}

function setupValidateZone(st: EditControllerState) {
  const { emit, kernelLimits, layer, publishValidation, pushViolationFlags, splitFlags } = st;
  /** Collisions et écart tête / normale de la zone qui vient d'être modifiée (état validé). */
  const validateZone = async (indices?: Uint32Array) => {
    if (st.status !== 'ready' || !indices || !indices.length) return;
    try {
      const v = await editKernel.validate({
        limits: kernelLimits(), collisions: true, lo: indices[0], hi: indices[indices.length - 1] + 1,
      });
      st.zoneV = v;
      const { c } = splitFlags(v);
      layer.setEditFlagBit(EDIT_FLAG_COLLISION, c.length ? c : null);
      publishValidation();
      emit();
    } catch {
      /* validation indisponible : l'édition elle-même n'en dépend pas */
    }
  };

  /** Pendant le glissement : validation de la déformation en cours, une fois le geste posé. */
  const scheduleLiveValidation = (n: NodeState) => {
    window.clearTimeout(st.validateTimer);
    st.validateTimer = window.setTimeout(async () => {
      if (st.node !== n || st.status !== 'ready') return;
      const seq = ++st.validateSeq;
      try {
        const v = await editKernel.validate({ limits: kernelLimits(), collisions: true });
        if (seq !== st.validateSeq || st.node !== n) return;
        st.zoneV = v;
        const { b, c } = splitFlags(v);
        st.liveB = b;
        const judged = new Set<number>();
        for (const k of n.affectedIdx ?? []) { judged.add(k); judged.add(k + 1); }
        st.judgedSet = judged;
        pushViolationFlags();
        layer.setEditFlagBit(EDIT_FLAG_COLLISION, c.length ? c : null);
        publishValidation();
        emit();
      } catch {
        /* sans validation, le glissement reste utilisable */
      }
    }, LIVE_VALIDATION_DELAY_MS);
  };
  Object.assign(st, { validateZone, scheduleLiveValidation });
}

function setupAnalyzeFile(st: EditControllerState) {
  const { busy, emit, kernelLimits, layer, publishValidation, pushViolationFlags, splitFlags } = st;
  /** Analyse du fichier entier (limites de B, et collisions échantillonnées si demandé). */
  const analyzeFile = async (collisions: boolean) => {
    if (st.status !== 'ready') return;
    try {
      const v = await busy(editKernel.validate({
        limits: { ...kernelLimits(), ...(collisions ? { maxPoses: 20000 } : {}) }, collisions,
      }));
      st.zoneV = v;
      st.fileV = v;
      const { b, c } = splitFlags(v);
      st.fileViolations = b;
      st.liveB = null;
      st.judgedSet = null;
      pushViolationFlags();
      layer.setEditFlagBit(EDIT_FLAG_COLLISION, c.length ? c : null);
      publishValidation();
      st.message = collisions && !v.collisionChecked
        ? "Collisions non contrôlées : le modèle de la tête n'est pas chargé."
        : `Analyse : ${b.length.toLocaleString('fr-FR')} point(s) hors limites de B` +
          (collisions ? `, ${c.length.toLocaleString('fr-FR')} en collision (${v.posesTested.toLocaleString('fr-FR')} poses testées).` : '.');
      emit();
    } catch (error) {
      st.message = error instanceof Error ? error.message : String(error);
      emit();
    }
  };

  /** Le modèle de la tête se charge après le G-code : le rendre au noyau dès qu'il est prêt. */
  st.headTimer = 0;
  const refreshHeadSamples = async (attempt = 0) => {
    if (st.disposed || st.status !== 'ready') return;
    const samples = layer.getHeadSamples(3);
    if (samples && samples.length >= 30) {
      try {
        await editKernel.setHeadSamples(samples);
        st.headModel = true;
        emit();
      } catch {
        /* sans modèle de tête, pas de contrôle de collision */
      }
      return;
    }
    if (attempt < 12) st.headTimer = window.setTimeout((): void => void refreshHeadSamples(attempt + 1), 1500);
  };
  Object.assign(st, { analyzeFile, refreshHeadSamples });
}

function setupRefreshLocks(st: EditControllerState) {
  const { canvas, emit, isActive, layer } = st;
  // --- verrous de zones de matière -----------------------------------------------------------------

  const refreshLocks = async () => {
    if (st.status !== 'ready') return;
    try {
      const indices = await editKernel.lockedIndices();
      st.locksCount = indices.length;
      layer.setEditFlagBit(EDIT_FLAG_LOCKED, indices.length ? indices : null);
      emit();
    } catch {
      /* ignoré : l'état des verrous est relu à la prochaine action */
    }
  };

  const syncPicking = () => layer.setPickingEnabled(st.placing || !!st.node || !!st.lockMode);
  const syncCursor = () => { canvas.style.cursor = st.placing || st.lockMode ? 'crosshair' : ''; };

  const setLockMode = (mode: EditLockMode, radiusMm: number) => {
    st.lockMode = isActive() && st.status === 'ready' ? mode : null;
    if (Number.isFinite(radiusMm) && radiusMm > 0) st.lockRadiusMm = radiusMm;
    if (st.lockMode && st.placing) st.setPlacing(false);
    syncPicking();
    syncCursor();
    if (!st.lockMode) layer.setPickHighlight(null);
    emit();
  };

  const lockAt = async (index: number) => {
    if (!st.lockMode || st.status !== 'ready') return;
    try {
      const touched = await editKernel.lockRegion(index, st.lockRadiusMm, st.lockMode === 'lock');
      if (touched.length === 0) {
        st.message = 'Aucune matière à verrouiller ici.';
      } else {
        st.message = null;
        await refreshLocks();
        // Les poids du nœud actif dépendent des verrous (la matière verrouillée ne bouge pas).
        if (st.node) st.requestWeights();
      }
      emit();
    } catch (error) {
      st.message = error instanceof Error ? error.message : String(error);
      emit();
    }
  };
  Object.assign(st, { refreshLocks, syncPicking, syncCursor, setLockMode, lockAt });
}

export function setupEditControllerValidation(st: EditControllerState) {
  setupIsActive(st);
  setupPublishValidation(st);
  setupValidateZone(st);
  setupAnalyzeFile(st);
  setupRefreshLocks(st);
}
