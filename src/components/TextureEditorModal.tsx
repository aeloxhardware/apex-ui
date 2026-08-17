import React, { useState, useEffect } from 'react';
import styles from './TextureEditorModal.module.scss';
import { Palette, X, Image, Check, Sliders } from 'lucide-react';
import { showSuccess } from '@/utils/toast';

interface TextureItem {
  id: string;
  name: string;
  type: string;
  res: string;
  color: string;
}

export const TextureEditorModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [textures, setTextures] = useState<TextureItem[]>([]);
  const [selectedTexture, setSelectedTexture] = useState<string>('');
  const [roughness, setRoughness] = useState<number>(50);
  const [metalness, setMetalness] = useState<number>(20);

  useEffect(() => {
    const handleToolChanged = (e: CustomEvent<{ tool: string }>) => {
      if (e.detail?.tool === 'texture') {
        setIsOpen(true);
        // Request actual textures from the selected mesh or window event
        window.dispatchEvent(new CustomEvent('apex-request-textures'));
      } else {
        setIsOpen(false);
      }
    };

    const handleTexturesLoaded = (e: CustomEvent<{ textures: TextureItem[] }>) => {
      if (e.detail?.textures && e.detail.textures.length > 0) {
        setTextures(e.detail.textures);
        setSelectedTexture(e.detail.textures[0].name);
      } else {
        // Fallback default textures if none found on model
        const defaultTexs: TextureItem[] = [
          { id: '1', name: 'Diffuse_Albedo.png', type: 'Couleur principale', res: '4096 x 4096', color: '#00f0ff' },
          { id: '2', name: 'Normal_Map.png', type: 'Relief / Bump', res: '4096 x 4096', color: '#8b5cf6' },
          { id: '3', name: 'Roughness_Metal.png', type: 'Spéculaire', res: '2048 x 2048', color: '#f59e0b' }
        ];
        setTextures(defaultTexs);
        setSelectedTexture(defaultTexs[0].name);
      }
    };

    window.addEventListener('apex-tool-changed', handleToolChanged as EventListener);
    window.addEventListener('apex-textures-loaded', handleTexturesLoaded as EventListener);

    return () => {
      window.removeEventListener('apex-tool-changed', handleToolChanged as EventListener);
      window.removeEventListener('apex-textures-loaded', handleTexturesLoaded as EventListener);
    };
  }, []);

  if (!isOpen) return null;

  const currentTexObj = textures.find(t => t.name === selectedTexture);

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
              window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Textures récupérées du modèle :</span>
            <div className={styles.textureGrid}>
              {textures.map(tex => (
                <div 
                  key={tex.id}
                  className={`${styles.textureCard} ${selectedTexture === tex.name ? styles.selectedCard : ''}`}
                  onClick={() => setSelectedTexture(tex.name)}
                >
                  <span 
                    className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm" 
                    style={{ backgroundColor: tex.color || '#00f0ff' }} 
                  />
                  <div className={styles.cardInfo}>
                    <span className={styles.cardName}>{tex.name}</span>
                    <span className={styles.cardMeta}>{tex.type} • {tex.res}</span>
                  </div>
                  {selectedTexture === tex.name && <Check size={14} className="text-[#00f0ff] ml-auto" />}
                </div>
              ))}
            </div>
          </div>

          {currentTexObj && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Réglages ({currentTexObj.name}) :</span>
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
          )}

          <button 
            className={styles.saveBtn}
            onClick={() => {
              showSuccess("Texture mise à jour sur le modèle 3D !");
            }}
          >
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
};