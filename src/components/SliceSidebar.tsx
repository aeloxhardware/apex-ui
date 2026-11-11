import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTopRightSlot } from './topRightSlot';
import clsx from 'clsx';
import { Play, Download } from 'lucide-react';
import styles from './SliceSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';

import { emitApex } from '@/events/apexEvents';
interface SliceSidebarProps {
  onSlice?: () => void;
  /** Espace Prévisualisation : le bouton exporte le G-code affiché au lieu de lancer le slicing. */
  previewExport?: {
    enabled: boolean;
    onExport: () => void;
    /** Pourquoi l'export est indisponible (tooltip). */
    reason: string;
  } | undefined;
}

export const SliceSidebar: React.FC<SliceSidebarProps> = ({ onSlice, previewExport }) => {
  const [hasModels, setHasModels] = useState(false);
  const slot = useTopRightSlot();
  /** Dans la rangée en haut à droite (portail) si elle existe ; sinon posé à sa place par le CSS (`position: fixed`). */
  const place = (node: React.ReactElement) => (slot ? createPortal(node, slot) : node);

  // SLICE tranche tous les modèles du plateau, pas la sélection : le bouton suit la liste réelle des
  // modèles (réponse de Viewport3D à `apex-request-slice-models`), jamais la sélection.
  useEffect(() => {
    const refresh = () => emitApex('apex-request-slice-models');
    const handleModelList = (e: CustomEvent<{ names?: string[] }>) => {
      setHasModels((e.detail?.names?.length ?? 0) > 0);
    };
    // Une suppression est traitée par Viewport3D après l'événement : on relit la liste juste après.
    const handleMeshDeleted = () => { window.setTimeout(refresh, 100); };
    const handleImportModel = () => {
      setHasModels(true);
    };

    window.addEventListener('apex-slice-models', handleModelList as EventListener);
    window.addEventListener('apex-mesh-deleted', handleMeshDeleted);
    window.addEventListener('apex-import-model', handleImportModel as EventListener);
    refresh();

    return () => {
      window.removeEventListener('apex-slice-models', handleModelList as EventListener);
      window.removeEventListener('apex-mesh-deleted', handleMeshDeleted);
      window.removeEventListener('apex-import-model', handleImportModel as EventListener);
    };
  }, []);

  if (previewExport) {
    const { enabled, onExport, reason } = previewExport;
    return place(
      <div className={clsx(styles.container, slot && styles.inSlot)} data-apex-chrome-panel>
        <div
          className={styles.toolbar}
          data-apex-tooltip="Barre d'export : enregistre le G-code affiché pour l'imprimer."
        >
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

  return place(
    <div className={clsx(styles.container, slot && styles.inSlot)} data-apex-chrome-panel>
      <div
        className={styles.toolbar}
        data-apex-tooltip="Découper le plateau : lance le calcul du G-code du plateau (slicing). Bouton placé en haut à droite, à gauche du sélecteur d'axes."
      >
        <CustomTooltip 
          content={hasModels ? "Découper le plateau" : "Aucun modèle sur le plateau"} 
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
            <span className="font-semibold text-xs tracking-wide">Découper le plateau</span>
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};