import React, { useRef, useState, useEffect } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Layers, 
  ShieldAlert, 
  Gauge, 
  Flame, 
  RotateCcw, 
  Cpu, 
  Sparkles, 
  Palette, 
  Workflow, 
  Terminal 
} from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import styles from './CategoriesSidebar.module.scss';

export interface CategoryItem {
  id: string;
  title: string;
  icon: React.ReactNode;
  sections: {
    title: string;
    items: { label: string; defaultValue: string }[];
  }[];
}

const CATEGORIES: CategoryItem[] = [
  {
    id: 'geometry',
    title: '1. Géométrie & Extrusion',
    icon: <Layers size={20} />,
    sections: [
      { 
        title: 'Hauteur & Première couche', 
        items: [
          { label: 'Hauteur de couche (Layer height)', defaultValue: '0.2 mm' },
          { label: 'Première couche (First layer height)', defaultValue: '0.24 mm' },
          { label: 'Débit première couche', defaultValue: '105%' }
        ] 
      },
      { 
        title: 'Largeurs d\'extrusion', 
        items: [
          { label: 'Largeur des murs (Line width)', defaultValue: '0.45 mm' },
          { label: 'Largeur du remplissage', defaultValue: '0.45 mm' },
          { label: 'Largeur des supports', defaultValue: '0.40 mm' }
        ] 
      },
      { 
        title: 'Parois', 
        items: [
          { label: 'Ordre d\'impression des parois (Inner/Outer)', defaultValue: 'Interne d\'abord' },
          { label: 'Compensation de contour', defaultValue: 'Activée' }
        ] 
      }
    ]
  },
  {
    id: 'resistance',
    title: '2. Résistance & Remplissage',
    icon: <ShieldAlert size={20} />,
    sections: [
      { 
        title: 'Remplissage', 
        items: [
          { label: 'Densité de remplissage (%)', defaultValue: '15%' },
          { label: 'Motifs (Grid, Gyroid, Lightning)', defaultValue: 'Gyroid' },
          { label: 'Angle du remplissage', defaultValue: '45°' }
        ] 
      },
      { 
        title: 'Parois & Coques', 
        items: [
          { label: 'Nombre de parois / contours (Wall loops)', defaultValue: '3' },
          { label: 'Couches supérieures et inférieures (Top/Bottom shell layers)', defaultValue: '4' }
        ] 
      }
    ]
  },
  {
    id: 'kinematics',
    title: '3. Cinématique & Vitesse',
    icon: <Gauge size={20} />,
    sections: [
      { 
        title: 'Vitesses', 
        items: [
          { label: 'Vitesse d\'impression des parois', defaultValue: '120 mm/s' },
          { label: 'Vitesse de remplissage', defaultValue: '200 mm/s' },
          { label: 'Vitesse de déplacement (Travel)', defaultValue: '300 mm/s' }
        ] 
      },
      { 
        title: 'Accélération & Temps', 
        items: [
          { label: 'Accélération & Jerk / Junction Deviation', defaultValue: '5000 mm/s²' },
          { label: 'Temps minimum de couche', defaultValue: '5.0 s' },
          { label: 'Ralentissement automatique', defaultValue: 'Activé' }
        ] 
      }
    ]
  },
  {
    id: 'thermal',
    title: '4. Thermique & Refroidissement',
    icon: <Flame size={20} />,
    sections: [
      { 
        title: 'Températures', 
        items: [
          { label: 'Température de la buse (Hotend)', defaultValue: '210°C' },
          { label: 'Température du plateau (Bed)', defaultValue: '60°C' }
        ] 
      },
      { 
        title: 'Ventilation', 
        items: [
          { label: 'Ventilation du composant (Part cooling fan %)', defaultValue: '100%' },
          { label: 'Ventilation ponts et surplombs (Overhang/Bridge fan)', defaultValue: '80%' }
        ] 
      }
    ]
  },
  {
    id: 'filament',
    title: '5. Gestion Filaments & Rétraction',
    icon: <RotateCcw size={20} />,
    sections: [
      { 
        title: 'Rétraction', 
        items: [
          { label: 'Distance et vitesse de rétraction', defaultValue: '0.8 mm / 35 mm/s' },
          { label: 'Z-Hop / Lift (décalage vertical)', defaultValue: '0.4 mm' },
          { label: 'Pressure Advance / Linear Advance', defaultValue: '0.035' }
        ] 
      },
      { 
        title: 'Débit', 
        items: [
          { label: 'Facteur de débit (Flow ratio / Extrusion multiplier)', defaultValue: '0.98' }
        ] 
      }
    ]
  },
  {
    id: 'supports',
    title: '6. Structures de Support & Adhérence',
    icon: <Cpu size={20} />,
    sections: [
      { 
        title: 'Supports', 
        items: [
          { label: 'Types de supports (Standard vs Tree/Arachne)', defaultValue: 'Arachne (Organique)' },
          { label: 'Distance d\'interface Z/XY', defaultValue: '0.2 mm' },
          { label: 'Motif des interfaces de support', defaultValue: 'Rectiligne' }
        ] 
      },
      { 
        title: 'Adhérence', 
        items: [
          { label: 'Adhérence au plateau (Brim, Raft, Skirt)', defaultValue: 'Brim (Ligne auto)' }
        ] 
      }
    ]
  },
  {
    id: 'surface',
    title: '7. Qualité de Surface & Finition',
    icon: <Sparkles size={20} />,
    sections: [
      { 
        title: 'Finition', 
        items: [
          { label: 'Lissage de la couche supérieure (Ironing)', defaultValue: 'Désactivé' },
          { label: 'Masquage des coutures Z (Seam position, Scarf seam)', defaultValue: 'Aléatoire' }
        ] 
      },
      { 
        title: 'Tolérances', 
        items: [
          { label: 'Compensation d\'élasticité et tolérances X/Y', defaultValue: '0.0 mm' }
        ] 
      }
    ]
  },
  {
    id: 'multimaterial',
    title: '8. Multi-Matériaux & Couleur (AMS)',
    icon: <Palette size={20} />,
    sections: [
      { 
        title: 'Purge & Rinçage', 
        items: [
          { label: 'Volumes de purge et tour de rinçage (Flush volumes)', defaultValue: '600 mm³' },
          { label: 'Changements d\'outils et températures de veille', defaultValue: '220°C' }
        ] 
      },
      { 
        title: 'Matériaux spéciaux', 
        items: [
          { label: 'Matériaux d\'interface de support dédiés (PVA / Support W)', defaultValue: 'Support W' }
        ] 
      }
    ]
  },
  {
    id: 'advanced',
    title: '9. Dynamique & Algorithmes Avancés',
    icon: <Workflow size={20} />,
    sections: [
      { 
        title: 'Algorithmes', 
        items: [
          { label: 'Générateur de parois (Arachne vs Classic)', defaultValue: 'Arachne' },
          { label: 'Arc Fitting (G2/G3 interpolation)', defaultValue: 'Activé' },
          { label: 'Compensation de vibration (Input Shaping)', defaultValue: 'MZV (X/Y)' }
        ] 
      }
    ]
  },
  {
    id: 'gcode',
    title: '10. G-code Custom & Intégration',
    icon: <Terminal size={20} />,
    sections: [
      { 
        title: 'Scripts G-code', 
        items: [
          { label: 'G-code de début / fin / pause', defaultValue: 'Standard Klipper' },
          { label: 'Dimensions et limites physiques du volume', defaultValue: '256x256x256 mm' }
        ] 
      },
      { 
        title: 'Intégration', 
        items: [
          { label: 'Gestion des caméras / Time-lapse', defaultValue: 'Smooth (Exturder Sync)' }
        ] 
      }
    ]
  }
];

