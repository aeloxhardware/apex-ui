import React, { useRef, useState, useEffect } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers,
  BicepsFlexed,
  Gauge,
  Sparkles,
  Terminal,
  ChevronDown,
  Check
} from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import styles from './CategoriesSidebar.module.scss';
import { showSuccess } from '@/utils/toast';

const SolidityIcon = () => <BicepsFlexed size={20} />;

// Icône personnalisée "Supports" : barres verticales évoquant une structure de support
const SupportsIcon = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 4v16M10.5 4v16M15 4v16M19 4v16" />
  </svg>
);

export interface InfillPattern {
  name: string;
  description: string;
}

export const INFILL_PATTERNS: InfillPattern[] = [
  { name: 'Concentrique', description: 'Suit la forme du périmètre externe en décalant la bordure vers l\'intérieur à chaque boucle.' },
  { name: 'Rectiligne', description: 'Lignes droites parallèles croisées d\'un angle fixe alterné à chaque couche.' },
  { name: 'Grille', description: 'Lignes parallèles croisées tracées sur une même couche pour former une grille carrée.' },
  { name: 'Ligne', description: 'Lignes parallèles tracées sur une même couche sans croisement, orientées à 90° de la couche précédente.' },
  { name: 'Triangles', description: 'Réseau de trois jeux de lignes croisées formant des triangles équilatéraux.' },
  { name: 'Tri-hexagone', description: 'Trois séries de lignes droites formant des hexagones entrelacés avec de petits triangles.' },
  { name: 'Nid d\'abeille', description: 'Hexagones parfaits alignés en 2D à chaque couche.' },
  { name: 'Rectiligne aligné', description: 'Lignes parallèles toujours orientées dans le même sens sur toutes les couches.' },
  { name: 'Spirale d\'Archimède', description: 'Motifs circulaires continus s\'enroulant du centre vers l\'extérieur.' },
  { name: 'Spirale Octagramme', description: 'Motif en étoile à 8 branches généré par des spirales concentriques polygonales.' },
  { name: 'Zigzag', description: 'Trajectoire continue en ligne brisée évitant les rétractions de l\'extrudeur.' },
  { name: 'Nid d\'abeille latéral', description: 'Structure en nid d\'abeille orientée verticalement le long des parois.' },
  { name: 'Grille latérale', description: 'Grille carrée projetée verticalement sur les flancs de la pièce.' },
  { name: 'Cubique', description: 'Réseau 3D de cubes basculés sur leur coin, créant des cavités pyramidales inversées.' },
  { name: 'Cubique adaptatif', description: 'Motif cubique dont la densité augmente à mesure qu\'on s\'approche des surfaces supérieures ou des parois.' },
  { name: 'Un quart de cube', description: 'Variante du motif cubique décalée pour réduire la taille des cellules par deux dans une direction.' },
  { name: 'Tétraèdre', description: 'Pyramides à base triangulaire interconnectées pour maximiser la résistance à la compression.' },
  { name: 'Nid d\'abeille 3D', description: 'Structure alvéolaire dont la forme évolue de façon fluide le long de l\'axe Z.' },
  { name: 'Support Cubique', description: 'Remplissage très aéré qui ne se densifie que sous les plafonds internes pour les soutenir.' },
  { name: 'Gyroïde', description: 'Surface courbe 3D isotrope ondulée continue offrant une résistance multidirectionnelle sans croisement de buse.' },
  { name: 'Croix 3D', description: 'Motif 3D composé de croix entrelacées offrant flexibilité et absorption d\'impacts.' },
  { name: 'Croix', description: 'Motif 2D souple composé de formes en croix à branches arrondies.' },
  { name: 'Croix-Zag', description: 'Structure hybride alternant entre la croix 3D et le tracé en zigzag.' },
  { name: 'Interlocked-Zag', description: 'Motif de remplissage avec liaisons mécaniques verrouillées d\'une couche à l\'autre.' },
  { name: 'TPMS Diamond', description: 'Structure minimale 3D inspirée de la disposition cristalline du diamant.' },
  { name: 'Gyroïde graduel', description: 'Gyroïde dont la densité et l\'épaisseur évoluent progressivement selon la hauteur Z.' },
  { name: 'TPMS Diamond graduel', description: 'Structure TPMS Diamond dont la densité varie le long de la pièce.' },
  { name: 'Fischer-Koch', description: 'Surface TPMS complexe offrant une porosité élevée et une répartition très homogène des contraintes.' },
  { name: 'Fischer-Koch graduel', description: 'Structure Fischer-Koch à densité variable le long de l\'axe Z.' },
  { name: 'Courbe de Hilbert', description: 'Ligne brisée continue remplissant l\'espace 2D sans croisement, idéale pour les pièces flexibles.' },
  { name: 'Éclair', description: 'Structure d\'arborescence interne suspendue qui ne soutient que les plafonds internes.' },
  { name: 'Hachures croisées', description: 'Motif de hachures croisées à intervalles alternés pour limiter l\'accumulation de matière.' }
];

