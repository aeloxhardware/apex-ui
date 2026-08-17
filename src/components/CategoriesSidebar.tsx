import React, { useRef, useState } from 'react';
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
    items: string[];
  }[];
}

const CATEGORIES: CategoryItem[] = [
  {
    id: 'geometry',
    title: '1. Géométrie & Extrusion',
    icon: <Layers size={20} />,
    sections: [
      { title: 'Hauteur & Première couche', items: ['Hauteur de couche (Layer height)', 'Première couche (First layer height)', 'Débit première couche'] },
      { title: 'Largeurs d\'extrusion', items: ['Largeur des murs (Line width)', 'Largeur du remplissage', 'Largeur des supports'] },
      { title: 'Parois', items: ['Ordre d\'impression des parois (Inner/Outer)', 'Compensation de contour'] }
    ]
  },
  {
    id: 'resistance',
    title: '2. Résistance & Remplissage',
    icon: <ShieldAlert size={20} />,
    sections: [
      { title: 'Remplissage', items: ['Densité de remplissage (%)', 'Motifs (Grid, Gyroid, Lightning)', 'Angle du remplissage'] },
      { title: 'Parois & Coques', items: ['Nombre de parois / contours (Wall loops)', 'Couches supérieures et inférieures (Top/Bottom shell layers)'] }
    ]
  },
  {
    id: 'kinematics',
    title: '3. Cinématique & Vitesse',
    icon: <Gauge size={20} />,
    sections: [
      { title: 'Vitesses', items: ['Vitesse d\'impression des parois', 'Vitesse de remplissage', 'Vitesse de déplacement (Travel)'] },
      { title: 'Accélération & Temps', items: ['Accélération & Jerk / Junction Deviation', 'Temps minimum de couche', 'Ralentissement automatique'] }
    ]
  },
  {
    id: 'thermal',
    title: '4. Thermique & Refroidissement',
    icon: <Flame size={20} />,
    sections: [
      { title: 'Températures', items: ['Température de la buse (Hotend)', 'Température du plateau (Bed)'] },
      { title: 'Ventilation', items: ['Ventilation du composant (Part cooling fan %)', 'Ventilation ponts et surplombs (Overhang/Bridge fan)'] }
    ]
  },
  {
    id: 'filament',
    title: '5. Gestion Filaments & Rétraction',
    icon: <RotateCcw size={20} />,
    sections: [
      { title: 'Rétraction', items: ['Distance et vitesse de rétraction', 'Z-Hop / Lift (décalage vertical)', 'Pressure Advance / Linear Advance'] },
      { title: 'Débit', items: ['Facteur de débit (Flow ratio / Extrusion multiplier)'] }
    ]
  },
  {
    id: 'supports',
    title: '6. Structures de Support & Adhérence',
    icon: <Cpu size={20} />,
    sections: [
      { title: 'Supports', items: ['Types de supports (Standard vs Tree/Arachne)', 'Distance d\'interface Z/XY', 'Motif des interfaces de support'] },
      { title: 'Adhérence', items: ['Adhérence au plateau (Brim, Raft, Skirt)'] }
    ]
  },
  {
    id: 'surface',
    title: '7. Qualité de Surface & Finition',
    icon: <Sparkles size={20} />,
    sections: [
      { title: 'Finition', items: ['Lissage de la couche supérieure (Ironing)', 'Masquage des coutures Z (Seam position, Scarf seam)'] },
      { title: 'Tolérances', items: ['Compensation d\'élasticité et tolérances X/Y'] }
    ]
  },
  {
    id: 'multimaterial',
    title: '8. Multi-Matériaux & Couleur (AMS)',
    icon: <Palette size={20} />,
    sections: [
      { title: 'Purge & Rinçage', items: ['Volumes de purge et tour de rinçage (Flush volumes)', 'Changements d\'outils et températures de veille'] },
      { title: 'Matériaux spéciaux', items: ['Matériaux d\'interface de support dédiés (PVA / Support W)'] }
    ]
  },
  {
    id: 'advanced',
    title: '9. Dynamique & Algorithmes Avancés',
    icon: <Workflow size={20} />,
    sections: [
      { title: 'Algorithmes', items: ['Générateur de parois (Arachne vs Classic)', 'Arc Fitting (G2/G3 interpolation)', 'Compensation de vibration (Input Shaping)'] }
    ]
  },
  {
    id: 'gcode',
    title: '10. G-code Custom & Intégration',
    icon: <Terminal size={20} />,
    sections: [
      { title: 'Scripts G-code', items: ['G-code de début / fin / pause', 'Dimensions et limites physiques du volume'] },
      { title: 'Intégration', items: ['Gestion des caméras / Time-lapse'] }
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
  const [scrollProgress, setScrollProgress] = useState(0);

  const handleCategoryClick = (catId: string) => {
    if (activeCategory === catId) {
      onSelectCategory(null);
    } else {
      onSelectCategory(catId);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const progress = target.scrollTop / (target.scrollHeight - target.clientHeight);
    setScrollProgress(isNaN(progress) ? 0 : progress);
  };

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
              className={styles.fusionMenuWrapper}
              initial={{ opacity: 0, scale: 0.95, x: -10, y: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, x: -10, y: 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <div 
                ref={contentRef}
                className={styles.fusionMenuContainer}
                onScroll={handleScroll}
              >
                <div className={styles.fusionMenuContent}>
                  {activeCatData.sections.map((section, idx) => (
                    <div key={idx} className={styles.sectionGroup}>
                      <h4 className={styles.sectionTitle}>{section.title}</h4>
                      <ul className={styles.itemsList}>
                        {section.items.map((item, iIdx) => (
                          <li key={iIdx} className={styles.itemRow}>
                            <span className={styles.itemName}>{item}</span>
                            <input 
                              type="text" 
                              defaultValue="Auto" 
                              className={styles.itemInput} 
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {/* Barre de défilement externe flottante */}
              <div className={styles.externalScrollbarTrack}>
                <div 
                  className={styles.externalScrollbarThumb}
                  style={{ top: `${scrollProgress * 75}%` }}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};