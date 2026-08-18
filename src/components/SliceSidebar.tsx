import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Play } from 'lucide-react';
import styles from './SliceSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';

interface SliceSidebarProps {
  onSlice?: () => void;
}

export const SliceSidebar: React.FC<SliceSidebarProps> = ({ onSlice }) => {
  const [hasModels, setHasModels] = useState(false);

  useEffect(() => {
    const handleMeshSelected = (e: CustomEvent<{ name: string | null }>) => {
      if (e.detail?.name) {
        setHasModels(true);
      } else {
        setHasModels(false);
      }
    };

    const handleMeshDeleted = (e: CustomEvent<{ name?: string }>) => {
      // If needed we can track remaining meshes, but for now if mesh deleted or plate cleared
      if (!e.detail?.name) {
        setHasModels(false);
      }
    };

    const handleImportModel = () => {
      setHasModels(true);
    };

    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    window.addEventListener('apex-mesh-deleted', handleMeshDeleted as EventListener);
    window.addEventListener('apex-import-model', handleImportModel as EventListener);

    return () => {
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
      window.removeEventListener('apex-mesh-deleted', handleMeshDeleted as EventListener);
      window.removeEventListener('apex-import-model', handleImportModel as EventListener);
    };
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <CustomTooltip 
          content={hasModels ? "Lancer le Slicing (Découpe)" : "Aucun modèle sur le plateau"} 
          description={hasModels ? "Lancez le calcul complet du G-code pour transformer votre modèle 3D en trajectoires d'impression exploitables." : "Veuillez importer un modèle 3D sur le plateau pour activer le slicing."}
        >
          <button
            className={clsx(styles.button, styles.sliceButton, "w-full", {
              [styles.disabledButton]: !hasModels
            })}
            onClick={hasModels ? onSlice : undefined}
            disabled={!hasModels}
          >
            <Play size={16} className="fill-current mr-2 shrink-0" />
            <span className="font-semibold text-xs tracking-wide">SLICE</span>
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};