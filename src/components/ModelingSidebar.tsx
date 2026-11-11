import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { ExtrudePanel } from './ExtrudePanel';
import { SketchBar } from './ModelingSketchBar';
import { ModelingPanel } from './ModelingPanel';
import { ModelingToolbar } from './ModelingToolbar';
import { LiquidGlassShadow } from './LiquidGlassMorph';
import { showError } from '@/utils/toast';
import type { Feature, FeatureKind, SketchEntityKind } from '@/modeling/types';
import { useModelingMorph } from './useModelingMorph';
import { useModelingSelection } from './useModelingSelection';
import { useModelingTree } from './useModelingTree';
import { useSketchState, useSketchEvents } from './modelingSketch';
import { makeExtrudeConfirm, makeExtrudeCancel, makeToolClick } from './modelingActions';

import { emitApex } from '@/events/apexEvents';

interface ModelingSidebarProps {
  /**
   * Signale une transition d'espace en cours entre Modélisation et la pilule/les panneaux de
   * Prévisualisation, dans un sens ou dans l'autre :
   *  - 'enter' : ce panneau — déjà affiché avec son contenu réel — part de la forme/position de la
   *    pilule (ou des deux panneaux de Prévisualisation si `fromPreview`) et se déforme en un seul
   *    geste vers sa forme normale.
   *  - 'exit' : mouvement inverse — parti de sa forme normale, ce panneau se déforme vers la
   *    pilule ou les panneaux de Prévisualisation, puis Index.tsx le démonte (`onDone`) et affiche
   *    à la place les vrais panneaux slicer, déjà dans leur état final (cf. `initialPreviewActive`
   *    de CategoriesSidebar).
   *
   * C'est ICI le même élément DOM, déjà monté avec son contenu réel, qui change de silhouette
   * (`clip-path`, cf. useModelingMorph) — aucun raccord entre deux éléments distincts, donc aucun
   * risque de clignotement. Reste monté pendant tout le morph (les effets de montage/démontage —
   * restauration du mode 3D notamment — ne doivent avoir lieu qu'une fois).
   */
  morph?: { direction: 'enter' | 'exit'; fromPreview: boolean; onDone: () => void } | undefined;
}

/** Le viewport a besoin de connaître l'état initial dès le montage du panneau ; retour au slicer au démontage. */
function useModelingModeEvents() {
  useEffect(() => {
    emitApex('apex-mode-changed', { mode: 'modeling' });
    emitApex('apex-selection-mode-changed', { mode: 'body' });
    return () => {
      // Retour au slicer : le viewport doit restaurer plateau, boundary shader et gizmos.
      emitApex('apex-mode-changed', { mode: 'slicer' });
      emitApex('apex-tool-changed', { tool: 'select' });
    };
  }, []);
}

/** Esquisse active : cf. la barre d'outils (icônes en cascade) et la largeur de la pilule (Sidebar). */
function useSketchActiveEvent(sketchModeActive: boolean) {
  useEffect(() => {
    emitApex('apex-modeling-sketch-active', { active: sketchModeActive });
    return () => {
      emitApex('apex-modeling-sketch-active', { active: false });
    };
  }, [sketchModeActive]);
}

/**
 * Touche E : lance l'Extrusion (comme un clic sur l'outil). Une face déjà choisie dans la vue est reprise par
 * l'outil (cf. `carriedFace` dans Viewport3D). Sans effet pendant la saisie de texte, avec un modificateur,
 * en pleine esquisse, ou si l'Extrusion est déjà active.
 */
function useExtrudeShortcut(blocked: boolean, handleToolClick: (kind: FeatureKind) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (blocked) return;
      e.preventDefault();
      handleToolClick('extrude');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}

