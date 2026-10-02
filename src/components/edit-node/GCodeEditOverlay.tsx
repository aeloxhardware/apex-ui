import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import EditNode from './EditNode';
import { LiquidGlassRenderer, collectLenses } from './liquidGlass';
import type { EditNodeView, GCodeEditController } from './gcodeEditController';
import styles from './GCodeEditOverlay.module.scss';

/**
 * Nœud d'édition posé sur la vue 3D (onglet Édition) : le nœud est dessiné en DOM à la projection
 * écran de son point, et son verre est rendu en WebGL dans un calque transparent qui réfracte
 * l'image de la scène Babylon de la MÊME image (rendu déclenché après chaque rendu de la scène,
 * nœud mis à jour de façon synchrone juste avant).
 */
const GCodeEditOverlay: React.FC<{ controller: GCodeEditController; sceneCanvas: HTMLCanvasElement }> = ({
  controller,
  sceneCanvas,
}) => {
  const [view, setView] = useState<EditNodeView>({ visible: false, nodeId: 0, x: 0, y: 0, handleOffsets: {}, busy: false });
  const [expanded, setExpanded] = useState(true);
  const [trimming, setTrimming] = useState(false);
  const glassRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // Nouveau nœud : développé, rognage désactivé.
  useEffect(() => {
    setExpanded(true);
    setTrimming(false);
  }, [view.nodeId]);

  useEffect(() => {
    const glass = glassRef.current!;
    let renderer: LiquidGlassRenderer | null = null;
    try {
      renderer = new LiquidGlassRenderer(glass, true);
    } catch (error) {
      console.warn('Verre du nœud indisponible :', error);
    }
    let shown = false;
    let subscribed = false;
    const unsubscribeView = controller.subscribe((next) => {
      // Synchrone (hors de cet effet) : le DOM du nœud doit être à jour avant le rendu du verre de
      // cette image.
      if (subscribed) flushSync(() => setView(next));
      else setView(next);
    });
    subscribed = true;
    const unsubscribeRender = controller.onAfterRender(() => {
      if (!renderer) return;
      if (!viewRef.current.visible) {
        if (shown) { renderer.clear(); shown = false; }
        return;
      }
      renderer.resize(sceneCanvas.width, sceneCanvas.height);
      renderer.setBackground(sceneCanvas);
      const dpr = sceneCanvas.width / Math.max(1, sceneCanvas.clientWidth);
      renderer.render(collectLenses(stageRef.current!, glass.getBoundingClientRect()), dpr);
      shown = true;
    });
    return () => {
      unsubscribeView();
      unsubscribeRender();
    };
  }, [controller, sceneCanvas]);

  return (
    <>
      <canvas ref={glassRef} className={styles.glass} />
      <div ref={stageRef} className={styles.stage}>
        {view.visible && (
          <EditNode
            key={view.nodeId}
            x={view.x}
            y={view.y}
            active={expanded}
            trimming={trimming}
            loading={view.busy}
            onActivate={() => setExpanded(true)}
            onDeactivate={() => setExpanded(false)}
            onToggleTrimming={() => setTrimming((t) => !t)}
            onMove={controller.onNodeMove}
            onMoveEnd={controller.onNodeMoveEnd}
            onHandlesChange={controller.onHandlesChange}
            handleOffsets={view.handleOffsets}
          />
        )}
      </div>
    </>
  );
};

export default GCodeEditOverlay;
