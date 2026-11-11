// Historique des modèles du plateau (Ctrl+Z / Ctrl+Y) et SEUL point de passage de leur création et
// de leur suppression : plateau, arborescence et bouton SLICE se tiennent ainsi toujours d'accord.
//
// Trois sortes d'entrées : création, suppression, et déplacement/rotation/échelle/unité (« pose »).
//
// Un modèle supprimé n'est pas détruit tout de suite : il est retiré du plateau (`modelsRef`),
// masqué, et annoncé à l'interface (`apex-mesh-deleted` → arborescence). Ctrl+Z le remet et
// l'annonce de nouveau. Il n'est réellement `dispose`é que lorsqu'il sort de l'historique.
//
// Les poses ne sont pas enregistrées geste par geste : après tout ce qui peut bouger un modèle
// (relâchement de la souris, saisie numérique, rangement, changement d'unité), on attend que plus rien
// ne bouge (la chute d'un modèle lâché dure un moment) puis on compare à la dernière pose connue.
import type * as BABYLON from 'babylonjs';
import { emitApex, onApex } from '@/events/apexEvents';
import { isPreviewSpace } from '@/utils/previewSpace';
import { applyPose, capturePose, poseChanged, type Pose } from './viewportPoses';
import { clearSelection, describeSubMeshes } from './viewportSelectionActions';
import type { ViewportState } from './viewportState';

const HISTORY_LIMIT = 30;
const SETTLE_TICK_MS = 150;
const SETTLE_MAX_TICKS = 20;

type HistoryEntry = { kind: 'create' | 'delete'; meshes: BABYLON.AbstractMesh[] } | { kind: 'transform'; before: Pose[]; after: Pose[] };

export interface ModelHistory {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  /** Dernière pose connue de chaque modèle du plateau. */
  baseline: Map<BABYLON.AbstractMesh, Pose>;
  settleTimer: ReturnType<typeof setTimeout> | null;
}

function createModelHistory(): ModelHistory {
  return { undo: [], redo: [], baseline: new Map(), settleTimer: null };
}

/** Détruit pour de bon les modèles d'une entrée qui sont encore retirés du plateau. */
function discardEntry(st: ViewportState, entry: HistoryEntry) {
  if (entry.kind === 'transform') return;
  entry.meshes.forEach((mesh) => {
    if (!st.modelsRef.current.has(mesh) && !mesh.isDisposed()) mesh.dispose();
  });
}

function pushEntry(st: ViewportState, entry: HistoryEntry) {
  const { redo, undo } = st.modelHistory;
  redo.splice(0).forEach((e) => discardEntry(st, e));
  undo.push(entry);
  const evicted = undo.length > HISTORY_LIMIT ? undo.shift() : undefined;
  if (evicted) discardEntry(st, evicted);
}

/** L'interface (bouton SLICE) relit la liste réelle des modèles du plateau. */
function syncModelList() {
  emitApex('apex-request-slice-models');
}

// --- Poses -------------------------------------------------------------------------------------

/** Aligne la liste des poses connues sur les modèles du plateau (nouveaux : pose actuelle). */
function syncBaseline(st: ViewportState) {
  const { baseline } = st.modelHistory;
  const models = st.modelsRef.current;
  baseline.forEach((_, mesh) => {
    if (!models.has(mesh)) baseline.delete(mesh);
  });
  models.forEach((mesh) => {
    if (!baseline.has(mesh)) baseline.set(mesh, capturePose(mesh));
  });
}

/** Modèles dont la pose actuelle diffère de la dernière pose connue. */
function changedPoses(st: ViewportState): { before: Pose[]; after: Pose[] } {
  const before: Pose[] = [];
  const after: Pose[] = [];
  st.modelHistory.baseline.forEach((known, mesh) => {
    if (mesh.isDisposed() || !st.modelsRef.current.has(mesh)) return;
    const now = capturePose(mesh);
    if (!poseChanged(known, now)) return;
    before.push(known);
    after.push(now);
  });
  return { before, after };
}

