import React, { useEffect, useState } from 'react';
import styles from './ModelStatusBox.module.scss';
import { Box, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
  const [isPreviewActive, setIsPreviewActive] = useState(false);

  useEffect(() => {
    const handleMeshSelected = (e: CustomEvent<{ name: string | null; subMeshes?: SubMeshItem[] }>) => {
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

    const handlePreviewToggled = (e: CustomEvent<{ active: boolean }>) => {
      if (e.detail) {
        setIsPreviewActive(e.detail.active);
      }
    };

    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    window.addEventListener('apex-import-model', handleImportModel as EventListener);
    window.addEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);

    return () => {
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
      window.removeEventListener('apex-import-model', handleImportModel as EventListener);
      window.removeEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    };
  }, []);

  return (
    <AnimatePresence>
      {!isPreviewActive && (
        <motion.div 
          className={styles.container}
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -350 }}
          transition={{ duration: 0.35, ease: [0.25, 1, 0.5, 1], delay: 0.05 }}
        >
          <div className={styles.toolbar}>
            <div className={styles.content}>
              {models.length === 0 ? (
                <div className={styles.emptyText}>Aucun modèle sur le plateau</div>
              ) : (
                <ul className={styles.treeList}>
                  {models.map((model) => {
                    const isSelected = selectedModelName === model.name;
                    return (
                      <li key={model.id} className={styles.treeNode}>
                        <div 
                          className={`${styles.nodeRow} ${isSelected ? styles.selectedNode : ''}`}
                          onClick={() => setSelectedModelName(model.name)}
                        >
                          <ChevronRight size={14} className="text-zinc-400 rotate-90" />
                          <Box size={14} className="text-[#00f0ff] ml-1" />
                          <span className={styles.nodeName}>{model.name}</span>
                        </div>
                        {model.children && model.children.length > 0 && (
                          <ul className={styles.childList}>
                            {model.children.map(child => (
                              <li key={child.id} className={styles.childRow}>
                                <span 
                                  className="w-2.5 h-2.5 rounded-full shrink-0 mr-1.5 shadow-sm" 
                                  style={{ backgroundColor: child.color }} 
                                />
                                <span className={styles.childName}>{child.name}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};