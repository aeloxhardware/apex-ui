// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import { PAN_PERSPECTIVE_EVENT } from '@/utils/panPerspectivePrefs';
import type { ViewportState } from './viewportState';

function disposeEngine(st: ViewportState) {
  const { engine, engineRef, gizmoManager, gizmoManagerRef, hlRef, orcaRotateGizmo, orcaScaleGizmo, renderPipeline, scene, sceneRef, unsubscribeShading } = st;
  unsubscribeShading();
  if (st.disposed) return;
  renderPipeline?.dispose();
  orcaRotateGizmo.dispose();
  orcaScaleGizmo.dispose();
  gizmoManager.dispose();
  scene.dispose();
  engine.dispose();

  engineRef.current = null;
  sceneRef.current = null;
  gizmoManagerRef.current = null;
  hlRef.current = null;
}

function removeExtrudeAndCameraListeners(st: ViewportState) {
  const { canvas, commitExtrudeBody, contextMenuPointerObserver, disposePlateActions, gridZoomObserver, handleCustomView, handleKeyDown, handleSetView, offArrange, onCanvasWheel, onExtrudeDown, onExtrudeMove, onExtrudeSetDistance, onExtrudeToolEvent, onExtrudeUp, onFaceBrowseContext, onPanDown, onPanMove, onPanPerspective, onPanUp, onRequestTextures, onSelectionModeEvent, onSetModelUnit, onWindowPointerUpSafety, pointerObserver, scene, sketchPlaneAxisLines, sketchPlaneOrigin, sketchPlanePlates, zoomTowardCursorObserver } = st;
  canvas.removeEventListener('pointerdown', onExtrudeDown);
  canvas.removeEventListener('pointermove', onExtrudeMove);
  canvas.removeEventListener('pointerup', onExtrudeUp);
  canvas.removeEventListener('pointercancel', onExtrudeUp);
  window.removeEventListener('apex-mode-changed', onFaceBrowseContext);
  window.removeEventListener('apex-tool-changed', onFaceBrowseContext);
  window.removeEventListener('apex-selection-mode-changed', onSelectionModeEvent);
  window.removeEventListener('apex-tool-changed', onExtrudeToolEvent);
  window.removeEventListener('apex-extrude-set-distance', onExtrudeSetDistance);
  window.removeEventListener('apex-extrude-commit', commitExtrudeBody);
  sketchPlanePlates.forEach((p) => p.dispose());
  sketchPlaneOrigin.dispose();
  sketchPlaneAxisLines.forEach((l) => l.dispose());
  window.removeEventListener('apex-request-textures', onRequestTextures);
  window.removeEventListener('apex-set-camera-view', handleSetView);
  window.removeEventListener('apex-set-camera-custom', handleCustomView);
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('pointerup', onWindowPointerUpSafety);
  window.removeEventListener('pointercancel', onWindowPointerUpSafety);
  scene.onPointerObservable.remove(pointerObserver);
  scene.onPointerObservable.remove(contextMenuPointerObserver);
  window.removeEventListener('apex-set-model-unit', onSetModelUnit);
  scene.onBeforeRenderObservable.remove(gridZoomObserver);
  scene.onBeforeRenderObservable.remove(zoomTowardCursorObserver);
  offArrange();
  disposePlateActions();
  canvas.removeEventListener("wheel", onCanvasWheel);
  window.removeEventListener(PAN_PERSPECTIVE_EVENT, onPanPerspective);
  canvas.removeEventListener("pointerdown", onPanDown);
  canvas.removeEventListener("pointermove", onPanMove);
  canvas.removeEventListener("pointerup", onPanUp);
  canvas.removeEventListener("pointercancel", onPanUp);
}

