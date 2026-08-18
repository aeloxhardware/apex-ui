import React, { useEffect, useState } from 'react';
import styles from './Viewcube.module.scss';
import { CustomTooltip } from './CustomTooltip';

export const Viewcube: React.FC = () => {
  const [rotation, setRotation] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleCameraUpdated = (e: CustomEvent<{ alpha: number; beta: number }>) => {
      if (e.detail) {
        // Convert Babylon camera alpha/beta to CSS 3D rotate angles
        const alphaDeg = (e.detail.alpha * 180) / Math.PI;
        const betaDeg = (e.detail.beta * 180) / Math.PI;
        
        // Blender-style orientation mapping
        setRotation({
          x: betaDeg - 90,
          y: -alphaDeg - 90,
        });
      }
    };

    window.addEventListener('apex-camera-updated', handleCameraUpdated as EventListener);
    return () => {
      window.removeEventListener('apex-camera-updated', handleCameraUpdated as EventListener);
    };
  }, []);

  const handleFaceClick = (view: string) => {
    window.dispatchEvent(new CustomEvent('apex-set-camera-view', { detail: { view } }));
  };

  return (
    <div className={styles.container}>
      <CustomTooltip content="Viewcube 3D" description="Cliquez sur n'importe quelle face pour réorienter instantanément la caméra (Vue style Blender).">
        <div 
          className={styles.cubeWrapper}
          style={{
            transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
          }}
        >
          <div className={`${styles.face} ${styles.front}`} onClick={() => handleFaceClick('front')}>FRONT</div>
          <div className={`${styles.face} ${styles.back}`} onClick={() => handleFaceClick('back')}>BACK</div>
          <div className={`${styles.face} ${styles.right}`} onClick={() => handleFaceClick('right')}>RIGHT</div>
          <div className={`${styles.face} ${styles.left}`} onClick={() => handleFaceClick('left')}>LEFT</div>
          <div className={`${styles.face} ${styles.top}`} onClick={() => handleFaceClick('top')}>TOP</div>
          <div className={`${styles.face} ${styles.bottom}`} onClick={() => handleFaceClick('bottom')}>BOTTOM</div>
        </div>
      </CustomTooltip>
    </div>
  );
};