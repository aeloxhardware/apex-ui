import * as BABYLON from 'babylonjs';
import type { ViewportCtx } from './context';

/** Survol et clic sur les boutons d'action du plateau. */
export function setupPlateActionsInput(c: ViewportCtx) {
  const { plateActionButtons, glassDiscMat, PLATE_ACTION_OUTLINE_ALPHA, plateActionHoverMat, plateActions, canvas, plateActionRoot, scene, onPlateActionModeChanged, onPlateActionPreviewToggled, onGCodePreviewToggled, onGCodeLoaded, onGCodePickMode, gcodePickObserver, onGCodeTime, onGCodeLineVisibility, onGCodeHighlightOffPlate, onGCodeShowFullHead, onGCodeColorBy, onGCodeRenderPrecision, editController, airCallout, gcodeLayer, setPlateActionHint, plateImportInputRef, setEditController } = c;


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
        window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: { title: action.title, desc: action.description } }));
      } else {
        window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));
      }
      plateActionHovered = index;
      canvas.style.cursor = index !== null ? 'pointer' : '';
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
      case 1: window.dispatchEvent(new CustomEvent('apex-select-all-models')); break;
      case 2: window.dispatchEvent(new CustomEvent('apex-arrange-models')); break;
      case 3: window.dispatchEvent(new CustomEvent('apex-delete-all-models')); break;
    }
  };

  const PLATE_ACTION_CLICK_THRESHOLD_PX = 5;

  let plateActionDown: { index: number; x: number; y: number } | null = null;

  const plateActionPointerObserver = scene.onPointerObservable.add((pointerInfo) => {
    const evt = pointerInfo.event as PointerEvent;
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      const index = evt.buttons === 0 ? pickPlateAction() : null;
      setPlateActionHovered(index, evt.clientX, evt.clientY);
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN && evt.button === 0) {
      const index = pickPlateAction();
      plateActionDown = index !== null ? { index, x: evt.clientX, y: evt.clientY } : null;
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP && evt.button === 0) {
      const down = plateActionDown;
      plateActionDown = null;
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
  c.disposePlateActions = disposePlateActions;
}
