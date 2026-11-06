import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AnimatePresence } from 'framer-motion';

import styles from './ModelingSidebar.module.scss';



import { ExtrudePanel, type ExtrudeParams } from './ExtrudePanel';
import { LiquidGlassShadow, type LiquidGlassShadowHandle } from './LiquidGlassMorph';

import { type Feature, type FeatureKind, type SelectionMode, type ExtrudeFeature, type SketchEntity, type SketchEntityKind, type SketchPlane, type SketchPlaneRef } from '@/modeling/types';
import { useModelingMorph } from './modeling-sidebar/useModelingMorph';
import { useModelTreeSync } from './modeling-sidebar/useModelTreeSync';
import { useSelectionIndicator } from './modeling-sidebar/useSelectionIndicator';
import { useSelectionMode } from './modeling-sidebar/useSelectionMode';
import { useSketchPlane } from './modeling-sidebar/useSketchPlane';
import { useExtrusion } from './modeling-sidebar/useExtrusion';
import { useModelingTools } from './modeling-sidebar/useModelingTools';
import { useFeatureActions } from './modeling-sidebar/useFeatureActions';
import { ModelTreePanel } from './modeling-sidebar/ModelTreePanel';
import { FeatureParamsPanel } from './modeling-sidebar/FeatureParamsPanel';
import { ToolsToolbar } from './modeling-sidebar/ToolsToolbar';
import { SketchBar } from './modeling-sidebar/SketchBar';
import type { ModelNode, FloatingSketch, ModelingSidebarProps } from './modeling-sidebar/constants';


