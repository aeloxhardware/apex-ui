import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Play, Download } from 'lucide-react';
import styles from './SliceSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';

interface SliceSidebarProps {
  onSlice?: () => void;
  /** Espace Prévisualisation : le bouton exporte le G-code affiché au lieu de lancer le slicing. */
  previewExport?: {
    enabled: boolean;
    onExport: () => void;
    /** Pourquoi l'export est indisponible (tooltip). */
    reason: string;
  };
}

export const SliceSidebar: React.FC<SliceSidebarProps> = ({ onSlice, previewExport }) => {
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

  if (previewExport) {
    const { enabled, onExport, reason } = previewExport;
    return (
      <div className={styles.container} data-apex-chrome-panel>
        <div className={styles.toolbar}>
          <CustomTooltip
            content={enabled ? 'Exporter le G-code' : 'Export indisponible'}
            description={enabled ? "Enregistre le G-code polaire affiché, prêt à être imprimé par l'Apex." : reason}
          >
            <button
              className={clsx(styles.button, styles.sliceButton, 'w-full', { [styles.disabledButton]: !enabled })}
              onClick={enabled ? onExport : undefined}
              disabled={!enabled}
            >
              <Download size={16} className="mr-2 shrink-0" />
              <span className="font-semibold text-xs tracking-wide">EXPORT</span>
            </button>
          </CustomTooltip>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container} data-apex-chrome-panel>
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