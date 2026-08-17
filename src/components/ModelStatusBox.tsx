import React, { useEffect, useState } from 'react';
import styles from './ModelStatusBox.module.scss';
import { Box } from 'lucide-react';

export const ModelStatusBox: React.FC = () => {
  const [modelName, setModelName] = useState<string>("Aucun modèle sélectionné");
  const [dimensions, setDimensions] = useState<string>("—");
  const [position, setPosition] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  const [rotation, setRotation] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    const handleMeshSelected = (e: CustomEvent<{ name: string | null }>) => {
      if (e.detail?.name) {
        setModelName(e.detail.name);
      } else {
        setModelName("Aucun modèle sélectionné");
      }
    };

    const handleModelPositioned = (e: CustomEvent<{ x: number; y: number; z: number }>) => {
      if (e.detail) {
        setPosition({
          x: Math.round(e.detail.x * 10) / 10,
          y: Math.round(e.detail.y * 10) / 10,
          z: Math.round(e.detail.z * 10) / 10,
        });
      }
    };

    const handleModelRotated = (e: CustomEvent<{ x: number; y: number; z: number }>) => {
      if (e.detail) {
        setRotation({
          x: Math.round(e.detail.x),
          y: Math.round(e.detail.y),
          z: Math.round(e.detail.z),
        });
      }
    };

    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    window.addEventListener('apex-model-positioned', handleModelPositioned as EventListener);
    window.addEventListener('apex-model-rotated', handleModelRotated as EventListener);

    return () => {
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
      window.removeEventListener('apex-model-positioned', handleModelPositioned as EventListener);
      window.removeEventListener('apex-model-rotated', handleModelRotated as EventListener);
    };
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.header}>
          <Box size={16} className="text-[#00f0ff]" />
          <span className={styles.title}>{modelName}</span>
        </div>
        <div className={styles.content}>
          <div className={styles.row}>
            <span className={styles.label}>Position (X, Y, Z) :</span>
            <span className={styles.value}>{position.x}mm, {position.y}mm, {position.z}mm</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Rotation (X, Y, Z) :</span>
            <span className={styles.value}>{rotation.x}°, {rotation.y}°, {rotation.z}°</span>
          </div>
        </div>
      </div>
    </div>
  );
};