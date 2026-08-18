import React, { useEffect, useState } from 'react';
import styles from './ViewCube.module.scss';
import { CustomTooltip } from './CustomTooltip';

export const ViewCube: React.FC = () => {
  const [alpha, setAlpha] = useState(Math.PI / 4);
  const [beta, setBeta] = useState(Math.PI / 3);

  useEffect(() => {
    const handleCameraUpdated = (e: CustomEvent<{ alpha: number; beta: number }>) => {
      if (e.detail) {
        setAlpha(e.detail.alpha);
        setBeta(e.detail.beta);
      }
    };

    window.addEventListener('apex-camera-updated', handleCameraUpdated as EventListener);
    return () => {
      window.removeEventListener('apex-camera-updated', handleCameraUpdated as EventListener);
    };
  }, []);

  const setView = (view: 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom') => {
    window.dispatchEvent(
      new CustomEvent('apex-set-camera-view', { detail: { view } })
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.widget}>
        {/* SVG lines connecting axes */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-80" viewBox="0 0 120 120">
          <line x1="60" y1="60" x2="88" y2="88" stroke="#ef4444" strokeWidth="2.5" />
          <line x1="60" y1="60" x2="96" y2="60" stroke="#22c55e" strokeWidth="2.5" />
          <line x1="60" y1="60" x2="60" y2="24" stroke="#3b82f6" strokeWidth="2.5" />
          <line x1="60" y1="60" x2="32" y2="32" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3,3" />
          <line x1="60" y1="60" x2="34" y2="86" stroke="#22c55e" strokeWidth="1.5" strokeDasharray="3,3" />
        </svg>

        <CustomTooltip content="Vue Axe X+" description="Orienter la caméra face à l'axe X positif.">
          <button className={`${styles.axisBtn} ${styles.axisX}`} onClick={() => setView('right')}>
            X
          </button>
        </CustomTooltip>

        <CustomTooltip content="Vue Axe Y+" description="Orienter la caméra face à l'axe Y positif.">
          <button className={`${styles.axisBtn} ${styles.axisY}`} onClick={() => setView('front')}>
            Y
          </button>
        </CustomTooltip>

        <CustomTooltip content="Vue Axe Z+" description="Orienter la caméra en vue de dessus (Top).">
          <button className={`${styles.axisBtn} ${styles.axisZ}`} onClick={() => setView('top')}>
            Z
          </button>
        </CustomTooltip>

        <CustomTooltip content="Vue Axe X-" description="Orienter la caméra face à l'axe X négatif (Gauche).">
          <button className={`${styles.axisBtn} ${styles.axisXNeg}`} onClick={() => setView('left')} />
        </CustomTooltip>

        <CustomTooltip content="Vue Axe Y-" description="Orienter la caméra face à l'axe Y négatif (Arrière).">
          <button className={`${styles.axisBtn} ${styles.axisYNeg}`} onClick={() => setView('back')} />
        </CustomTooltip>
      </div>
    </div>
  );
};