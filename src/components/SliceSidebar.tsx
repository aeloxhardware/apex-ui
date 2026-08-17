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
        <CustomTooltip content="Slice Plate">
          <button
            className={clsx(styles.button, styles.sliceButton)}
            onClick={onSlice}
          >
            <Play size={16} className="fill-current mr-2 z-10 relative" />
            <span className="font-semibold text-xs tracking-wide z-10 relative">SLICE</span>
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};