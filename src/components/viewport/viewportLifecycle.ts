// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import { FLAT_MAX_FPS } from '@/utils/interfaceMode';
import type { ViewportState } from './viewportState';

function setupOnRenderPause(st: ViewportState) {
  const { canvas, engine, scene } = st;
  st.renderPaused = false;
  const onRenderPause = (e: Event) => {
    st.renderPaused = !!(e as CustomEvent<{ paused: boolean }>).detail?.paused;
  };
  window.addEventListener('apex-render-pause', onRenderPause);

  const handleResize = () => {
    engine.resize();
  };
  window.addEventListener('resize', handleResize);
  // Le conteneur du canvas peut changer de taille sans événement `resize` de la fenêtre
  // (panneaux, changement d'espace, zoom/DPI) : sans cela le tampon de rendu garde l'ancienne
  // taille et l'image apparaît étirée, aplatie ou déformée.
  st.resizeFrame = 0;
  const resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(st.resizeFrame);
    st.resizeFrame = requestAnimationFrame(() => { if (!scene.isDisposed) engine.resize(); });
  });
  resizeObserver.observe(canvas);
  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

  // Interface classique : rendu plafonné à FLAT_MAX_FPS images/s (consommation, cf. utils/interfaceMode.ts). Cadence tenue
  // en moyenne par une échéance (pas par un écart minimal, qui tomberait à 20 images/s sur un écran 60 Hz).
  const FLAT_FRAME_MS = 1000 / FLAT_MAX_FPS;
  st.nextFrameAt = 0;
  Object.assign(st, { onRenderPause, handleResize, resizeObserver, FLAT_FRAME_MS });
}

function setupOnShutdown3d(st: ViewportState) {
  const { FLAT_FRAME_MS, canvas, engine, engineRef, flat, gizmoManager, gizmoManagerRef, handleResize, hlRef, orcaRotateGizmo, orcaScaleGizmo, renderPipeline, resizeObserver, scene, sceneRef } = st;
  engine.runRenderLoop(() => {
    if (flat) {
      const now = performance.now();
      if (now < st.nextFrameAt - 8) return;
      st.nextFrameAt = Math.max(st.nextFrameAt + FLAT_FRAME_MS, now - FLAT_FRAME_MS);
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
    if (!scene.isDisposed && !st.renderPaused) {
      scene.render();
    }
  });

  // Premier rendu complet (shaders compilés) : l'application peut sortir de son écran de démarrage.
  scene.executeWhenReady(() => window.dispatchEvent(new Event('apex-viewport-ready')));

  // Fermeture de l'application (src/utils/shutdownSequence.ts) : « close » ferme l'accès au viewport (plus de rendu,
  // plus de gizmo, canevas masqué) ; « purge » libère la scène, le pipeline et le moteur (RAM et vRAM). Le nettoyage
  // du démontage ci-dessous reste valable : il ne repasse pas sur ce qui est déjà libéré (`disposed`).
  st.disposed = false;
  const onShutdown3d = (e: Event) => {
    const phase = (e as CustomEvent<{ phase?: string }>).detail?.phase;
    if (phase === 'close') {
      engine.stopRenderLoop();
      gizmoManager.attachToMesh(null);
      canvas.style.display = 'none';
    } else if (phase === 'purge' && !st.disposed) {
      st.disposed = true;
      engine.stopRenderLoop();
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(st.resizeFrame);
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
  Object.assign(st, { onShutdown3d });
}

function setupLifecyclePart3(st: ViewportState) {
  const { onShutdown3d } = st;
  window.addEventListener('apex-shutdown-3d', onShutdown3d);
}

export function setupViewportLifecycle(st: ViewportState) {
  setupOnRenderPause(st);
  setupOnShutdown3d(st);
  setupLifecyclePart3(st);
}
