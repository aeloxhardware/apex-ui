import React, { useEffect, useRef, useState } from 'react';
import styles from './ModelStatusBox.module.scss';
import { Box, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ELEMENTS_FADE_MS, MODEL_TREE_TOP, MODEL_TREE_PILL_GAP, PILL_TOP } from '@/utils/spaceMorphGeometry';

interface SubMeshItem {
  id: string;
  name: string;
  color: string;
}

interface ModelItem {
  id: string;
  name: string;
  children: SubMeshItem[];
}

export const ModelStatusBox: React.FC = () => {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [selectedModelNames, setSelectedModelNames] = useState<Set<string>>(new Set());
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});
  const [previewActive, setPreviewActive] = useState(false);
  // Le mode modélisation a sa propre arborescence (les corps) : celle des modèles importés
  // ferait doublon, on l'escamote comme en mode Prévisualisation.
  const [modelingActive, setModelingActive] = useState(false);
  // Vrai dès le clic vers Prévisualisation : sortie rapide (ELEMENTS_FADE_MS) plutôt que 0,9 s.
  const [enteringPreview, setEnteringPreview] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let fallbackTimer: number | undefined;
    const handlePreviewToggled = (e: CustomEvent<{ active: boolean }>) => {
      window.clearTimeout(fallbackTimer);
      if (e.detail?.active) {
        setPreviewActive(true);
        return;
      }
      // Sortie de Prévisualisation : la boîte ne revient qu'APRÈS la déformation inverse de la
      // pilule (apex-preview-morph-done). Repli temporisé si CategoriesSidebar n'est pas monté
      // (sortie directe vers Modélisation) et n'émet donc jamais l'événement.
      fallbackTimer = window.setTimeout(() => {
        setEnteringPreview(false);
        setPreviewActive(false);
      }, 1700);
    };
    const handlePreviewMorphDone = () => {
      window.clearTimeout(fallbackTimer);
      setEnteringPreview(false);
      setPreviewActive(false);
    };
    const handleModeChanged = (e: CustomEvent<{ mode: 'slicer' | 'modeling' }>) => {
      setModelingActive(e.detail?.mode === 'modeling');
    };
    // Dispatché par Sidebar.tsx dès le CLIC vers Modélisation, avant même que le rideau plein écran
    // ne commence à monter — ce panneau doit disparaître EN TRANSPARENCE À TRAVERS le rideau qui
    // monte (cf. ELEMENTS_FADE_MS), pas seulement une fois `apex-mode-changed` reçu (dispatché par
    // ModelingSidebar à son montage, lui-même retardé jusqu'à ce que le rideau ait fini de couvrir
    // l'écran — bien trop tard pour ce fondu).
    const handleEnteringModeling = () => setModelingActive(true);
    // Idem vers Prévisualisation (dispatché par Sidebar.tsx dès le clic) : la boîte doit avoir
    // totalement disparu avant que la pilule ne commence à se déformer.
    const handleEnteringPreview = () => {
      setEnteringPreview(true);
      setPreviewActive(true);
    };
    window.addEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    window.addEventListener('apex-mode-changed', handleModeChanged as EventListener);
    window.addEventListener('apex-entering-modeling', handleEnteringModeling);
    window.addEventListener('apex-entering-preview', handleEnteringPreview);
    window.addEventListener('apex-preview-morph-done', handlePreviewMorphDone);
    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener('apex-preview-morph-done', handlePreviewMorphDone);
      window.removeEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
      window.removeEventListener('apex-mode-changed', handleModeChanged as EventListener);
      window.removeEventListener('apex-entering-modeling', handleEnteringModeling);
      window.removeEventListener('apex-entering-preview', handleEnteringPreview);
    };
  }, []);

  useEffect(() => {
    const handleMeshSelected = (e: CustomEvent<{ name: string | null; names?: string[]; subMeshes?: SubMeshItem[] }>) => {
      setSelectedModelNames(new Set(e.detail?.names ?? (e.detail?.name ? [e.detail.name] : [])));
      if (e.detail?.name) {
        setSelectedModelName(e.detail.name);
        if (e.detail.subMeshes) {
          setModels(prev => {
            const exists = prev.some(m => m.name === e.detail.name);
            if (!exists) {
              return [...prev, {
                id: Date.now().toString(),
                name: e.detail.name!,
                children: e.detail.subMeshes!
              }];
            }
            return prev.map(m => m.name === e.detail.name ? { ...m, children: e.detail.subMeshes! } : m);
          });
        }
      } else {
        setSelectedModelName(null);
      }
    };

    const handleImportModel = (e: CustomEvent<File>) => {
      if (e.detail) {
        const fileName = e.detail.name;
        setSelectedModelName(fileName);
      }
    };

    const handleMeshDeleted = (e: CustomEvent<{ name?: string }>) => {
      const deletedName = e.detail?.name;
      if (deletedName) {
        setModels(prev => prev.filter(m => m.name !== deletedName));
        if (selectedModelName === deletedName) {
          setSelectedModelName(null);
        }
        setSelectedModelNames(prev => {
          const next = new Set(prev);
          next.delete(deletedName);
          return next;
        });
      } else {
        setModels([]);
        setSelectedModelName(null);
        setSelectedModelNames(new Set());
      }
    };

    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    window.addEventListener('apex-import-model', handleImportModel as EventListener);
    window.addEventListener('apex-mesh-deleted', handleMeshDeleted as EventListener);

    return () => {
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
      window.removeEventListener('apex-import-model', handleImportModel as EventListener);
      window.removeEventListener('apex-mesh-deleted', handleMeshDeleted as EventListener);
    };
  }, [selectedModelName]);

  const toggleExpand = (modelName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedModels(prev => ({
      ...prev,
      [modelName]: !prev[modelName]
    }));
  };

  // Ce panneau grandit avec l'arborescence (dépliage d'un modèle) : la pilule Qualité/Solidité/
  // Vitesse (CategoriesSidebar), positionnée juste en-dessous, doit alors être repoussée d'autant
  // pour que la marge (MODEL_TREE_PILL_GAP) reste TOUJOURS respectée, plutôt que de se faire
  // recouvrir ou coller. On mesure la hauteur réellement rendue et on ne diffuse un décalage que
  // lorsque le bord bas réel + la marge dépasse la position par défaut de la pilule (PILL_TOP).
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || previewActive || modelingActive) {
      window.dispatchEvent(new CustomEvent('apex-model-tree-resized', { detail: { overflow: 0 } }));
      return;
    }
    const notify = () => {
      const requiredTop = MODEL_TREE_TOP + el.offsetHeight + MODEL_TREE_PILL_GAP;
      const overflow = Math.max(0, requiredTop - PILL_TOP);
      window.dispatchEvent(new CustomEvent('apex-model-tree-resized', { detail: { overflow } }));
    };
    const observer = new ResizeObserver(notify);
    observer.observe(el);
    notify();
    return () => {
      observer.disconnect();
      window.dispatchEvent(new CustomEvent('apex-model-tree-resized', { detail: { overflow: 0 } }));
    };
  }, [previewActive, modelingActive]);

  return (
    <div className={styles.container} data-apex-chrome-panel>
      <AnimatePresence custom={modelingActive || enteringPreview}>
        {!previewActive && !modelingActive && (
          <motion.div
            ref={toolbarRef}
            className={styles.toolbar}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            // Vers Modélisation / Prévisualisation : ce panneau doit avoir fini de disparaître AVANT
            // que le morph ne commence à se déformer (cf. ELEMENTS_FADE_MS) — sa durée de sortie
            // doit donc correspondre à ce délai, plus court que la transition générique (0.9s)
            // utilisée pour les autres sorties (ex. vers Dev). `custom` (et non une prop figée au
            // dernier rendu) pour que la valeur soit celle du moment du démontage.
            custom={modelingActive || enteringPreview}
            variants={{
              exit: (fast: boolean) => ({
                opacity: 0,
                x: -20,
                transition: {
                  duration: fast ? ELEMENTS_FADE_MS / 1000 : 0.9,
                  ease: fast ? 'easeInOut' : 'linear',
                },
              }),
            }}
            exit="exit"
            transition={{
              opacity: { duration: 0.9, ease: 'linear' },
              x: { duration: 0.9, ease: 'easeInOut' },
            }}
          >
        <div className={styles.content}>
          {models.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className={styles.emptyText}
            >
              Aucun modèle sur le plateau
            </motion.div>
          ) : (
            <ul className={styles.treeList}>
              <AnimatePresence>
                {models.map((model) => {
                  const isSelected = selectedModelNames.has(model.name);
                  const isExpanded = !!expandedModels[model.name];
                  return (
                    <motion.li 
                      key={model.id} 
                      className={styles.treeNode}
                      initial={{ opacity: 0, height: 0, scale: 0.9 }}
                      animate={{ opacity: 1, height: 'auto', scale: 1 }}
                      exit={{ opacity: 0, height: 0, scale: 0.9, marginBottom: 0 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <div 
                        className={`${styles.nodeRow} ${isSelected ? styles.selectedNode : ''}`}
                        onClick={(e) => {
                          setSelectedModelName(model.name);
                          window.dispatchEvent(new CustomEvent('apex-select-model', {
                            detail: { name: model.name, additive: e.ctrlKey || e.metaKey }
                          }));
                        }}
                      >
                        <button 
                          className="bg-transparent border-none cursor-pointer p-0 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
                          onClick={(e) => toggleExpand(model.name, e)}
                        >
                          <ChevronRight 
                            size={14} 
                            className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} 
                          />
                        </button>
                        <Box size={14} className="text-[#00f0ff] ml-1" />
                        <span className={styles.nodeName}>{model.name}</span>
                      </div>
                      <AnimatePresence>
                        {isExpanded && model.children && model.children.length > 0 && (
                          <motion.ul 
                            className={styles.childList}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                          >
                            {model.children.map(child => (
                              <li key={child.id} className={styles.childRow}>
                                <span 
                                  className="w-2.5 h-2.5 rounded-full shrink-0 mr-1.5 shadow-sm" 
                                  style={{ backgroundColor: child.color }} 
                                />
                                <span className={styles.childName}>{child.name}</span>
                              </li>
                            ))}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};