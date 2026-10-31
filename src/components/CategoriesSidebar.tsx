import React, { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react';
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
import { EngineItemRow } from './EngineItemRow';
import { InfillPatternIcon } from './InfillPatternIcon';
import { ENGINE_PATTERN_ICON, ORCA_ONLY_PATTERNS } from '@/utils/orcaInfillPatterns';
import {
  ENUM_DESCRIPTIONS, ENUM_LABELS, getEngineSetting, getEngineSettingValue, setEngineSettingValue, useEngineSettings,
} from '@/utils/engineSettings';
import { LiquidGlassMorph, GLASS_BLUR_PX, PREVIEW_GLASS_BLUR_PX } from './LiquidGlassMorph';
import styles from './CategoriesSidebar.module.scss';
import { showSuccess } from '@/utils/toast';
import { mitosisPath, rectPath, stretchPath, type GlassRect } from '@/utils/liquidGlass';
import {
  PANEL_LEFT, PILL_TOP, PILL, PREVIEW_W, previewGeometry, FROM_PREVIEW_FADE_MS, previewTabLayout, tabMorphPathAt,
  TAB_CASCADE_FADE_MS, TAB_CASCADE_STAGGER_MS, TAB_MORPH_MS,
} from '@/utils/spaceMorphGeometry';
import { getPreviewTab, usePreviewTab } from './PreviewUpperTabs';
import { usePreviewPanelVars } from '@/hooks/use-preview-panel-vars';

// Géométrie du menu de catégorie, en px, dans le repère de la pilule (fixed, left 24 / top 212).
// Doit rester alignée sur CategoriesSidebar.module.scss (.leftSidebarContainer,
// .categoriesToolbar, .fusionMenuContainer).
const MENU_OFFSET_Y = 68; // .fusionMenuContainer : top 280
const MENU_W = 320;
const MENU_R = 16;
// Panneau (max-height 400) + la marge que prend le col en s'étirant avant de se rompre.
const MENU_STAGE_H = MENU_OFFSET_Y + 400 + 40;
const MENU_MORPH_MS = 700;

// Prévisualisation : panneau du haut sur toute la hauteur disponible, panneau du bas de hauteur
// fixe, le tout s'arrêtant à 236px du bas de l'écran (au-dessus de la barre d'aide).
const PREVIEW_STRETCH_MS = 520;
const PREVIEW_HOLD_MS = 90; // temps mort entre l'étirement et la division : deux gestes distincts
const PREVIEW_DIVIDE_MS = 760;
const PREVIEW_MORPH_MS = PREVIEW_STRETCH_MS + PREVIEW_HOLD_MS + PREVIEW_DIVIDE_MS;

// Cascade des icônes de la pilule (Qualité/Solidité/Vitesse/...) autour d'un morph de Modélisation,
// dans l'ordre d'affichage (gauche → droite) : disparition dès le clic vers Modélisation
// (leavingToModeling), apparition au retour d'un morph de sortie (arrivingFromModeling). Symétrique
// à la cascade du contenu du panneau Modélisation (cf. CONTENT_STAGGER_MS dans ModelingSidebar.tsx).
// Avec ~8 catégories et 30ms de décalage, la cascade dure ~370ms : largement terminée avant que la
// déformation ne commence (`onCovered`, ~900ms après le clic).
const PILL_ICON_STAGGER_MS = 0.07;
const PILL_ICON_FADE_MS = 0.24;

const pillIconsContainerVariants = {
  visible: { transition: { staggerChildren: PILL_ICON_STAGGER_MS } },
  hidden: { transition: { staggerChildren: PILL_ICON_STAGGER_MS } },
};

const pillIconVariants = {
  visible: { opacity: 1, x: 0, y: 0, transition: { duration: PILL_ICON_FADE_MS, ease: [0.4, 0, 0.2, 1] } },
  hidden: { opacity: 0, x: -14, y: -4, transition: { duration: PILL_ICON_FADE_MS, ease: [0.4, 0, 0.2, 1] } },
};

const SolidityIcon = () => <BicepsFlexed size={20} />;

// Icône personnalisée "Supports" : barres verticales évoquant une structure de support
const SupportsIcon = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 4v16M10.5 4v16M15 4v16M19 4v16" />
  </svg>
);

export interface CategoryItem {
  id: string;
  title: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  disabled?: boolean;
  sections: {
    title: string;
    /** `engine` : chemin du réglage du moteur auquel la ligne est reliée (ligne active, cf. EngineItemRow). */
    items: { label: string; defaultValue: string; description: string; engine?: string }[];
  }[];
}

const DESC_ORCA = 'Réglage d’OrcaSlicer, pas encore pris en charge par le moteur d’Apex.';

