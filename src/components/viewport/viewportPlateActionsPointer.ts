// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';
import type { ViewportState } from './viewportState';

import { emitApex } from '@/events/apexEvents';
function setupSetPlateActionHovered(st: ViewportState) {
  const { PLATE_ACTION_OUTLINE_ALPHA, canvas, glassDiscMat, plateActionButtons, plateActionHoverMat, plateActionRoot, plateActions, plateImportInputRef, scene, setPlateActionHint } = st;
  let plateActionHovered: number | null = null;
  let plateActionHintShown = false;
  const setPlateActionHovered = (index: number | null, clientX = 0, clientY = 0) => {
    if (index !== plateActionHovered) {
      if (plateActionHovered !== null) {
        const prev = plateActionButtons[plateActionHovered];
        prev.mesh.material = glassDiscMat;
        prev.outline.material!.alpha = PLATE_ACTION_OUTLINE_ALPHA;
        prev.iconMat.alpha = 0.8;
      }
      if (index !== null) {
        const next = plateActionButtons[index];
        next.mesh.material = plateActionHoverMat;
        next.outline.material!.alpha = 1;
        next.iconMat.alpha = 1;
        const action = plateActions[index];
        emitApex('apex-set-tooltip', { title: action.title, desc: action.description });
      } else {
        emitApex('apex-reset-tooltip');
      }
      plateActionHovered = index;
      // Curseur « main » par attribut + règle CSS !important (globals.css) : plusieurs fonctions (extrusion, gizmos,
      // croquis) écrivent `canvas.style.cursor` à chaque survol et effaçaient la main, bouton pourtant surligné.
      if (index !== null) canvas.setAttribute('data-apex-plate-action-hover', '');
      else canvas.removeAttribute('data-apex-plate-action-hover');
    }
    // L'étiquette suit le curseur tant qu'un bouton est survolé ; hors survol, on ne touche
    // plus à l'état React pour ne pas re-rendre à chaque mouvement de souris.
    if (index !== null) setPlateActionHint({ title: plateActions[index].title, x: clientX, y: clientY });
    else if (plateActionHintShown) setPlateActionHint(null);
    plateActionHintShown = index !== null;
  };
  const pickPlateAction = () => {
    if (!plateActionRoot.isEnabled()) return null;
    const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m.name.startsWith('plateAction') && m.isPickable);
    if (!pick?.hit || !pick.pickedMesh) return null;
    const index = plateActionButtons.findIndex((b) => b.mesh === pick.pickedMesh);
    return index >= 0 ? index : null;
  };
  const runPlateAction = (index: number) => {
    switch (index) {
      case 0: plateImportInputRef.current?.click(); break;
      case 1: emitApex('apex-select-all-models'); break;
      case 2: emitApex('apex-arrange-models'); break;
      case 3: emitApex('apex-delete-all-models'); break;
    }
  };
  const PLATE_ACTION_CLICK_THRESHOLD_PX = 5;
  st.plateActionDown = null;
  Object.assign(st, { setPlateActionHovered, pickPlateAction, runPlateAction,
    PLATE_ACTION_CLICK_THRESHOLD_PX });
}

function setupDisposePlateActions(st: ViewportState) {
  const { PLATE_ACTION_CLICK_THRESHOLD_PX, airCallout, canvas, editController, gcodeLayer, gcodePickObserver, onGCodeColorBy, onGCodeHighlightOffPlate, onGCodeLineVisibility, onGCodeLoaded, onGCodePickMode, onGCodePreviewToggled, onGCodeRenderPrecision, onGCodeShowFullHead, onGCodeTime, onPlateActionModeChanged, onPlateActionPreviewToggled, pickPlateAction, runPlateAction, scene, setEditController, setPlateActionHovered } = st;
  const plateActionPointerObserver = scene.onPointerObservable.add((pointerInfo) => {
    const evt = pointerInfo.event as PointerEvent;
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      const index = evt.buttons === 0 ? pickPlateAction() : null;
      setPlateActionHovered(index, evt.clientX, evt.clientY);
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN && evt.button === 0) {
      const index = pickPlateAction();
      st.plateActionDown = index !== null ? { index, x: evt.clientX, y: evt.clientY } : null;
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP && evt.button === 0) {
      const down = st.plateActionDown;
      st.plateActionDown = null;
      if (!down || Math.hypot(evt.clientX - down.x, evt.clientY - down.y) > PLATE_ACTION_CLICK_THRESHOLD_PX) return;
      if (pickPlateAction() === down.index) runPlateAction(down.index);
    }
  });
  const disposePlateActions = () => {
    window.removeEventListener('apex-mode-changed', onPlateActionModeChanged);
    window.removeEventListener('apex-preview-toggled', onPlateActionPreviewToggled);
    scene.onPointerObservable.remove(plateActionPointerObserver);
    window.removeEventListener('apex-preview-toggled', onGCodePreviewToggled);
    window.removeEventListener('apex-gcode-loaded', onGCodeLoaded);
    window.removeEventListener('apex-gcode-pick-mode', onGCodePickMode);
    scene.onPointerObservable.remove(gcodePickObserver);
    canvas.style.cursor = '';
    canvas.removeAttribute('data-apex-plate-action-hover');
    window.removeEventListener('apex-gcode-time', onGCodeTime);
    window.removeEventListener('apex-gcode-line-visibility', onGCodeLineVisibility);
    window.removeEventListener('apex-gcode-highlight-offplate', onGCodeHighlightOffPlate);
    window.removeEventListener('apex-gcode-show-full-head', onGCodeShowFullHead);
    window.removeEventListener('apex-gcode-color-by', onGCodeColorBy);
    window.removeEventListener('apex-gcode-render-precision', onGCodeRenderPrecision);
    editController.dispose();
    setEditController(null);
    airCallout.dispose();
    gcodeLayer.dispose();
  };
  Object.assign(st, { disposePlateActions });
}

export function setupViewportPlateActionsPointer(st: ViewportState) {
  setupSetPlateActionHovered(st);
  setupDisposePlateActions(st);
}
