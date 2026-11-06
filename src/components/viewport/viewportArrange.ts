// Disposition automatique des modèles du plateau (utils/orcaArrange.ts) et verrouillage des modèles. Tout le plateau
// ou la sélection seule ; les modèles verrouillés et, pour « la sélection seule », les non-sélectionnés restent en place et
// servent d'obstacles. La disposition rend la main entre deux pièces : progression affichée au-delà de 400 ms, Échap annule,
// et rien ne bouge avant la fin (annuler ne laisse donc jamais le plateau à moitié rangé).
import * as BABYLON from 'babylonjs';
import { emitApex, onApex } from '@/events/apexEvents';
import { getArrangePrefs } from '@/utils/arrangePrefs';
import { ArrangeCancelled, arrangeAsync, type ArrangeInput, type ArrangeResult } from '@/utils/orcaArrange';
import { pushNotification, removeNotification } from '@/utils/notificationStore';
import { showSuccess, showWarning } from '@/utils/toast';
import { fixedFlags, lockToggleTarget, nothingToMove } from './arrangePlan';
import type { ViewportState } from './viewportState';

const PROGRESS_DELAY_MS = 400;
const PROGRESS_REFRESH_MS = 250;

const isLocked = (mesh: BABYLON.AbstractMesh): boolean => mesh.metadata?.apexLocked === true;

/** Contour du modèle (plan X/Z, mm) dans sa position actuelle. */
function worldOutline(mesh: BABYLON.AbstractMesh): { x: number; z: number }[] {
  mesh.computeWorldMatrix(true);
  const outline: { x: number; z: number }[] = [];
  const v = new BABYLON.Vector3();
  for (const m of [mesh, ...mesh.getChildMeshes()]) {
    const pos = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    if (!pos) continue;
    const world = m.getWorldMatrix();
    for (let i = 0; i < pos.length; i += 3) {
      BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(pos[i] ?? 0, pos[i + 1] ?? 0, pos[i + 2] ?? 0, world, v);
      outline.push({ x: v.x, z: v.z });
    }
  }
  return outline;
}

/** Pose un résultat de disposition sur son modèle ; faux si le modèle ne tient pas sur le plateau. */
function applyResult(mesh: BABYLON.AbstractMesh, r: ArrangeResult): boolean {
  if (r.fixed) return true;
  if (!r.center) return false;
  // Babylon tourne dans l'autre sens que orcaArrange (axe Y vers le haut, repère main gauche).
  if (Math.abs(r.angle) > 1e-9) mesh.rotate(BABYLON.Axis.Y, -r.angle, BABYLON.Space.WORLD);
  mesh.computeWorldMatrix(true);
  const b = mesh.getHierarchyBoundingVectors(true);
  mesh.position.x += r.center.x - (b.min.x + b.max.x) / 2;
  mesh.position.z += r.center.z - (b.min.z + b.max.z) / 2;
  mesh.computeWorldMatrix(true);
  return true;
}

/** Notification de progression : n'apparaît que si la disposition dure, se met à jour au plus 4 fois par seconde. */
function createProgress() {
  const startedAt = Date.now();
  let shownAt = 0;
  let id: string | null = null;
  return {
    update(done: number, total: number) {
      const now = Date.now();
      if (now - startedAt < PROGRESS_DELAY_MS || now - shownAt < PROGRESS_REFRESH_MS) return;
      if (id) removeNotification(id);
      id = pushNotification('loading', `Disposition automatique : ${done} / ${total} (Échap pour annuler)`);
      shownAt = now;
    },
    close() {
      if (id) removeNotification(id);
    },
  };
}

async function arrangeModels(st: ViewportState, selectedOnly: boolean, signal: AbortSignal) {
  const meshes = Array.from(st.modelsRef.current).filter((m) => !m.isDisposed());
  const fixed = fixedFlags(
    meshes.map((m) => ({ locked: isLocked(m), selected: st.selectedMeshesRef.current.has(m) })),
    selectedOnly,
  );
  if (nothingToMove(fixed)) {
    if (meshes.length > 0) showWarning(selectedOnly ? 'Aucun modèle sélectionné à disposer.' : 'Tous les modèles sont verrouillés.');
    return;
  }
  const prefs = getArrangePrefs();
  const inputs: ArrangeInput[] = meshes.map((mesh, i) => ({ outline: worldOutline(mesh), fixed: fixed[i] === true }));
  const progress = createProgress();
  try {
    const results = await arrangeAsync(
      inputs,
      { binRadius: st.RADIUS, spacing: prefs.spacingMm, allowRotations: prefs.allowRotations, alignToY: prefs.alignToY },
      { onProgress: (p) => progress.update(p.done, p.total), signal },
    );
    const skipped = results.filter((r, i) => !applyResult(meshes[i] as BABYLON.AbstractMesh, r)).length;
    if (skipped > 0) showWarning(`${skipped} modèle(s) ne tiennent pas sur le plateau et n'ont pas été déplacés.`);
    st.updateSelectedPosition();
  } finally {
    progress.close();
  }
}

function setupArrangeRunner(st: ViewportState) {
  let running: AbortController | null = null;
  let pending: boolean | null = null;
  const run = async (selectedOnly: boolean): Promise<void> => {
    if (running) {
      pending = selectedOnly;
      return;
    }
    const controller = new AbortController();
    running = controller;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') controller.abort();
    };
    window.addEventListener('keydown', onKey);
    try {
      await arrangeModels(st, selectedOnly, controller.signal);
    } catch (err) {
      if (err instanceof ArrangeCancelled) showWarning("Disposition automatique annulée : rien n'a bougé.");
      else throw err;
    } finally {
      window.removeEventListener('keydown', onKey);
      running = null;
      emitApex('apex-arrange-finished');
    }
    // Une demande arrivée pendant la disposition (ex. import enchaîné) repart ensuite.
    const next = pending;
    pending = null;
    if (next !== null) await run(next);
  };
  const offAll = onApex('apex-arrange-models', () => {
    void run(false);
  });
  const offSelection = onApex('apex-arrange-selection', () => {
    void run(true);
  });
  return () => {
    offAll();
    offSelection();
  };
}

function setupToggleLock(st: ViewportState) {
  return onApex('apex-toggle-lock-models', () => {
    const selected = Array.from(st.selectedMeshesRef.current).filter((m) => st.modelsRef.current.has(m));
    if (selected.length === 0) {
      showWarning("Sélectionnez d'abord un ou plusieurs modèles à verrouiller.");
      return;
    }
    const lock = lockToggleTarget(selected.map(isLocked));
    for (const m of selected) m.metadata = { ...(m.metadata ?? {}), apexLocked: lock };
    showSuccess(
      lock
        ? `${selected.length} modèle(s) verrouillé(s) : la disposition automatique les laisse en place.`
        : `${selected.length} modèle(s) déverrouillé(s).`,
    );
  });
}

export function setupViewportArrange(st: ViewportState) {
  const offArrange = setupArrangeRunner(st);
  const offLock = setupToggleLock(st);
  Object.assign(st, {
    offArrange: () => {
      offArrange();
      offLock();
    },
  });
}
