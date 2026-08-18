import React, { useEffect, useState } from 'react';
import styles from './ViewCube.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { showSuccess } from '@/utils/toast';

export const ViewCube: React.FC = () => {
  const [rotation, setRotation] = useState({ x: -25, y: 45 });

  useEffect(() => {
    const handleCameraUpdated = (e: CustomEvent<{ alpha: number; beta: number }>) => {
      if (e.detail) {
        const { alpha, beta } = e.detail;
        // Convert Babylon angles to CSS rotation degrees
        const rotY = (alpha * 180) / Math.PI - 90;
        const rotX = 90 - (beta * 180) / Math.PI;
        setRotation({ x: rotX, y: rotY });
      }
    };

    window.addEventListener('apex-camera-updated', handleCameraUpdated as EventListener);
    return () => {
      window.removeEventListener('apex-camera-updated', handleCameraUpdated as EventListener);
    };
  }, []);

  const triggerView = (viewName: string, alpha: number, beta: number) => {
    window.dispatchEvent(
      new CustomEvent('apex-set-camera-custom', {
        detail: { alpha, beta }
      })
    );
    showSuccess(`Vue orientée : ${viewName}`);
  };

  return (
    <div className={styles.container}>
      <CustomTooltip content="ViewCube 3D" description="Cliquez sur une face, une arête ou un sommet pour orienter instantanément la caméra 3D.">
        <div 
          className={styles.cube}
          style={{
            transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`
          }}
        >
          {/* Faces principales */}
          <div className={`${styles.face} ${styles.front}`} onClick={() => triggerView('Face (Avant)', Math.PI / 2, Math.PI / 2)}>
            FRONT
          </div>
          <div className={`${styles.face} ${styles.back}`} onClick={() => triggerView('Dos (Arrière)', -Math.PI / 2, Math.PI / 2)}>
            BACK
          </div>
          <div className={`${styles.face} ${styles.right}`} onClick={() => triggerView('Droite', 0, Math.PI / 2)}>
            RIGHT
          </div>
          <div className={`${styles.face} ${styles.left}`} onClick={() => triggerView('Gauche', Math.PI, Math.PI / 2)}>
            LEFT
          </div>
          <div className={`${styles.face} ${styles.top}`} onClick={() => triggerView('Dessus (Top)', Math.PI / 2, 0.01)}>
            TOP
          </div>
          <div className={`${styles.face} ${styles.bottom}`} onClick={() => triggerView('Dessous (Bottom)', Math.PI / 2, Math.PI - 0.01)}>
            BOTTOM
          </div>

          {/* Sommets (Corners) pour diagonales isométriques */}
          <div 
            className={styles.node} 
            style={{ top: '15px', left: '15px', transform: 'translateZ(35px)' }}
            onClick={() => triggerView('Sommet Haut-Avant-Gauche', (3 * Math.PI) / 4, Math.PI / 4)}
            title="Sommet ISO"
          />
          <div 
            className={styles.node} 
            style={{ top: '15px', right: '15px', transform: 'translateZ(35px)' }}
            onClick={() => triggerView('Sommet Haut-Avant-Droite', Math.PI / 4, Math.PI / 4)}
            title="Sommet ISO"
          />
          <div 
            className={styles.node} 
            style={{ bottom: '15px', left: '15px', transform: 'translateZ(35px)' }}
            onClick={() => triggerView('Sommet Bas-Avant-Gauche', (5 * Math.PI) / 4, (3 * Math.PI) / 4)}
            title="Sommet ISO"
          />
          <div 
            className={styles.node} 
            style={{ bottom: '15px', right: '15px', transform: 'translateZ(35px)' }}
            onClick={() => triggerView('Sommet Bas-Avant-Droite', (7 * Math.PI) / 4, (3 * Math.PI) / 4)}
            title="Sommet ISO"
          />
        </div>
      </CustomTooltip>
    </div>
  );
};