export interface CategoryItem {
  id: string;
  title: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  disabled?: boolean;
  sections: {
    title: string;
    items: { label: string; defaultValue: string; description: string; isPatternDropdown?: boolean }[];
  }[];
}

const CATEGORIES: CategoryItem[] = [
  {
    id: 'quality',
    title: 'Quality (Qualité)',
    label: 'Qualité',
    description: 'Paramétrez la hauteur de couche, la vitesse globale, la précision des parois, les porte-à-faux, la couture et la compensation d’isolation.',
    icon: <Sparkles size={20} />,
    sections: [
      {
        title: 'Quality settings',
        items: [
          { label: 'Hauteur de couche (Layer height)', defaultValue: '0.2 mm', description: 'Définit la résolution verticale et le niveau de détail de la pièce.' },
          { label: 'Vitesse globale', defaultValue: '100%', description: 'Applique un facteur global aux vitesses d’impression.' },
          { label: 'Précision des parois', defaultValue: 'Élevée', description: 'Contrôle la précision dimensionnelle et la qualité des contours.' },
          { label: 'Angles et porte-à-faux (Overhangs)', defaultValue: '45°', description: 'Définit l’angle à partir duquel les porte-à-faux nécessitent une attention particulière.' },
          { label: 'Position de couture (Seam position)', defaultValue: 'Alignée', description: 'Choisit la position des points de départ de chaque couche.' },
          { label: 'Compensation d’isolation', defaultValue: 'Activée', description: 'Compense les écarts thermiques et dimensionnels liés à l’isolation.' }
        ]
      }
    ]
  },
  {
    id: 'strength',
    title: 'Strength (Solidité)',
    label: 'Solidité',
    description: 'Configurez les parois, les coques, le remplissage et l’ancrage des structures.',
    icon: <BicepsFlexed size={20} />,
    sections: [
      {
        title: 'Parois & coques',
        items: [
          { label: 'Nombre de parois (Perimeters / Walls)', defaultValue: '3', description: 'Nombre de périmètres extérieurs formant les parois de la pièce.' },
          { label: 'Couches supérieures / inférieures (Top / Bottom shells)', defaultValue: '4', description: 'Nombre de couches pleines formant le dessus et le dessous de la pièce.' }
        ]
      },
      {
        title: 'Remplissage & ancrage',
        items: [
          { label: 'Densité de remplissage (Infill)', defaultValue: '15%', description: 'Pourcentage de matière utilisé à l’intérieur de la pièce.' },
          { label: 'Motif de remplissage (Infill pattern)', defaultValue: 'Gyroïde', description: 'Géométrie de la structure interne de la pièce.', isPatternDropdown: true },
          { label: 'Ancrage des structures', defaultValue: 'Activé', description: 'Renforce la liaison entre le remplissage, les parois et les couches solides.' }
        ]
      }
    ]
  },
  {
    id: 'speed',
    title: 'Speed (Vitesse)',
    label: 'Vitesse',
    description: 'Réglez l’accélération, les vitesses spécifiques et la vitesse de rétraction.',
    icon: <Gauge size={20} />,
    sections: [
      {
        title: 'Accélération & vitesses',
        items: [
          { label: 'Accélération', defaultValue: '5000 mm/s²', description: 'Vitesse à laquelle la tête atteint sa consigne.' },
          { label: 'Vitesse des parois externes', defaultValue: '80 mm/s', description: 'Vitesse des contours visibles.' },
          { label: 'Vitesse des parois internes', defaultValue: '120 mm/s', description: 'Vitesse des contours internes.' },
          { label: 'Vitesse du premier niveau', defaultValue: '30 mm/s', description: 'Vitesse dédiée à la première couche pour améliorer l’adhérence.' },
          { label: 'Vitesse du remplissage', defaultValue: '200 mm/s', description: 'Vitesse d’impression de la structure interne.' },
          { label: 'Vitesse de détection des ponts', defaultValue: '50 mm/s', description: 'Vitesse utilisée pour les zones de ponts.' }
        ]
      },
      {
        title: 'Rétraction',
        items: [
          { label: 'Vitesse de rétraction', defaultValue: '35 mm/s', description: 'Vitesse de recul du filament pendant les déplacements.' },
          { label: 'Distance de rétraction', defaultValue: '0.8 mm', description: 'Distance de recul du filament pour limiter le suintement.' }
        ]
      }
    ]
  },
  {
    id: 'support',
    title: 'Support (Support & Adhérence)',
    label: 'Support & Adhérence',
    description: 'Configurez les supports, leurs interfaces et l’adhérence au plateau.',
    icon: <SupportsIcon />,
    sections: [
      {
        title: 'Supports',
        items: [
          { label: 'Activer les supports', defaultValue: 'Activé', description: 'Active la génération de supports sous les zones en porte-à-faux.' },
          { label: 'Type de support', defaultValue: 'Tree', description: 'Choisit entre supports normaux et supports arborescents (Tree).' },
          { label: 'Style de support', defaultValue: 'Organique', description: 'Définit la forme et la stratégie de génération des supports.' },
          { label: 'Angle de déclenchement', defaultValue: '45°', description: 'Angle au-delà duquel un support est généré.' }
        ]
      },
      {
        title: 'Interfaces & adhérence',
        items: [
          { label: 'Distance d’interface Z', defaultValue: '0.2 mm', description: 'Écart vertical entre la pièce et l’interface du support.' },
          { label: 'Distance d’interface X/Y', defaultValue: '0.35 mm', description: 'Écart horizontal entre la pièce et le support.' },
          { label: 'Type de bordure (Brim / Raft)', defaultValue: 'Brim', description: 'Augmente la surface de contact avec le plateau pour améliorer l’adhérence.' }
        ]
      }
    ]
  },
  {
    id: 'others',
    title: 'Others (Autres)',
    label: 'Autres',
    description: 'Regroupez les options avancées, la ventilation fine, la purge multi-couleurs et les scripts.',
    icon: <Layers size={20} />,
    sections: [
      {
        title: 'Impression & ventilation',
        items: [
          { label: 'Mode vase (Spiral vase)', defaultValue: 'Désactivé', description: 'Imprime les parois en spirale continue pour les objets adaptés.' },
          { label: 'Ordre d’impression des objets', defaultValue: 'Séquentiel', description: 'Définit l’ordre dans lequel les objets sont imprimés.' },
          { label: 'Stratégie de ventilation fine', defaultValue: 'Automatique', description: 'Ajuste finement le refroidissement selon la géométrie et la couche.' }
        ]
      },
      {
        title: 'Multi-couleurs & scripts',
        items: [
          { label: 'Purge / tour de rinçage', defaultValue: '600 mm³', description: 'Gère la purge de matière lors des changements de couleur.' },
          { label: 'Scripts d’I/O (G-code personnalisé)', defaultValue: 'Standard', description: 'Personnalise les commandes exécutées au début, à la fin ou pendant une pause.' }
        ]
      }
    ]
  },
  {
    id: 'others-gcode',
    title: 'Others/G-code (Flotteurs spécifiques)',
    label: 'G-code spécifique',
    description: 'Regroupez les paramètres d’exclusion d’objets, de pauses intermédiaires et d’optimisation de trajectoire.',
    icon: <Terminal size={20} />,
    sections: [
      {
        title: 'Paramètres spécifiques',
        items: [
          { label: 'Exclusion d’objets', defaultValue: 'Désactivée', description: 'Permet d’exclure certains objets du plateau pendant la préparation ou l’impression.' },
          { label: 'Pauses intermédiaires', defaultValue: 'Aucune', description: 'Insère des pauses à des hauteurs ou étapes définies.' },
          { label: 'Optimisation de trajectoire', defaultValue: 'Activée', description: 'Réduit les déplacements inutiles et optimise les trajectoires générées.' }
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
  const categoriesToolbarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const patternContentRef = useRef<HTMLDivElement>(null);

  const [thumbHeight, setThumbHeight] = useState(40);
  const [thumbTop, setThumbTop] = useState(8);
  const [hasScroll, setHasScroll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [patternThumbHeight, setPatternThumbHeight] = useState(40);
  const [patternThumbTop, setPatternThumbTop] = useState(8);
  const [hasPatternScroll, setHasPatternScroll] = useState(false);
  const [isPatternDragging, setIsPatternDragging] = useState(false);

  const [selectedPattern, setSelectedPattern] = useState<string>('Gyroïde');
  const [isPatternPopupOpen, setIsPatternPopupOpen] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);

  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);

  useEffect(() => {
    const handlePreviewToggled = (e: CustomEvent<{ active: boolean }>) => {
      setPreviewActive(!!e.detail?.active);
    };
    window.addEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    return () => {
      window.removeEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    };
  }, []);

  const handleCategoryClick = (cat: CategoryItem) => {
    if (cat.disabled) {
      showSuccess("Bientôt disponible");
      return;
    }
    if (activeCategory === cat.id) {
      onSelectCategory(null);
    } else {
      onSelectCategory(cat.id);
    }
    setIsPatternPopupOpen(false);
  };

  useEffect(() => {
    if (!activeCategory) return;

    const activeButton = iconRefs.current[activeCategory];
    activeButton?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeCategory]);

  const handleCategoriesWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!categoriesToolbarRef.current || event.deltaY === 0) return;
    event.preventDefault();
    categoriesToolbarRef.current.scrollBy({ left: event.deltaY, behavior: 'smooth' });
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

  const handlePatternScroll = () => {
    if (!patternContentRef.current || isPatternDragging) return;
    const { scrollTop, scrollHeight, clientHeight } = patternContentRef.current;
    if (scrollHeight <= clientHeight) {
      setHasPatternScroll(false);
      return;
    }
    setHasPatternScroll(true);
    
    const margin = 8;
    const trackHeight = clientHeight - (margin * 2);
    const calculatedHeight = Math.max(32, (clientHeight / scrollHeight) * trackHeight);
    
    const maxScrollTop = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - calculatedHeight;
    const calculatedTop = maxScrollTop > 0 ? margin + (scrollTop / maxScrollTop) * maxThumbTop : margin;

    setPatternThumbHeight(calculatedHeight);
    setPatternThumbTop(calculatedTop);
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

  const handlePatternMouseDown = (e: React.MouseEvent) => {
    setIsPatternDragging(true);
    startYRef.current = e.clientY;
    if (patternContentRef.current) {
      startScrollTopRef.current = patternContentRef.current.scrollTop;
    }
    document.addEventListener('mousemove', handlePatternMouseMove);
    document.addEventListener('mouseup', handlePatternMouseUp);
    e.preventDefault();
  };

  const handlePatternMouseMove = (e: MouseEvent) => {
    if (!patternContentRef.current) return;
    const deltaY = e.clientY - startYRef.current;
    const { scrollHeight, clientHeight } = patternContentRef.current;
    const margin = 8;
    const trackHeight = clientHeight - (margin * 2);
    const maxThumbTop = trackHeight - patternThumbHeight;
    const maxScrollTop = scrollHeight - clientHeight;

    if (maxThumbTop > 0) {
      const scrollRatio = deltaY / maxThumbTop;
      const newScrollTop = Math.max(0, Math.min(maxScrollTop, startScrollTopRef.current + scrollRatio * maxScrollTop));
      patternContentRef.current.scrollTop = newScrollTop;
      
      const calculatedTop = margin + (newScrollTop / maxScrollTop) * maxThumbTop;
      setPatternThumbTop(calculatedTop);
    }
  };

  const handlePatternMouseUp = () => {
    setIsPatternDragging(false);
    document.removeEventListener('mousemove', handlePatternMouseMove);
    document.removeEventListener('mouseup', handlePatternMouseUp);
  };

  useEffect(() => {
    if (activeCategory) {
      setTimeout(handleScroll, 50);
    } else {
      setIsPatternPopupOpen(false);
    }
  }, [activeCategory]);

  useEffect(() => {
    if (isPatternPopupOpen) {
      setTimeout(handlePatternScroll, 50);
    }
  }, [isPatternPopupOpen]);

  const activeCatData = CATEGORIES.find(c => c.id === activeCategory);

  return (
    <>
      <div className={styles.leftSidebarContainer} data-apex-chrome-panel>
        <AnimatePresence>
          {!previewActive && (
            <motion.div
              ref={categoriesToolbarRef}
              className={styles.categoriesToolbar}
              onWheel={handleCategoriesWheel}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{
                opacity: { duration: 0.9, ease: 'linear' },
                x: { duration: 0.9, ease: 'easeInOut' },
              }}
            >
              {CATEGORIES.map((cat) => {
                const isActive = activeCategory === cat.id;
                return (
                  <CustomTooltip
                    key={cat.id}
                    content="Arrive bientôt"
                    description={cat.description}
                  >
                    <button
                      ref={(el) => { iconRefs.current[cat.id] = el; }}
                      className={clsx(styles.categoryButton, {
                        [styles.active]: isActive,
                        [styles.disabledButton]: true
                      })}
                      disabled
                    >
                      {cat.icon}
                      <span className={styles.categoryLabel}>{cat.label}</span>
                    </button>
                  </CustomTooltip>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {activeCatData && !activeCatData.disabled && (
          <>
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
                        <CustomTooltip key={iIdx} content={item.label} description={item.description}>
                          <li 
                            className={clsx(styles.itemRow, { [styles.clickableRow]: item.isPatternDropdown })}
                            onClick={() => {
                              if (item.isPatternDropdown) {
                                setIsPatternPopupOpen(!isPatternPopupOpen);
                              }
                            }}
                          >
                            <span className={styles.itemName}>
                              {item.isPatternDropdown ? `Motif de remplissage (${selectedPattern})` : item.label}
                            </span>
                            {item.isPatternDropdown ? (
                              <ChevronDown size={14} className="shrink-0 text-[#00f0ff] -rotate-90 ml-2" />
                            ) : (
                              <input 
                                type="text" 
                                defaultValue={item.defaultValue} 
                                className={styles.itemInput} 
                              />
                            )}
                          </li>
                        </CustomTooltip>
                      ))}
                    </ul>
                  </div>
                ))}
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
            </motion.div>

            {/* Pattern popup window next to the menu */}
            <AnimatePresence>
              {isPatternPopupOpen && (
                <motion.div
                  className={styles.patternPopup}
                  initial={{ opacity: 0, scale: 0.95, x: -10 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.95, x: -10 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div 
                    ref={patternContentRef}
                    className={styles.patternPopupContent}
                    onScroll={handlePatternScroll}
                  >
                    <div className={styles.sectionGroup}>
                      <h4 className={styles.sectionTitle}>Motifs de remplissage</h4>
                      <ul className={styles.itemsList}>
                        {INFILL_PATTERNS.map((pat, pIdx) => {
                          const isSelected = selectedPattern === pat.name;
                          return (
                            <CustomTooltip key={pIdx} content={pat.name} description={pat.description} key-override={pat.name}>
                              <li 
                                className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                                onClick={() => {
                                  setSelectedPattern(pat.name);
                                  setIsPatternPopupOpen(false);
                                }}
                              >
                                <span className={styles.itemName}>{pat.name}</span>
                                {isSelected && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                              </li>
                            </CustomTooltip>
                          );
                        })}
                      </ul>
                    </div>
                  </div>

                  {hasPatternScroll && (
                    <div 
                      className={clsx(styles.externalScrollThumb, { [styles.dragging]: isPatternDragging })}
                      onMouseDown={handlePatternMouseDown}
                      style={{
                        height: `${patternThumbHeight}px`,
                        top: `${patternThumbTop}px`
                      }}
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </AnimatePresence>
    </>
  );
};