import type { ParsedGCode } from '../../gcodeParse';
import { EDIT_VALUES_PER_POINT, EditHistoryEntry, editKernel, EditTransform, EditInfluence } from '@/utils/editKernelClient';
import { ApexJournalEntry, fingerprintOf } from '@/utils/apexHeader';
import * as BABYLON from 'babylonjs';
import { EditDelta } from '../editProtocol';
import { NodeState, ANCHOR_MIN_RADIUS_MM, ANCHOR_RADIUS_FRACTION, REFUSAL_MESSAGES } from './shared';
import type { EditCtx } from './context';

/** Journal des modifications, conversion noyau ↔ plateau, influence et calcul des poids. */
export function setupJournalInfluence(ctx: EditCtx) {
  const { layer, busy, emit } = ctx;


// --- journal (D5) : historique écrit dans l'en-tête chiffré, relu à la réouverture ---------------

const JOURNAL_PRECISION = 1e7;

const round = (v: number) => Math.round(v * JOURNAL_PRECISION) / JOURNAL_PRECISION;


/** Valeurs courantes (R, C, Z, B, E) des points `indices` dans le G-code affiché. */
const currentValues = (parsed: ParsedGCode, indices: ArrayLike<number>) => {
  const out = new Float64Array(indices.length * EDIT_VALUES_PER_POINT);
  for (let i = 0; i < indices.length; i++) {
    const k = indices[i];
    const m = parsed.moves[k];
    out.set([m.x, m.y, m.z, m.b, parsed.eDelta[k]], i * EDIT_VALUES_PER_POINT);
  }
  return out;
};
  ctx.currentValues = currentValues;


const toHistory = (e: ApexJournalEntry): EditHistoryEntry => ({
  indices: Uint32Array.from(e.indices),
  before: Float64Array.from(e.before),
  after: Float64Array.from(e.after),
  trimmed: e.trimmed && e.trimmed.length ? Uint32Array.from(e.trimmed) : undefined,
});


/** Tailles des groupes d'entrées consécutives de même identifiant de groupe (une validation et ses copies). */
const groupsOf = (entries: ApexJournalEntry[]) => {
  const out: number[] = [];
  let last: string | undefined;
  for (const e of entries) {
    if (e.group !== undefined && e.group === last) out[out.length - 1]++;
    else out.push(1);
    last = e.group;
  }
  return out;
};


/** Historique relu dans l'en-tête du fichier : rendu au noyau si le fichier n'a pas changé
 * depuis (empreinte de la dernière modification) ; sinon ignoré, avec un message. */
const restoreJournal = async (parsed: ParsedGCode) => {
  const journal = parsed.apexHeader?.journal;
  if (!journal || (journal.undo.length === 0 && journal.redo.length === 0)) return;
  const last = journal.undo[journal.undo.length - 1];
  if (last) {
    const now = await fingerprintOf(last.indices, currentValues(parsed, last.indices));
    if (now !== last.fingerprint) {
      ctx.message = "Historique du fichier ignoré : le fichier a été modifié hors d'Apex depuis.";
      return;
    }
  }
  try {
    const depths = await editKernel.restoreHistory({ undo: journal.undo.map(toHistory), redo: journal.redo.map(toHistory) });
    ctx.undoDepth = depths.undoDepth;
    ctx.redoDepth = depths.redoDepth;
    ctx.undoGroups = groupsOf(journal.undo);
    ctx.redoGroups = groupsOf(journal.redo);
    parsed.editJournal = { undo: [...journal.undo], redo: [...journal.redo] };
  } catch (error) {
    ctx.message = `Historique du fichier ignoré : ${error instanceof Error ? error.message : String(error)}`;
  }
};
  ctx.restoreJournal = restoreJournal;


/** Nouvelle entrée du journal pour une validation (avant / après, transformation, influence). */
const journalCommit = async (
  parsed: ParsedGCode,
  nodeIndex: number,
  transform: EditTransform,
  influenceUsed: EditInfluence,
  indices: Uint32Array,
  before: Float64Array,
  after: Float64Array,
  trimmed?: Uint32Array,
  group?: string,
) => {
  if (parsed.insertedBlocks?.length) return;
  const journal = (parsed.editJournal ??= { undo: [], redo: [] });
  const entry: ApexJournalEntry = {
    at: new Date().toISOString(),
    node: nodeIndex,
    transform: {
      translation: Array.from(transform.translation),
      axis: Array.from(transform.axis),
      angleRad: transform.angleRad,
    },
    influence: {
      ...influenceUsed,
      directions: influenceUsed.directions ? Array.from(influenceUsed.directions, round) : [],
      anchors: influenceUsed.anchors ? Array.from(influenceUsed.anchors, round) : [],
    },
    indices: Array.from(indices),
    before: Array.from(before, round),
    after: Array.from(after, round),
    ...(trimmed && trimmed.length ? { trimmed: Array.from(trimmed) } : {}),
    ...(group !== undefined ? { group } : {}),
    fingerprint: '',
  };
  journal.undo.push(entry);
  journal.redo = [];
  entry.fingerprint = await fingerprintOf(indices, after);
};
  ctx.journalCommit = journalCommit;


const journalStep = (parsed: ParsedGCode, step: 'undo' | 'redo') => {
  const journal = parsed.editJournal;
  if (!journal) return;
  const from = step === 'undo' ? journal.undo : journal.redo;
  const to = step === 'undo' ? journal.redo : journal.undo;
  const entry = from.pop();
  if (entry) to.push(entry);
};
  ctx.journalStep = journalStep;


const toKernel = (v: BABYLON.Vector3) => [v.x, v.z, v.y] as const;
  ctx.toKernel = toKernel;

const fromKernel = (v: ArrayLike<number>) => new BABYLON.Vector3(v[0], v[2], v[1]);
  ctx.fromKernel = fromKernel;


// Repère du noyau = composantes Babylon y ↔ z échangées (une réflexion) : la même rotation s'y
// écrit avec l'axe échangé et l'angle opposé.
const transformOf = (n: NodeState): EditTransform => ({
  translation: Float64Array.from(toKernel(n.translation)),
  axis: Float64Array.from(toKernel(n.rotation.axis)),
  angleRad: -n.rotation.angle,
});
  ctx.transformOf = transformOf;


const pushTransform = (n: NodeState | null) => {
  layer.setEditTransform(n
    ? { translation: n.applied, pivot: n.anchor, axis: n.rotation.axis, angle: n.rotation.applied, stackAxis: n.stackAxis ?? undefined }
    : { translation: BABYLON.Vector3.Zero(), pivot: BABYLON.Vector3.Zero(), axis: BABYLON.Vector3.Up(), angle: 0 });
};
  ctx.pushTransform = pushTransform;


const buildInfluence = (n: NodeState): EditInfluence => {
  const dirs: number[] = [];
  const anchors: number[] = [];
  // Mode Auto : les poignées ne règlent que l'orientation de la rotation ; la portée part de la portée
  // minimale (toutes directions) et s'élargit.
  if (ctx.influence.reachMode === 'reach') for (const h of n.handles.values()) {
    const v = h.lockPoint ? h.lockPoint.subtract(n.anchor) : h.v;
    const reach = v.length();
    if (!(reach > 1e-6)) continue;
    const [x, y, z] = toKernel(v.scale(1 / reach));
    dirs.push(x, y, z, reach * n.reach.scale);
    if (h.lockPoint) {
      const [ax, ay, az] = toKernel(h.lockPoint);
      anchors.push(ax, ay, az, Math.max(ANCHOR_MIN_RADIUS_MM, ANCHOR_RADIUS_FRACTION * reach));
    }
  }
  return {
    ...ctx.influence,
    spatial: { ...ctx.influence.spatial, radiusMm: ctx.influence.spatial.radiusMm * n.reach.scale },
    dragDirection: Float64Array.from(toKernel(n.translation)),
    directions: Float64Array.from(dirs),
    anchors: Float64Array.from(anchors),
    trim: n.trimming ? { enabled: true, layers: ctx.influence.trimLayers } : undefined,
  };
};
  ctx.buildInfluence = buildInfluence;


/** Plus grande portée en cours du nœud (mm) : poignée la plus longue ou portée minimale, élargie. */
const maxReachOf = (n: NodeState) => {
  let reach = ctx.influence.spatial.radiusMm;
  if (ctx.influence.reachMode === 'reach') for (const h of n.handles.values()) reach = Math.max(reach, (h.lockPoint ? h.lockPoint.subtract(n.anchor) : h.v).length());
  return reach * n.reach.scale;
};


// Diagonale de l'objet (mm), mesurée une fois par fichier : borne de l'élargissement du mode Auto.
let extentOf: object | null = null;

let extent = 0;

const objectExtent = () => {
  const parsed = layer.getParsed();
  if (!parsed) return 0;
  if (extentOf !== parsed) {
    let rMax = 0, zMin = Infinity, zMax = -Infinity;
    // Polaire : X = rayon ; cartésien : X et Y recentrés sur le plateau.
    const cartesian = parsed.kind === 'cartesian';
    for (const m of parsed.moves) {
      const r = cartesian ? Math.hypot(m.x, m.y) : Math.abs(m.x);
      if (r > rMax) rMax = r;
      if (m.z < zMin) zMin = m.z;
      if (m.z > zMax) zMax = m.z;
    }
    extent = Math.hypot(2 * rMax, zMax > zMin ? zMax - zMin : 0);
    extentOf = parsed;
  }
  return extent;
};


// Poids : une requête en vol, la plus récente remplace celle qui attendait.
let weightsBusy = false;

let weightsDirty = false;

// Pendant la répétition d'une déformation par symétrie, le noyau sert aux copies : pas de poids du nœud actif.
ctx.symmetryBusy = false;

// Message important (résultat d'une symétrie, copie…) : le recalcul des poids ne l'efface pas avant 5 s.
ctx.heldUntil = 0;

const hold = (text: string) => { ctx.message = text; ctx.heldUntil = performance.now() + 5000; };
  ctx.hold = hold;

const requestWeights = () => {
  weightsDirty = true;
  void pumpWeights();
};
  ctx.requestWeights = requestWeights;

const pumpWeights = async () => {
  if (weightsBusy || !weightsDirty || ctx.symmetryBusy) return;
  const n = ctx.node;
  if (!n || ctx.status !== 'ready') { weightsDirty = false; return; }
  weightsBusy = true;
  weightsDirty = false;
  try {
    const res = await busy(editKernel.setHandle(n.index, buildInfluence(n)), false);
    if (ctx.node === n) {
      if (!('refused' in res)) {
        layer.setEditWeights(res.affected, res.weights, res.slideNormals, res.axes);
        n.affectedIdx = res.affected;
        n.dependentIdx = res.dependents;
        n.baseHeights = res.baseHeights;
        ctx.capacityMm = res.capacityMm;
        n.stackAxis = res.stackSign !== 0 ? fromKernel(res.handleAxis).normalize() : null;
        pushTransform(n);
        ctx.affected = res.affected.length;
        if (performance.now() > ctx.heldUntil) ctx.message = null;
        if (n.reach.growing) {
          // Plus aucun point gagné et la portée couvre tout l'objet : tout ce qui peut bouger bouge déjà.
          // (Sans gain mais plus courte que l'objet : un vide entre deux parties, on continue.)
          if (res.affected.length <= n.reach.affected && maxReachOf(n) >= objectExtent()) n.reach.saturated = true;
          n.reach.growing = false;
        }
        n.reach.affected = res.affected.length;
        // Nouvelle influence : le noyau a oublié la déformation en cours, la redemander.
        if (n.positionLocked && n.translation.lengthSquared() > 0) ctx.requestDelta(n);
      } else {
        layer.setEditWeights(null);
        ctx.capacityMm = null;
        ctx.affected = 0;
        ctx.message = REFUSAL_MESSAGES[res.refused];
      }
    }
  } catch (error) {
    ctx.message = error instanceof Error ? error.message : String(error);
  }
  weightsBusy = false;
  emit();
  void pumpWeights();
};


/** Valeurs validées du point (le champ `eRatio` y porte l'extrusion d'origine du segment). */
const originalOf = (index: number): EditDelta => {
  const parsed = layer.getParsed()!;
  const m = parsed.moves[index];
  return { r: m.x, c: m.y, z: m.z, b: m.b, eRatio: parsed.eDelta[index] };
};
  ctx.originalOf = originalOf;
}
