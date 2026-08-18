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
  Terminal,
  ChevronDown,
  Check
} from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import styles from './CategoriesSidebar.module.scss';
import { showSuccess } from '@/utils/toast';

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
    id: 'geometry',
    title: '1. Géométrie & Extrusion',
    description: 'Configurez la hauteur des couches, la précision géométrique et la résolution de dépôt de matière pour chaque passe.',
    icon: <Layers size={20} />,
    sections: [
      { 
        title: 'Hauteur & Première couche', 
        items: [
          { label: 'Hauteur de couche (Layer height)', defaultValue: '0.2 mm', description: 'Définit la résolution verticale de la pièce. Plus la valeur est faible, plus le détail est fin mais l\'impression est longue.' },
          { label: 'Première couche (First layer height)', defaultValue: '0.24 mm', description: 'Épaisseur de la première couche imprimée sur le plateau. Une couche plus épaisse améliore l\'adhérence.' },
          { label: 'Débit première couche', defaultValue: '105%', description: 'Quantité de plastique extrudé en surplus sur la première couche pour maximiser l\'écrasement et l\'adhésion.' }
        ] 
      },
      { 
        title: 'Largeurs d\'extrusion', 
        items: [
          { label: 'Largeur des murs (Line width)', defaultValue: '0.45 mm', description: 'Largeur nominale des lignes de contour extrudées par la buse pour garantir la solidité des parois.' },
          { label: 'Largeur du remplissage', defaultValue: '0.45 mm', description: 'Largeur du trait pour les structures internes de remplissage de la pièce.' },
          { label: 'Largeur des supports', defaultValue: '0.40 mm', description: 'Largeur des lignes générées pour les structures de support amovibles.' }
        ] 
      },
      { 
        title: 'Parois', 
        items: [
          { label: 'Ordre d\'impression des parois', defaultValue: 'Interne d\'abord', description: 'Détermine si les parois intérieures ou extérieures sont imprimées en premier pour optimiser l\'état de surface.' },
          { label: 'Compensation de contour', defaultValue: 'Activée', description: 'Ajuste mathématiquement les trajectoires pour compenser le foisonnement du polymère.' }
        ] 
      }
    ]
  },
  {
    id: 'resistance',
    title: '2. Résistance & Remplissage',
    description: 'Ajustez la densité interne, les motifs de structure et le nombre de coques pour garantir la robustesse mécanique.',
    icon: <ShieldAlert size={20} />,
    sections: [
      { 
        title: 'Remplissage', 
        items: [
          { label: 'Densité de remplissage (%)', defaultValue: '15%', description: 'Pourcentage de matière à l\'intérieur de la pièce. 15% offre un excellent compromis poids/solidité.' },
          { label: 'Motifs (Gyroid, Grid, Lightning)', defaultValue: 'Gyroïde', description: 'Géométrie tridimensionnelle interne de l\'objet. Peut faire varier la vitesse et la résistance de l\'objet.', isPatternDropdown: true },
          { label: 'Angle du remplissage', defaultValue: '45°', description: 'Orientation des lignes de remplissage par rapport aux axes du plateau.' }
        ] 
      },
      { 
        title: 'Parois & Coques', 
        items: [
          { label: 'Nombre de parois (Wall loops)', defaultValue: '3', description: 'Nombre de périmètres extérieurs solides. Plus il y en a, plus la pièce est rigide et étanche.' },
          { label: 'Couches supérieures et inférieures', defaultValue: '4', description: 'Nombre de couches pleines formant le plafond et le plancher de la pièce imprimée.' }
        ] 
      }
    ]
  },
  {
    id: 'kinematics',
    title: '3. Cinématique & Vitesse',
    description: 'Pilotez les vitesses d\'accélération, les limites de déplacement et les dynamiques de mouvement de l\'imprimante.',
    icon: <Gauge size={20} />,
    sections: [
      { 
        title: 'Vitesses', 
        items: [
          { label: 'Vitesse des parois', defaultValue: '120 mm/s', description: 'Vitesse d\'impression des contours visibles. Réduire cette valeur améliore la netteté des détails extérieurs.' },
          { label: 'Vitesse de remplissage', defaultValue: '200 mm/s', description: 'Vitesse d\'exécution des structures internes invisibles pour maximiser le débit global.' },
          { label: 'Vitesse de déplacement (Travel)', defaultValue: '300 mm/s', description: 'Vitesse de la tête lorsqu\'elle se déplace sans extruder de matière d\'un point à un autre.' }
        ] 
      },
      { 
        title: 'Accélération & Temps', 
        items: [
          { label: 'Accélération & Jerk', defaultValue: '5000 mm/s²', description: 'Taux d\'augmentation de la vitesse et tolérance de saut brusque aux intersections de trajectoire.' },
          { label: 'Temps minimum de couche', defaultValue: '5.0 s', description: 'Temps syndical minimal par couche pour laisser le temps au plastique chaud de refroidir correctement.' },
          { label: 'Ralentissement automatique', defaultValue: 'Activé', description: 'Réduit dynamiquement la vitesse sur les petites structures pour éviter la déformation thermique.' }
        ] 
      }
    ]
  },
  {
    id: 'thermal',
    title: '4. Thermique & Refroidissement',
    description: 'Maîtrisez les températures de fusion du filament, la chauffe du plateau et la puissance de ventilation.',
    icon: <Flame size={20} />,
    sections: [
      { 
        title: 'Températures', 
        items: [
          { label: 'Température de la buse (Hotend)', defaultValue: '210°C', description: 'Température de fusion de la buse chauffante adaptée au PLA ou aux thermoplastiques standards.' },
          { label: 'Température du plateau (Bed)', defaultValue: '60°C', description: 'Température de chauffe du plateau en verre ou acier magnétique pour éviter le warping (décollement).' }
        ] 
      },
      { 
        title: 'Ventilation', 
        items: [
          { label: 'Ventilation du composant (Part cooling)', defaultValue: '100%', description: 'Vitesse des turbines soufflant directement sur le polymère fraîchement déposé pour figer les surplombs.' },
          { label: 'Ventilation ponts et surplombs', defaultValue: '80%', description: 'Augmentation instantanée du flux d\'air lors du franchissement de vides ou de ponts.' }
        ] 
      }
    ]
  },
  {
    id: 'filament',
    title: '5. Gestion Filaments & Rétraction',
    description: 'Paramétrez les distances de recul du filament pour éliminer les fils d\'ange et suintements.',
    icon: <RotateCcw size={20} />,
    sections: [
      { 
        title: 'Rétraction', 
        items: [
          { label: 'Distance et vitesse de rétraction', defaultValue: '0.8 mm / 35 mm/s', description: 'Longueur de filament tirée en arrière hors de la zone de fusion lors des déplacements aériens.' },
          { label: 'Z-Hop / Lift (décalage vertical)', defaultValue: '0.4 mm', description: 'Soulèvement vertical de la tête d\'impression pendant la rétraction pour éviter de frotter sur les parois.' },
          { label: 'Pressure Advance / Linear Advance', defaultValue: '0.035', description: 'Anticipation de la pression dans la buse lors des accélérations et décélérations.' }
        ] 
      },
      { 
        title: 'Débit', 
        items: [
          { label: 'Facteur de débit (Extrusion multiplier)', defaultValue: '0.98', description: 'Multiplicateur global du volume de matière expulsée pour corriger la tolérance du diamètre du fil.' }
        ] 
      }
    ]
  },
  {
    id: 'supports',
    title: '6. Structures de Support & Adhérence',
    description: 'Générez des échafaudages intelligents pour soutenir les surplombs et optimiser l\'ancrage sur le plateau.',
    icon: <Cpu size={20} />,
    disabled: true,
    sections: [
      { 
        title: 'Supports', 
        items: [
          { label: 'Types de supports (Arachne vs Organique)', defaultValue: 'Arachne (Organique)', description: 'Supports ramifiés en forme d\'arbres nécessitant moins de matière et faciles à détacher manuellement.' },
          { label: 'Distance d\'interface Z/XY', defaultValue: '0.2 mm', description: 'Espace d\'air entre le support et la pièce pour permettre un décollement propre sans marquer l\'objet.' },
          { label: 'Motif des interfaces de support', defaultValue: 'Rectiligne', description: 'Trame géométrique de la couche de contact directe sous la pièce.' }
        ] 
      },
      { 
        title: 'Adhérence', 
        items: [
          { label: 'Adhérence au plateau (Brim, Skirt)', defaultValue: 'Brim (Ligne auto)', description: 'Ajout d\'une collerette plate autour de la première couche pour augmenter la surface de contact au sol.' }
        ] 
      }
    ]
  },
  {
    id: 'surface',
    title: '7. Qualité de Surface & Finition',
    description: 'Optimisez l\'esthétique visuelle, le lissage des dessus de pièces et la précision dimensionnelle.',
    icon: <Sparkles size={20} />,
    disabled: true,
    sections: [
      { 
        title: 'Finition', 
        items: [
          { label: 'Lissage de la couche supérieure (Ironing)', defaultValue: 'Désactivé', description: 'Passage à chaud de la buse sans extrusion sur la dernière couche pour polir et éliminer les stries.' },
          { label: 'Masquage des coutures Z (Scarf seam)', defaultValue: 'Aléatoire', description: 'Position de départ de la couche pour dissimuler la micro-cicatrice verticale de raccord.' }
        ] 
      },
      { 
        title: 'Tolérances', 
        items: [
          { label: 'Compensation d\'élasticité X/Y', defaultValue: '0.0 mm', description: 'Ajustement dimensionnel pour compenser le retrait thermique des pièces techniques emboîtables.' }
        ] 
      }
    ]
  },
  {
    id: 'multimaterial',
    title: '8. Multi-Matériaux & Couleur (AMS)',
    description: 'Pilotez les changements de bobines automatiques, les tours de purge et les matériaux de support solubles.',
    icon: <Palette size={20} />,
    disabled: true,
    sections: [
      { 
        title: 'Purge & Rinçage', 
        items: [
          { label: 'Volumes de purge et tour de rinçage', defaultValue: '600 mm³', description: 'Quantité de plastique purgée lors d\'un changement de couleur pour éviter les teintes baveuses.' },
          { label: 'Changements d\'outils et températures', defaultValue: '220°C', description: 'Gestion des consignes thermiques lors du basculement entre filaments de natures différentes.' }
        ] 
      },
      { 
        title: 'Matériaux spéciaux', 
        items: [
          { label: 'Matériaux d\'interface solubles (PVA / W)', defaultValue: 'Support W', description: 'Utilisation d\'un polymère soluble dans l\'eau pour les interfaces de supports complexes.' }
        ] 
      }
    ]
  },
  {
    id: 'advanced',
    title: '9. Dynamique & Algorithmes Avancés',
    description: 'Activez les algorithmes mathématiques de pointe pour accélérer le calcul et lisser les trajectoires.',
    icon: <Workflow size={20} />,
    disabled: true,
    sections: [
      { 
        title: 'Algorithmes', 
        items: [
          { label: 'Générateur de parois (Arachne vs Classic)', defaultValue: 'Arachne', description: 'Moteur de calcul à épaisseur de trait variable pour remplir parfaitement les détails fins.' },
          { label: 'Arc Fitting (G2/G3 interpolation)', defaultValue: 'Activé', description: 'Convertit les micro-segments droits en véritables arcs de cercle pour fluidifier le G-code.' },
          { label: 'Compensation de vibration (Input Shaping)', defaultValue: 'MZV (X/Y)', description: 'Filtre anti-résonance supprimant l\'effet d\'echo (ringing) sur les parois à haute vitesse.' }
        ] 
      }
    ]
  },
  {
    id: 'gcode',
    title: '10. G-code Custom & Intégration',
    description: 'Personnalisez les scripts d\'initialisation, de fin de course et l\'intégration avec vos fermes d\'impression.',
    icon: <Terminal size={20} />,
    disabled: true,
    sections: [
      { 
        title: 'Scripts G-code', 
        items: [
          { label: 'G-code de début / fin / pause', defaultValue: 'Standard Klipper', description: 'Séquences de commandes brutes exécutées au démarrage, à l\'arrêt ou en cas de pause.' },
          { label: 'Dimensions du volume d\'impression', defaultValue: '256x256x256 mm', description: 'Limites physiques et coordonnées de sécurité des axes X, Y et Z de la machine.' }
        ] 
      },
      { 
        title: 'Intégration', 
        items: [
          { label: 'Gestion des caméras / Time-lapse', defaultValue: 'Smooth (Extruder Sync)', description: 'Synchronisation des prises de vue vidéo à chaque fin de couche montante.' }
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

  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);

  const [hoveredCatId, setHoveredCatId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; title: string; description: string } | null>(null);

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

  const handleMouseEnter = (cat: CategoryItem, e: React.MouseEvent<HTMLButtonElement>) => {
    setHoveredCatId(cat.id);
    const rect = e.currentTarget.getBoundingClientRect();
    const tooltipTitle = cat.disabled ? "Bientôt disponible" : cat.title;
    const tooltipDesc = cat.disabled ? "Cette fonctionnalité sera disponible dans une prochaine mise à jour." : cat.description;
    setTooltipPos({
      top: rect.top + rect.height / 2,
      title: tooltipTitle,
      description: tooltipDesc
    });
  };

  const handleMouseLeave = () => {
    setHoveredCatId(null);
    setTooltipPos(null);
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
      <div className={styles.leftSidebarContainer}>
        <div className={styles.categoriesToolbar}>
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                ref={(el) => (iconRefs.current[cat.id] = el)}
                className={clsx(styles.categoryButton, { 
                  [styles.active]: isActive,
                  [styles.disabledButton]: cat.disabled
                })}
                onClick={() => handleCategoryClick(cat)}
                onMouseEnter={(e) => handleMouseEnter(cat, e)}
                onMouseLeave={handleMouseLeave}
                style={cat.disabled ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
              >
                {cat.icon}
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {tooltipPos && (
          <motion.div
            initial={{ opacity: 0, x: -6, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -6, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'fixed',
              left: '74px',
              top: `${tooltipPos.top}px`,
              transform: 'translateY(-50%)',
              zIndex: 999999,
              pointerEvents: 'none',
              background: 'rgba(10, 15, 26, 0.85)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '10px 14px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
              maxWidth: '260px'
            }}
          >
            <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: '12px', fontWeight: 700, color: '#00f0ff', marginBottom: '4px' }}>
              {tooltipPos.title}
            </div>
            <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.8)', lineHeight: '1.4' }}>
              {tooltipPos.description}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeCatData && !activeCatData.disabled && (
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
                onClick={() => {
                  onSelectCategory(null);
                  setIsPatternPopupOpen(false);
                }}
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