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

  const renderFace = (faceName: string, alphaFace: number, betaFace: number) => {
    return (
      <>
        {/* Sommets */}
        <div className={`${styles.vertex} ${styles.vertexTL}`} onClick={() => triggerView(`Sommet Haut-Gauche (${faceName})`, alphaFace - 0.5, betaFace - 0.5)} title="Sommet" />
        <div className={`${styles.vertex} ${styles.vertexTR}`} onClick={() => triggerView(`Sommet Haut-Droite (${faceName})`, alphaFace + 0.5, betaFace - 0.5)} title="Sommet" />
        <div className={`${styles.vertex} ${styles.vertexBL}`} onClick={() => triggerView(`Sommet Bas-Gauche (${faceName})`, alphaFace - 0.5, betaFace + 0.5)} title="Sommet" />
        <div className={`${styles.vertex} ${styles.vertexBR}`} onClick={() => triggerView(`Sommet Bas-Droite (${faceName})`, alphaFace + 0.5, betaFace + 0.5)} title="Sommet" />

        {/* Arêtes */}
        <div className={`${styles.edge} ${styles.edgeTop}`} onClick={() => triggerView(`Arête Haute (${faceName})`, alphaFace, betaFace - 0.6)} title="Arête" />
        <div className={`${styles.edge} ${styles.edgeBottom}`} onClick={() => triggerView(`Arête Basse (${faceName})`, alphaFace, betaFace + 0.6)} title="Arête" />
        <div className={`${styles.edge} ${styles.edgeLeft}`} onClick={() => triggerView(`Arête Gauche (${faceName})`, alphaFace - 0.6, betaFace)} title="Arête" />
        <div className={`${styles.edge} ${styles.edgeRight}`} onClick={() => triggerView(`Arête Droite (${faceName})`, alphaFace + 0.6, betaFace)} title="Arête" />

        {/* Face centrale */}
        <div className={styles.centerPart} onClick={() => triggerView(faceName, alphaFace, betaFace)}>
          {faceName}
        </div>
      </>
    );
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
          <div className={`${styles.face} ${styles.front}`}>
            {renderFace('FRONT', Math.PI / 2, Math.PI / 2)}
          </div>
          <div className={`${styles.face} ${styles.back}`}>
            {renderFace('BACK', -Math.PI / 2, Math.PI / 2)}
          </div>
          <div className={`${styles.face} ${styles.right}`}>
            {renderFace('RIGHT', 0, Math.PI / 2)}
          </div>
          <div className={`${styles.face} ${styles.left}`}>
            {renderFace('LEFT', Math.PI, Math.PI / 2)}
          </div>
          <div className={`${styles.face} ${styles.top}`}>
            {renderFace('TOP', Math.PI / 2, 0.01)}
          </div>
          <div className={`${styles.face} ${styles.bottom}`}>
            {renderFace('BOTTOM', Math.PI / 2, Math.PI - 0.01)}
          </div>
        </div>
      </CustomTooltip>
    </div>
  );
};