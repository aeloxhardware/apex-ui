// Issu de la découpe de createGCodeEditController (gcodeEditController.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (controllerState.ts).
import * as BABYLON from 'babylonjs';
import { LINE_TYPES } from '../../gcodeLineTypes';
import { editKernel, type EditSplice, type EditTransform } from '@/utils/editKernelClient';
import { insertMoves, removeMoves, remapMoveIndex } from '@/utils/gcodeSplice';
import { currentValues } from '../editJournal';
import { type ParsedGCode } from '../../gcodeParse';
import { REACH_GROWTH_MAX, REACH_GROWTH_MIN, type NodeState } from './controllerShared';
import type { EditControllerState } from './controllerState';

function setupSlideAlongToolpath(st: EditControllerState) {
  const { cssScale, emit, layer, nodes, originalOf, pick, project, requestWeights, unproject, updateView } = st;
  // --- glissement et validation -------------------------------------------------------------------

  /** Nœud déverrouillé : il suit le point de dépôt sous le curseur, sans rien déformer. */
  const slideAlongToolpath = (n: NodeState, x: number, y: number) => {
    const s = cssScale();
    const hit = pick(x / s, y / s);
    const parsed = layer.getParsed();
    if (!hit || !parsed) return;
    const index = Math.max(0, Math.min(parsed.moves.length - 1, Math.round(hit.t)));
    if (index === n.index) return;
    n.index = index;
    n.anchor = layer.getMoveTip(index, new BABYLON.Vector3());
    n.original = originalOf(index);
    st.delta = null;
    requestWeights();
    updateView(true);
    emit();
  };

  const togglePositionLock = (id: number) => {
    const n = nodes.get(id);
    if (!n) return;
    n.positionLocked = !n.positionLocked;
    updateView(true);
  };

  st.dragSeq = 0;
  st.lastDrag = null;
  const onNodeMove = (id: number, x: number, y: number) => {
    const n = st.node;
    // Un nœud réduit ne se déplace pas : un clic le reprend d'abord.
    if (!n || n.id !== id || st.status !== 'ready') return;
    if (!n.positionLocked) {
      slideAlongToolpath(n, x, y);
      return;
    }
    const depth = project(n.anchor).z;
    // Le noyau freine la translation près des limites d'épaisseur : le nœud et le shader suivent
    // la translation qu'il applique, dès sa réponse.
    n.translation = unproject(x, y, depth).subtract(n.anchor);
    st.requestDelta(n);
  };
  Object.assign(st, { togglePositionLock, onNodeMove });
}

function setupRequestDelta(st: EditControllerState) {
  const { emit, fromKernel, layer, pushTransform, requestWeights, scheduleLiveValidation, tipOfFirmware, transformOf, updatePreview, updateView } = st;
  /** Valeurs firmware exactes du point du nœud pour la déformation en cours (champs Δ). */
  const requestDelta = (n: NodeState): Promise<void> => {
    const seq = ++st.dragSeq;
    // Hauteurs demandées : E dépend de l'épaisseur (D3, recalcul dynamique) et l'aperçu de la nouvelle
    // hauteur de dépôt en vient ; trajets à vide : déformés aussi pendant le glissement.
    st.requestedAxialMm = n.stackAxis ? Math.abs(BABYLON.Vector3.Dot(n.translation, n.stackAxis)) : null;
    return editKernel.drag(transformOf(n), { heights: true, travel: true }).then((res) => {
      if (!res || st.node !== n || seq !== st.dragSeq) return;
      st.lastDrag = res;
      n.applied = fromKernel(res.appliedTranslation);
      n.rotation.applied = -res.appliedAngleRad;
      if (Math.abs(n.rotation.angle) > 1e-6) n.rotation.fraction = Math.max(0, Math.min(1, n.rotation.applied / n.rotation.angle));
      n.dragTip = tipOfFirmware(res.handle);
      // Sens changé le long de l'empilement : poids à répartir selon l'autre marge.
      if (res.rebuild && !n.reach.growing) {
        n.reach.growing = true;
        n.reach.saturated = false;
        n.reach.affected = 0;
        requestWeights();
        return;
      }
      // Mode Auto, portée recommandée trop courte pour la translation demandée : on la dépasse.
      if (st.influence.reachMode === 'auto' && res.limitScale !== null && res.limitScale < 1 &&
        !n.reach.growing && !n.reach.saturated) {
        const growth = Math.min(REACH_GROWTH_MAX, Math.max(REACH_GROWTH_MIN, 1 / Math.max(res.limitScale, 1e-6)));
        n.reach.scale *= growth;
        n.reach.growing = true;
        requestWeights();
      }
      pushTransform(n);
      updateView();
      const e0 = n.original.eRatio;
      st.delta = {
        r: res.handle[0] - n.original.r,
        c: res.handle[1] - n.original.c,
        z: res.handle[2] - n.original.z,
        b: res.handle[3] - n.original.b,
        eRatio: e0 > 0 ? res.handle[4] / e0 : NaN,
      };
      if (res.travelIndices && res.travelTips) {
        // Repère du noyau (x, y, z) → local (x, z, y).
        const tips = new Float32Array(res.travelTips.length);
        for (let i = 0; i + 2 < tips.length; i += 3) {
          tips[i] = res.travelTips[i]; tips[i + 1] = res.travelTips[i + 2]; tips[i + 2] = res.travelTips[i + 1];
        }
        layer.setTravelPreview(res.travelIndices, tips);
      }
      updatePreview(n, res);
      scheduleLiveValidation(n);
      emit();
    }).catch((): void => undefined);
  };
    st.requestDelta = requestDelta;
}

