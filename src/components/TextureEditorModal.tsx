import React, { useState, useEffect } from 'react';
import styles from './TextureEditorModal.module.scss';
import { Palette, X, Image, Check, Sliders } from 'lucide-react';
import { showSuccess } from '@/utils/toast';

export const TextureEditorModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTexture, setSelectedTexture] = useState<string>('Diffuse_Albedo.png');
  const [roughness, setRoughness] = useState<number>(50);
  const [metalness, setMetalness] = useState<number>(20);

  useEffect(() => {
    const handleToolChanged = (e: CustomEvent<{ tool: string }>) => {
      if (e.detail?.tool === 'texture') {
        setIsOpen(true);
        window.dispatchEvent(new CustomEvent('apex-texture-mode', { detail: { active: true } }));
      } else {
        setIsOpen(false);
        window.dispatchEvent(new CustomEvent('apex-texture-mode', { detail: { active: false } }));
      }
    };

    window.addEventListener('apex-tool-changed', handleToolChanged as EventListener);
    return () => {
      window.removeEventListener('apex-tool-changed', handleToolChanged as EventListener);
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Palette size={16} className="text-[#00f0ff]" />
            <span>Éditeur de Texture</span>
          </div>
          <button 
            className={styles.closeBtn} 
            onClick={() => {
              setIsOpen(false);
              window.dispatchEvent(new CustomEvent('apex-texture-mode', { detail: { active: false } }));
              window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Textures du modèle actif :</span>
            <div className={styles.textureGrid}>
              {[
                { id: '1', name: 'Diffuse_Albedo.png', res: '4096 x 4096', type: 'Couleur Principale' },
                { id: '2', name: 'Normal_Map.png', res: '4096 x 4096', type: 'Relief / Bump' },
                { id: '3', name: 'Roughness_Metal.png', res: '2048 x 2048', type: 'Spéculaire' },
              ].map(tex => (
                <div 
                  key={tex.id}
                  className={`${styles.textureCard} ${selectedTexture === tex.name ? styles.selectedCard : ''}`}
                  onClick={() => setSelectedTexture(tex.name)}
                >
                  <Image size={20} className="text-[#00f0ff]" />
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
            <span className={styles.sectionLabel}>Réglages ({selectedTexture}) :</span>
            <div className={styles.sliderGroup}>
              <div className={styles.sliderRow}>
                <span>Rugosité : {roughness}%</span>
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
                <span>Métallicité : {metalness}%</span>
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

          <button 
            className={styles.saveBtn}
            onClick={() => {
              showSuccess("Texture mise à jour sur la grille 3D !");
            }}
          >
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
};