import React, { useState, useEffect } from 'react';
import styles from './TextureEditorModal.module.scss';
import { Palette, X, Sliders, Image, Check } from 'lucide-react';
import { showSuccess } from '@/utils/toast';

export const TextureEditorModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [modelName, setModelName] = useState<string>('Modèle 3D');
  const [roughness, setRoughness] = useState<number>(50);
  const [metalness, setMetalness] = useState<number>(20);
  const [selectedTexture, setSelectedTexture] = useState<string>('Diffuse_Albedo.png');

  useEffect(() => {
    const handleToolChanged = (e: CustomEvent<{ tool: string }>) => {
      if (e.detail?.tool === 'texture') {
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
    };

    const handleMeshSelected = (e: CustomEvent<{ name: string | null }>) => {
      if (e.detail?.name) {
        setModelName(e.detail.name);
      }
    };

    window.addEventListener('apex-tool-changed', handleToolChanged as EventListener);
    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);

    return () => {
      window.removeEventListener('apex-tool-changed', handleToolChanged as EventListener);
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Palette size={18} className="text-[#00f0ff]" />
            <span>Éditeur de Texture & Matériau — {modelName}</span>
          </div>
          <button className={styles.closeBtn} onClick={() => setIsOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Textures attachées sélectionnables :</span>
            <div className={styles.textureGrid}>
              {[
                { id: '1', name: 'Diffuse_Albedo.png', res: '4K', type: 'Couleur' },
                { id: '2', name: 'Normal_Map.png', res: '4K', type: 'Relief' },
                { id: '3', name: 'Roughness_Metal.png', res: '2K', type: 'Spéculaire' },
              ].map(tex => (
                <div 
                  key={tex.id}
                  className={`${styles.textureCard} ${selectedTexture === tex.name ? styles.selectedCard : ''}`}
                  onClick={() => setSelectedTexture(tex.name)}
                >
                  <Image size={24} className="text-[#00f0ff]" />
                  <div className={styles.cardInfo}>
                    <span className={styles.cardName}>{tex.name}</span>
                    <span className={styles.cardMeta}>{tex.type} • {tex.res}</span>
                  </div>
                  {selectedTexture === tex.name && <Check size={14} className="text-[#00f0ff] ml-auto" />}
                </div>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Paramètres de la texture active ({selectedTexture}) :</span>
            <div className={styles.sliderGroup}>
              <div className={styles.sliderRow}>
                <span>Rugosité (Roughness) : {roughness}%</span>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={roughness} 
                  onChange={(e) => setRoughness(Number(e.target.value))} 
                  className={styles.slider}
                />
              </div>
              <div className={styles.sliderRow}>
                <span>Métallicité (Metalness) : {metalness}%</span>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={metalness} 
                  onChange={(e) => setMetalness(Number(e.target.value))} 
                  className={styles.slider}
                />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button 
            className={styles.saveBtn}
            onClick={() => {
              showSuccess("Propriétés de texture mises à jour avec succès !");
              setIsOpen(false);
            }}
          >
            Appliquer les modifications
          </button>
        </div>
      </div>
    </div>
  );
};