function commitTransforms(st: ViewportState) {
  const h = st.modelHistory;
  if (h.settleTimer) clearTimeout(h.settleTimer);
  h.settleTimer = null;
  const { before, after } = changedPoses(st);
  if (before.length === 0) return;
  after.forEach((pose) => h.baseline.set(pose.mesh, pose));
  pushEntry(st, { kind: 'transform', before, after });
}

/** Enregistre le déplacement une fois que plus rien ne bouge (au plus ~3 s). */
function scheduleSettle(st: ViewportState) {
  const h = st.modelHistory;
  if (h.settleTimer) clearTimeout(h.settleTimer);
  let ticks = 0;
  let previous = changedPoses(st).after;
  const tick = () => {
    const current = changedPoses(st).after;
    const moving =
      current.length !== previous.length ||
      current.some((p, i) => {
        const prev = previous[i];
        return !prev || prev.mesh !== p.mesh || poseChanged(prev, p);
      });
    if (moving && ticks++ < SETTLE_MAX_TICKS) {
      previous = current;
      h.settleTimer = setTimeout(tick, SETTLE_TICK_MS);
      return;
    }
    commitTransforms(st);
  };
  h.settleTimer = setTimeout(tick, SETTLE_TICK_MS);
}

function applyPoses(st: ViewportState, poses: Pose[]) {
  poses.forEach((pose) => {
    applyPose(pose);
    st.modelHistory.baseline.set(pose.mesh, pose);
  });
  st.updateHighlight();
  st.updateSelectedPosition();
  st.updateSelectedRotation();
  st.emitTransformState();
}

// --- Création / suppression --------------------------------------------------------------------

function hide(st: ViewportState, meshes: BABYLON.AbstractMesh[]) {
  const { modelsRef, selectedMeshesRef } = st;
  meshes.forEach((mesh) => {
    if (!modelsRef.current.has(mesh)) return;
    modelsRef.current.delete(mesh);
    selectedMeshesRef.current.delete(mesh);
    mesh.setEnabled(false);
    emitApex('apex-mesh-deleted', { name: mesh.name });
  });
  syncBaseline(st);
  clearSelection(st);
  // Plus de modèle visé : l'outil actif (Déplacer, Pivoter, Échelle…) n'a plus d'objet et se ferme.
  if (st.currentToolRef.current !== 'select') emitApex('apex-tool-changed', { tool: 'select' });
  syncModelList();
}

function show(st: ViewportState, meshes: BABYLON.AbstractMesh[]) {
  const { modelsRef, selectedMeshesRef, setSelectedMeshName, updateHighlight } = st;
  const back = meshes.filter((mesh) => !mesh.isDisposed());
  back.forEach((mesh) => {
    mesh.setEnabled(true);
    modelsRef.current.add(mesh);
    // Annoncé un par un pour que l'arborescence retrouve chaque corps.
    emitApex('apex-mesh-selected', { name: mesh.name, subMeshes: describeSubMeshes(mesh) });
  });
  syncBaseline(st);
  selectedMeshesRef.current = new Set(back);
  const last = back[back.length - 1];
  setSelectedMeshName(last ? last.name : null);
  updateHighlight();
  if (last) {
    emitApex('apex-mesh-selected', { name: last.name, names: back.map((m) => m.name), subMeshes: describeSubMeshes(last) });
  }
  syncModelList();
}

/** Supprime ces modèles (plateau + arborescence + SLICE) ; Ctrl+Z les ramène. */
export function removeModels(st: ViewportState, meshes: BABYLON.AbstractMesh[]) {
  commitTransforms(st);
  const present = meshes.filter((mesh) => st.modelsRef.current.has(mesh));
  if (present.length === 0) return;
  hide(st, present);
  pushEntry(st, { kind: 'delete', meshes: present });
}

