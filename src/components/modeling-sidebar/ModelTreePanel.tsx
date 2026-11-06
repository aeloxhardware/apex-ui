import { motion, AnimatePresence } from 'framer-motion';
import styles from '../ModelingSidebar.module.scss';
import { Box, ChevronRight, EyeOff, Eye, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { CustomTooltip } from '../CustomTooltip';
import { ExternalScrollArea } from '../ExternalScrollArea';
import { contentContainerVariants, contentGroupVariants, SELECTION_MODES, SELECTION_LOCKED, FEATURE_ICONS } from './constants';
import type { ModelNode } from './constants';
import type React from 'react';

interface ModelTreePanelProps {
  contentRevealed: boolean;
  contentLeaving: boolean;
  segmentedRef: React.RefObject<HTMLDivElement>;
  indicatorStyle: React.CSSProperties;
  segmentRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  selectionMode: SelectionMode;
  handleSelectionMode: (mode: SelectionMode) => void;
  models: ModelNode[];
  expanded: Record<string, boolean>;
  selectedModel: string;
  selectModelInViewport: (name: string) => void;
  toggleExpand: (e: React.MouseEvent, id: string) => void;
  selectedFeatureId: string;
  setSelectedFeatureId: React.Dispatch<React.SetStateAction<string>>;
  toggleSuppress: (modelId: string, featureId: string) => void;
  deleteFeature: (modelId: string, featureId: string) => void;
}

/** Liste des corps et de leurs éléments. */
export function ModelTreePanel({ contentRevealed, contentLeaving, segmentedRef, indicatorStyle, segmentRefs, selectionMode, handleSelectionMode, models, expanded, selectedModel, selectModelInViewport, toggleExpand, selectedFeatureId, setSelectedFeatureId, toggleSuppress, deleteFeature }: ModelTreePanelProps) {
  return (
    <motion.div
      variants={contentContainerVariants}
      initial={false}
      animate={contentRevealed && !contentLeaving ? 'visible' : 'hidden'}
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
    <ExternalScrollArea className={styles.treeScroll} contentClassName={styles.treeContent}>
      {models.length === 0 ? (
        <div className={styles.emptyState}>
          Aucun corps dans la scène.<br />
          Importez un modèle ou créez une esquisse.
        </div>
      ) : (
        <ul className={styles.treeList}>
          <AnimatePresence initial={false}>
            {models.map((model) => {
              const isExpanded = !!expanded[model.id];
              const hasChildren = model.children.length > 0 || model.features.length > 0;

              return (
                <motion.li
                  key={model.id}
                  className={styles.treeNode}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    className={clsx(styles.treeRow, {
                      [styles.selected]: selectedModel === model.name,
                    })}
                    onClick={() => selectModelInViewport(model.name)}
                    onKeyDown={(e) => { if (e.key === 'Enter') selectModelInViewport(model.name); }}
                  >
                    {hasChildren ? (
                      <ChevronRight
                        className={clsx('w-3 h-3', styles.chevron, { [styles.expanded]: isExpanded })}
                        onClick={(e) => toggleExpand(e, model.id)}
                      />
                    ) : (
                      <span className={styles.chevronSpacer} />
                    )}
                    <Box className={clsx('w-3.5 h-3.5', styles.nodeIcon)} />
                    <span className={styles.nodeName}>{model.name}</span>
                  </div>

                  <AnimatePresence initial={false}>
                    {isExpanded && hasChildren && (
                      <motion.ul
                        className={styles.childList}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                      >
                        {model.children.map((sub) => (
                          <li key={sub.id} className={styles.childRow}>
                            <span className={styles.childDot} style={{ background: sub.color }} />
                            {sub.name}
                          </li>
                        ))}

                        {model.features.map((feature) => {
                          const Icon = FEATURE_ICONS[feature.kind];
                          return (
                            <li key={feature.id}>
                              <div
                                role="button"
                                tabIndex={0}
                                className={clsx(styles.treeRow, styles.featureRow, {
                                  [styles.selected]: selectedFeatureId === feature.id,
                                  [styles.suppressed]: feature.suppressed,
                                  [styles.errored]: !!feature.error,
                                })}
                                onClick={() => setSelectedFeatureId(feature.id)}
                                onKeyDown={(e) => { if (e.key === 'Enter') setSelectedFeatureId(feature.id); }}
                              >
                                <Icon className={clsx('w-3 h-3', styles.nodeIcon)} />
                                <span className={styles.nodeName}>{feature.name}</span>
                                <button
                                  className={styles.nodeAction}
                                  title={feature.suppressed ? 'Réactiver' : 'Supprimer du calcul'}
                                  onClick={(e) => { e.stopPropagation(); toggleSuppress(model.id, feature.id); }}
                                >
                                  {feature.suppressed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                </button>
                                <button
                                  className={styles.nodeAction}
                                  title="Supprimer"
                                  onClick={(e) => { e.stopPropagation(); deleteFeature(model.id, feature.id); }}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </ExternalScrollArea>
    </motion.div>
    </motion.div>
  );
}
