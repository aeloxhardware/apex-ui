import React from 'react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Box, ChevronRight, Eye, EyeOff, Trash2 } from 'lucide-react';
import styles from './ModelingSidebar.module.scss';
import { ExternalScrollArea } from './ExternalScrollArea';
import { CustomTooltip } from './CustomTooltip';
import { FEATURE_ICONS, type ModelNode } from './modelingData';

export interface ModelTreeProps {
  models: ModelNode[];
  expanded: Record<string, boolean>;
  selectedModel: string | null;
  selectModelInViewport: (name: string) => void;
  toggleExpand: (e: React.MouseEvent, id: string) => void;
  selectedFeatureId: string | null;
  setSelectedFeatureId: React.Dispatch<React.SetStateAction<string | null>>;
  toggleSuppress: (modelId: string, featureId: string) => void;
  deleteFeature: (modelId: string, featureId: string) => void;
}

interface ModelRowProps extends Omit<ModelTreeProps, 'models'> {
  model: ModelNode;
}

const ModelRow: React.FC<ModelRowProps> = ({ model, expanded, selectedModel, selectModelInViewport, toggleExpand, selectedFeatureId, setSelectedFeatureId, toggleSuppress, deleteFeature }) => {
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
                                      <CustomTooltip
                                        inline
                                        content={feature.suppressed ? 'Réactiver' : 'Supprimer du calcul'}
                                        description={feature.suppressed
                                          ? "Remet cette opération dans le calcul du modèle : elle s'applique de nouveau à la forme."
                                          : "Retire temporairement cette opération du calcul du modèle sans l'effacer : on peut la réactiver ensuite."}
                                      >
                                        <button
                                          className={styles.nodeAction}
                                          onClick={(e) => { e.stopPropagation(); toggleSuppress(model.id, feature.id); }}
                                        >
                                          {feature.suppressed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                        </button>
                                      </CustomTooltip>
                                      <CustomTooltip
                                        inline
                                        content="Supprimer"
                                        description="Efface définitivement cette opération de l'arbre de modélisation."
                                      >
                                        <button
                                          className={styles.nodeAction}
                                          onClick={(e) => { e.stopPropagation(); deleteFeature(model.id, feature.id); }}
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </CustomTooltip>
                                    </div>
                                  </li>
                                );
                              })}
                            </motion.ul>
                          )}
                        </AnimatePresence>
                      </motion.li>
                    );
};

export const ModelTree: React.FC<ModelTreeProps> = ({ models, expanded, selectedModel, selectModelInViewport, toggleExpand, selectedFeatureId, setSelectedFeatureId, toggleSuppress, deleteFeature }) => (
<ExternalScrollArea className={styles.treeScroll} contentClassName={styles.treeContent}>
            {models.length === 0 ? (
              <div className={styles.emptyState}>
                Aucun corps dans la scène.<br />
                Importez un modèle ou créez une esquisse.
              </div>
            ) : (
              <ul className={styles.treeList}>
                <AnimatePresence initial={false}>
                  {models.map((model) => (
<ModelRow key={model.id} model={model} expanded={expanded} selectedModel={selectedModel} selectModelInViewport={selectModelInViewport} toggleExpand={toggleExpand} selectedFeatureId={selectedFeatureId} setSelectedFeatureId={setSelectedFeatureId} toggleSuppress={toggleSuppress} deleteFeature={deleteFeature} />
))}
                </AnimatePresence>
              </ul>
            )}
          </ExternalScrollArea>
);