const CATEGORIES: CategoryItem[] = [
  {
    id: 'quality',
    title: 'Quality (Qualité)',
    label: 'Qualité',
    description: 'Paramétrez la hauteur de couche, la vitesse globale, la précision des parois, les porte-à-faux, la couture et la compensation d’isolation.',
    icon: <Sparkles size={20} />,
    sections: [
      {
        title: 'Hauteur de couche',
        items: [
          { label: 'Hauteur de couche', defaultValue: '', description: '', engine: 'layers.layer_height_base' },
          { label: 'Hauteur de couche initiale', defaultValue: '0,2 mm', description: DESC_ORCA }
        ]
      },
      {
        title: 'Largeur de ligne',
        items: [
          { label: 'Défaut', defaultValue: '0,4 mm', description: DESC_ORCA },
          { label: 'Couche initiale', defaultValue: '0,5 mm', description: DESC_ORCA },
          { label: 'Paroi extérieure', defaultValue: '0,4 mm', description: DESC_ORCA },
          { label: 'Paroi intérieure', defaultValue: '0,45 mm', description: DESC_ORCA },
          { label: 'Surface supérieure', defaultValue: '0,4 mm', description: DESC_ORCA },
          { label: 'Remplissage', defaultValue: '0,45 mm', description: DESC_ORCA },
          { label: 'Remplissage plein interne', defaultValue: '0,4 mm', description: DESC_ORCA },
          { label: 'Supports', defaultValue: '0,4 mm', description: DESC_ORCA },
          { label: 'Pont', defaultValue: '100%', description: DESC_ORCA }
        ]
      },
      {
        title: 'Couture',
        items: [
          { label: 'Position de la couture', defaultValue: 'Alignée', description: DESC_ORCA },
          { label: 'Coutures intérieures décalées', defaultValue: 'Désactivé', description: DESC_ORCA },
          { label: 'Écart de couture', defaultValue: '10%', description: DESC_ORCA },
          { label: 'Couture en biseau (beta)', defaultValue: 'Aucun', description: DESC_ORCA },
          { label: 'Vitesse d’essuyage en fonction de la vitesse d’extrusion', defaultValue: 'Activé', description: DESC_ORCA },
          { label: 'Vitesse d’essuyage', defaultValue: '80%', description: DESC_ORCA },
          { label: 'Essuyer sur les boucles', defaultValue: 'Désactivé', description: DESC_ORCA },
          { label: 'Essuyer avant la boucle externe', defaultValue: 'Désactivé', description: DESC_ORCA }
        ]
      },
      {
        title: 'Précision',
        items: [
          { label: 'Rayon de fermeture de l’écart des tranches', defaultValue: '0,049 mm', description: DESC_ORCA },
          { label: 'Résolution', defaultValue: '0,012 mm', description: DESC_ORCA }
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
          { label: 'Nombre de parois', defaultValue: '', description: '', engine: 'toolpath2d.wall_count' },
          { label: 'Couches supérieures / inférieures (Top / Bottom shells)', defaultValue: '4', description: 'Nombre de couches pleines formant le dessus et le dessous de la pièce.' }
        ]
      },
      {
        title: 'Remplissage & ancrage',
        items: [
          { label: 'Densité de remplissage', defaultValue: '', description: '', engine: 'toolpath2d.infill_density' },
          { label: 'Motif de remplissage', defaultValue: '', description: '', engine: 'toolpath2d.infill_pattern' },
          { label: 'Parois d’ancrage des ponts', defaultValue: '', description: '', engine: 'toolpath2d.bridge_anchor_extra_walls' }
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
          { label: 'Vitesse d’impression', defaultValue: '', description: '', engine: 'gcode_params.print_speed' },
          { label: 'Accélération', defaultValue: '5000 mm/s²', description: 'Vitesse à laquelle la tête atteint sa consigne.' },
          { label: 'Vitesse des parois externes', defaultValue: '80 mm/s', description: 'Vitesse des contours visibles.' },
          { label: 'Vitesse des parois internes', defaultValue: '120 mm/s', description: 'Vitesse des contours internes.' },
          { label: 'Vitesse du premier niveau', defaultValue: '30 mm/s', description: 'Vitesse dédiée à la première couche pour améliorer l’adhérence.' },
          { label: 'Vitesse du remplissage', defaultValue: '200 mm/s', description: 'Vitesse d’impression de la structure interne.' },
          { label: 'Vitesse de détection des ponts', defaultValue: '50 mm/s', description: 'Vitesse utilisée pour les zones de ponts.' }
        ]
      },
      {
        title: 'Déplacements',
        items: [
          { label: 'Vitesse de déplacement', defaultValue: '', description: '', engine: 'gcode_params.travel_speed' },
          { label: 'Dégagement', defaultValue: '', description: '', engine: 'gcode_params.travel_clearance' },
          { label: 'Limite de rotation cumulée du plateau', defaultValue: '', description: '', engine: 'gcode_params.max_y_turns' }
        ]
      },
      {
        title: 'Rétraction',
        items: [
          { label: 'Vitesse de rétraction', defaultValue: '35 mm/s', description: 'Vitesse de recul du filament pendant les déplacements.' },
          { label: 'Longueur de rétraction', defaultValue: '', description: '', engine: 'gcode_params.retract_length' }
        ]
      }
    ]
  },
  {
    id: 'support',
    title: 'Support (Support & Adhérence)',
    label: 'Supports',
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
    label: 'Autre',
    description: 'Regroupez les options avancées, la ventilation fine, la purge multi-couleurs et les scripts.',
    icon: <Layers size={20} />,
    sections: [
      {
        title: 'Impression & ventilation',
        items: [
          { label: 'Température', defaultValue: '', description: '', engine: 'gcode_params.nozzle_temp' },
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
  /**
   * Vrai quand ce composant est remonté directement dans l'espace Prévisualisation — après un
   * morph de sortie de Modélisation joué par ModelingSidebar lui-même (cf. son prop `morph`) — au
   * lieu d'y entrer par la mitose normale (pilule → panneaux). Les deux panneaux réels doivent
   * alors être affichés tels quels dès le premier rendu, sans aucune animation ici : le morph a
   * déjà eu lieu visuellement, ailleurs.
   */
  initialPreviewActive?: boolean;
  /**
   * Vrai dès le CLIC vers Modélisation (cf. apex-entering-modeling dans Index.tsx), ~900ms avant
   * que ce composant ne soit démonté sous le rideau. Le contenu qui n'a pas sa place dans
   * Modélisation disparaît en fondu-glissement : les icônes de la pilule (en cascade) et le panneau
   * du bas de Prévisualisation — jamais la forme qui va se déformer (pilule ou panneau du haut),
   * reprise telle quelle par ModelingSidebar.
   */
  leavingToModeling?: boolean;
  /**
   * Vrai quand ce composant est remonté à la fin d'un morph de sortie de Modélisation (lu une seule
   * fois, au montage) : la pilule apparaît directement opaque (ModelingSidebar vient d'en prendre la
   * forme) et seules ses icônes apparaissent, en cascade.
   */
  arrivingFromModeling?: boolean;
  /** Contenu du panneau du haut de Prévisualisation (légende des types de ligne). */
  previewUpperContent?: React.ReactNode;
  /** Contenu posé en haut du panneau du bas de Prévisualisation (informations G-code). */
  previewLowerHeader?: React.ReactNode;
  /** Contenu posé au bas du panneau du bas de Prévisualisation (ex. sélecteur de vitesse). */
  previewLowerContent?: React.ReactNode;
  /** Élément à positionnement propre sous les deux panneaux (carte de conversion G-code), monté et
   * estompé avec eux. */
  previewBelowContent?: React.ReactNode;
}

export const CategoriesSidebar: React.FC<CategoriesSidebarProps> = ({
  activeCategory,
  onSelectCategory,
  initialPreviewActive = false,
  leavingToModeling = false,
  arrivingFromModeling = false,
  previewUpperContent,
  previewLowerHeader,
  previewLowerContent,
  previewBelowContent,
}) => {
  usePreviewPanelVars();
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

  useEngineSettings(); // le motif choisi (liste de droite) vient du réglage du moteur
  const [isPatternPopupOpen, setIsPatternPopupOpen] = useState(false);
  const [previewActive, setPreviewActive] = useState(initialPreviewActive);
  // Figé au montage, jamais réévalué : `initialPreviewActive` (la PROP) suit isPreviewActive en
  // direct côté Index.tsx, qui devient vrai dès le tout début de la mitose normale (avant même
  // qu'elle soit terminée) — si le JSX plus bas réagissait à la prop plutôt qu'à cette valeur
  // figée, le panneau du bas basculerait du <div> normal vers le motion.div spécial EN PLEINE
  // mitose (un changement de `key`, donc démontage/remontage avec `initial={{opacity:0,x:-20}}`) :
  // exactement le clignotement observé, à la toute fin du dévoilement du rideau.
  const [wasInitialPreviewActive] = useState(initialPreviewActive);
  // Même principe : figé au montage (Index.tsx remet la prop à `false` juste après).
  const [wasArrivingFromModeling] = useState(arrivingFromModeling);

  // Morphings "verre liquide" (cf. LiquidGlassMorph). Pendant qu'une forme animée est à l'écran,
  // les vrais éléments restent montés mais sans fond (classe .morphing) : seul leur contenu
  // s'estompe, par-dessus le verre animé qui en tient lieu.
  //
  // Menu de catégorie :
  //  - 'dividing' : la pilule enfante le panneau détaillé (ouverture)
  //  - 'merging'  : le panneau remonte se refondre dans la pilule (fermeture)
  const [morphPhase, setMorphPhase] = useState<'dividing' | 'merging' | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  // Espace Prévisualisation : à l'entrée, la pilule s'étire en panneau du haut, PUIS ce panneau
  // enfante celui du bas (deux temps successifs d'une même timeline, cf. previewPathAt) ; les deux
  // panneaux restent affichés tant qu'on reste dans l'espace. À la sortie, la même timeline est
  // rejouée à l'envers (reverse) : les deux panneaux se refondent en pilule.
  //  - 'forward' : pilule → panneau haut → panneau bas (ouverture)
  //  - 'reverse' : panneau bas → panneau haut → pilule (fermeture)
  const [previewMorphPhase, setPreviewMorphPhase] = useState<'forward' | 'reverse' | null>(null);
  const [previewPanelsBorn, setPreviewPanelsBorn] = useState(initialPreviewActive);
  const previewActiveRef = useRef(initialPreviewActive);

  // Onglet Édition : le panneau du bas disparaît (ses éléments s'effacent en cascade) en se fondant dans
  // celui du haut par mitose inversée, puis le panneau du haut s'agrandit à leur surface commune ;
  // Coloration fait l'inverse. `editionLayout` : disposition AFFICHÉE (fusionnée), qui suit l'onglet
  // une fois l'animation terminée.
  //  - 'cascade' : éléments du panneau du bas qui s'effacent
  //  - 'absorb'  : le verre fusionne les deux panneaux puis s'agrandit
  //  - 'release' : le verre se réduit puis enfante le panneau du bas
  const tab = usePreviewTab();
  const [editionLayout, setEditionLayout] = useState(initialPreviewActive && getPreviewTab() === 'edition');
  const [tabMorph, setTabMorph] = useState<'cascade' | 'absorb' | 'release' | null>(null);
  const [lowerKey, setLowerKey] = useState(0);
  const lowerRef = useRef<HTMLDivElement>(null);
  // Repousse la pilule quand l'arborescence des modèles (ModelStatusBox, juste au-dessus) déborde
  // de sa hauteur de base, plutôt que de la laisser recouverte (cf. apex-model-tree-resized).
  const [modelTreeOverflow, setModelTreeOverflow] = useState(0);
  const onSelectCategoryRef = useRef(onSelectCategory);
  onSelectCategoryRef.current = onSelectCategory;

  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);

  // Vrai dès le CLIC vers Prévisualisation (apex-entering-preview, cf. Sidebar.tsx), ~900ms avant
  // que la pilule ne commence à s'étirer à `onCovered` : ses icônes disparaissent en cascade
  // pendant ce temps, comme vers Modélisation (leavingToModeling). Repasse à faux au début de la
  // fusion inverse, où `previewMorphPhase` prend le relais jusqu'à ce que la pilule soit reformée.
  const [enteringPreview, setEnteringPreview] = useState(false);

  useEffect(() => {
    const handleEnteringPreview = () => setEnteringPreview(true);
    window.addEventListener('apex-entering-preview', handleEnteringPreview);
    return () => window.removeEventListener('apex-entering-preview', handleEnteringPreview);
  }, []);

  useEffect(() => {
    const handlePreviewToggled = (e: CustomEvent<{ active: boolean }>) => {
      const active = !!e.detail?.active;
      if (!active) setEnteringPreview(false);
      if (active && !previewActiveRef.current) {
        // La pilule devient le panneau du haut : un menu de catégorie encore ouvert se ferme
        // sans animation plutôt que de se superposer à la mitose.
        setMorphPhase(null);
        onSelectCategoryRef.current(null);
        setPreviewPanelsBorn(false);
        setPreviewMorphPhase('forward');
      } else if (!active && previewActiveRef.current) {
        // Sortie de l'espace : les deux panneaux se refondent en pilule (même timeline, à
        // l'envers) avant de démonter — jamais de disparition instantanée. `previewActive` lui-
        // même ne repasse à false qu'à la fin de cette animation (cf. onDone du morph), pour que
        // les panneaux réels restent montés (silencieux, cf. .morphing) tout du long.
        setTabMorph(null);
        setEditionLayout(false);
        setPreviewMorphPhase('reverse');
        return;
      }
      previewActiveRef.current = active;
      setPreviewActive(active);
    };
    window.addEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    return () => {
      window.removeEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleModelTreeResized = (e: CustomEvent<{ overflow: number }>) => {
      setModelTreeOverflow(e.detail?.overflow ?? 0);
    };
    window.addEventListener('apex-model-tree-resized', handleModelTreeResized as EventListener);
    return () => {
      window.removeEventListener('apex-model-tree-resized', handleModelTreeResized as EventListener);
    };
  }, []);

  const menuPathAt = useCallback((t: number, dx: number, dy: number) => {
    // Hauteur réelle du panneau (plafonnée par son max-height), lue sur l'élément monté invisible.
    const menuH = menuContainerRef.current?.offsetHeight ?? 0;
    return mitosisPath(PILL, { x: 0, y: MENU_OFFSET_Y, w: MENU_W, h: menuH, r: MENU_R }, t, dx, dy);
  }, []);

  const previewPathAt = useCallback((t: number, dx: number, dy: number) => {
    const { upper, lower } = previewGeometry(window.innerHeight);
    dy -= upper.y; // la scène du morph démarre à `upper.y` (panneaux remontés), pas à PILL_TOP
    const ms = t * PREVIEW_MORPH_MS;
    if (ms < PREVIEW_STRETCH_MS) return stretchPath(PILL, upper, ms / PREVIEW_STRETCH_MS, dx, dy);
    if (ms < PREVIEW_STRETCH_MS + PREVIEW_HOLD_MS) return rectPath(upper, dx, dy);
    return mitosisPath(upper, lower, (ms - PREVIEW_STRETCH_MS - PREVIEW_HOLD_MS) / PREVIEW_DIVIDE_MS, dx, dy);
  }, []);

  const tabPathAt = useCallback((t: number, dx: number, dy: number) => tabMorphPathAt(window.innerHeight, t, dx, dy), []);

  // Les morphs de Modélisation partent de la forme réelle du panneau du haut.
  useLayoutEffect(() => {
    previewTabLayout.edition = editionLayout && previewActive;
    return () => { previewTabLayout.edition = false; };
  }, [editionLayout, previewActive]);

  // Changement d'onglet : lance l'animation quand le panneau est au repos et que l'onglet voulu
  // n'est pas la disposition affichée (aussi au retour d'un onglet choisi pendant une autre animation).
  useEffect(() => {
    if (!previewActive || !previewPanelsBorn || previewMorphPhase || leavingToModeling || tabMorph) return;
    const wantEdition = tab === 'edition';
    if (wantEdition === editionLayout) return;
    setTabMorph(wantEdition ? 'cascade' : 'release');
  }, [tab, editionLayout, tabMorph, previewActive, previewPanelsBorn, previewMorphPhase, leavingToModeling]);

  // Cascade : chaque élément du panneau du bas s'efface à son tour (du haut vers le bas), puis le verre fusionne.
  useEffect(() => {
    if (tabMorph !== 'cascade') return;
    let cancelled = false;
    const root = lowerRef.current;
    const targets: Element[] = [];
    root?.querySelectorAll('[data-cascade="header"] > dl > div, [data-cascade="header"] > p').forEach((e) => targets.push(e));
    const footer = root?.querySelector('[data-cascade="footer"]')?.firstElementChild;
    if (footer) targets.push(...Array.from(footer.children));
    const animations = targets.map((el, i) => el.animate(
      [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-8px)' }],
      { duration: TAB_CASCADE_FADE_MS, delay: i * TAB_CASCADE_STAGGER_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
    ));
    let finished = false;
    Promise.all(animations.map((a) => a.finished.catch(() => undefined))).then(() => {
      if (cancelled) return;
      finished = true;
      setTabMorph('absorb');
    });
    return () => {
      cancelled = true;
      // Terminée, la cascade garde ses éléments effacés (fill) jusqu'au démontage du panneau ; seule une
      // interruption les rétablit.
      if (!finished) animations.forEach((a) => a.cancel());
    };
  }, [tabMorph]);

  const handleCategoryClick = (cat: CategoryItem) => {
    if (cat.disabled) {
      showSuccess("Bientôt disponible");
      return;
    }
    // Pendant un morphing, ou en Prévisualisation où la pilule est en train de devenir un panneau.
    if (morphPhase || previewActive) return;
    setIsPatternPopupOpen(false);

    if (activeCategory === cat.id) {
      // Fermeture : le panneau se refond dans la pilule ; il n'est démonté qu'en fin d'animation.
      setMorphPhase('merging');
    } else if (activeCategory === null) {
      setMorphPhase('dividing');
      onSelectCategory(cat.id);
    } else {
      // Un panneau est déjà ouvert : simple substitution de contenu, pas de mitose.
      onSelectCategory(cat.id);
    }
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
  const patternSetting = getEngineSetting('toolpath2d.infill_pattern');

  const previewGeo = previewGeometry(window.innerHeight);

  return (
    <>
      <div
        className={styles.leftSidebarContainer}
        data-apex-chrome-panel
        style={modelTreeOverflow > 0 ? { top: PILL_TOP + modelTreeOverflow } : undefined}
      >
        <AnimatePresence>
          {/* En Prévisualisation, la pilule reste démontée tant que les deux panneaux existent
              (elle EST devenue le panneau du haut) ; elle remonte (sans fond, cf. .morphing) dès
              que la fusion inverse démarre, jusqu'à avoir repris sa forme. */}
          {(!previewActive || !previewPanelsBorn || previewMorphPhase === 'reverse') && (
            <motion.div
              ref={categoriesToolbarRef}
              data-apex-tooltip="Catégories de réglages de découpe (qualité, solidité, vitesse…) : cliquez une icône pour ouvrir ses paramètres."
              className={clsx(styles.categoriesToolbar, {
                [styles.morphing]: morphPhase !== null || previewMorphPhase !== null,
              })}
              onWheel={handleCategoriesWheel}
              // La pilule elle-même (sa forme de verre) ne s'estompe JAMAIS autour d'un morph de
              // Modélisation : c'est elle que ModelingSidebar reprend à l'identique pour la
              // déformer (même commit, cf. Index.tsx). Au retour d'un morph de sortie
              // (wasArrivingFromModeling), elle est donc déjà opaque dès son montage : ModelingSidebar
              // vient de prendre exactement sa forme.
              initial={wasArrivingFromModeling ? false : { opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{
                opacity: { duration: 0.9, ease: 'linear' },
                x: { duration: 0.9, ease: 'easeInOut' },
              }}
            >
              {/* Seules les icônes suivent l'espace : cascade de disparition dès le clic vers
                  Modélisation (leavingToModeling) ou vers Prévisualisation (enteringPreview),
                  ~900ms avant que la pilule ne soit reprise par ModelingSidebar ou ne commence à
                  s'étirer en panneaux (tous deux sous le rideau, à `onCovered`) ; cascade
                  d'apparition au retour d'un morph de sortie (wasArrivingFromModeling), une fois la
                  déformation terminée. Hors de ces cas, `animate="visible"` sans délai, comme un
                  menu statique normal. */}
              <motion.div
                variants={pillIconsContainerVariants}
                // Pendant la déformation inverse (Prévisualisation → Préparation), les icônes
                // restent masquées et n'apparaissent en cascade qu'une fois la pilule reformée.
                initial={wasArrivingFromModeling || previewMorphPhase === 'reverse' ? 'hidden' : false}
                animate={leavingToModeling || enteringPreview || previewMorphPhase === 'reverse' ? 'hidden' : 'visible'}
                style={{ display: 'contents' }}
              >
                {CATEGORIES.map((cat) => {
                  const isActive = activeCategory === cat.id;
                  return (
                    <CustomTooltip
                      key={cat.id}
                      content={cat.label}
                      description={cat.description}
                    >
                      <motion.button
                        ref={(el) => { iconRefs.current[cat.id] = el; }}
                        variants={pillIconVariants}
                        className={clsx(styles.categoryButton, {
                          [styles.active]: isActive,
                        })}
                        onClick={() => handleCategoryClick(cat)}
                      >
                        {cat.icon}
                        <span className={styles.categoryLabel}>{cat.label}</span>
                      </motion.button>
                    </CustomTooltip>
                  );
                })}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Prévisualisation : la pilule s'étire en panneau du haut puis celui-ci enfante le panneau
          du bas ('forward'), ou l'inverse à la sortie ('reverse', même timeline jouée à l'envers).
          Le verre animé part/finit exactement sur la géométrie de la pilule et des deux panneaux
          ci-dessous, qui le remplacent une fois l'animation terminée. */}
      {previewMorphPhase && (
        <LiquidGlassMorph
          key={previewMorphPhase}
          left={PANEL_LEFT}
          top={PILL_TOP + previewGeo.upper.y}
          width={PREVIEW_W}
          height={previewGeo.stageH - previewGeo.upper.y}
          duration={PREVIEW_MORPH_MS}
          pathAt={previewPathAt}
          reverse={previewMorphPhase === 'reverse'}
          // Le flou passe de celui de la pilule à celui, plus fort, des panneaux de Prévisualisation.
          blur={[GLASS_BLUR_PX, PREVIEW_GLASS_BLUR_PX]}
          onDone={() => {
            if (previewMorphPhase === 'reverse') {
              previewActiveRef.current = false;
              setPreviewActive(false);
              setPreviewPanelsBorn(false);
              // La pilule a repris sa forme : les éléments voisins (ModelStatusBox) peuvent revenir.
              window.dispatchEvent(new CustomEvent('apex-preview-morph-done'));
            } else {
              setPreviewPanelsBorn(true);
            }
            setPreviewMorphPhase(null);
          }}
        />
      )}

      {/* Changement d'onglet (Coloration ↔ Édition) : le verre fusionne le panneau du bas dans celui du haut
          puis l'agrandit ('absorb'), ou l'inverse ('release', même timeline à l'envers). */}
      {(tabMorph === 'absorb' || tabMorph === 'release') && (
        <LiquidGlassMorph
          key={`tab-${tabMorph}`}
          left={PANEL_LEFT}
          top={PILL_TOP + previewGeo.upper.y}
          width={PREVIEW_W}
          height={previewGeo.stageH - previewGeo.upper.y}
          duration={TAB_MORPH_MS}
          pathAt={tabPathAt}
          reverse={tabMorph === 'release'}
          blur={[PREVIEW_GLASS_BLUR_PX, PREVIEW_GLASS_BLUR_PX]}
          onDone={() => {
            if (tabMorph === 'absorb') {
              setEditionLayout(true);
            } else {
              setEditionLayout(false);
              setLowerKey((k) => k + 1);
            }
            setTabMorph(null);
          }}
        />
      )}

      {/* Panneaux de Prévisualisation, nés de la mitose : contenu à brancher plus tard. Pas
          d'animation d'entrée/sortie propre en temps normal — leur verre est identique à la
          dernière image du morphing ; ils s'effacent (.morphing) dès que la fusion inverse démarre,
          plutôt que de se démonter d'un coup. Exceptions, symétriques, jamais de refusion avec le
          panneau du haut (qui, lui, se transforme ailleurs — cf. ModelingSidebar) : le panneau du
          bas joue son propre fondu-glissement piloté directement par `animate` (JAMAIS par `exit` —
          `leavingToModeling` devient vrai dès le CLIC, ~900ms avant que ce composant ne démonte
          réellement à `onCovered` sous le rideau ; un `exit` ne jouerait qu'à ce moment bien trop
          tardif, invisible). Toujours le MÊME élément (jamais de changement de `key`/type), pour
          qu'`animate` puisse réagir à `leavingToModeling` sans jamais démonter/remonter. */}
      {previewActive && previewPanelsBorn && (
        <React.Fragment key="preview-panels">
          <div
            data-scroll-edge
            data-apex-tooltip="Panneau de l'espace Prévisualisation : onglets Coloration, Édition et Fonction pour analyser et modifier le G-code affiché."
            className={clsx(styles.previewPanelUpper, {
              [styles.morphing]: previewMorphPhase === 'reverse' || tabMorph === 'absorb' || tabMorph === 'release',
              [styles.previewPanelUpperExpanded]: editionLayout,
            })}
          >
            {/* Le contenu s'efface dès le clic vers Modélisation : seule la forme du panneau est
                reprise par ModelingSidebar. */}
            {previewUpperContent && (
              <motion.div
                className={clsx(styles.previewPanelBody, {
                  // Le contenu de l'onglet n'apparaît qu'une fois le panneau à sa forme finale.
                  [styles.previewPanelBodyWaiting]: tabMorph !== null || (tab === 'edition') !== editionLayout,
                })}
                animate={{ opacity: leavingToModeling ? 0 : 1 }}
                transition={{ duration: FROM_PREVIEW_FADE_MS / 1000, ease: 'easeInOut' }}
              >
                {previewUpperContent}
              </motion.div>
            )}
          </div>
          {/* Fusionné dans le panneau du haut en mode Édition : démonté, puis remonté (ses éléments
              réapparaissent en cascade) au retour à Coloration. */}
          {(!editionLayout || tabMorph === 'cascade' || tabMorph === 'absorb') && (
            <motion.div
              key={`lower-${lowerKey}`}
              ref={lowerRef}
              data-apex-tooltip="Panneau d'informations du G-code affiché : légende et réglages d'affichage du tracé."
              className={clsx(styles.previewPanelLower, {
                [styles.morphing]: previewMorphPhase === 'reverse' || tabMorph === 'absorb',
              })}
              initial={wasInitialPreviewActive && lowerKey === 0 ? { opacity: 0, x: -20 } : false}
              animate={{
                opacity: leavingToModeling ? 0 : 1,
                x: leavingToModeling ? -20 : 0,
                transition: { duration: FROM_PREVIEW_FADE_MS / 1000, ease: 'easeInOut' },
              }}
            >
              {previewLowerHeader && <div className={styles.previewPanelHeader} data-cascade="header">{previewLowerHeader}</div>}
              {previewLowerContent && <div className={styles.previewPanelFooter} data-cascade="footer">{previewLowerContent}</div>}
            </motion.div>
          )}
          {/* Opacité seule (jamais de transform) : le contenu est en `position: fixed`. */}
          {previewBelowContent && (
            <motion.div
              className={clsx(styles.previewBelow, { [styles.morphing]: previewMorphPhase === 'reverse' })}
              animate={{ opacity: leavingToModeling ? 0 : 1 }}
              transition={{ duration: FROM_PREVIEW_FADE_MS / 1000, ease: 'easeInOut' }}
            >
              {previewBelowContent}
            </motion.div>
          )}
        </React.Fragment>
      )}

      {/* Menu de catégorie : la pilule enfante le panneau (ouverture) ou le réabsorbe (fermeture,
          même timeline jouée à l'envers). */}
      {morphPhase && (
        <LiquidGlassMorph
          key={morphPhase}
          left={PANEL_LEFT}
          top={PILL_TOP + modelTreeOverflow}
          width={MENU_W}
          height={MENU_STAGE_H}
          duration={MENU_MORPH_MS}
          pathAt={menuPathAt}
          reverse={morphPhase === 'merging'}
          onDone={() => {
            if (morphPhase === 'merging') onSelectCategory(null);
            setMorphPhase(null);
          }}
        />
      )}

      <AnimatePresence>
        {activeCatData && !activeCatData.disabled && !previewActive && (
          <>
            {/* Toujours ouvert/fermé par un morphing : pas d'animation d'entrée ni de sortie
                propre, le verre animé en tient lieu (.morphing masque le fond de ce panneau et
                estompe son contenu pendant ce temps). */}
            <motion.div
              ref={menuContainerRef}
              className={clsx(styles.fusionMenuContainer, {
                [styles.morphing]: morphPhase !== null,
              })}
              // Le menu suit la pilule quand l'arborescence des modèles / la carte Filament la repoussent.
              style={modelTreeOverflow > 0 ? { top: 280 + modelTreeOverflow } : undefined}
              initial={false}
              exit={{ opacity: 0 }}
              transition={{ duration: 0 }}
            >
              <div
                ref={contentRef}
                className={styles.fusionMenuContent}
                onScroll={handleScroll}
              >
                {/* Portée des réglages, comme « Global / Objets » d'OrcaSlicer. Les réglages par objet n'existent
                    pas encore côté moteur : « Par objet » est visible mais inactif. */}
                <div className={styles.scopeSwitch}>
                  <CustomTooltip content="Global" description="Les réglages s'appliquent à tout le plateau.">
                    <button type="button" className={clsx(styles.scopeButton, styles.scopeActive)}>Global</button>
                  </CustomTooltip>
                  <CustomTooltip content="Arrive bientôt" description="Réglages propres à chaque objet du plateau, qui remplacent les réglages globaux pour cet objet.">
                    <button type="button" className={clsx(styles.scopeButton, styles.scopeInert)} aria-disabled="true" tabIndex={-1}>Par objet</button>
                  </CustomTooltip>
                </div>
                {activeCatData.sections.map((section, idx) => (
                  <div key={idx} className={styles.sectionGroup}>
                    <h4 className={styles.sectionTitle}>{section.title}</h4>
                    <ul className={styles.itemsList}>
                      {section.items.map((item, iIdx) => item.engine ? (
                        <EngineItemRow
                          key={item.engine}
                          path={item.engine}
                          onOpenChoices={getEngineSetting(item.engine)?.enum ? () => setIsPatternPopupOpen((open) => !open) : undefined}
                        />
                      ) : (
                        <CustomTooltip key={iIdx} content="Arrive bientôt" description={item.description}>
                          <li className={clsx(styles.itemRow, styles.itemRowInert)}>
                            <span className={styles.itemName}>{item.label}</span>
                            <input
                              type="text"
                              defaultValue={item.defaultValue}
                              className={styles.itemInput}
                              readOnly
                              tabIndex={-1}
                            />
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
                  // Le verre (.patternGlass) fait son propre fondu : un parent translucide désactiverait son flou.
                  initial={{ scale: 0.95, x: -10 }}
                  animate={{ scale: 1, x: 0 }}
                  exit={{ scale: 0.95, x: -10 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  <motion.div
                    className={styles.patternGlass}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  />
                  <motion.div
                    ref={patternContentRef}
                    className={styles.patternPopupContent}
                    onScroll={handlePatternScroll}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className={styles.sectionGroup}>
                      <h4 className={styles.sectionTitle}>Motifs de remplissage</h4>
                      <ul className={styles.itemsList}>
                        {patternSetting?.enum?.map((option) => {
                          const isSelected = getEngineSettingValue(patternSetting) === option;
                          return (
                            <CustomTooltip key={option} content={ENUM_LABELS[option] ?? option} description={ENUM_DESCRIPTIONS[option] ?? ''}>
                              <li
                                className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                                onClick={() => {
                                  setEngineSettingValue(patternSetting, option);
                                  setIsPatternPopupOpen(false);
                                }}
                              >
                                <span className={styles.patternName}>
                                  <InfillPatternIcon pattern={ENGINE_PATTERN_ICON[option] ?? option} />
                                  <span className={styles.itemName}>{ENUM_LABELS[option] ?? option}</span>
                                </span>
                                {isSelected && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                              </li>
                            </CustomTooltip>
                          );
                        })}
                        {/* Motifs d'OrcaSlicer que le moteur ne réalise pas encore : proposés, grisés. */}
                        {ORCA_ONLY_PATTERNS.map((pattern) => (
                          <CustomTooltip key={pattern.key} content="Arrive bientôt" description={`${pattern.label} : motif d’OrcaSlicer pas encore pris en charge par le moteur d’Apex.`}>
                            <li className={clsx(styles.patternItem, styles.patternItemDisabled)} aria-disabled>
                              <span className={styles.patternName}>
                                <InfillPatternIcon pattern={pattern.key} />
                                <span className={styles.itemName}>{pattern.label}</span>
                              </span>
                            </li>
                          </CustomTooltip>
                        ))}
                      </ul>
                    </div>
                  </motion.div>

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