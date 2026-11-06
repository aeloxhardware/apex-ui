// Issu de la découpe de createGCodeEditController (gcodeEditController.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (controllerState.ts).
import * as BABYLON from 'babylonjs';
import { editKernel } from '@/utils/editKernelClient';
import { type HandleDragEvent } from '../EditNode';
import { rotateAbout, wrapPi } from './controllerShared';
import type { EditControllerState } from './controllerState';

function setupScreenAngle(st: EditControllerState) {
  // --- rotation par les poignées (D2) -------------------------------------------------------------
  // Comme une tangente de Bézier : l'angle dont tourne la poignée saisie autour du nœud, dans le plan
  // face à la caméra, fait tourner la déformation. Glisser seul tourne aussi le sens de l'influence
  // (les autres poignées non verrouillées tournent avec) ; Ctrl : rotation seule ; Alt : influence
  // seule. Seulement nœud verrouillé (déverrouillé, on choisit son point) et poignée non ancrée.
  const MIN_LEVER_PX = 8;
  st.handleDrag = null;
  const screenAngle = (dx: number, dy: number) => Math.atan2(-dy, dx);
  Object.assign(st, { MIN_LEVER_PX, screenAngle });
}

function setupOnHandleDrag(st: EditControllerState) {
  const { MIN_LEVER_PX, camera, commitNode, layer, nodeLocal, project, pushTransform, requestDelta, requestWeights, screenAngle, unproject, updateView } = st;
  const onHandleDrag = (nodeId: number, e: HandleDragEvent) => {
    const n = st.node;
    if (!n || n.id !== nodeId) return;
    if (e.phase === 'start') {
      const center = nodeLocal(n);
      const screen = project(center);
      if (n.rotation.angle === 0) {
        const camLocal = BABYLON.Vector3.TransformCoordinates(
          camera.globalPosition, layer.getPlateWorldMatrix().clone().invert(),
        );
        n.rotation.axis = camLocal.subtract(center).normalize();
      }
      // Sens : une petite rotation positive autour de l'axe tourne-t-elle la poignée dans le sens
      // trigonométrique à l'écran ? (dépend de la main du repère et du côté de la caméra)
      const v = unproject(screen.x + e.dx, screen.y + e.dy, screen.z).subtract(center);
      const p1 = project(center.add(v));
      const p2 = project(center.add(rotateAbout(v, n.rotation.axis, 0.01)));
      const turn = wrapPi(screenAngle(p2.x - screen.x, p2.y - screen.y) - screenAngle(p1.x - screen.x, p1.y - screen.y));
      st.handleDrag = { id: e.id, lastAngle: screenAngle(e.dx, e.dy), sign: turn < 0 ? -1 : 1, mode: e.mode, rotated: false };
      return;
    }
    const drag = st.handleDrag;
    if (!drag || drag.id !== e.id) return;
    drag.mode = e.mode;
    const angleNow = screenAngle(e.dx, e.dy);
    const turn = wrapPi(angleNow - drag.lastAngle);
    drag.lastAngle = angleNow;
    const lever = Math.hypot(e.dx, e.dy) >= MIN_LEVER_PX;
    // Mode Auto : pas d'ancrage, une poignée verrouillée en Portée tourne comme les autres.
    const anchored = e.locked && st.influence.reachMode !== 'auto';
    if (e.phase === 'move' && n.positionLocked && !anchored && lever && e.mode !== 'influence' && turn !== 0) {
      const a = turn * drag.sign;
      n.rotation.angle += a;
      n.rotation.applied = n.rotation.angle * n.rotation.fraction;
      drag.rotated = true;
      if (e.mode === 'both') {
        for (const [id, h] of n.handles) {
          if (id !== e.id && !h.lockPoint) h.v = rotateAbout(h.v, n.rotation.axis, a);
        }
        requestWeights();
      }
      pushTransform(n);
      updateView(true);
      requestDelta(n);
    }
    if (e.phase === 'end') {
      st.handleDrag = null;
      if (drag.rotated && n.positionLocked) commitNode(n);
      else updateView(true);
    }
  };
  Object.assign(st, { onHandleDrag });
}

function setupHistoryStep(st: EditControllerState) {
  const { afterEdit, applyChange, applySplice, busy, emit, journalStep, layer, originalOf, requestWeights, updateView } = st;
  let historyBusy = false;
  const historyStep = (step: 'undo' | 'redo') => {
    if (st.status !== 'ready' || historyBusy || st.committing) return;
    // Une validation et ses copies par symétrie ne font qu'une étape.
    const groups = step === 'undo' ? st.undoGroups : st.redoGroups;
    const other = step === 'undo' ? st.redoGroups : st.undoGroups;
    const depth = step === 'undo' ? st.undoDepth : st.redoDepth;
    const count = Math.max(1, Math.min(groups.length ? groups[groups.length - 1] : 1, depth || 1));
    historyBusy = true;
    void busy((async () => {
      let touched: Uint32Array | undefined;
      let done = 0;
      for (let i = 0; i < count; i++) {
        const change = await (step === 'undo' ? editKernel.undo() : editKernel.redo());
        st.undoDepth = change.undoDepth;
        st.redoDepth = change.redoDepth;
        if (!change.ok) break;
        done++;
        // Couches inserées : rétablir les remet avant les valeurs, annuler les retire après.
        if (change.splice?.inserted) await applySplice(change.splice);
        const parsed = layer.getParsed();
        if (parsed) journalStep(parsed, step);
        applyChange(change.indices, change.values, change.trimmed, change.trimState);
        if (change.splice && !change.splice.inserted) await applySplice(change.splice);
        if (change.indices?.length) touched = change.indices;
      }
      if (done > 0) {
        groups.pop();
        other.push(done);
      }
      return touched;
    })()).then((touched) => {
      historyBusy = false;
      if (st.node) {
        st.node.original = originalOf(st.node.index);
        st.delta = null;
        requestWeights();
      }
      updateView(true);
      emit();
      void afterEdit(touched);
    }).catch(() => { historyBusy = false; });
  };
  Object.assign(st, { historyStep });
}

export function setupEditControllerHistory(st: EditControllerState) {
  setupScreenAngle(st);
  setupOnHandleDrag(st);
  setupHistoryStep(st);
}
