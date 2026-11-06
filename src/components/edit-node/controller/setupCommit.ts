import type { ParsedGCode } from '../../gcodeParse';
import { LINE_TYPES } from '../../gcodeLineTypes';
import { editKernel, EditSplice, EditTransform } from '@/utils/editKernelClient';
import { remapMoveIndex, insertMoves, removeMoves } from '@/utils/gcodeSplice';
import * as BABYLON from 'babylonjs';
import { NodeState } from './shared';
import type { EditCtx } from './context';

/** Validation d'une modification, re-tranchage en place (couches insérées). */
export function setupCommit(ctx: EditCtx) {
  const { layer, nodes, refreshLocks, transformOf, toKernel, buildInfluence, busy, currentValues, journalCommit, applyChange, originalOf, requestWeights, updateView, emit, afterEdit } = ctx;


const newGroupId = () => `g${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;


// --- re-tranchage : couches interpolées insérées dans la trajectoire, en place -----------------------------

/** Temps machine et types de ligne par mouvement, à redonner au noyau après une insertion de points. */
const syncKernelMoves = async (parsed: ParsedGCode) => {
  const typeIndex = new Map<string, number>(LINE_TYPES.map((t, i) => [t.id, i]));
  const types = new Uint8Array(parsed.moves.length);
  parsed.moves.forEach((m, k) => { types[k] = typeIndex.get(m.type) ?? 0; });
  await editKernel.setTypes(types);
  await editKernel.setTimes(Float64Array.from(parsed.times));
};


/** Points insérés ou retirés par le noyau (re-tranchage) : le G-code affiché, le calque 3D et les nœuds suivent,
 * sans réécrire ni relire le fichier. À l'insertion, avant d'appliquer les valeurs ; au retrait, après. */
const applySplice = async (splice: EditSplice) => {
  const parsed = layer.getParsed();
  if (!parsed || splice.blocks.length === 0) return;
  const length = parsed.moves.length;
  for (const m of nodes.values()) {
    const k = remapMoveIndex(m.index, splice.blocks, splice.inserted, length);
    m.index = k >= 0 ? k : Math.max(0, splice.blocks[0].at - 1);
  }
  if (splice.inserted) insertMoves(parsed, splice.blocks);
  else removeMoves(parsed, splice.blocks);
  // Le journal du fichier décrivait l'ancienne numérotation (et n'est plus écrit tant que des plages sont insérées).
  parsed.editJournal = { undo: [], redo: [] };
  ctx.liveB = null;
  ctx.judgedSet = null;
  await layer.replaceMoves(parsed);
  await syncKernelMoves(parsed);
  for (const m of nodes.values()) m.anchor = layer.getMoveTip(m.index, new BABYLON.Vector3());
  void refreshLocks();
};
  ctx.applySplice = applySplice;


/** Valide la déformation en cours (translation du nœud et rotation des poignées). */
const commitNode = (n: NodeState) => {
  if (ctx.status !== 'ready') return;
  ctx.dragSeq++;
  window.clearTimeout(ctx.validateTimer);
  ctx.validateSeq++;
  // Instantané pour le journal : transformation et influence de cette validation.
  const transform = transformOf(n);
  // Journal : la translation et l'angle appliqués (freinés), pas ceux demandés par le pointeur.
  const journalTransform: EditTransform = {
    ...transform,
    translation: Float64Array.from(toKernel(n.applied)),
    angleRad: -n.rotation.applied,
  };
  const influenceUsed = buildInfluence(n);
  const nodeIndex = n.index;
  const anchorKernel = toKernel(n.anchor);
  const group = newGroupId();
  ctx.committing = true;
  void busy(editKernel.commit(transform)).then(async (change) => {
    if (ctx.node !== n) return;
    ctx.undoDepth = change.undoDepth;
    ctx.redoDepth = change.redoDepth;
    // Re-tranchage : des couches sont insérées (indices de `change` = état avec elles).
    if (change.ok && change.splice?.inserted) await applySplice(change.splice);
    const parsed = layer.getParsed();
    if (change.ok && change.indices && change.values && parsed && !parsed.insertedBlocks?.length) {
      // Valeurs d'avant lues AVANT d'appliquer la modification au G-code affiché.
      const before = currentValues(parsed, change.indices);
      void journalCommit(
        parsed, nodeIndex, journalTransform, influenceUsed, change.indices, before, change.values,
        change.trimmed, ctx.symmetry.mode !== 'none' ? group : undefined,
      );
      ctx.undoGroups.push(1);
      ctx.redoGroups = [];
    }
    applyChange(
      change.ok ? change.indices : undefined, change.ok ? change.values : undefined,
      change.ok ? change.trimmed : undefined, change.ok ? change.trimState : undefined,
    );
    n.original = originalOf(n.index);
    // Validée : la portée revient à celle que recommandent les poignées.
    n.reach = { scale: 1, growing: false, saturated: false, affected: 0 };
    requestWeights();
    updateView(true);
    emit();
    if (change.ok) {
      if (ctx.symmetry.mode !== 'none') await ctx.applySymmetry(journalTransform, influenceUsed, anchorKernel, group);
      void afterEdit(change.indices);
    }
  }).catch((error) => {
    if (import.meta.env.DEV) console.error('[édition] validation :', error);
    ctx.message = error instanceof Error ? error.message : String(error);
    emit();
  }).finally(() => { ctx.committing = false; });
};
  ctx.commitNode = commitNode;
}
