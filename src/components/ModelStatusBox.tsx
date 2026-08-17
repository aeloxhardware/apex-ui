import React, { useEffect, useState } from 'react';
import styles from './ModelStatusBox.module.scss';
import { Box, ChevronRight } from 'lucide-react';

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
        // Generate mock sub-parts with color pills for demonstration
        const subParts: SubMeshItem[] = [
          { id: `${Date.now()}-1`, name: 'Partie Principale (Albedo)', color: '#00f0ff' },
          { id: `${Date.now()}-2`, name: 'Détails & Relief (Normal)', color: '#8b5cf6' },
          { id: `${Date.now()}-3`, name: 'Finitions (Spéculaire)', color: '#f59e0b' }
        ];

        const newModel: ModelItem = {
          id: Date.now().toString(),
          name: fileName,
          children: subParts
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
    </div>
  );
};