/** Historique d'un ou plusieurs modèles déjà posés sur le plateau (import, collage) : Ctrl+Z les retire. */
export function recordCreatedModels(st: ViewportState, meshes: BABYLON.AbstractMesh[]) {
  commitTransforms(st);
  syncBaseline(st);
  pushEntry(st, { kind: 'create', meshes });
}

/** Enregistre un modèle fraîchement créé (primitive) : plateau, arborescence, SLICE et historique. */
export function registerCreatedModel(st: ViewportState, mesh: BABYLON.AbstractMesh) {
  const { modelsRef, selectedMeshesRef, setSelectedMeshName, updateHighlight } = st;
  modelsRef.current.add(mesh);
  selectedMeshesRef.current = new Set([mesh]);
  setSelectedMeshName(mesh.name);
  updateHighlight();
  emitApex('apex-mesh-selected', { name: mesh.name, names: [mesh.name], subMeshes: describeSubMeshes(mesh) });
  syncModelList();
  recordCreatedModels(st, [mesh]);
}

/** Nom unique pour une primitive (« Boîte 3 ») : jamais réutilisé, même après suppression. */
export function nextPrimitiveName(st: ViewportState, label: string): string {
  const next = (st.primitiveCounters[label] ?? 0) + 1;
  st.primitiveCounters[label] = next;
  return `${label} ${next}`;
}

// --- Ctrl+Z / Ctrl+Y ---------------------------------------------------------------------------

function applyEntry(st: ViewportState, entry: HistoryEntry, direction: 'undo' | 'redo') {
  if (entry.kind === 'transform') {
    applyPoses(st, direction === 'undo' ? entry.before : entry.after);
    return;
  }
  const removing = (entry.kind === 'create') === (direction === 'undo');
  if (removing) hide(st, entry.meshes);
  else show(st, entry.meshes);
}

function isGone(entry: HistoryEntry): boolean {
  const meshes = entry.kind === 'transform' ? entry.before.map((p) => p.mesh) : entry.meshes;
  return meshes.every((m) => m.isDisposed());
}

function step(st: ViewportState, direction: 'undo' | 'redo') {
  commitTransforms(st); // un geste tout juste terminé doit pouvoir être annulé
  const { redo, undo } = st.modelHistory;
  const from = direction === 'undo' ? undo : redo;
  const to = direction === 'undo' ? redo : undo;
  // Une entrée dont les modèles ont déjà disparu (détruits ailleurs) est sautée.
  for (let entry = from.pop(); entry; entry = from.pop()) {
    if (isGone(entry)) continue;
    applyEntry(st, entry, direction);
    to.push(entry);
    return;
  }
}

/** Ctrl+Z → annuler ; Ctrl+Y ou Ctrl+Maj+Z → rétablir ; rien dans un champ de saisie. */
function historyKeyAction(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey)) return null;
  const target = e.target as HTMLElement | null;
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  return key === 'y' ? 'redo' : null;
}

export function setupViewportHistory(st: ViewportState) {
  st.modelHistory = createModelHistory();
  st.primitiveCounters = {};

  const onHistoryKey = (e: KeyboardEvent) => {
    const action = historyKeyAction(e);
    if (!action || isPreviewSpace()) return;
    e.preventDefault();
    step(st, action);
  };
  const onPointerUp = () => scheduleSettle(st);

  // Tout ce qui peut bouger un modèle : on compare ensuite les poses.
  const offTransformSet = onApex('apex-transform-set', () => scheduleSettle(st));
  const offArrange = onApex('apex-arrange-finished', () => scheduleSettle(st));
  const offUnit = onApex('apex-set-model-unit', () => scheduleSettle(st));
  const offHistory = () => {
    offTransformSet();
    offArrange();
    offUnit();
    if (st.modelHistory.settleTimer) clearTimeout(st.modelHistory.settleTimer);
  };

  window.addEventListener('keydown', onHistoryKey);
  window.addEventListener('pointerup', onPointerUp);
  Object.assign(st, { offHistory, onHistoryKey, onHistoryPointerUp: onPointerUp });
}
