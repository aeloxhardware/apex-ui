import React, { useEffect, useState } from 'react';
import styles from './ModelStatusBox.module.scss';
import { Box, ChevronRight, Layers } from 'lucide-react';

interface ModelItem {
  id: string;
  name: string;
  children?: { id: string; name: string }[];
}

export const ModelStatusBox: React.FC = () => {
  const [models, setModels] = useState<ModelItem[]>([
    { 
      id: '1', 
      name: 'Benchy_v3.stl',
      children: [
        { id: '1-1', name: 'Coque principale' },
        { id: '1-2', name: 'Cabine & Cheminée' }
      ]
    }
  ]);
  const [selectedModelName, setSelectedModelName] = useState<string | null>('Benchy_v3.stl');

  useEffect(() => {
    const handleMeshSelected = (e: CustomEvent<{ name: string | null }>) => {
      if (e.detail?.name) {
        setSelectedModelName(e.detail.name);
      } else {
        setSelectedModelName(null);
      }
    };

    const handleImportModel = (e: CustomEvent<File>) => {
      if (e.detail) {
        const fileName = e.detail.name;
        const newModel: ModelItem = {
          id: Date.now().toString(),
          name: fileName,
          children: [{ id: `${Date.now()}-1`, name: 'Maillage STL' }]
        };
        setModels(prev => [...prev, newModel]);
        setSelectedModelName(fileName);
      }
    };

    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    window.addEventListener('apex-import-model', handleImportModel as EventListener);

    return () => {
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
      window.removeEventListener('apex-import-model', handleImportModel as EventListener);
    };
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.header}>
          <Layers size={16} className="text-[#00f0ff]" />
          <span className={styles.title}>Arborescence des Modèles</span>
        </div>
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
                            <span className={styles.childDot}>•</span>
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
    </div>
  );
};