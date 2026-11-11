import React, { useCallback } from 'react';
import { LiquidGlassMorph, GLASS_BLUR_PX, PREVIEW_GLASS_BLUR_PX } from './LiquidGlassMorph';
import { mitosisPath, rectPath, stretchPath } from '@/utils/liquidGlass';
import {
  PANEL_LEFT, PILL_TOP, PILL, PREVIEW_W, previewGeometry, tabMorphPathAt, TAB_MORPH_MS,
} from '@/utils/spaceMorphGeometry';
import {
  MENU_OFFSET_Y, MENU_W, MENU_R, MENU_MORPH_MS, PREVIEW_STRETCH_MS, PREVIEW_HOLD_MS, PREVIEW_DIVIDE_MS, PREVIEW_MORPH_MS,
} from './categoriesMotion';
import type { MorphPhase, PreviewSpace } from './categoriesPreviewState';

import { emitApex } from '@/events/apexEvents';
interface CategoryGlassMorphsProps {
  space: PreviewSpace;
  morphPhase: MorphPhase;
  setMorphPhase: (phase: MorphPhase) => void;
  menuContainerRef: React.RefObject<HTMLDivElement | null>;
  modelTreeOverflow: number;
  onSelectCategory: (catId: string | null) => void;
}

/** Verres animés : pilule → panneaux de Prévisualisation, changement d'onglet, ouverture / fermeture du menu. */
export const CategoryGlassMorphs: React.FC<CategoryGlassMorphsProps> = ({
  space, morphPhase, setMorphPhase, menuContainerRef, modelTreeOverflow, onSelectCategory,
}) => {
  const {
    previewMorphPhase, setPreviewMorphPhase, setPreviewActive, setPreviewPanelsBorn, previewActiveRef, tabMorph, setTabMorph,
    setEditionLayout, setLowerKey,
  } = space;
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
  const previewGeo = previewGeometry(window.innerHeight);

  return (
    <>

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
              emitApex('apex-preview-morph-done');
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

      {/* Menu de catégorie : la pilule enfante le panneau (ouverture) ou le réabsorbe (fermeture,
          même timeline jouée à l'envers). */}
      {morphPhase && (
        <LiquidGlassMorph
          key={morphPhase}
          left={PANEL_LEFT}
          top={PILL_TOP + modelTreeOverflow}
          width={MENU_W}
          // Panneau (de hauteur variable, cf. .fusionMenuContainer) + la marge que prend le col en s'étirant avant de se rompre.
          height={MENU_OFFSET_Y + (menuContainerRef.current?.offsetHeight ?? 400) + 40}
          duration={MENU_MORPH_MS}
          pathAt={menuPathAt}
          reverse={morphPhase === 'merging'}
          onDone={() => {
            if (morphPhase === 'merging') onSelectCategory(null);
            setMorphPhase(null);
          }}
        />
      )}
    </>
  );
};
