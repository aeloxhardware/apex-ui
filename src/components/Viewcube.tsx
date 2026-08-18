import React, { useEffect, useState } from 'react';
import styles from './Viewcube.module.scss';
import { showSuccess } from '@/utils/toast';

export const Viewcube: React.FC = () => {
  const [rotation, setRotation] = useState({ x: -30, y: 45 });

  useEffect(() => {
    const handleCameraMove = (e: CustomEvent<{ alpha: number; beta: number }>) => {
      if (e.detail) {
        const alphaDeg = (e.detail.alpha * 180) / Math.PI;
        const betaDeg = (e.detail.beta * 180) / Math.PI;
        setRotation({
          x: betaDeg - 90,
          y: alphaDeg - 90,
        });
      }
    };

    window.addEventListener('apex-camera-updated', handleCameraMove as EventListener);
    return () => {
      window.removeEventListener('apex-camera-updated', handleCameraMove as EventListener);
    };
  }, []);

  const handleViewClick = (view: string) => {
    window.dispatchEvent(new CustomEvent('apex-set-camera-view', { detail: { view } }));
    showSuccess(`Caméra orientée : ${view}`);
  };

  return (
    <div className={styles.container}>
      <div className={styles.compassWrapper}>
        <div 
          className={styles.compassInner}
          style={{
            transform: `rotate(${rotation.y}deg)`,
          }}
        >
          <button className={`${styles.directionBtn} ${styles.topDir}`} onClick={() => handleViewClick('front')}>
            AV
          </button>
          <button className={`${styles.directionBtn} ${styles.bottomDir}`} onClick={() => handleViewClick('back')}>
            AR
          </button>
          <button className={`${styles.directionBtn} ${styles.leftDir}`} onClick={() => handleViewClick('left')}>
            GA
          </button>
          <button className={`${styles.directionBtn} ${styles.rightDir}`} onClick={() => handleViewClick('right')}>
            DR
          </button>
          <button className={styles.centerHub} onClick={() => handleViewClick('top')}>
            3D
          </button>
        </div>
      </div>
    </div>
  );
};