interface CategoriesSidebarProps {
  activeCategory: string | null;
  onSelectCategory: (catId: string | null) => void;
}

export const CategoriesSidebar: React.FC<CategoriesSidebarProps> = ({
  activeCategory,
  onSelectCategory,
}) => {
  const iconRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const [thumbHeight, setThumbHeight] = useState(40);
  const [thumbTop, setThumbTop] = useState(8);
  const [hasScroll, setHasScroll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);

  const handleCategoryClick = (catId: string) => {
    if (activeCategory === catId) {
      onSelectCategory(null);
    } else {
      onSelectCategory(catId);
    }
  };

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

  useEffect(() => {
    if (activeCategory) {
      setTimeout(handleScroll, 50);
    }
  }, [activeCategory]);

  const activeCatData = CATEGORIES.find(c => c.id === activeCategory);

  return (
    <>
      <div className={styles.leftSidebarContainer}>
        <div className={styles.categoriesToolbar}>
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <CustomTooltip key={cat.id} content={cat.title}>
                <button
                  ref={(el) => (iconRefs.current[cat.id] = el)}
                  className={clsx(styles.categoryButton, { [styles.active]: isActive })}
                  onClick={() => handleCategoryClick(cat.id)}
                >
                  {cat.icon}
                </button>
              </CustomTooltip>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {activeCatData && (
          <>
            <motion.div 
              className={styles.fusionTitleContainer}
              initial={{ opacity: 0, scale: 0.95, x: -10, y: -20 }}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, x: -10, y: -20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className={styles.fusionMenuTitle}>{activeCatData.title}</span>
              <button 
                className={styles.fusionCloseBtn}
                onClick={() => onSelectCategory(null)}
              >
                ✕
              </button>
            </motion.div>

            <motion.div 
              className={styles.fusionMenuContainer}
              initial={{ opacity: 0, scale: 0.95, x: -10, y: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, x: -10, y: 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <div 
                ref={contentRef}
                className={styles.fusionMenuContent}
                onScroll={handleScroll}
              >
                {activeCatData.sections.map((section, idx) => (
                  <div key={idx} className={styles.sectionGroup}>
                    <h4 className={styles.sectionTitle}>{section.title}</h4>
                    <ul className={styles.itemsList}>
                      {section.items.map((item, iIdx) => (
                        <li key={iIdx} className={styles.itemRow}>
                          <span className={styles.itemName}>{item.label}</span>
                          <input 
                            type="text" 
                            defaultValue={item.defaultValue} 
                            className={styles.itemInput} 
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Curseur de défilement externe interactif avec maintien d'extension pendant le clic */}
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
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};