import React from 'react';
import clsx from 'clsx';
import { FolderOpen, Save, Printer } from 'lucide-react';
import styles from './FileSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';

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
        <CustomTooltip content="Open Model">
          <button
            className={clsx(styles.button)}
            onClick={onOpenModel}
          >
            <FolderOpen size={18} />
          </button>
        </CustomTooltip>

        <CustomTooltip content="Save Project">
          <button
            className={clsx(styles.button)}
            onClick={onSaveProject}
          >
            <Save size={18} />
          </button>
        </CustomTooltip>

        <div className={styles.separator} />

        <CustomTooltip content="Printer: Prusa MK4 | Filament: PLA">
          <button
            className={clsx(styles.button, styles.configButton)}
            onClick={onOpenSettings}
          >
            <Printer size={18} />
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};