import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import EditNode from './EditNode';
import { LiquidGlassRenderer, collectLenses } from './liquidGlass';
import type { EditNodeView, EditOverlayView, GCodeEditController } from './gcodeEditController';
import styles from './GCodeEditOverlay.module.scss';

/**
 * Nœuds d'édition posés sur la vue 3D (onglet Édition) : chaque nœud est dessiné en DOM à la
 * projection écran de son point, et le verre est rendu en WebGL dans un calque transparent qui
 * réfracte l'image de la scène Babylon de la MÊME image (rendu déclenché après chaque rendu de la
 * scène, nœuds mis à jour de façon synchrone juste avant). Un seul nœud est développé (l'actif) ;
 * les autres restent réduits, avec leurs poignées, pour être repris d'un clic.
 */
const GCodeEditOverlay: React.FC<{ controller: GCodeEditController; sceneCanvas: HTMLCanvasElement }> = ({
  controller,
  sceneCanvas,
}) => {
  const [view, setView] = useState<EditOverlayView>({ nodes: [] });
  const glassRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

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
      // Synchrone (hors de cet effet) : le DOM des nœuds doit être à jour avant le rendu du verre de
      // cette image.
      if (subscribed) flushSync(() => setView(next));
      else setView(next);
    });
    subscribed = true;
    const unsubscribeRender = controller.onAfterRender(() => {
      if (!renderer) return;
      if (!viewRef.current.nodes.some((n) => n.visible)) {
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

  // L'actif en dernier : dessiné par-dessus les nœuds réduits qu'il recouvre.
  const ordered = useMemo(
    () => [...view.nodes].sort((a, b) => Number(a.active) - Number(b.active)),
    [view.nodes],
  );

  return (
    <>
      <canvas ref={glassRef} className={styles.glass} />
      <div ref={stageRef} className={styles.stage}>
        {ordered.map((n) => (
          <OverlayNode
            key={n.id}
            view={n}
            controller={controller}
          />
        ))}
      </div>
    </>
  );
};

/** Un nœud : rappels liés à son identifiant, stables d'un rendu à l'autre (EditNode est mémoïsé). */
const OverlayNode: React.FC<{
  view: EditNodeView;
  controller: GCodeEditController;
}> = ({ view, controller }) => {
  const { id } = view;
  const callbacks = useMemo(() => ({
    onActivate: () => controller.activateNode(id),
    onDeactivate: () => controller.deactivateNode(id),
    onToggleTrimming: () => controller.toggleTrimming(id),
    onMove: (x: number, y: number) => controller.onNodeMove(id, x, y),
    onMoveEnd: () => controller.onNodeMoveEnd(id),
    onHandlesChange: (list: Parameters<GCodeEditController['onHandlesChange']>[1]) => controller.onHandlesChange(id, list),
    onTogglePositionLock: () => controller.togglePositionLock(id),
    onHandleDrag: (e: Parameters<GCodeEditController['onHandleDrag']>[1]) => controller.onHandleDrag(id, e),
  }), [controller, id]);
  // Derrière la caméra : caché mais monté (ses poignées et leur état sont conservés).
  return (
    <div style={view.visible ? undefined : { display: 'none' }}>
      <EditNode
        x={view.x}
        y={view.y}
        active={view.active}
        trimming={view.trimming}
        occluded={view.occluded}
        loading={view.busy}
        handleOffsets={view.handleOffsets}
        positionLocked={view.positionLocked}
        fixedHandles={view.fixedHandles}
        {...callbacks}
      />
    </div>
  );
};

export default GCodeEditOverlay;
