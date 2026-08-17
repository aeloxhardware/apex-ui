import React, { useEffect, useState } from 'react';
import styles from './ModelHoverTooltip.module.scss';
import { Box, Palette, Image as ImageIcon } from 'lucide-react';

interface HoverInfo {
  visible: boolean;
  x: number;
  y: number;
  modelName: string;
  hasTexture: boolean;
  textureName?: string;
  textureResolution?: string;
  materialType?: string;
}

export const ModelHoverTooltip: React.FC = () => {
  const [info, setInfo] = useState<HoverInfo>({
    visible: false,
    x: 0,
    y: 0,
    modelName: '',
    hasTexture: false,
  });

  useEffect(() => {
    const handlePointerMove = (e: CustomEvent<{ visible: boolean; x: number; y: number; modelName: string; hasTexture: boolean; textureName?: string; textureResolution?: string; materialType?: string }>) => {
      if (e.detail) {
        setInfo({
          visible: e.detail.visible,
          x: e.detail.x + 15,
          y: e.detail.y + 15,
          modelName: e.detail.modelName,
          hasTexture: e.detail.hasTexture,
          textureName: e.detail.textureName || 'Diffuse_Albedo_4K.png',
          textureResolution: e.detail.textureResolution || '4096 x 4096 px',
          materialType: e.detail.materialType || 'PBR Metallic Roughness',
        });
      }
    };

    window.addEventListener('apex-model-hover', handlePointerMove as EventListener);
    return () => {
      window.removeEventListener('apex-model-hover', handlePointerMove as EventListener);
    };
  }, []);

  if (!info.visible) return null;

  return (
    <div 
      className={styles.tooltipContainer}
      style={{ left: `${info.x}px`, top: `${info.y}px` }}
    >
      <div className={styles.header}>
        <Box size={14} className="text-[#00f0ff]" />
        <span className={styles.title}>{info.modelName}</span>
      </div>
      <div className={styles.body}>
        <div className={styles.row}>
          <span className={styles.label}>Type :</span>
          <span className={styles.value}>Modèle 3D </span>
        </div>
        {info.hasTexture ? (
          <>
            <div className={styles.divider} />
            <div className={styles.textureHeader}>
              <Palette size={13} className="text-amber-400" />
              <span className={styles.subTitle}>Texture active survolée</span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>Fichier :</span>
              <span className={styles.value}>{info.textureName}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>Résolution :</span>
              <span className={styles.value}>{info.textureResolution}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>Matériau :</span>
              <span className={styles.value}>{info.materialType}</span>
            </div>
          </>
        ) : (
          <div className={styles.row}>
            <span className={styles.label}>Texture :</span>
            <span className={styles.value}>Aucune texture (Modèle STL standard)</span>
          </div>
        )}
      </div>
    </div>
  );
};