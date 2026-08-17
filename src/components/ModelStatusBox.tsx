import React, { useEffect, useState } from 'react';
import styles from './ModelStatusBox.module.scss';
import { Box, ChevronRight, Play } from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';

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

    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    window.addEventListener('apex-import-model', handleImportModel as EventListener);

    return () => {
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
      window.removeEventListener('apex-import-model', handleImportModel as EventListener);
    };
  }, []);

  const handleSlice = () => {
    window.dispatchEvent(new CustomEvent('apex-start-slice'));
  };

  return (
    <div className={styles.container}>
      <div className={styles.toolbar} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
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

        {/* Bouton SLICE intégré en dessous */}
        <div className="w-full pt-2 border-t border-white/10">
          <CustomTooltip content="Lancer le Slicing (Découpe)" description="Lancez le calcul complet du G-code pour transformer votre modèle 3D en trajectoires d'impression exploitables.">
            <button
              className="flex items-center justify-center bg-[rgba(0,240,255,0.12)] hover:bg-[rgba(0,240,255,0.22)] text-[#00f0ff] py-2.5 px-4 rounded-xl border-none w-full cursor-pointer transition-all duration-200 shadow-sm hover:shadow-[0_0_12px_rgba(0,240,255,0.25)]"
              onClick={handleSlice}
            >
              <Play size={16} className="fill-current mr-2 shrink-0" />
              <span className="font-semibold text-xs tracking-wide">SLICE</span>
            </button>
          </CustomTooltip>
        </div>
      </div>
    </div>
  );
};