import type { ModelNode } from './modelingData';
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  MousePointerSquareDashed,
} from 'lucide-react';
import styles from './ModelingSidebar.module.scss';
import { ApexNumberField } from './ApexNumberField';
import {
  type Feature,
  type SketchPlane,
} from '@/modeling/types';


export interface FeatureParamsProps {
  selectedFeature: Feature | null;
  targetModel: ModelNode | null;
  updateFeature: (modelId: string, featureId: string, patch: Partial<Feature>) => void;
}

export const FeatureParams: React.FC<FeatureParamsProps> = ({ selectedFeature, targetModel, updateFeature }) => (
  <>
          <AnimatePresence initial={false}>
            {selectedFeature && targetModel && (
              <motion.div
                className={styles.params}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              >
                <div className={styles.paramsTitle}>{selectedFeature.name}</div>

                {selectedFeature.kind === 'sketch' && selectedFeature.planeRef.kind === 'axis' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Plan</span>
                    <select
                      className={styles.paramSelect}
                      value={selectedFeature.planeRef.plane}
                      onChange={(e) =>
                        updateFeature(targetModel.id, selectedFeature.id, {
                          planeRef: { kind: 'axis', plane: e.target.value as SketchPlane },
                        })
                      }
                    >
                      {/* Repère Babylon, Y vertical : XZ est le plan du sol (dessus). */}
                      <option value="XZ">XZ (dessus)</option>
                      <option value="XY">XY (face)</option>
                      <option value="YZ">YZ (côté)</option>
                    </select>
                  </div>
                )}

                {selectedFeature.kind === 'sketch' && selectedFeature.planeRef.kind === 'face' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Plan</span>
                    <span className={styles.paramLabel} style={{ color: 'rgba(245,158,11,0.85)' }}>
                      Face sélectionnée
                    </span>
                  </div>
                )}

                {selectedFeature.kind === 'extrude' && (
                  <>
                    <div className={styles.paramRow}>
                      <span className={styles.paramLabel}>Distance (mm)</span>
                      <ApexNumberField value={selectedFeature.distance} step={0.5} onChange={(v) => v !== null && updateFeature(targetModel.id, selectedFeature.id, { distance: v })} />
                    </div>
                    <div className={styles.paramRow}>
                      <label className={styles.paramToggle}>
                        <input
                          type="checkbox"
                          checked={selectedFeature.symmetric}
                          onChange={(e) =>
                            updateFeature(targetModel.id, selectedFeature.id, { symmetric: e.target.checked })
                          }
                        />
                        Symétrique
                      </label>
                    </div>
                  </>
                )}

                {selectedFeature.kind === 'revolve' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Angle (°)</span>
                    <ApexNumberField value={selectedFeature.angle} min={1} max={360} onChange={(v) => v !== null && updateFeature(targetModel.id, selectedFeature.id, { angle: v })} />
                  </div>
                )}

                {selectedFeature.kind === 'fillet' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Rayon (mm)</span>
                    <ApexNumberField value={selectedFeature.radius} step={0.5} min={0.1} onChange={(v) => v !== null && updateFeature(targetModel.id, selectedFeature.id, { radius: v })} />
                  </div>
                )}

                {selectedFeature.kind === 'chamfer' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Distance (mm)</span>
                    <ApexNumberField value={selectedFeature.distance} step={0.5} min={0.1} onChange={(v) => v !== null && updateFeature(targetModel.id, selectedFeature.id, { distance: v })} />
                  </div>
                )}

                {selectedFeature.kind === 'mirror' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Centre X</span>
                    <ApexNumberField value={selectedFeature.center.x} onChange={(v) => v !== null && updateFeature(targetModel.id, selectedFeature.id, {
                          center: { ...selectedFeature.center, x: v },
                        })} />
                  </div>
                )}

                {(selectedFeature.kind === 'fillet' || selectedFeature.kind === 'chamfer') && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>
                      <MousePointerSquareDashed className="w-3 h-3 inline mr-1" />
                      {selectedFeature.targetIds.length} face(s) sélectionnée(s)
                    </span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
  </>
);
