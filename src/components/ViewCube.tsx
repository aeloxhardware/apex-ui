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
          {/* Faces principales avec clic central */}
          <div className={`${styles.face} ${styles.front}`}>
            <div className={styles.centerPart} onClick={() => triggerView('FRONT', Math.PI / 2, Math.PI / 2)}>FRONT</div>
          </div>
          <div className={`${styles.face} ${styles.back}`}>
            <div className={styles.centerPart} onClick={() => triggerView('BACK', -Math.PI / 2, Math.PI / 2)}>BACK</div>
          </div>
          <div className={`${styles.face} ${styles.right}`}>
            <div className={styles.centerPart} onClick={() => triggerView('RIGHT', 0, Math.PI / 2)}>RIGHT</div>
          </div>
          <div className={`${styles.face} ${styles.left}`}>
            <div className={`${styles.centerPart}`} onClick={() => triggerView('LEFT', Math.PI, Math.PI / 2)}>LEFT</div>
          </div>
          <div className={`${styles.face} ${styles.top}`}>
            <div className={styles.centerPart} onClick={() => triggerView('TOP', Math.PI / 2, 0.01)}>TOP</div>
          </div>
          <div className={`${styles.face} ${styles.bottom}`}>
            <div className={styles.centerPart} onClick={() => triggerView('BOTTOM', Math.PI / 2, Math.PI - 0.01)}>BOTTOM</div>
          </div>

          {/* Sommets 3D (Coins Top-Front-Left indiqué par votre flèche) */}
          <div 
            className={styles.cornerOverlay} 
            style={{ top: '-8px', left: '-8px', transform: 'translateZ(40px)' }}
            onClick={() => triggerView('Sommet Haut-Avant-Gauche (Top-Front-Left)', (3 * Math.PI) / 4, Math.PI / 4)}
            title="Sommet Top-Front-Left"
          />
          <div 
            className={styles.cornerOverlay} 
            style={{ top: '-8px', right: '-8px', transform: 'translateZ(40px)' }}
            onClick={() => triggerView('Sommet Haut-Avant-Droite (Top-Front-Right)', Math.PI / 4, Math.PI / 4)}
            title="Sommet Top-Front-Right"
          />
          <div 
            className={styles.cornerOverlay} 
            style={{ bottom: '-8px', left: '-8px', transform: 'translateZ(40px)' }}
            onClick={() => triggerView('Sommet Bas-Avant-Gauche (Bottom-Front-Left)', (5 * Math.PI) / 4, (3 * Math.PI) / 4)}
            title="Sommet Bottom-Front-Left"
          />
          <div 
            className={styles.cornerOverlay} 
            style={{ bottom: '-8px', right: '-8px', transform: 'translateZ(40px)' }}
            onClick={() => triggerView('Sommet Bas-Avant-Droite (Bottom-Front-Right)', (7 * Math.PI) / 4, (3 * Math.PI) / 4)}
            title="Sommet Bottom-Front-Right"
          />

          {/* Arêtes 3D unifiées */}
          <div 
            className={styles.edgeOverlay}
            style={{ top: '-8px', left: '16px', width: '48px', height: '16px', transform: 'translateZ(40px)' }}
            onClick={() => triggerView('Arête Top-Front', Math.PI / 2, Math.PI / 4)}
            title="Arête Top-Front"
          />
          <div 
            className={styles.edgeOverlay}
            style={{ bottom: '-8px', left: '16px', width: '48px', height: '16px', transform: 'translateZ(40px)' }}
            onClick={() => triggerView('Arête Bottom-Front', Math.PI / 2, (3 * Math.PI) / 4)}
            title="Arête Bottom-Front"
          />
          <div 
            className={styles.edgeOverlay}
            style={{ top: '16px', left: '-8px', width: '16px', height: '48px', transform: 'translateZ(40px)' }}
            onClick={() => triggerView('Arête Left-Front', (3 * Math.PI) / 4, Math.PI / 2)}
            title="Arête Left-Front"
          />
          <div 
            className={styles.edgeOverlay}
            style={{ top: '16px', right: '-8px', width: '16px', height: '48px', transform: 'translateZ(40px)' }}
            onClick={() => triggerView('Arête Right-Front', Math.PI / 4, Math.PI / 2)}
            title="Arête Right-Front"
          />
        </div>
      </CustomTooltip>
    </div>
  );
};