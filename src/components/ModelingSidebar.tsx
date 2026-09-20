import React, { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Box,
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Minus,
  MousePointerSquareDashed,
  PenLine,
  RotateCw,
  Spline,
  Square,
  Trash2,
  Triangle,
  Waves,
} from 'lucide-react';
import styles from './ModelingSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { showError, showSuccess } from '@/utils/toast';
import {
  FEATURE_LABELS,
  SKETCH_ENTITY_LABELS,
  nextId,
  type Feature,
  type FeatureKind,
  type SelectionMode,
  type SketchEntityKind,
  type SketchPlane,
  type SketchPlaneRef,
} from '@/modeling/types';

/** Sous-maillage d'un modèle importé, tel que le diffuse `apex-mesh-selected`. */
interface SubMeshItem {
  id: string;
  name: string;
  color: string;
}

/** Un corps de la scène et les features paramétriques qui lui sont rattachées. */
interface ModelNode {
  id: string;
  name: string;
  children: SubMeshItem[];
  features: Feature[];
}

const TOOLS: {
  kind: FeatureKind;
  icon: React.ElementType;
  description: string;
}[] = [
  { kind: 'sketch', icon: PenLine, description: 'Créez des contours géométriques sur un plan ou une surface plane afin de définir la base d\'une conception tridimensionnelle.' },
  { kind: 'extrude', icon: Box, description: 'Extruder un profil d\'esquisse fermé le long de sa normale.' },
  { kind: 'revolve', icon: RotateCw, description: 'Faire tourner un profil autour d\'un axe.' },
  { kind: 'fillet', icon: Spline, description: 'Arrondir les arêtes sélectionnées avec un rayon.' },
  { kind: 'chamfer', icon: Triangle, description: 'Biseauter les arêtes sélectionnées.' },
  { kind: 'mirror', icon: FlipHorizontal2, description: 'Dupliquer le corps par symétrie autour d\'un point.' },
];

const SKETCH_ENTITIES: { kind: SketchEntityKind; icon: React.ElementType }[] = [
  { kind: 'line', icon: Minus },
  { kind: 'rectangle', icon: Square },
  { kind: 'circle', icon: Circle },
  { kind: 'triangle', icon: Triangle },
  { kind: 'curve', icon: Waves },
];

const SELECTION_MODES: { mode: SelectionMode; label: string; enabled: boolean }[] = [
  { mode: 'body', label: 'Corps', enabled: true },
  { mode: 'face', label: 'Face', enabled: true },
  { mode: 'edge', label: 'Arête', enabled: false },
  { mode: 'vertex', label: 'Sommet', enabled: false },
];

const FEATURE_ICONS: Record<FeatureKind, React.ElementType> = {
  sketch: PenLine,
  extrude: Box,
  revolve: RotateCw,
  fillet: Spline,
  chamfer: Triangle,
  mirror: FlipHorizontal2,
};

