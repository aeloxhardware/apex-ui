import React, { useState } from 'react';
import clsx from 'clsx';
import styles from './AxisSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { showSuccess } from '@/utils/toast';

export const AxisSidebar: React.FC = () => {
  const [axisMode, setAxisMode] = useState<'3-axes' | '5-axes'>('3-axes');

  const handleSelect = (mode: '3-axes' | '5-axes') => {
    setAxisMode(mode);
    showSuccess(`Mode d'impression configuré : ${mode === '3-axes' ? '3 Axes Standard' : '5 Axes Avancé'}`);
    window.dispatchEvent(new CustomEvent('apex-axis-changed', { detail: { mode } }));
  };

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <CustomTooltip content="Mode 3 Axes" description="Impression 3D cartésienne / delta standard (X, Y, Z).">
          <button
            className={clsx(styles.button, {
              [styles.active]: axisMode === '3-axes',
            })}
            onClick={() => handleSelect('3-axes')}
          >
            3 AXES
          </button>
        </CustomTooltip>

        <CustomTooltip content="Mode 5 Axes" description="Impression continue 5 axes avec tête inclinable et plateau rotatif (Cinématique avancée).">
          <button
            className={clsx(styles.button, {
              [styles.active]: axisMode === '5-axes',
            })}
            onClick={() => handleSelect('5-axes')}
          >
            5 AXES
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};