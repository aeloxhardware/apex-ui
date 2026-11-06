import React from 'react';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { Box } from 'lucide-react';
import styles from './ModelingSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { ModelTree } from './ModelingTree';
import { FeatureParams } from './ModelingFeatureParams';
import { SELECTION_LOCKED, SELECTION_MODES, contentContainerVariants, contentGroupVariants, type ModelNode } from './modelingData';
import type { Feature } from '@/modeling/types';
import type { ModelingTree } from './useModelingTree';
import type { useModelingSelection } from './useModelingSelection';

interface ModelingPanelProps {
  stage: { left: number; top: number; width: number; height: number } | null;
  panelRef: React.RefObject<HTMLDivElement | null>;
  contentVisible: boolean;
  tree: ModelingTree;
  selection: ReturnType<typeof useModelingSelection>;
  selectedFeature: Feature | null;
  targetModel: ModelNode | null;
}

/** Panneau latéral : arborescence des corps, mode de sélection et paramètres de la feature sélectionnée. */
export const ModelingPanel: React.FC<ModelingPanelProps> = ({
  stage, panelRef, contentVisible, tree, selection, selectedFeature, targetModel,
}) => {
  const { selectionMode, handleSelectionMode, segmentedRef, segmentRefs, indicatorStyle } = selection;
  const { models, expanded, selectedModel, selectModelInViewport, toggleExpand, selectedFeatureId, setSelectedFeatureId, toggleSuppress, deleteFeature, updateFeature } = tree;
  return (
    <>
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
          <motion.div
            variants={contentContainerVariants}
            initial={false}
            animate={contentVisible ? 'visible' : 'hidden'}
          >
          <motion.div className={styles.header} variants={contentGroupVariants}>
            <Box className={clsx('w-4 h-4', styles.headerIcon)} />
            Modélisation
          </motion.div>

          <motion.div variants={contentGroupVariants}>
          <div className={styles.sectionLabel}>Sélection</div>
          <div ref={segmentedRef} className={styles.segmented}>
            <div className={styles.activeIndicator} style={indicatorStyle} />
            {SELECTION_MODES.map(({ mode, label, enabled }) => (
              <CustomTooltip
                key={mode}
                content={label}
                description={enabled ? `Sélectionner par ${label.toLowerCase()}.` : 'Arrive bientôt.'}
              >
                <button
                  ref={(el) => { if (el) segmentRefs.current.set(mode, el); }}
                  className={clsx(styles.segmentButton, { [styles.active]: !SELECTION_LOCKED && selectionMode === mode })}
                  onClick={() => handleSelectionMode(mode)}
                  disabled={!enabled}
                >
                  {label}
                </button>
              </CustomTooltip>
            ))}
          </div>
          </motion.div>

          <motion.div variants={contentGroupVariants}>
          <div className={styles.sectionLabel}>Corps</div>
      <ModelTree models={models} expanded={expanded} selectedModel={selectedModel} selectModelInViewport={selectModelInViewport} toggleExpand={toggleExpand} selectedFeatureId={selectedFeatureId} setSelectedFeatureId={setSelectedFeatureId} toggleSuppress={toggleSuppress} deleteFeature={deleteFeature} />
          </motion.div>
          </motion.div>

          {/* ---- Paramètres de la feature sélectionnée ---- */}
      <FeatureParams selectedFeature={selectedFeature} targetModel={targetModel} updateFeature={updateFeature} />
        </div>
      </div>
    </>
  );
};
