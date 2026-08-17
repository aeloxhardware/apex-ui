import React, { useState, useEffect } from 'react';
import styles from './TextureEditorModal.module.scss';
import { Palette, X, Check, Info } from 'lucide-react';
import { showSuccess } from '@/utils/toast';
import { motion, AnimatePresence } from 'framer-motion';

interface TextureItem {
  id: string;
  name: string;
  type: string;
  res: string;
  color: string;
}

interface ColorNameMap {
  name: string;
  rgb: [number, number, number];
}

const COLOR_DICTIONARY: ColorNameMap[] = [
  { name: "Noir Profond", rgb: [10, 10, 15] },
  { name: "Noir Charbon", rgb: [30, 30, 35] },
  { name: "Gris Nuit", rgb: [50, 50, 60] },
  { name: "Gris Acier", rgb: [100, 110, 120] },
  { name: "Gris Clair", rgb: [180, 185, 190] },
  { name: "Argent Métallique", rgb: [210, 215, 220] },
  { name: "Blanc Pur", rgb: [255, 255, 255] },
  { name: "Blanc Cassé", rgb: [245, 245, 240] },
  { name: "Rouge Vif", rgb: [255, 0, 0] },
  { name: "Rouge Carmin", rgb: [220, 20, 60] },
  { name: "Rouge Vermillon", rgb: [230, 50, 20] },
  { name: "Bordeaux", rgb: [128, 0, 32] },
  { name: "Rose Bonbon", rgb: [255, 105, 180] },
  { name: "Rose Pâle", rgb: [255, 192, 203] },
  { name: "Magenta Électrique", rgb: [255, 0, 255] },
  { name: "Orange Solaire", rgb: [255, 140, 0] },
  { name: "Orange Corail", rgb: [255, 127, 80] },
  { name: "Mandarine", rgb: [255, 165, 0] },
  { name: "Jaune Or", rgb: [255, 215, 0] },
  { name: "Jaune Citron", rgb: [255, 255, 0] },
  { name: "Jaune Paille", rgb: [238, 232, 170] },
  { name: "Vert Forêt", rgb: [34, 139, 34] },
  { name: "Vert Émeraude", rgb: [0, 201, 87] },
  { name: "Vert Menthe", rgb: [152, 251, 152] },
  { name: "Vert Olive", rgb: [107, 142, 35] },
  { name: "Vert Pomme", rgb: [50, 205, 50] },
  { name: "Vert Sarcelle", rgb: [0, 128, 128] },
  { name: "Cyan Néon", rgb: [0, 240, 255] },
  { name: "Bleu Turquoise", rgb: [64, 224, 208] },
  { name: "Bleu Céleste", rgb: [135, 206, 235] },
  { name: "Bleu Azur", rgb: [0, 127, 255] },
  { name: "Bleu Roi", rgb: [65, 105, 225] },
  { name: "Bleu Marine", rgb: [0, 0, 128] },
  { name: "Bleu Nuit", rgb: [25, 25, 112] },
  { name: "Violet Profond", rgb: [138, 43, 226] },
  { name: "Lavande", rgb: [230, 230, 250] },
  { name: "Indigo", rgb: [75, 0, 130] },
  { name: "Prune", rgb: [160, 32, 240] },
  { name: "Brun Chocolat", rgb: [139, 69, 19] },
  { name: "Brun Cannelle", rgb: [210, 105, 30] },
  { name: "Beige Sable", rgb: [244, 164, 96] },
  { name: "Bronze", rgb: [205, 127, 50] },
  { name: "Cuivre", rgb: [184, 115, 51] },
  { name: "Or Rose", rgb: [183, 110, 121] },
  { name: "Saumon", rgb: [250, 128, 114] },
  { name: "Kaki", rgb: [189, 183, 107] },
  { name: "Ocre", rgb: [204, 119, 34] },
  { name: "Terracotta", rgb: [226, 114, 91] },
  { name: "Pêche", rgb: [255, 218, 185] },
  { name: "Amande", rgb: [238, 221, 130] },
  { name: "Chartreuse", rgb: [127, 255, 0] },
  { name: "Aigue-marine", rgb: [127, 255, 212] },
  { name: "Turquoise Foncé", rgb: [0, 206, 209] },
  { name: "Bleu Acier", rgb: [70, 130, 180] },
  { name: "Ardoise", rgb: [112, 128, 144] },
  { name: "Fuchsia", rgb: [255, 20, 147] },
  { name: "Framboise", rgb: [227, 11, 92] },
  { name: "Lilas", rgb: [200, 162, 200] },
  { name: "Orchidée", rgb: [218, 112, 214] },
  { name: "Moutarde", rgb: [255, 219, 88] }
];

