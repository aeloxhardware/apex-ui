import React, { useState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Palette, X, Sparkles } from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import { showSuccess } from '@/utils/toast';
import styles from './CategoriesSidebar.module.scss';

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
  
  const contentRef = useRef<HTMLDivElement>(null);
  const [thumbHeight, setThumbHeight] = useState(40);
  const [thumbTop, setThumbTop] = useState(8);
  const [hasScroll, setHasScroll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);

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
      if (e.detail?.name) {
        const matched = textures.find(t => t.name.toLowerCase().includes(e.detail.name!.toLowerCase()));
        if (matched) {
          setSelectedTexture(matched.name);
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

  const handleScroll = () => {
    if (!contentRef.current || isDragging) return;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    if (scrollHeight <= clientHeight) {
      setHasScroll(false);
      return;
    }
    setHasScroll(true);
    
    const margin = 8;
    const trackHeight = clientHeight - (margin * 2);
    const calculatedHeight = Math.max(32, (clientHeight / scrollHeight) * trackHeight);
    
    const maxScrollTop = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - calculatedHeight;
    const calculatedTop = maxScrollTop > 0 ? margin + (scrollTop / maxScrollTop) * maxThumbTop : margin;

    setThumbHeight(calculatedHeight);
    setThumbTop(calculatedTop);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    startYRef.current = e.clientY;
    if (contentRef.current) {
      startScrollTopRef.current = contentRef.current.scrollTop;
    }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!contentRef.current) return;
    const deltaY = e.clientY - startYRef.current;
    const { scrollHeight, clientHeight } = contentRef.current;
    const margin = 8;
    const trackHeight = clientHeight - (margin * 2);
    const maxThumbTop = trackHeight - thumbHeight;
    const maxScrollTop = scrollHeight - clientHeight;

    if (maxThumbTop > 0) {
      const scrollRatio = deltaY / maxThumbTop;
      const newScrollTop = Math.max(0, Math.min(maxScrollTop, startScrollTopRef.current + scrollRatio * maxScrollTop));
      contentRef.current.scrollTop = newScrollTop;
      
      const calculatedTop = margin + (newScrollTop / maxScrollTop) * maxThumbTop;
      setThumbTop(calculatedTop);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

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
    <>
      <div className={styles.fusionTitleContainer}>
        <span className={styles.fusionMenuTitle}>Texture & Matériaux (AMS)</span>
        <button 
          className={styles.fusionCloseBtn}
          onClick={() => {
            setIsOpen(false);
            window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
          }}
        >
          ✕
        </button>
      </div>

      <div className={styles.fusionMenuContainer}>
        <div 
          ref={contentRef}
          className={styles.fusionMenuContent}
          onScroll={handleScroll}
        >
          <div className={styles.sectionGroup}>
            <h4 className={styles.sectionTitle}>Textures du modèle actif</h4>
            <ul className={styles.itemsList}>
              {textures.map((tex) => {
                const isSelected = selectedTexture === tex.name;
                return (
                  <CustomTooltip key={tex.id} content={tex.name} description={`${tex.type} • Résolution ${tex.res}`}>
                    <li 
                      className={clsx(styles.itemRow, { 'bg-cyan-500/10 border-cyan-500/30': isSelected })}
                      onClick={() => setSelectedTexture(tex.name)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <span 
                          className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm border border-white/20" 
                          style={{ backgroundColor: tex.color || '#00f0ff' }} 
                        />
                        <span className={styles.itemName}>{tex.name}</span>
                      </div>
                      <span className="text-[11px] text-cyan-400 font-mono shrink-0">{tex.res}</span>
                    </li>
                  </CustomTooltip>
                );
              })}
            </ul>
          </div>

          {currentTexObj && (
            <div className={styles.sectionGroup}>
              <h4 className={styles.sectionTitle}>Personnalisation de la couleur</h4>
              <ul className={styles.itemsList}>
                <CustomTooltip content={currentTexObj.name} description="Modifiez la couleur de la texture en temps réel.">
                  <li className={styles.itemRow}>
                    <span className={styles.itemName}>Teinte / Couleur principale</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-neutral-400">{currentTexObj.color}</span>
                      <input 
                        type="color" 
                        value={currentTexObj.color || '#00f0ff'}
                        onChange={(e) => handleColorChange(e.target.value)}
                        className={styles.itemInput}
                        style={{ width: '36px', height: '26px', padding: 0, cursor: 'pointer', background: 'transparent', border: 0 }}
                      />
                    </div>
                  </li>
                </CustomTooltip>
              </ul>
            </div>
          )}

          <div className="pt-2 pb-4 px-1">
            <button 
              className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-semibold rounded-lg shadow-lg transition-all text-xs tracking-wide uppercase flex items-center justify-center gap-2"
              onClick={() => {
                showSuccess("Texture appliquée avec succès sur le modèle 3D !");
              }}
            >
              <Sparkles size={14} />
              Appliquer la texture
            </button>
          </div>
        </div>

        {hasScroll && (
          <div 
            className={clsx(styles.externalScrollThumb, { [styles.dragging]: isDragging })}
            onMouseDown={handleMouseDown}
            style={{
              height: `${thumbHeight}px`,
              top: `${thumbTop}px`
            }}
          />
        )}
      </div>
    </>
  );
};