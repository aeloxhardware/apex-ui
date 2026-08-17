import React, { useState, useEffect } from 'react';
import styles from './TextureEditorModal.module.scss';
import { Palette, X, Check } from 'lucide-react';
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

  useEffect(() => {
    const handleToolChanged = (e: CustomEvent<{ tool: string }>) => {
      if (e.detail?.tool === 'texture') {
        setIsOpen(true);
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
        const defaultTexs: TextureItem[] = [
          { id: '1', name: 'Diffuse_Albedo.png', type: 'Couleur principale', res: '4096 x 4096', color: '#00f0ff' },
          { id: '2', name: 'Normal_Map.png', type: 'Relief / Bump', res: '4096 x 4096', color: '#8b5cf6' },
          { id: '3', name: 'Roughness_Metal.png', type: 'Spéculaire', res: '2048 x 2048', color: '#f59e0b' }
        ];
        setTextures(defaultTexs);
        setSelectedTexture(defaultTexs[0].name);
      }
    };

    const handleMeshSelected = (e: CustomEvent<{ name: string | null; subMeshes: { id: string; name: string; color: string }[] }>) => {
      if (e.detail?.subMeshes && e.detail.subMeshes.length > 0) {
        const targetName = e.detail.name;
        if (targetName) {
          const matched = textures.find(t => t.name.toLowerCase().includes(targetName.toLowerCase()));
          if (matched) {
            setSelectedTexture(matched.name);
          }
        }
      }
    };

    window.addEventListener('apex-tool-changed', handleToolChanged as EventListener);
    window.addEventListener('apex-textures-loaded', handleTexturesLoaded as EventListener);
    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);

    return () => {
      window.removeEventListener('apex-tool-changed', handleToolChanged as EventListener);
      window.removeEventListener('apex-textures-loaded', handleTexturesLoaded as EventListener);
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    };
  }, [textures]);

  if (!isOpen) return null;

  const currentTexObj = textures.find(t => t.name === selectedTexture);

  const handleColorChange = (newColor: string) => {
    if (!currentTexObj) return;
    setTextures(prev => prev.map(t => t.name === currentTexObj.name ? { ...t, color: newColor } : t));
    window.dispatchEvent(
      new CustomEvent('apex-update-texture-color', {
        detail: { textureName: currentTexObj.name, color: newColor }
      })
    );
  };

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
              {textures.map(tex => {
                const isSelected = selectedTexture === tex.name;
                return (
                  <div 
                    key={tex.id}
                    className={styles.textureCard}
                    style={isSelected ? {
                      backgroundColor: `${tex.color}22`,
                      boxShadow: `0 0 16px ${tex.color}55`
                    } : {}}
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
                    {isSelected && <Check size={14} style={{ color: tex.color }} className="ml-auto" />}
                  </div>
                );
              })}
            </div>
          </div>

          {currentTexObj && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Couleur de la texture ({currentTexObj.name}) :</span>
              <div className="flex items-center gap-3 mt-2 bg-neutral-900/60 p-3 rounded-lg border border-neutral-800">
                <input 
                  type="color" 
                  value={currentTexObj.color || '#00f0ff'}
                  onChange={(e) => handleColorChange(e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer bg-transparent border-0"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-mono text-neutral-300">{currentTexObj.color}</span>
                  <span className="text-[10px] text-neutral-500">Cliquez pour changer la couleur</span>
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