export const ModelingSidebar: React.FC<ModelingSidebarProps> = ({ morph }) => {
  const [models, setModels] = useState<ModelNode[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeTool, setActiveTool] = useState<FeatureKind | null>(null);
  // Aucune forme n'est active à la création d'une esquisse : l'utilisateur choisit (pour l'instant
  // seul le rectangle est disponible).
  const [sketchEntity, setSketchEntity] = useState<SketchEntityKind | null>(null);
  const [sketchPlaneChosen, setSketchPlaneChosen] = useState(false);
  const sketchIdRef = useRef<string | null>(null);
  // Esquisse « flottante » : tracée sans corps sélectionné, elle attend l'extrusion, qui crée le corps.
  const floatingSketchRef = useRef<FloatingSketch | null>(null);
  const [floatingSketchName, setFloatingSketchName] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('body');

  const segmentedRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});
  const { contentLeaving, stage, shadowRef, panelRef, contentRevealed } = useModelingMorph({ morph });
  const {  } = useModelTreeSync({ setSelectedModel, setModels });
  const {  } = useSelectionIndicator({ segmentedRef, segmentRefs, selectionMode, setIndicatorStyle });
  const { leaveExtrudeSelectionMode, enterExtrudeSelectionMode, handleSelectionMode } = useSelectionMode({ models, setSelectionMode, selectionMode });
  const { targetModel } = useSketchPlane({ models, selectedModel, sketchEntity, setSketchEntity, setSketchPlaneChosen, sketchIdRef, floatingSketchRef, setFloatingSketchName, setModels, setSelectedFeatureId, setExpanded });
  const { handleExtrudeConfirm, handleExtrudeCancel } = useExtrusion({ targetModel, floatingSketchRef, models, setModels, setSelectedFeatureId, setExpanded, setSelectedModel, setFloatingSketchName, sketchIdRef, setActiveTool, leaveExtrudeSelectionMode });
  const { sketchModeActive, handleToolClick, handleSketchEntity, handleFinishSketch } = useModelingTools({ activeTool, setActiveTool, leaveExtrudeSelectionMode, setSketchEntity, setSketchPlaneChosen, targetModel, enterExtrudeSelectionMode, setModels, setSelectedFeatureId, setExpanded, morph, contentLeaving, sketchIdRef, sketchPlaneChosen, sketchEntity });
  const { selectModelInViewport, toggleExpand, toggleSuppress, deleteFeature, selectedFeature, updateFeature, toolbarSlot } = useFeatureActions({ setModels, setSelectedFeatureId, setSelectedModel, setExpanded, targetModel, selectedFeatureId });

  return (
    <>
      {/* Pendant le morph (cf. `morph`), l'ombre portée est un calque séparé qui épouse la même
          silhouette animée que .panel — box-shadow ne suivrait pas un clip-path complexe, il
          resterait un rectangle fixe pendant que le contenu change de forme. Composant purement
          passif : pilotée par `shadowRef`, dans la MÊME boucle RAF que .panel (cf. le
          useLayoutEffect plus haut), jamais par sa propre boucle indépendante. */}
      {stage && (
        <LiquidGlassShadow
          left={stage.left}
          top={stage.top}
          width={stage.width}
          height={stage.height}
          shadowRef={shadowRef}
        />
      )}

      {/* ---------- Panneau latéral : arborescence des corps ---------- */}
      {/* Ni ce conteneur ni .panel ne sont des motion.div : Framer Motion pose un `transform`
          inline sur tout ce qu'il anime, ce qui créerait un contexte d'empilement sur un ANCÊTRE
          du panneau à `backdrop-filter` (cf. le commentaire de tête de LiquidGlassMorph.tsx). */}
      <div
        className={styles.container}
        data-apex-chrome-panel
        style={
          stage
            ? { position: 'fixed', left: stage.left, top: stage.top, width: stage.width, height: stage.height, maxHeight: 'none' }
            : undefined
        }
      >
        <div
          ref={panelRef}
          data-scroll-edge
          data-apex-tooltip="Panneau Modélisation : liste des corps de la scène et mode de sélection (corps, face, arête ou sommet)."
          className={clsx(styles.panel, { [styles.morphing]: !!stage })}
        >
          {/* Jamais visible pendant une déformation : apparaît en cascade (header, Sélection,
              Corps) une fois un morph d'entrée terminé, disparaît de même dès le clic qui quitte
              Modélisation (contentLeaving). Hors morph, `animate="visible"` sans délai. */}
          <ModelTreePanel contentRevealed={contentRevealed} contentLeaving={contentLeaving} segmentedRef={segmentedRef} indicatorStyle={indicatorStyle} segmentRefs={segmentRefs} selectionMode={selectionMode} handleSelectionMode={handleSelectionMode} models={models} expanded={expanded} selectedModel={selectedModel} selectModelInViewport={selectModelInViewport} toggleExpand={toggleExpand} selectedFeatureId={selectedFeatureId} setSelectedFeatureId={setSelectedFeatureId} toggleSuppress={toggleSuppress} deleteFeature={deleteFeature} />

          {/* ---- Paramètres de la feature sélectionnée ---- */}
          <FeatureParamsPanel selectedFeature={selectedFeature} targetModel={targetModel} updateFeature={updateFeature} />
        </div>
      </div>

      {/* ---------- Boutons d'opérations CAD ----------
          Injectés par portail dans le même conteneur physique que la barre d'outils slicer
          (voir Sidebar.tsx : c'est LUI qui se vide/se déplace/se déforme entre les modes,
          pas un composant séparé qui apparaît par-dessus) — ici on ne possède que la
          logique (activeTool, handleToolClick, création de features), pas le conteneur. */}
      {toolbarSlot && createPortal(
        // Infobulle de la barre elle-même (fond), les boutons gardant la leur. L'enveloppe remplit
        // le conteneur porté, avec la même disposition que lui (cf. .modelingSlot dans Sidebar).
        <ToolsToolbar sketchModeActive={sketchModeActive} activeTool={activeTool} handleToolClick={handleToolClick} />,
        toolbarSlot,
      )}

      {/* ---------- Panneau latéral droit de l'outil Extrusion ---------- */}
      <AnimatePresence>
        {activeTool === 'extrude' && (
          <ExtrudePanel
            key="extrude-panel"
            sketchName={
              targetModel?.features.filter((f) => f.kind === 'sketch').slice(-1)[0]?.name ?? floatingSketchName
            }
            onConfirm={handleExtrudeConfirm}
            onCancel={handleExtrudeCancel}
          />
        )}
      </AnimatePresence>

      {/* ---------- Petite barre des formes d'esquisse, juste sous la barre principale ---------- */}
      <SketchBar activeTool={activeTool} sketchEntity={sketchEntity} handleSketchEntity={handleSketchEntity} handleFinishSketch={handleFinishSketch} />
    </>
  );
};
