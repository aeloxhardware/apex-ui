import React from 'react';
import clsx from 'clsx';
import { FolderOpen, Save, Printer } from 'lucide-react';
import styles from './FileSidebar.module.scss';

interface FileSidebarProps {
  onOpenModel?: () => void;
  onSaveProject?: () => void;
  onOpenSettings?: () => void;
}

export const FileSidebar: React.FC<FileSidebarProps> = ({
  onOpenModel,
  onSaveProject,
  onOpenSettings,
}) => {
  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <button
          className={clsx(styles.button)}
          onClick={onOpenModel}
          title="Open Model"
        >
          <FolderOpen size={18} />
        </button>

        <button
          className={clsx(styles.button)}
          onClick={onSaveProject}
          title="Save Project"
        >
          <Save size={18} />
        </button>

        <div className={styles.separator} />

        <button
          className={clsx(styles.button, styles.configButton)}
          onClick={onOpenSettings}
          title="Printer: Prusa MK4 | Filament: PLA (0.20mm)"
        >
          <Printer size={18} />
        </button>
      </div>
    </div>
  );
};