function removeSketchListeners(st: ViewportState) {
  const { canvas, extrudeArrowScaleObserver, onSketchPlanePickCancel, onSketchRectDeactivate, onSketchRectDown, onSketchRectKey, onSketchRectLeave, onSketchRectMove, onSketchRectUp, onSketchToolEvent, scene, sketchPlanePickObserver, sketchPlaneScaleObserver } = st;
  canvas.removeEventListener('pointermove', onSketchRectMove);
  canvas.removeEventListener('pointerdown', onSketchRectDown);
  canvas.removeEventListener('pointerup', onSketchRectUp);
  canvas.removeEventListener('pointerleave', onSketchRectLeave);
  window.removeEventListener('keydown', onSketchRectKey);
  window.removeEventListener('apex-sketch-tool', onSketchToolEvent);
  [
    'apex-tool-changed', 'apex-sketch-plane-pick-start', 'apex-sketch-plane-pick-cancel',
    'apex-mode-changed', 'apex-sketch-plane-selected',
  ].forEach((name) => window.removeEventListener(name, onSketchRectDeactivate));
  window.removeEventListener('apex-sketch-plane-pick-cancel', onSketchPlanePickCancel);
  scene.onPointerObservable.remove(sketchPlanePickObserver);
  scene.onBeforeRenderObservable.remove(sketchPlaneScaleObserver);
  scene.onBeforeRenderObservable.remove(extrudeArrowScaleObserver);
}

function removeGeneralListeners(st: ViewportState) {
  const { boxDrawObserver, clearSketchView, emitTransformState, handleResize, lockOrbit, onBoxDrawStart, offHistory, onDeleteAll, onExportPlateStl, onHistoryKey, onHistoryPointerUp, onImportModel, onModeChanged, onPyramidDrawStart, onRenderPause, onRequestSliceModels, onSelectAll, onSelectModel, onSetBlurLevel, onShutdown3d, onSketchPlanePickStart, onSliceAllModels, onToolChanged, onTransformSet, pyramidDrawObserver, resizeObserver, restoreSketchView, saveSketchView, scene, unlockOrbit } = st;
  window.removeEventListener('apex-shutdown-3d', onShutdown3d);
  window.removeEventListener('apex-render-pause', onRenderPause);
  window.removeEventListener('resize', handleResize);
  cancelAnimationFrame(st.resizeFrame);
  resizeObserver.disconnect();
  window.removeEventListener('apex-import-model', onImportModel);
  window.removeEventListener('apex-select-all-models', onSelectAll);
  window.removeEventListener('apex-request-slice-models', onRequestSliceModels);
  window.removeEventListener('apex-slice-all-models', onSliceAllModels);
  window.removeEventListener('apex-export-plate-stl', onExportPlateStl);
  window.removeEventListener('apex-delete-all-models', onDeleteAll);
  offHistory();
  window.removeEventListener('pointerup', onHistoryPointerUp);
  window.removeEventListener('keydown', onHistoryKey);
  window.removeEventListener('apex-set-blur-level', onSetBlurLevel);
  window.removeEventListener('apex-select-model', onSelectModel);
  window.removeEventListener('apex-tool-changed', onToolChanged);
  window.removeEventListener('apex-transform-request', emitTransformState);
  window.removeEventListener('apex-transform-set', onTransformSet);
  window.removeEventListener('apex-mode-changed', onModeChanged);
  window.removeEventListener('apex-primitive-box-start', onBoxDrawStart);
  scene.onPointerObservable.remove(boxDrawObserver);
  window.removeEventListener('apex-primitive-pyramid-start', onPyramidDrawStart);
  scene.onPointerObservable.remove(pyramidDrawObserver);
  window.removeEventListener('apex-sketch-plane-pick-start', onSketchPlanePickStart);
  window.removeEventListener('apex-sketch-plane-selected', lockOrbit);
  window.removeEventListener('apex-sketch-plane-pick-start', saveSketchView);
  window.removeEventListener('apex-sketch-finished', restoreSketchView);
  window.removeEventListener('apex-sketch-plane-pick-cancel', clearSketchView);
  window.removeEventListener('apex-mode-changed', clearSketchView);
  window.removeEventListener('apex-tool-changed', unlockOrbit);
  window.removeEventListener('apex-sketch-plane-pick-start', unlockOrbit);
  window.removeEventListener('apex-sketch-plane-pick-cancel', unlockOrbit);
  window.removeEventListener('apex-mode-changed', unlockOrbit);
}

function setupCleanupPart1(st: ViewportState) {
  return () => {
    removeGeneralListeners(st);
    removeSketchListeners(st);
    removeExtrudeAndCameraListeners(st);
    disposeEngine(st);
  };
}

export function setupViewportCleanup(st: ViewportState) {
  return setupCleanupPart1(st);
}
