import { FLAT_MAX_FPS } from '@/utils/interfaceMode';
import { PAN_PERSPECTIVE_EVENT } from '@/utils/panPerspectivePrefs';
import type { ViewportCtx } from './context';

/** Pause du rendu, redimensionnement, boucle de rendu, arrêt et nettoyage au démontage. */
export function setupLifecycle(c: ViewportCtx): () => void {
  const { engine, scene, canvas, flat, gizmoManager, renderPipeline, orcaRotateGizmo, orcaScaleGizmo, onImportModel, onSelectAll, onRequestSliceModels, onSliceAllModels, onExportPlateStl, onDeleteAll, onSetBlurLevel, onSelectModel, onToolChanged, emitTransformState, onTransformSet, onModeChanged, onBoxDrawStart, boxDrawObserver, onPyramidDrawStart, pyramidDrawObserver, onSketchPlanePickStart, lockOrbit, saveSketchView, restoreSketchView, clearSketchView, unlockOrbit, onSketchRectMove, onSketchRectDown, onSketchRectUp, onSketchRectLeave, onSketchRectKey, onSketchToolEvent, onSketchRectDeactivate, onSketchPlanePickCancel, sketchPlanePickObserver, sketchPlaneScaleObserver, extrudeArrowScaleObserver, onExtrudeDown, onExtrudeMove, onExtrudeUp, onFaceBrowseContext, onSelectionModeEvent, onExtrudeToolEvent, onExtrudeSetDistance, commitExtrudeBody, sketchPlanePlates, sketchPlaneOrigin, sketchPlaneAxisLines, onRequestTextures, handleSetView, handleCustomView, handleKeyDown, onWindowPointerUpSafety, pointerObserver, contextMenuPointerObserver, onSetModelUnit, gridZoomObserver, zoomTowardCursorObserver, onArrangeModels, disposePlateActions, onCanvasWheel, onPanPerspective, onPanDown, onPanMove, onPanUp, unsubscribeShading, engineRef, sceneRef, gizmoManagerRef, hlRef } = c;


  let renderPaused = false;

  const onRenderPause = (e: Event) => {
    renderPaused = !!(e as CustomEvent<{ paused: boolean }>).detail?.paused;
  };

  window.addEventListener('apex-render-pause', onRenderPause);


  const handleResize = () => {
    engine.resize();
  };

  window.addEventListener('resize', handleResize);

  // Le conteneur du canvas peut changer de taille sans événement `resize` de la fenêtre
  // (panneaux, changement d'espace, zoom/DPI) : sans cela le tampon de rendu garde l'ancienne
  // taille et l'image apparaît étirée, aplatie ou déformée.
  let resizeFrame = 0;

  const resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { if (!scene.isDisposed) engine.resize(); });
  });

  resizeObserver.observe(canvas);

  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);


  // Interface classique : rendu plafonné à FLAT_MAX_FPS images/s (consommation, cf. utils/interfaceMode.ts). Cadence tenue
  // en moyenne par une échéance (pas par un écart minimal, qui tomberait à 20 images/s sur un écran 60 Hz).
  const FLAT_FRAME_MS = 1000 / FLAT_MAX_FPS;

  let nextFrameAt = 0;

  engine.runRenderLoop(() => {
    if (flat) {
      const now = performance.now();
      if (now < nextFrameAt - 8) return;
      nextFrameAt = Math.max(nextFrameAt + FLAT_FRAME_MS, now - FLAT_FRAME_MS);
    }
    // Garde-fou : tampon de rendu différent de la taille affichée → on resynchronise.
    if (canvas.clientWidth > 0 && canvas.clientHeight > 0 &&
        (Math.abs(engine.getRenderWidth() - Math.round(canvas.clientWidth * engine.getHardwareScalingLevel() ** -1)) > 2 ||
         Math.abs(engine.getRenderHeight() - Math.round(canvas.clientHeight * engine.getHardwareScalingLevel() ** -1)) > 2)) {
      engine.resize();
    }
    // Rideau opaque (changement d'espace, chargement lourd) : la scène est cachée, son rendu ne ferait
    // que concurrencer sur le thread principal le montage de l'interface et la construction du
    // maillage. Les images du moteur continuent (verre, observateurs de fin d'image).
    if (!scene.isDisposed && !renderPaused) {
      scene.render();
    }
  });


  // Premier rendu complet (shaders compilés) : l'application peut sortir de son écran de démarrage.
  scene.executeWhenReady(() => window.dispatchEvent(new Event('apex-viewport-ready')));


  // Fermeture de l'application (src/utils/shutdownSequence.ts) : « close » ferme l'accès au viewport (plus de rendu,
  // plus de gizmo, canevas masqué) ; « purge » libère la scène, le pipeline et le moteur (RAM et vRAM). Le nettoyage
  // du démontage ci-dessous reste valable : il ne repasse pas sur ce qui est déjà libéré (`disposed`).
  let disposed = false;

  const onShutdown3d = (e: Event) => {
    const phase = (e as CustomEvent<{ phase?: string }>).detail?.phase;
    if (phase === 'close') {
      engine.stopRenderLoop();
      gizmoManager.attachToMesh(null);
      canvas.style.display = 'none';
    } else if (phase === 'purge' && !disposed) {
      disposed = true;
      engine.stopRenderLoop();
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(resizeFrame);
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
  };

  window.addEventListener('apex-shutdown-3d', onShutdown3d);


  return () => {
    window.removeEventListener('apex-shutdown-3d', onShutdown3d);
    window.removeEventListener('apex-render-pause', onRenderPause);
    window.removeEventListener('resize', handleResize);
    cancelAnimationFrame(resizeFrame);
    resizeObserver.disconnect();
    window.removeEventListener('apex-import-model', onImportModel);
    window.removeEventListener('apex-select-all-models', onSelectAll);
    window.removeEventListener('apex-request-slice-models', onRequestSliceModels);
    window.removeEventListener('apex-slice-all-models', onSliceAllModels);
    window.removeEventListener('apex-export-plate-stl', onExportPlateStl);
    window.removeEventListener('apex-delete-all-models', onDeleteAll);
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
    window.removeEventListener('apex-arrange-models', onArrangeModels);
    disposePlateActions();
    canvas.removeEventListener("wheel", onCanvasWheel);
    window.removeEventListener(PAN_PERSPECTIVE_EVENT, onPanPerspective);
    canvas.removeEventListener("pointerdown", onPanDown);
    canvas.removeEventListener("pointermove", onPanMove);
    canvas.removeEventListener("pointerup", onPanUp);
    canvas.removeEventListener("pointercancel", onPanUp);
    unsubscribeShading();
    if (disposed) return;
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
  };
}