function setupApplyChange(st: EditControllerState) {
  const { clearPreviews, layer, nodes, pushTransform, refreshFileValidation, validateZone } = st;
  const applyChange = (indices?: Uint32Array, values?: Float64Array, trimmed?: Uint32Array, trimState?: boolean) => {
    // Même image : géométrie validée, déformation et poids remis à zéro (pas de saut visible).
    if (st.node) {
      st.node.translation = BABYLON.Vector3.Zero();
      st.node.applied = BABYLON.Vector3.Zero();
      st.node.dragTip = null;
      st.node.rotation.angle = 0;
      st.node.rotation.applied = 0;
      st.node.rotation.fraction = 1;
    }
    pushTransform(null);
    layer.setEditWeights(null);
    st.requestedAxialMm = null;
    // Trajets à vide d'abord (ils reprennent la géométrie validée), puis les valeurs validées.
    clearPreviews();
    if (indices && values) layer.applyMoveEdits(indices, values, trimmed, trimState);
    // Tous les nœuds, réduits compris, restent sur leur point de trajectoire.
    for (const m of nodes.values()) m.anchor = layer.getMoveTip(m.index, new BABYLON.Vector3());
  };

  /** Après une modification validée : limites de B du fichier, collisions et normales de la zone. */
  const afterEdit = async (indices?: Uint32Array) => {
    await refreshFileValidation();
    await validateZone(indices);
  };

  const onNodeMoveEnd = (id: number) => {
    const n = st.node;
    if (n && n.id === id && n.positionLocked) st.commitNode(n);
  };

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
  Object.assign(st, { applyChange, afterEdit, onNodeMoveEnd, newGroupId, syncKernelMoves });
}

function setupApplySplice(st: EditControllerState) {
  const { layer, nodes, refreshLocks, syncKernelMoves } = st;
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
    st.liveB = null;
    st.judgedSet = null;
    await layer.replaceMoves(parsed);
    await syncKernelMoves(parsed);
    for (const m of nodes.values()) m.anchor = layer.getMoveTip(m.index, new BABYLON.Vector3());
    void refreshLocks();
  };
  Object.assign(st, { applySplice });
}

function setupCommitNode(st: EditControllerState) {
  const { afterEdit, applyChange, applySplice, buildInfluence, busy, emit, journalCommit, layer, newGroupId, originalOf, requestWeights, toKernel, transformOf, updateView } = st;
  /** Valide la déformation en cours (translation du nœud et rotation des poignées). */
  const commitNode = (n: NodeState) => {
    if (st.status !== 'ready') return;
    st.dragSeq++;
    window.clearTimeout(st.validateTimer);
    st.validateSeq++;
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
    st.committing = true;
    void busy(editKernel.commit(transform)).then(async (change) => {
      if (st.node !== n) return;
      st.undoDepth = change.undoDepth;
      st.redoDepth = change.redoDepth;
      // Re-tranchage : des couches sont insérées (indices de `change` = état avec elles).
      if (change.ok && change.splice?.inserted) await applySplice(change.splice);
      const parsed = layer.getParsed();
      if (change.ok && change.indices && change.values && parsed && !parsed.insertedBlocks?.length) {
        // Valeurs d'avant lues AVANT d'appliquer la modification au G-code affiché.
        const before = currentValues(parsed, change.indices);
        void journalCommit(parsed, {
          node: nodeIndex, transform: journalTransform, influence: influenceUsed,
          indices: change.indices, before, after: change.values, trimmed: change.trimmed,
          group: st.symmetry.mode !== 'none' ? group : undefined,
        });
        st.undoGroups.push(1);
        st.redoGroups = [];
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
        if (st.symmetry.mode !== 'none') await st.applySymmetry(journalTransform, influenceUsed, anchorKernel, group);
        void afterEdit(change.indices);
      }
    }).catch((error) => {
      if (import.meta.env.DEV) console.error('[édition] validation :', error);
      st.message = error instanceof Error ? error.message : String(error);
      emit();
    }).finally(() => { st.committing = false; });
  };
    st.commitNode = commitNode;
}

export function setupEditControllerDrag(st: EditControllerState) {
  setupSlideAlongToolpath(st);
  setupRequestDelta(st);
  setupApplyChange(st);
  setupApplySplice(st);
  setupCommitNode(st);
}
