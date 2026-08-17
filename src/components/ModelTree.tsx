import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { Box, Eye, EyeOff, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import styles from './ModelTree.module.scss';
import { CustomTooltip } from './CustomTooltip';

interface ModelItem {
  id: string;
  name: string;
  visible: boolean;
}

export const ModelTree: React.FC = () => {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const handleMeshSelected = (e: Event) => {
      const customEvent = e as CustomEvent<{ name: string | null }>;
      if (customEvent.detail && customEvent.detail.name) {
        // Find or add
        const name = customEvent.detail.name;
        setModels((prev) => {
          const exists = prev.find((m) => m.name === name);
          if (!exists) {
            return [...prev, { id: name, name, visible: true }];
          }
          return prev;
        });
        setSelectedId(name);
      } else {
        setSelectedId(null);
      }
    };

    const handleImportModel = (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (file) {
        const name = file.name;
        setModels((prev) => [...prev, { id: name + Date.now(), name, visible: true }]);
        setSelectedId(name + Date.now());
      }
    };

    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    window.addEventListener('apex-import-model', handleImportModel as EventListener);

    return () => {
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
      window.removeEventListener('apex-import-model', handleImportModel as EventListener);
    };
  }, []);

  if (models.length === 0) return null;

  return (
    <div className={styles.container}>
      <div className={styles.header} onClick={() => setIsOpen(!isOpen)}>
        <div className={styles.headerTitle}>
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span>Modèles sur le Plateau ({models.length})</span>
        </div>
      </div>

      {isOpen && (
        <div className={styles.list}>
          {models.map((model) => (
            <div
              key={model.id}
              className={clsx(styles.item, {
                [styles.selected]: selectedId === model.name,
              })}
              onClick={() => {
                setSelectedId(model.name);
                window.dispatchEvent(
                  new CustomEvent('apex-select-model-by-name', { detail: { name: model.name } })
                );
              }}
            >
              <div className={styles.itemInfo}>
                <Box size={14} className={styles.icon} />
                <span className={styles.name} title={model.name}>{model.name}</span>
              </div>
              <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
                <button
                  className={styles.actionBtn}
                  onClick={() => {
                    setModels(
                      models.map((m) => (m.id === model.id ? { ...m, visible: !m.visible } : m))
                    );
                    window.dispatchEvent(
                      new CustomEvent('apex-toggle-visibility', { detail: { name: model.name, visible: !model.visible } })
                    );
                  }}
                >
                  {model.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => {
                    setModels(models.filter((m) => m.id !== model.id));
                    if (selectedId === model.name) setSelectedId(null);
                    window.dispatchEvent(
                      new CustomEvent('apex-delete-model', { detail: { name: model.name } })
                    );
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};