const hexToRgb = (hex: string): [number, number, number] => {
  let cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map(c => c + c).join('');
  }
  const num = parseInt(cleaned, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
};

const getClosestColorName = (hex: string): string => {
  const targetRgb = hexToRgb(hex);
  let minDistance = Infinity;
  let closestName = "Couleur Inconnue";

  COLOR_DICTIONARY.forEach(item => {
    const dr = targetRgb[0] - item.rgb[0];
    const dg = targetRgb[1] - item.rgb[1];
    const db = targetRgb[2] - item.rgb[2];
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    if (distance < minDistance) {
      minDistance = distance;
      closestName = item.name;
    }
  });

  return closestName;
};

export const TextureEditorModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [textures, setTextures] = useState<TextureItem[]>([]);
  const [selectedTexture, setSelectedTexture] = useState<string | null>(null);

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
        setSelectedTexture(null);
      } else {
        setTextures([]);
        setSelectedTexture(null);
      }
    };

    const handleMeshSelected = (e: CustomEvent<{ name: string | null; subMeshes: { id: string; name: string; color: string }[] }>) => {
      if (e.detail?.name) {
        window.dispatchEvent(new CustomEvent('apex-request-textures'));
      } else {
        setTextures([]);
        setSelectedTexture(null);
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
  }, []);

  const currentTexObj = textures.find(t => t.name === selectedTexture);

  const handleCardClick = (texName: string) => {
    if (selectedTexture === texName) {
      setSelectedTexture(null);
    } else {
      setSelectedTexture(texName);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className={styles.container}>
          {/* Menu principal de textures */}
          <motion.div 
            className={styles.toolbar}
            initial={{ opacity: 0, scale: 0.95, x: -10 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: -10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
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
                  {textures.length === 0 ? (
                    <div className="text-xs text-neutral-500 py-4 text-center">Aucun modèle sélectionné</div>
                  ) : (
                    textures.map(tex => {
                      const isSelected = selectedTexture === tex.name;
                      return (
                        <div 
                          key={tex.id}
                          className={styles.textureCard}
                          style={isSelected ? {
                            backgroundColor: `${tex.color}22`,
                            boxShadow: `0 0 16px ${tex.color}55`
                          } : {}}
                          onClick={() => handleCardClick(tex.name)}
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
                    })
                  )}
                </div>
              </div>

              <button 
                className={styles.saveBtn}
                onClick={() => {
                  showSuccess("Texture mise à jour sur le modèle 3D !");
                }}
              >
                Appliquer
              </button>
            </div>
          </motion.div>

          {/* Panneau latéral de détails s'ouvrant à droite si une texture est sélectionnée */}
          <AnimatePresence>
            {currentTexObj && (
              <motion.div 
                className={styles.sidePanel}
                initial={{ opacity: 0, scale: 0.95, x: -15 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95, x: -15 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className={styles.header}>
                  <div className={styles.headerTitle}>
                    <Info size={16} className="text-[#00f0ff]" />
                    <span>Détails & Filament</span>
                  </div>
                </div>

                <div className={styles.content}>
                  <div className={styles.section}>
                    <span className={styles.sectionLabel}>Couleur dominante :</span>
                    <div className="flex items-center gap-3 mt-2 bg-neutral-900/60 p-3 rounded-lg">
                      <div 
                        className="w-8 h-8 rounded-full shrink-0 shadow-md border border-white/20"
                        style={{ backgroundColor: currentTexObj.color }}
                      />
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-white font-orbitron">
                          {getClosestColorName(currentTexObj.color)}
                        </span>
                        <span className="text-[10px] text-neutral-400 font-mono">
                          {currentTexObj.color.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.section}>
                    <span className={styles.sectionLabel}>Numéro de Filament :</span>
                    <div className="flex flex-col gap-1 mt-1 bg-neutral-900/40 p-3 rounded-lg border border-white/5">
                      <span className="text-xs font-medium text-amber-400">Filament #AMS-01 (Proche)</span>
                      <span className="text-[10px] text-neutral-400 leading-relaxed">
                        Fonctionnalité en cours d'implémentation pour l'attribution automatique des bobines multi-matériaux.
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </AnimatePresence>
  );
};