export const ModelingSidebar: React.FC = () => {
  const [models, setModels] = useState<ModelNode[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeTool, setActiveTool] = useState<FeatureKind | null>(null);
  const [sketchEntity, setSketchEntity] = useState<SketchEntityKind>('rectangle');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('body');

  const segmentedRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});

  /** Le viewport a besoin de connaître l'état initial dès le montage du panneau. */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('apex-mode-changed', { detail: { mode: 'modeling' } }));
    window.dispatchEvent(new CustomEvent('apex-selection-mode-changed', { detail: { mode: 'body' } }));

    return () => {
      // Retour au slicer : le viewport doit restaurer plateau, boundary shader et gizmos.
      window.dispatchEvent(new CustomEvent('apex-mode-changed', { detail: { mode: 'slicer' } }));
      window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
    };
  }, []);

  /**
   * L'arborescence reflète les corps réellement présents dans la scène : on suit les mêmes
   * événements que ModelStatusBox plutôt que de tenir une liste parallèle qui divergerait.
   */
  useEffect(() => {
    const handleMeshSelected = (
      e: CustomEvent<{ name: string | null; names?: string[]; subMeshes?: SubMeshItem[] }>,
    ) => {
      const name = e.detail?.name ?? null;
      setSelectedModel(name);
      if (!name || !e.detail?.subMeshes) return;

      setModels((prev) => {
        const exists = prev.some((m) => m.name === name);
        if (!exists) {
          return [...prev, { id: nextId('body'), name, children: e.detail.subMeshes!, features: [] }];
        }
        return prev.map((m) => (m.name === name ? { ...m, children: e.detail.subMeshes! } : m));
      });
    };

    const handleMeshDeleted = (e: CustomEvent<{ name?: string }>) => {
      const deleted = e.detail?.name;
      if (deleted) {
        setModels((prev) => prev.filter((m) => m.name !== deleted));
        setSelectedModel((cur) => (cur === deleted ? null : cur));
      } else {
        setModels([]);
        setSelectedModel(null);
      }
    };

    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    window.addEventListener('apex-mesh-deleted', handleMeshDeleted as EventListener);
    window.addEventListener('apex-delete-all-models', handleMeshDeleted as EventListener);

    return () => {
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
      window.removeEventListener('apex-mesh-deleted', handleMeshDeleted as EventListener);
      window.removeEventListener('apex-delete-all-models', handleMeshDeleted as EventListener);
    };
  }, []);

  /** Indicateur coulissant du sélecteur de granularité (même technique que AxisSidebar). */
  useEffect(() => {
    if (!segmentedRef.current) return;
    const activeBtn = segmentRefs.current.get(selectionMode);
    if (!activeBtn) return;

    const barRect = segmentedRef.current.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setIndicatorStyle({
      width: btnRect.width,
      height: btnRect.height,
      left: btnRect.left - barRect.left,
      top: btnRect.top - barRect.top,
      opacity: 1,
    });
  }, [selectionMode]);

  /** L'arbre est la source de vérité : toute mutation déclenche un replay côté viewport. */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('apex-feature-tree-updated', { detail: { models } }));
  }, [models]);

  const handleSelectionMode = (mode: SelectionMode) => {
    setSelectionMode(mode);
    window.dispatchEvent(new CustomEvent('apex-selection-mode-changed', { detail: { mode } }));
  };

  const targetModel = models.find((m) => m.name === selectedModel) ?? null;

  // Le choix du plan d'esquisse se fait de façon asynchrone dans le viewport (l'utilisateur
  // clique une plaque de plan ou une face) : au moment où `apex-sketch-plane-selected`
  // arrive, il faut le corps ciblé et la forme active *à cet instant*, pas ceux capturés à
  // l'inscription du listener — d'où ces refs tenues à jour à chaque rendu.
  const targetModelRef = useRef<ModelNode | null>(targetModel);
  useEffect(() => { targetModelRef.current = targetModel; }, [targetModel]);
  const sketchEntityRef = useRef<SketchEntityKind>(sketchEntity);
  useEffect(() => { sketchEntityRef.current = sketchEntity; }, [sketchEntity]);

  /** Reçoit le plan choisi dans le viewport et crée seulement alors la feature esquisse. */
  useEffect(() => {
    const handlePlaneSelected = (e: CustomEvent<SketchPlaneRef>) => {
      const planeRef = e.detail;
      const model = targetModelRef.current;

      if (!model) {
        // Pas de corps existant : l'esquisse reste « flottante » jusqu'à l'extrusion, qui
        // en créera un — rien à stocker dans l'arborescence pour l'instant.
        window.dispatchEvent(
          new CustomEvent('apex-sketch-tool', { detail: { entity: sketchEntityRef.current, sketchId: null, planeRef } }),
        );
        return;
      }

      const id = nextId('sketch');
      const index = model.features.filter((f) => f.kind === 'sketch').length + 1;
      const name = `${FEATURE_LABELS.sketch} ${index}`;
      const feature: Feature = { id, name, kind: 'sketch', planeRef, entities: [] };

      setModels((prev) => prev.map((m) => (m.id === model.id ? { ...m, features: [...m.features, feature] } : m)));
      setSelectedFeatureId(id);
      setExpanded((prev) => ({ ...prev, [model.id]: true }));
      showSuccess(`${name} ajoutée à ${model.name}.`);
      window.dispatchEvent(
        new CustomEvent('apex-sketch-tool', { detail: { entity: sketchEntityRef.current, sketchId: id, planeRef } }),
      );
    };

    window.addEventListener('apex-sketch-plane-selected', handlePlaneSelected as EventListener);
    return () => window.removeEventListener('apex-sketch-plane-selected', handlePlaneSelected as EventListener);
  }, []);

  const handleToolClick = (kind: FeatureKind) => {
    // Re-cliquer sur l'outil actif le désactive (même convention que la Sidebar principale).
    if (activeTool === kind) {
      setActiveTool(null);
      window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
      if (kind === 'sketch') window.dispatchEvent(new CustomEvent('apex-sketch-plane-pick-cancel'));
      return;
    }

    if (!targetModel && kind !== 'sketch') {
      showError('Sélectionnez un corps dans l\'arborescence.');
      return;
    }

    const sketchId = targetModel?.features.filter((f) => f.kind === 'sketch').slice(-1)[0]?.id ?? null;
    if ((kind === 'extrude' || kind === 'revolve') && !sketchId) {
      showError('Créez d\'abord une esquisse à extruder.');
      return;
    }

    setActiveTool(kind);
    window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: kind } }));

    if (kind === 'sketch') {
      // Le plan se choisit dans le viewport (plaque d'axe ou face d'un corps) : la feature
      // n'est créée qu'à la réception de `apex-sketch-plane-selected` (effet dédié plus haut).
      window.dispatchEvent(new CustomEvent('apex-sketch-plane-pick-start'));
      return;
    }

    if (!targetModel) return; // uniquement possible pour 'sketch', déjà traité ci-dessus

    const id = nextId(kind);
    const index = targetModel.features.filter((f) => f.kind === kind).length + 1;
    const name = `${FEATURE_LABELS[kind]} ${index}`;

    let feature: Feature;
    switch (kind) {
      case 'extrude':
        feature = { id, name, kind, sketchId: sketchId!, distance: 10, symmetric: false };
        break;
      case 'revolve':
        feature = { id, name, kind, sketchId: sketchId!, axis: { x: 0, y: 1, z: 0 }, angle: 360 };
        break;
      case 'fillet':
        feature = { id, name, kind, targetIds: [], radius: 2 };
        break;
      case 'chamfer':
        feature = { id, name, kind, targetIds: [], distance: 2 };
        break;
      case 'mirror':
        feature = { id, name, kind, center: { x: 0, y: 0, z: 0 } };
        break;
    }

    setModels((prev) =>
      prev.map((m) => (m.id === targetModel.id ? { ...m, features: [...m.features, feature] } : m)),
    );
    setSelectedFeatureId(id);
    setExpanded((prev) => ({ ...prev, [targetModel.id]: true }));
    showSuccess(`${name} ajoutée à ${targetModel.name}.`);
  };

  const handleSketchEntity = (kind: SketchEntityKind) => {
    setSketchEntity(kind);
    const sketchId =
      targetModel?.features.find((f) => f.id === selectedFeatureId && f.kind === 'sketch')?.id ?? null;
    window.dispatchEvent(new CustomEvent('apex-sketch-tool', { detail: { entity: kind, sketchId } }));
  };

  const updateFeature = (modelId: string, featureId: string, patch: Partial<Feature>) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id !== modelId
          ? m
          : { ...m, features: m.features.map((f) => (f.id === featureId ? ({ ...f, ...patch } as Feature) : f)) },
      ),
    );
  };

  const deleteFeature = (modelId: string, featureId: string) => {
    setModels((prev) =>
      prev.map((m) => (m.id !== modelId ? m : { ...m, features: m.features.filter((f) => f.id !== featureId) })),
    );
    setSelectedFeatureId((cur) => (cur === featureId ? null : cur));
  };

  const toggleSuppress = (modelId: string, featureId: string) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id !== modelId
          ? m
          : { ...m, features: m.features.map((f) => (f.id === featureId ? { ...f, suppressed: !f.suppressed } : f)) },
      ),
    );
  };

  const selectModelInViewport = (name: string) => {
    setSelectedModel(name);
    window.dispatchEvent(new CustomEvent('apex-select-model', { detail: { name } }));
  };

  const toggleExpand = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedFeature =
    targetModel?.features.find((f) => f.id === selectedFeatureId) ?? null;

  return (
    <>
      {/* ---------- Panneau latéral : arborescence des corps ---------- */}
      <div className={styles.container} data-apex-chrome-panel>
        <motion.div
          className={styles.panel}
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className={styles.header}>
            <Box className={clsx('w-4 h-4', styles.headerIcon)} />
            Modélisation
          </div>

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
                  className={clsx(styles.segmentButton, { [styles.active]: selectionMode === mode })}
                  onClick={() => handleSelectionMode(mode)}
                  disabled={!enabled}
                >
                  {label}
                </button>
              </CustomTooltip>
            ))}
          </div>

          <div className={styles.sectionLabel}>Corps</div>
          <div className={styles.treeScroll}>
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
          </div>

          {/* ---- Paramètres de la feature sélectionnée ---- */}
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
                    <span className={styles.paramLabel} style={{ color: 'rgba(0,240,255,0.85)' }}>
                      Face sélectionnée
                    </span>
                  </div>
                )}

                {selectedFeature.kind === 'extrude' && (
                  <>
                    <div className={styles.paramRow}>
                      <span className={styles.paramLabel}>Distance (mm)</span>
                      <input
                        type="number"
                        className={styles.paramInput}
                        value={selectedFeature.distance}
                        step={0.5}
                        onChange={(e) =>
                          updateFeature(targetModel.id, selectedFeature.id, { distance: Number(e.target.value) })
                        }
                      />
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
                    <input
                      type="number"
                      className={styles.paramInput}
                      value={selectedFeature.angle}
                      min={1}
                      max={360}
                      onChange={(e) =>
                        updateFeature(targetModel.id, selectedFeature.id, { angle: Number(e.target.value) })
                      }
                    />
                  </div>
                )}

                {selectedFeature.kind === 'fillet' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Rayon (mm)</span>
                    <input
                      type="number"
                      className={styles.paramInput}
                      value={selectedFeature.radius}
                      step={0.5}
                      min={0.1}
                      onChange={(e) =>
                        updateFeature(targetModel.id, selectedFeature.id, { radius: Number(e.target.value) })
                      }
                    />
                  </div>
                )}

                {selectedFeature.kind === 'chamfer' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Distance (mm)</span>
                    <input
                      type="number"
                      className={styles.paramInput}
                      value={selectedFeature.distance}
                      step={0.5}
                      min={0.1}
                      onChange={(e) =>
                        updateFeature(targetModel.id, selectedFeature.id, { distance: Number(e.target.value) })
                      }
                    />
                  </div>
                )}

                {selectedFeature.kind === 'mirror' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Centre X</span>
                    <input
                      type="number"
                      className={styles.paramInput}
                      value={selectedFeature.center.x}
                      onChange={(e) =>
                        updateFeature(targetModel.id, selectedFeature.id, {
                          center: { ...selectedFeature.center, x: Number(e.target.value) },
                        })
                      }
                    />
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
        </motion.div>
      </div>

      {/* ---------- Barre d'opérations : icônes seules, pleine largeur, au-dessus du statut ---------- */}
      <motion.div
        className={styles.opsBar}
        data-apex-chrome-panel
        // Se déploie horizontalement pendant que la barre slicer se rétracte au même
        // endroit : les deux mouvements se croisent et se lisent comme un seul morph.
        initial={{ opacity: 0, scaleX: 0.55 }}
        animate={{ opacity: 1, scaleX: 1 }}
        exit={{ opacity: 0, scaleX: 0.55 }}
        transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className={styles.opsBarInner}>
          {TOOLS.map(({ kind, icon: Icon, description }) => (
            <CustomTooltip key={kind} content={FEATURE_LABELS[kind]} description={description}>
              <button
                className={clsx(styles.barButton, { [styles.active]: activeTool === kind })}
                onClick={() => handleToolClick(kind)}
                aria-label={FEATURE_LABELS[kind]}
              >
                <Icon className="w-5 h-5" />
              </button>
            </CustomTooltip>
          ))}
        </div>
      </motion.div>

      {/* ---------- Petite barre des formes d'esquisse, juste sous la barre principale ---------- */}
      <AnimatePresence initial={false}>
        {activeTool === 'sketch' && (
          <motion.div
            className={styles.sketchBar}
            data-apex-chrome-panel
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className={styles.sketchBarInner}>
              {SKETCH_ENTITIES.map(({ kind, icon: Icon }) => (
                <CustomTooltip
                  key={kind}
                  content={SKETCH_ENTITY_LABELS[kind]}
                  description="Sommets connectables aux autres formes de l'esquisse."
                >
                  <button
                    className={clsx(styles.barButton, { [styles.active]: sketchEntity === kind })}
                    onClick={() => handleSketchEntity(kind)}
                    aria-label={SKETCH_ENTITY_LABELS[kind]}
                  >
                    <Icon className="w-5 h-5" />
                  </button>
                </CustomTooltip>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
