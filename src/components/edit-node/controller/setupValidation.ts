import { getPreviewTab } from '../../PreviewUpperTabs';
import { EditValidation, editKernel } from '@/utils/editKernelClient';
import { toKernelLimits } from '@/utils/machineLimits';
import { EDIT_FLAG_VIOLATION, EDIT_FLAG_COLLISION } from '../../gcodeEditDeform';
import { NodeState, LIVE_VALIDATION_DELAY_MS } from './shared';
import type { EditCtx } from './context';

/** Noyau C++ et validation physique (limites de B, collisions, écart tête / normale). */
export function setupValidation(ctx: EditCtx) {
  const { layer, emit, busy, opts } = ctx;


// --- noyau --------------------------------------------------------------------------------------

const isActive = () => opts.isPreviewActive() && getPreviewTab() === 'edition';
  ctx.isActive = isActive;


// --- validation physique par le noyau (limites de B, collisions, écart tête / normale) ------------
// Résultats du fichier entier (B seulement : un million de points en quelques dizaines de ms) et de la
// zone modifiée (collisions et normales, poses échantillonnées). Les points en défaut sont repérés par
// des drapeaux dans l'attribut des cordons (rouge vif, réservé aux alertes).
let fileViolations = new Uint32Array(0);

let fileV: EditValidation | null = null;

let zoneV: EditValidation | null = null;

ctx.liveB = null;

ctx.judgedSet = null;

ctx.validateTimer = 0;

ctx.validateSeq = 0;

ctx.lastPreviewAt = 0;


const kernelLimits = () => toKernelLimits(ctx.limits);

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


const publishValidation = () => {
  if (!fileV && !zoneV) { ctx.validation = null; return; }
  ctx.validation = {
    bRange: zoneV?.bRange ?? 0, bSpeed: zoneV?.bSpeed ?? 0, bAccel: zoneV?.bAccel ?? 0,
    headPart: zoneV?.headPart ?? 0, headPlate: zoneV?.headPlate ?? 0,
    posesTested: zoneV?.posesTested ?? 0,
    collisionChecked: zoneV?.collisionChecked ?? false,
    timingKnown: (zoneV ?? fileV)?.timingKnown ?? false,
    fileBViolations: fileViolations.length,
    normalIndices: zoneV?.normalIndices ?? new Uint32Array(0),
    normalDeviation: zoneV?.normalDeviation ?? new Float32Array(0),
    normalWorst: zoneV?.normalWorst ?? 0,
  };
};


/** Drapeau « hors limites » : points du fichier entier, remplacés dans la zone jugée en direct. */
const pushViolationFlags = () => {
  let list = fileViolations;
  if (ctx.liveB && ctx.judgedSet) {
    const merged: number[] = [];
    for (const k of fileViolations) if (!ctx.judgedSet.has(k)) merged.push(k);
    for (const k of ctx.liveB) merged.push(k);
    merged.sort((a, b) => a - b);
    list = Uint32Array.from(merged);
  }
  layer.setEditFlagBit(EDIT_FLAG_VIOLATION, list.length ? list : null);
};
  ctx.pushViolationFlags = pushViolationFlags;


/** Limites de B de tout le fichier (état validé). */
const refreshFileValidation = async () => {
  if (ctx.status !== 'ready') return;
  try {
    const v = await editKernel.validate({ limits: kernelLimits(), collisions: false });
    fileV = v;
    fileViolations = splitFlags(v).b;
    ctx.liveB = null;
    ctx.judgedSet = null;
    pushViolationFlags();
    publishValidation();
    emit();
  } catch (error) {
    ctx.message = error instanceof Error ? error.message : String(error);
    emit();
  }
};
  ctx.refreshFileValidation = refreshFileValidation;


/** Collisions et écart tête / normale de la zone qui vient d'être modifiée (état validé). */
const validateZone = async (indices?: Uint32Array) => {
  if (ctx.status !== 'ready' || !indices || !indices.length) return;
  try {
    const v = await editKernel.validate({
      limits: kernelLimits(), collisions: true, lo: indices[0], hi: indices[indices.length - 1] + 1,
    });
    zoneV = v;
    const { c } = splitFlags(v);
    layer.setEditFlagBit(EDIT_FLAG_COLLISION, c.length ? c : null);
    publishValidation();
    emit();
  } catch {
    /* validation indisponible : l'édition elle-même n'en dépend pas */
  }
};
  ctx.validateZone = validateZone;


/** Pendant le glissement : validation de la déformation en cours, une fois le geste posé. */
const scheduleLiveValidation = (n: NodeState) => {
  window.clearTimeout(ctx.validateTimer);
  ctx.validateTimer = window.setTimeout(async () => {
    if (ctx.node !== n || ctx.status !== 'ready') return;
    const seq = ++ctx.validateSeq;
    try {
      const v = await editKernel.validate({ limits: kernelLimits(), collisions: true });
      if (seq !== ctx.validateSeq || ctx.node !== n) return;
      zoneV = v;
      const { b, c } = splitFlags(v);
      ctx.liveB = b;
      const judged = new Set<number>();
      for (const k of n.affectedIdx ?? []) { judged.add(k); judged.add(k + 1); }
      ctx.judgedSet = judged;
      pushViolationFlags();
      layer.setEditFlagBit(EDIT_FLAG_COLLISION, c.length ? c : null);
      publishValidation();
      emit();
    } catch {
      /* sans validation, le glissement reste utilisable */
    }
  }, LIVE_VALIDATION_DELAY_MS);
};
  ctx.scheduleLiveValidation = scheduleLiveValidation;


/** Analyse du fichier entier (limites de B, et collisions échantillonnées si demandé). */
const analyzeFile = async (collisions: boolean) => {
  if (ctx.status !== 'ready') return;
  try {
    const v = await busy(editKernel.validate({
      limits: { ...kernelLimits(), ...(collisions ? { maxPoses: 20000 } : {}) }, collisions,
    }));
    zoneV = v;
    fileV = v;
    const { b, c } = splitFlags(v);
    fileViolations = b;
    ctx.liveB = null;
    ctx.judgedSet = null;
    pushViolationFlags();
    layer.setEditFlagBit(EDIT_FLAG_COLLISION, c.length ? c : null);
    publishValidation();
    ctx.message = collisions && !v.collisionChecked
      ? "Collisions non contrôlées : le modèle de la tête n'est pas chargé."
      : `Analyse : ${b.length.toLocaleString('fr-FR')} point(s) hors limites de B` +
        (collisions ? `, ${c.length.toLocaleString('fr-FR')} en collision (${v.posesTested.toLocaleString('fr-FR')} poses testées).` : '.');
    emit();
  } catch (error) {
    ctx.message = error instanceof Error ? error.message : String(error);
    emit();
  }
};
  ctx.analyzeFile = analyzeFile;


/** Le modèle de la tête se charge après le G-code : le rendre au noyau dès qu'il est prêt. */
ctx.headTimer = 0;

const refreshHeadSamples = async (attempt = 0) => {
  if (ctx.disposed || ctx.status !== 'ready') return;
  const samples = layer.getHeadSamples(3);
  if (samples && samples.length >= 30) {
    try {
      await editKernel.setHeadSamples(samples);
      ctx.headModel = true;
      emit();
    } catch {
      /* sans modèle de tête, pas de contrôle de collision */
    }
    return;
  }
  if (attempt < 12) ctx.headTimer = window.setTimeout(() => void refreshHeadSamples(attempt + 1), 1500);
};
  ctx.refreshHeadSamples = refreshHeadSamples;
}