export const ModelingSidebar: React.FC<ModelingSidebarProps> = ({ morph }) => {
  const tree = useModelingTree();
  const [activeTool, setActiveTool] = useState<FeatureKind | null>(null);
  const sketch = useSketchState();
  const selection = useModelingSelection();
  const { panelRef, shadowRef, stage, contentRevealed, contentLeaving } = useModelingMorph(morph);
  const targetModel = tree.models.find((m) => m.name === tree.selectedModel) ?? null;
  useModelingModeEvents();
  useSketchEvents(tree, targetModel, sketch);

  const toolCtx = {
    tree, targetModel, sketch, activeTool, setActiveTool,
    enterExtrudeSelectionMode: selection.enterExtrudeSelectionMode,
    leaveExtrudeSelectionMode: selection.leaveExtrudeSelectionMode,
  };
  const handleToolClick = makeToolClick(toolCtx);
  const sketchModeActive = activeTool === 'sketch';
  useSketchActiveEvent(sketchModeActive);
  useExtrudeShortcut(!!morph || contentLeaving || activeTool === 'sketch' || activeTool === 'extrude', handleToolClick);

  /** Termine l'esquisse : plus de forme active, le plan est abandonné, l'orbite est rendue. */
  const handleFinishSketch = () => {
    setActiveTool(null);
    sketch.setSketchEntity(null);
    sketch.setSketchPlaneChosen(false);
    sketch.sketchIdRef.current = null;
    emitApex('apex-sketch-tool', { entity: null, sketchId: null });
    // Rend la vue d'avant l'outil Esquisse (doit partir AVANT le pick-cancel, qui efface l'instantané).
    emitApex('apex-sketch-finished');
    // Même signal que le retrait de l'outil : déverrouille l'orbite et désactive le tracé.
    emitApex('apex-tool-changed', { tool: 'select' });
    emitApex('apex-sketch-plane-pick-cancel');
  };

  const handleSketchEntity = (kind: SketchEntityKind) => {
    if (!sketch.sketchPlaneChosen) {
      showError('Choisissez d\'abord un plan ou une face plane.');
      return;
    }
    // Re-cliquer sur la forme active la désactive.
    const next = sketch.sketchEntity === kind ? null : kind;
    sketch.setSketchEntity(next);
    emitApex('apex-sketch-tool', { entity: next, sketchId: sketch.sketchIdRef.current });
  };

  const selectedFeature: Feature | null =
    targetModel?.features.find((f) => f.id === tree.selectedFeatureId) ?? null;

  // Slot exposé par Sidebar (même conteneur physique que la barre d'outils slicer) : Sidebar est
  // toujours monté en parallèle, donc le noeud existe déjà quand ce composant apparaît.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setToolbarSlot(document.getElementById('apex-modeling-toolbar-slot'));
  }, []);

  return (
    <>
      {/* Pendant le morph, l'ombre portée est un calque séparé qui épouse la même silhouette animée
          que .panel (box-shadow ne suivrait pas un clip-path complexe). Purement passif : piloté par
          `shadowRef`, dans la MÊME boucle RAF que .panel (cf. useModelingMorph). */}
      {stage && (
        <LiquidGlassShadow left={stage.left} top={stage.top} width={stage.width} height={stage.height} shadowRef={shadowRef} />
      )}

      <ModelingPanel
        stage={stage}
        panelRef={panelRef}
        contentVisible={contentRevealed && !contentLeaving}
        tree={tree}
        selection={selection}
        selectedFeature={selectedFeature}
        targetModel={targetModel}
      />

      {toolbarSlot && createPortal(
        <ModelingToolbar activeTool={activeTool} sketchModeActive={sketchModeActive} handleToolClick={handleToolClick} />,
        toolbarSlot,
      )}

      {/* ---------- Panneau latéral droit de l'outil Extrusion ---------- */}
      <AnimatePresence>
        {activeTool === 'extrude' && (
          <ExtrudePanel
            key="extrude-panel"
            sketchName={
              targetModel?.features.filter((f) => f.kind === 'sketch').slice(-1)[0]?.name ?? sketch.floatingSketchName
            }
            onConfirm={makeExtrudeConfirm(toolCtx)}
            onCancel={makeExtrudeCancel(toolCtx)}
          />
        )}
      </AnimatePresence>

      {/* ---------- Petite barre des formes d'esquisse, juste sous la barre principale ---------- */}
      <SketchBar activeTool={activeTool} sketchEntity={sketch.sketchEntity} handleSketchEntity={handleSketchEntity} handleFinishSketch={handleFinishSketch} />
    </>
  );
};
