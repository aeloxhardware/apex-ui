import React, { useRef, useState, useEffect } from 'react';
import { useEngineSettings } from '@/utils/engineSettings';
import { usePreviewPanelVars } from '@/hooks/use-preview-panel-vars';
import { useExternalScrollThumb } from '@/hooks/use-external-scroll-thumb';
import { CATEGORIES, type CategoryItem } from './categoriesData';
import { usePreviewSpace, useModelTreeOverflow, type MorphPhase } from './categoriesPreviewState';
import { CategoryPill, PreviewPanels, CategoryMenu } from './CategoriesPanels';
import { CategoryGlassMorphs } from './CategoryGlassMorphs';

interface CategoriesSidebarProps {
  activeCategory: string | null;
  /** Menu à rouvrir quand la Prévisualisation est quittée (le menu avait été fermé à son entrée). */
  resumeCategory?: string | null;
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
  resumeCategory = null,
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
  const thumb = useExternalScrollThumb(contentRef);
  const patternThumb = useExternalScrollThumb(patternContentRef);

  useEngineSettings(); // le motif choisi (liste de droite) vient du réglage du moteur
  const [isPatternPopupOpen, setIsPatternPopupOpen] = useState(false);
  // Figés au montage, jamais réévalués : `initialPreviewActive` (la PROP) suit isPreviewActive en direct côté
  // Index.tsx ; si le JSX réagissait à la prop plutôt qu'à cette valeur figée, le panneau du bas basculerait
  // EN PLEINE mitose (changement de `key`, démontage/remontage) : le clignotement observé.
  const [wasInitialPreviewActive] = useState(initialPreviewActive);
  const [wasArrivingFromModeling] = useState(arrivingFromModeling);

  // Morphing « verre liquide » du menu de catégorie (cf. LiquidGlassMorph) : les vrais éléments restent montés
  // mais sans fond (classe .morphing). 'dividing' : la pilule enfante le panneau ; 'merging' : il se refond.
  const [morphPhase, setMorphPhase] = useState<MorphPhase>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const space = usePreviewSpace({ initialPreviewActive, leavingToModeling, onSelectCategory, setMorphPhase });
  const { previewActive } = space;
  const modelTreeOverflow = useModelTreeOverflow();

  // Retour de la Prévisualisation (ou d'un aller-retour par Modélisation) : le menu qui était ouvert se rouvre.
  useEffect(() => {
    if (resumeCategory && activeCategory === null && !previewActive && !leavingToModeling) onSelectCategory(resumeCategory);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [resumeCategory, previewActive]);


  const handleCategoryClick = (cat: CategoryItem) => {
    if (cat.disabled) return;
    // Pendant un morphing, ou en Prévisualisation où la pilule est en train de devenir un panneau.
    if (morphPhase || previewActive) return;
    setIsPatternPopupOpen(false);

    // Un menu de la pilule reste toujours ouvert : recliquer sur le menu actif ne le ferme pas (on ne passe
    // d'un menu à l'autre qu'en choisissant un autre bouton).
    if (activeCategory === cat.id) return;
    if (activeCategory === null) {
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

  useEffect(() => {
    if (activeCategory) {
      setTimeout(thumb.handleScroll, 50);
    } else {
      setIsPatternPopupOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [activeCategory]);

  useEffect(() => {
    if (isPatternPopupOpen) {
      setTimeout(patternThumb.handleScroll, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [isPatternPopupOpen]);


  return (
    <>
      <CategoryPill
        modelTreeOverflow={modelTreeOverflow} space={space} morphPhase={morphPhase}
        wasArrivingFromModeling={wasArrivingFromModeling} leavingToModeling={leavingToModeling}
        activeCategory={activeCategory} onCategoryClick={handleCategoryClick} iconRefs={iconRefs}
        toolbarRef={categoriesToolbarRef} onWheel={handleCategoriesWheel}
      />
      <CategoryGlassMorphs
        space={space} morphPhase={morphPhase} setMorphPhase={setMorphPhase} menuContainerRef={menuContainerRef}
        modelTreeOverflow={modelTreeOverflow} onSelectCategory={onSelectCategory}
      />

      <PreviewPanels
        space={space} leavingToModeling={leavingToModeling} wasInitialPreviewActive={wasInitialPreviewActive}
        previewUpperContent={previewUpperContent} previewLowerHeader={previewLowerHeader}
        previewLowerContent={previewLowerContent} previewBelowContent={previewBelowContent}
      />


      <CategoryMenu
        animateIn={!wasArrivingFromModeling} activeCatData={CATEGORIES.find((c) => c.id === activeCategory)} previewActive={previewActive}
        menuContainerRef={menuContainerRef} morphPhase={morphPhase} modelTreeOverflow={modelTreeOverflow}
        contentRef={contentRef} thumb={thumb} patternContentRef={patternContentRef} patternThumb={patternThumb}
        isPatternPopupOpen={isPatternPopupOpen} setIsPatternPopupOpen={setIsPatternPopupOpen}
      />
    </>
  );
};
