import React, { useState, useEffect } from 'react';
import styles from './TextureInspector.module.scss';
import { Sparkles, Edit3, Image as ImageIcon } from 'lucide-react';

export const TextureInspector: React.FC = () => {
  const [hoveredInfo, setHoveredInfo] = useState<{ name: string; type: string; details: string } | null>(null);
  const [selectedTexture, setSelectedTexture] = useState<{ name: string; resolution: string; format: string } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [textureNameInput, setTextureNameInput] = useState('');

  useEffect(() => {
    const handleMeshHover = (e: CustomEvent<{ name: string; type: string; details: string }>) => {
      if (e.detail) {
        setHoveredInfo(e.detail);
      }
    };

    const handleMeshLeave = () => {
      // Keep selected or reset if not selected
    };

    window.addEventListener('apex-mesh-hover', handleMeshHover as EventListener);
    window.addEventListener('apex-mesh-leave', handleMeshLeave);

    return () => {
      window.removeEventListener('apex-mesh-hover', handleMeshHover as EventListener);
      window.removeEventListener('apex-mesh-leave', handleMeshLeave);
    };
  }, []);

  const handleSelectTexture = () => {
    const tex = { name: 'Albedo_Diffuse_01.png', resolution: '2048 x 2048 px', format: 'PNG (RGBA)' };
    setSelectedTexture(tex);
    setTextureNameInput(tex.name);
  };

  return (
    <div className={styles.container}>
      {hoveredInfo && !selectedTexture && (
        <div className={styles.toolbar}>
          <div className={styles.header}>
            <Sparkles size={14} className="text-[#00f0ff]" />
            <span className={styles.title}>{hoveredInfo.name}</span>
          </div>
          <div className={styles.content}>
            <p className={styles.desc}>Type : {hoveredInfo.type}</p>
            <p className={styles.desc}>{hoveredInfo.details}</p>
            <button 
              className={styles.selectTexBtn}
              onClick={handleSelectTexture}
            >
              <ImageIcon size={12} className="mr-1.5" /> Inspecter les textures
            </button>
          </div>
        </div>
      )}

      {selectedTexture && (
        <div className={styles.toolbar}>
          <div className={styles.header}>
            <ImageIcon size={14} className="text-[#00f0ff]" />
            <span className={styles.title}>Propriétés de la Texture</span>
            <button 
              className={styles.closeBtn}
              onClick={() => { setSelectedTexture(null); setIsEditing(false); }}
            >
              ✕
            </button>
          </div>
          <div className={styles.content}>
            {isEditing ? (
              <div className={styles.editGroup}>
                <input 
                  type="text" 
                  value={textureNameInput} 
                  onChange={(e) => setTextureNameInput(e.target.value)}
                  className={styles.input}
                />
                <button 
                  className={styles.saveBtn}
                  onClick={() => setIsEditing(false)}
                >
                  Enregistrer
                </button>
              </div>
            ) : (
              <div className={styles.infoGroup}>
                <div className={styles.row}>
                  <span className={styles.label}>Nom :</span>
                  <span className={styles.value}>{selectedTexture.name}</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>Résolution :</span>
                  <span className={styles.value}>{selectedTexture.resolution}</span>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>Format :</span>
                  <span className={styles.value}>{selectedTexture.format}</span>
                </div>
                <button 
                  className={styles.editBtn}
                  onClick={() => setIsEditing(true)}
                >
                  <Edit3 size={12} className="mr-1.5" /> Éditer la texture
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};