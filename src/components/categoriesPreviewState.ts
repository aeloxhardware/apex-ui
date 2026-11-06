import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  previewTabLayout, TAB_CASCADE_FADE_MS, TAB_CASCADE_STAGGER_MS,
} from '@/utils/spaceMorphGeometry';
import { getPreviewTab, usePreviewTab } from './PreviewUpperTabs';

export type MorphPhase = 'dividing' | 'merging' | null;
type PreviewMorphPhase = 'forward' | 'reverse' | null;
type TabMorph = 'cascade' | 'absorb' | 'release' | null;

interface PreviewSpaceOptions {
  initialPreviewActive: boolean;
  leavingToModeling: boolean;
  onSelectCategory: (catId: string | null) => void;
  setMorphPhase: (phase: MorphPhase) => void;
}

/** Cascade : chaque élément du panneau du bas s'efface à son tour (du haut vers le bas), puis le verre fusionne. */
function useCascadeEffect(tabMorph: TabMorph, lowerRef: React.RefObject<HTMLDivElement | null>, setTabMorph: (m: TabMorph) => void) {
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
    Promise.all(animations.map((a) => a.finished.catch((): void => undefined))).then(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [tabMorph]);
}

/**
 * Onglet Édition : le panneau du bas disparaît (ses éléments s'effacent en cascade) en se fondant dans
 * celui du haut par mitose inversée, puis le panneau du haut s'agrandit à leur surface commune ;
 * Coloration fait l'inverse. `editionLayout` : disposition AFFICHÉE (fusionnée), qui suit l'onglet une fois
 * l'animation terminée. 'cascade' : éléments du bas qui s'effacent ; 'absorb' : le verre fusionne puis
 * s'agrandit ; 'release' : le verre se réduit puis enfante le panneau du bas.
 */
function useTabMorph(initialPreviewActive: boolean, gate: { previewActive: boolean; previewPanelsBorn: boolean; busy: boolean }) {
  const tab = usePreviewTab();
  const [editionLayout, setEditionLayout] = useState(initialPreviewActive && getPreviewTab() === 'edition');
  const [tabMorph, setTabMorph] = useState<TabMorph>(null);
  const [lowerKey, setLowerKey] = useState(0);
  const lowerRef = useRef<HTMLDivElement>(null);

  // Les morphs de Modélisation partent de la forme réelle du panneau du haut.
  useLayoutEffect(() => {
    previewTabLayout.edition = editionLayout && gate.previewActive;
    return () => { previewTabLayout.edition = false; };
  }, [editionLayout, gate.previewActive]);

  // Changement d'onglet : lance l'animation quand le panneau est au repos et que l'onglet voulu
  // n'est pas la disposition affichée (aussi au retour d'un onglet choisi pendant une autre animation).
  useEffect(() => {
    if (!gate.previewActive || !gate.previewPanelsBorn || gate.busy || tabMorph) return;
    const wantEdition = tab === 'edition';
    if (wantEdition === editionLayout) return;
    setTabMorph(wantEdition ? 'cascade' : 'release');
  }, [tab, editionLayout, tabMorph, gate.previewActive, gate.previewPanelsBorn, gate.busy]);

  useCascadeEffect(tabMorph, lowerRef, setTabMorph);
  return { tab, editionLayout, setEditionLayout, tabMorph, setTabMorph, lowerKey, setLowerKey, lowerRef };
}

/**
 * Espace Prévisualisation : à l'entrée, la pilule s'étire en panneau du haut, PUIS ce panneau enfante celui du
 * bas (deux temps d'une même timeline) ; à la sortie, la même timeline est rejouée à l'envers. 'forward' :
 * pilule → panneaux ; 'reverse' : panneaux → pilule. `enteringPreview` est vrai dès le CLIC vers
 * Prévisualisation (apex-entering-preview), ~900 ms avant que la pilule ne s'étire : ses icônes disparaissent
 * en cascade pendant ce temps.
 */
export function usePreviewSpace(o: PreviewSpaceOptions) {
  const { initialPreviewActive, leavingToModeling, onSelectCategory, setMorphPhase } = o;
  const [previewActive, setPreviewActive] = useState(initialPreviewActive);
  const [previewMorphPhase, setPreviewMorphPhase] = useState<PreviewMorphPhase>(null);
  const [previewPanelsBorn, setPreviewPanelsBorn] = useState(initialPreviewActive);
  const previewActiveRef = useRef(initialPreviewActive);
  const [enteringPreview, setEnteringPreview] = useState(false);
  const onSelectCategoryRef = useRef(onSelectCategory);
  onSelectCategoryRef.current = onSelectCategory;
  const tabs = useTabMorph(initialPreviewActive, { previewActive, previewPanelsBorn, busy: !!previewMorphPhase || leavingToModeling });
  const { setTabMorph, setEditionLayout } = tabs;

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
        // Sortie de l'espace : les deux panneaux se refondent en pilule (même timeline, à l'envers)
        // avant de démonter. `previewActive` ne repasse à false qu'à la fin de cette animation (cf.
        // onDone du morph), pour que les panneaux réels restent montés tout du long.
        setTabMorph(null);
        setEditionLayout(false);
        setPreviewMorphPhase('reverse');
        return;
      }
      previewActiveRef.current = active;
      setPreviewActive(active);
    };
    window.addEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    return () => window.removeEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, []);

  return {
    previewActive, setPreviewActive, previewMorphPhase, setPreviewMorphPhase, previewPanelsBorn, setPreviewPanelsBorn,
    previewActiveRef, enteringPreview, ...tabs,
  };
}

export type PreviewSpace = ReturnType<typeof usePreviewSpace>;

/** Repousse la pilule quand l'arborescence des modèles (ModelStatusBox, juste au-dessus) déborde de sa hauteur de base. */
export function useModelTreeOverflow() {
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    const onResized = (e: CustomEvent<{ overflow: number }>) => setOverflow(e.detail?.overflow ?? 0);
    window.addEventListener('apex-model-tree-resized', onResized as EventListener);
    return () => window.removeEventListener('apex-model-tree-resized', onResized as EventListener);
  }, []);
  return overflow;
}
