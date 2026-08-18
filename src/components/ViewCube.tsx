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
        const rotY = 90 - (alpha * 180) / Math.PI;
        const rotX = (beta * 180) / Math.PI - 90;
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
          <div className={`${styles.face} ${styles.front}`} onClick={() => triggerView('Face (Front)', Math.PI / 2, Math.PI / 2)}>FRONT</div>
          <div className={`${styles.face} ${styles.back}`} onClick={() => triggerView('Dos (Back)', -Math.PI / 2, Math.PI / 2)}>BACK</div>
          <div className={`${styles.face} ${styles.right}`} onClick={() => triggerView('Droite (Right)', 0, Math.PI / 2)}>RIGHT</div>
          <div className={`${styles.face} ${styles.left}`} onClick={() => triggerView('Gauche (Left)', Math.PI, Math.PI / 2)}>LEFT</div>
          <div className={`${styles.face} ${styles.top}`} onClick={() => triggerView('Dessus (Top)', Math.PI / 2, 0.01)}>TOP</div>
          <div className={`${styles.face} ${styles.bottom}`} onClick={() => triggerView('Dessous (Bottom)', Math.PI / 2, Math.PI - 0.01)}>BOTTOM</div>

          {/* Sommets (8 coins) */}
          <div className={styles.vertex} style={{ transform: 'translate3d(-6px, -6px, 35px)' }} onClick={() => triggerView('Sommet Haut-Avant-Gauche', (3 * Math.PI) / 4, Math.PI / 4)} />
          <div className={styles.vertex} style={{ transform: 'translate3d(64px, -6px, 35px)' }} onClick={() => triggerView('Sommet Haut-Avant-Droite', Math.PI / 4, Math.PI / 4)} />
          <div className={styles.vertex} style={{ transform: 'translate3d(-6px, 64px, 35px)' }} onClick={() => triggerView('Sommet Bas-Avant-Gauche', (5 * Math.PI) / 4, (3 * Math.PI) / 4)} />
          <div className={styles.vertex} style={{ transform: 'translate3d(64px, 64px, 35px)' }} onClick={() => triggerView('Sommet Bas-Avant-Droite', (7 * Math.PI) / 4, (3 * Math.PI) / 4)} />
          
          <div className={styles.vertex} style={{ transform: 'translate3d(-6px, -6px, -35px)' }} onClick={() => triggerView('Sommet Haut-Arrière-Gauche', (3 * Math.PI) / 4, Math.PI / 4)} />
          <div className={styles.vertex} style={{ transform: 'translate3d(64px, -6px, -35px)' }} onClick={() => triggerView('Sommet Haut-Arrière-Droite', Math.PI / 4, Math.PI / 4)} />
          <div className={styles.vertex} style={{ transform: 'translate3d(-6px, 64px, -35px)' }} onClick={() => triggerView('Sommet Bas-Arrière-Gauche', (5 * Math.PI) / 4, (3 * Math.PI) / 4)} />
          <div className={styles.vertex} style={{ transform: 'translate3d(64px, 64px, -35px)' }} onClick={() => triggerView('Sommet Bas-Arrière-Droite', (7 * Math.PI) / 4, (3 * Math.PI) / 4)} />

          {/* Arêtes (12 arêtes) */}
          <div className={styles.edge} style={{ width: '70px', height: '6px', transform: 'translate3d(0px, -3px, 35px)' }} onClick={() => triggerView('Arête Haut-Avant', Math.PI / 2, Math.PI / 4)} />
          <div className={styles.edge} style={{ width: '70px', height: '6px', transform: 'translate3d(0px, 67px, 35px)' }} onClick={() => triggerView('Arête Bas-Avant', Math.PI / 2, (3 * Math.PI) / 4)} />
          <div className={styles.edge} style={{ width: '6px', height: '70px', transform: 'translate3d(-3px, 0px, 35px)' }} onClick={() => triggerView('Arête Gauche-Avant', (3 * Math.PI) / 4, Math.PI / 2)} />
          <div className={styles.edge} style={{ width: '6px', height: '70px', transform: 'translate3d(67px, 0px, 35px)' }} onClick={() => triggerView('Arête Droite-Avant', Math.PI / 4, Math.PI / 2)} />
        </div>
      </CustomTooltip>
    </div>
  );
};