import React from 'react';
import clsx from 'clsx';
import { FolderOpen, Save, Printer, Volume2, VolumeX } from 'lucide-react';
import styles from './FileSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { useUiSoundMuted } from '@/hooks/use-ui-sounds';

interface FileSidebarProps {
  onOpenModel?: () => void;
  onSaveProject?: () => void;
  onOpenSettings?: () => void;
  onOpenPrinterConfig?: () => void;
  selectedPrinter?: string;
  selectedFilament?: string;
}

export const FileSidebar: React.FC<FileSidebarProps> = ({
  onOpenModel,
  onSaveProject,
  onOpenSettings,
  onOpenPrinterConfig,
  selectedPrinter = 'Prusa MK4',
  selectedFilament = 'PLA Premium 1.75mm',
}) => {
  const [soundMuted, toggleSoundMuted] = useUiSoundMuted();

  return (
    <div className={styles.container} data-apex-chrome-panel>
      <div className={styles.toolbar}>
        <CustomTooltip content="Ouvrir un Projet" description="Chargez un projet 3D enregistré précédemment avec ses configurations complètes.">
          <button
            className={clsx(styles.button)}
            onClick={onOpenModel}
          >
            <FolderOpen size={18} />
          </button>
        </CustomTooltip>

        <CustomTooltip content="Sauvegarder le Projet" description="Enregistrez l'état actuel de votre plateau et vos réglages dans un fichier de projet.">
          <button
            className={clsx(styles.button)}
            onClick={onSaveProject}
          >
            <Save size={18} />
          </button>
        </CustomTooltip>

        <div className={styles.separator} />

        <CustomTooltip content="Configuration Imprimante & Filament" description={`Imprimante active : ${selectedPrinter} | Filament sélectionné : ${selectedFilament}. Cliquez pour modifier.`}>
          <button
            className={clsx(styles.button, styles.configButton)}
            onClick={onOpenPrinterConfig || onOpenSettings}
          >
            <Printer size={18} />
          </button>
        </CustomTooltip>

        <div className={styles.separator} />

        <CustomTooltip content={soundMuted ? 'Activer les sons' : 'Couper les sons'} description="Active ou coupe les sons de survol et de clic de l'interface. Coupés par défaut.">
          <button
            className={clsx(styles.button)}
            onClick={toggleSoundMuted}
          >
            {soundMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};