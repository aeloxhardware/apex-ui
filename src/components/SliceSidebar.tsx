import React from 'react';
import clsx from 'clsx';
import { Play } from 'lucide-react';
import styles from './SliceSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';

interface SliceSidebarProps {
  onSlice?: () => void;
}

export const SliceSidebar: React.FC<SliceSidebarProps> = ({ onSlice }) => {
  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <CustomTooltip content="Lancer le Slicing (Découpe)" description="Lancez le calcul complet du G-code pour transformer votre modèle 3D en trajectoires d'impression exploitables.">
          <button
            className={clsx(styles.button, styles.sliceButton)}
            onClick={onSlice}
          >
            <Play size={16} className="fill-current mr-2" />
            <span className="font-semibold text-xs tracking-wide">SLICE</span>
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};