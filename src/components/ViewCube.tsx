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
          <div className={`${styles.face} ${styles.front}`} onClick={() => triggerView('FRONT', Math.PI / 2, Math.PI / 2)}>FRONT</div>
          <div className={`${styles.face} ${styles.back}`} onClick={() => triggerView('BACK', -Math.PI / 2, Math.PI / 2)}>BACK</div>
          <div className={`${styles.face} ${styles.right}`} onClick={() => triggerView('RIGHT', 0, Math.PI / 2)}>RIGHT</div>
          <div className={`${styles.face} ${styles.left}`} onClick={() => triggerView('LEFT', Math.PI, Math.PI / 2)}>LEFT</div>
          <div className={`${styles.face} ${styles.top}`} onClick={() => triggerView('TOP', Math.PI / 2, 0.01)}>TOP</div>
          <div className={`${styles.face} ${styles.bottom}`} onClick={() => triggerView('BOTTOM', Math.PI / 2, Math.PI - 0.01)}>BOTTOM</div>

          {/* Sommets (8 Coins - intersection de 3 faces) */}
          <div className={styles.cornerNode} style={{ top: '-8px', left: '-8px', transform: 'translateZ(40px)' }} onClick={() => triggerView('Sommet Haut-Avant-Gauche', (3 * Math.PI) / 4, Math.PI / 4)} title="Sommet (3 faces)" />
          <div className={styles.cornerNode} style={{ top: '-8px', right: '-8px', transform: 'translateZ(40px)' }} onClick={() => triggerView('Sommet Haut-Avant-Droite', Math.PI / 4, Math.PI / 4)} title="Sommet (3 faces)" />
          <div className={styles.cornerNode} style={{ bottom: '-8px', left: '-8px', transform: 'translateZ(40px)' }} onClick={() => triggerView('Sommet Bas-Avant-Gauche', (5 * Math.PI) / 4, (3 * Math.PI) / 4)} title="Sommet (3 faces)" />
          <div className={styles.cornerNode} style={{ bottom: '-8px', right: '-8px', transform: 'translateZ(40px)' }} onClick={() => triggerView('Sommet Bas-Avant-Droite', (7 * Math.PI) / 4, (3 * Math.PI) / 4)} title="Sommet (3 faces)" />

          <div className={styles.cornerNode} style={{ top: '-8px', left: '-8px', transform: 'translateZ(-40px) rotateY(180deg)' }} onClick={() => triggerView('Sommet Haut-Arrière-Gauche', (5 * Math.PI) / 4, Math.PI / 4)} title="Sommet (3 faces)" />
          <div className={styles.cornerNode} style={{ top: '-8px', right: '-8px', transform: 'translateZ(-40px) rotateY(180deg)' }} onClick={() => triggerView('Sommet Haut-Arrière-Droite', (7 * Math.PI) / 4, Math.PI / 4)} title="Sommet (3 faces)" />
          <div className={styles.cornerNode} style={{ bottom: '-8px', left: '-8px', transform: 'translateZ(-40px) rotateY(180deg)' }} onClick={() => triggerView('Sommet Bas-Arrière-Gauche', (3 * Math.PI) / 4, (3 * Math.PI) / 4)} title="Sommet (3 faces)" />
          <div className={styles.cornerNode} style={{ bottom: '-8px', right: '-8px', transform: 'translateZ(-40px) rotateY(180deg)' }} onClick={() => triggerView('Sommet Bas-Arrière-Droite', Math.PI / 4, (3 * Math.PI) / 4)} title="Sommet (3 faces)" />

          {/* Arêtes (12 Arêtes - intersection de 2 faces) */}
          <div className={styles.edgeNode} style={{ width: '56px', height: '16px', top: '-8px', left: '12px', transform: 'translateZ(40px)' }} onClick={() => triggerView('Arête Haut-Avant', Math.PI / 2, Math.PI / 4)} title="Arête (2 faces)" />
          <div className={styles.edgeNode} style={{ width: '56px', height: '16px', bottom: '-8px', left: '12px', transform: 'translateZ(40px)' }} onClick={() => triggerView('Arête Bas-Avant', Math.PI / 2, (3 * Math.PI) / 4)} title="Arête (2 faces)" />
          <div className={styles.edgeNode} style={{ width: '16px', height: '56px', top: '12px', left: '-8px', transform: 'translateZ(40px)' }} onClick={() => triggerView('Arête Gauche-Avant', (3 * Math.PI) / 4, Math.PI / 2)} title="Arête (2 faces)" />
          <div className={styles.edgeNode} style={{ width: '16px', height: '56px', top: '12px', right: '-8px', transform: 'translateZ(40px)' }} onClick={() => triggerView('Arête Droite-Avant', Math.PI / 4, Math.PI / 2)} title="Arête (2 faces)" />
        </div>
      </CustomTooltip>
    </div>
  );
};