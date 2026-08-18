import React, { useEffect, useState } from 'react';
import styles from './Viewcube.module.scss';
import { showSuccess } from '@/utils/toast';

export const Viewcube: React.FC = () => {
  const [rotation, setRotation] = useState({ x: -30, y: 45 });

  useEffect(() => {
    const handleCameraMove = (e: CustomEvent<{ alpha: number; beta: number }>) => {
      if (e.detail) {
        // Convert Babylon ArcRotateCamera angles to Viewcube rotation
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

  const handleFaceClick = (face: string) => {
    window.dispatchEvent(new CustomEvent('apex-set-camera-view', { detail: { view: face } }));
    showSuccess(`Caméra orientée : ${face}`);
  };

  return (
    <div className={styles.container}>
      <div 
        className={styles.cubeWrapper}
        style={{
          transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
        }}
      >
        <div className={`${styles.face} ${styles.front}`} onClick={() => handleFaceClick('front')}>AVANT</div>
        <div className={`${styles.face} ${styles.back}`} onClick={() => handleFaceClick('back')}>ARRIÈRE</div>
        <div className={`${styles.face} ${styles.right}`} onClick={() => handleFaceClick('right')}>DROITE</div>
        <div className={`${styles.face} ${styles.left}`} onClick={() => handleFaceClick('left')}>GAUCHE</div>
        <div className={`${styles.face} ${styles.top}`} onClick={() => handleFaceClick('top')}>DESSUS</div>
        <div className={`${styles.face} ${styles.bottom}`} onClick={() => handleFaceClick('bottom')}>DESSOUS</div>
      </div>
    </div>
  );
};