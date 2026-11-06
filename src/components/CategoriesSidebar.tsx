import { useCustomScrollbar } from './categories-sidebar/useCustomScrollbar';
import React, { useRef, useState, useEffect } from 'react';

import { AnimatePresence } from 'framer-motion';





import { getEngineSetting, useEngineSettings } from '@/utils/engineSettings';
import { LiquidGlassMorph, GLASS_BLUR_PX, PREVIEW_GLASS_BLUR_PX } from './LiquidGlassMorph';

import { showSuccess } from '@/utils/toast';

import { PANEL_LEFT, PILL_TOP, PREVIEW_W, previewGeometry, TAB_MORPH_MS } from '@/utils/spaceMorphGeometry';

import { usePreviewPanelVars } from '@/hooks/use-preview-panel-vars';
import { usePreviewMorph } from './categories-sidebar/usePreviewMorph';
import { CategoriesPill } from './categories-sidebar/CategoriesPill';
import { PreviewPanels } from './categories-sidebar/PreviewPanels';
import { CategoryMenuPanel } from './categories-sidebar/CategoryMenuPanel';
import { PatternPopup } from './categories-sidebar/PatternPopup';
import { MENU_W, MENU_STAGE_H, MENU_MORPH_MS, PREVIEW_MORPH_MS, CATEGORIES } from './categories-sidebar/constants';
import type { CategoryItem, CategoriesSidebarProps } from './categories-sidebar/constants';
export type { CategoryItem } from './categories-sidebar/constants';

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

  const { contentRef, thumbHeight, thumbTop, hasScroll, isDragging, handleScroll, handleMouseDown } = useCustomScrollbar();
  const {
    contentRef: patternContentRef, thumbHeight: patternThumbHeight, thumbTop: patternThumbTop, hasScroll: hasPatternScroll,
    isDragging: isPatternDragging, handleScroll: handlePatternScroll, handleMouseDown: handlePatternMouseDown,
  } = useCustomScrollbar();


  useEngineSettings(); // le motif choisi (liste de droite) vient du réglage du moteur
  const [isPatternPopupOpen, setIsPatternPopupOpen] = useState(false);
  const { morphPhase, previewActive, setMorphPhase, modelTreeOverflow, previewPanelsBorn, previewMorphPhase, wasArrivingFromModeling, enteringPreview, previewPathAt, previewActiveRef, setPreviewActive, setPreviewPanelsBorn, setPreviewMorphPhase, tabMorph, tabPathAt, setEditionLayout, setLowerKey, setTabMorph, editionLayout, tab, lowerKey, lowerRef, wasInitialPreviewActive, menuPathAt, menuContainerRef } = usePreviewMorph({ initialPreviewActive, arrivingFromModeling, onSelectCategory, leavingToModeling });

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
      <CategoriesPill modelTreeOverflow={modelTreeOverflow} previewActive={previewActive} previewPanelsBorn={previewPanelsBorn} previewMorphPhase={previewMorphPhase} categoriesToolbarRef={categoriesToolbarRef} morphPhase={morphPhase} handleCategoriesWheel={handleCategoriesWheel} wasArrivingFromModeling={wasArrivingFromModeling} leavingToModeling={leavingToModeling} enteringPreview={enteringPreview} activeCategory={activeCategory} iconRefs={iconRefs} handleCategoryClick={handleCategoryClick} />

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
        <PreviewPanels key="preview-panels" previewMorphPhase={previewMorphPhase} tabMorph={tabMorph} editionLayout={editionLayout} previewUpperContent={previewUpperContent} tab={tab} leavingToModeling={leavingToModeling} lowerKey={lowerKey} lowerRef={lowerRef} wasInitialPreviewActive={wasInitialPreviewActive} previewLowerHeader={previewLowerHeader} previewLowerContent={previewLowerContent} previewBelowContent={previewBelowContent} />
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
            <CategoryMenuPanel menuContainerRef={menuContainerRef} morphPhase={morphPhase} modelTreeOverflow={modelTreeOverflow} contentRef={contentRef} handleScroll={handleScroll} activeCatData={activeCatData} setIsPatternPopupOpen={setIsPatternPopupOpen} hasScroll={hasScroll} isDragging={isDragging} handleMouseDown={handleMouseDown} thumbHeight={thumbHeight} thumbTop={thumbTop} />

            {/* Pattern popup window next to the menu */}
            <PatternPopup isPatternPopupOpen={isPatternPopupOpen} patternContentRef={patternContentRef} handlePatternScroll={handlePatternScroll} patternSetting={patternSetting} setIsPatternPopupOpen={setIsPatternPopupOpen} hasPatternScroll={hasPatternScroll} isPatternDragging={isPatternDragging} handlePatternMouseDown={handlePatternMouseDown} patternThumbHeight={patternThumbHeight} patternThumbTop={patternThumbTop} />
          </>
        )}
      </AnimatePresence>
    </>
  );
};