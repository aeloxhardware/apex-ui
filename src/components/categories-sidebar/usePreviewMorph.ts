import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { usePreviewTab, getPreviewTab } from '../PreviewUpperTabs';
import { mitosisPath, stretchPath, rectPath } from '@/utils/liquidGlass';
import { PILL, previewGeometry, tabMorphPathAt, previewTabLayout, TAB_CASCADE_FADE_MS, TAB_CASCADE_STAGGER_MS } from '@/utils/spaceMorphGeometry';
import { MENU_OFFSET_Y, MENU_W, MENU_R, PREVIEW_MORPH_MS, PREVIEW_STRETCH_MS, PREVIEW_HOLD_MS, PREVIEW_DIVIDE_MS } from './constants';

/** Morphings « verre liquide » du panneau : menu de catégorie, entrée en Prévisualisation, changement d'onglet (mitose, cascade, fusion). */
export function usePreviewMorph({ initialPreviewActive, arrivingFromModeling, onSelectCategory, leavingToModeling }: {
  initialPreviewActive: boolean;
  arrivingFromModeling: boolean;
  onSelectCategory: (catId: string | null) => void;
  leavingToModeling: boolean;
}) {

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
  return { morphPhase, previewActive, setMorphPhase, modelTreeOverflow, previewPanelsBorn, previewMorphPhase, wasArrivingFromModeling, enteringPreview, previewPathAt, previewActiveRef, setPreviewActive, setPreviewPanelsBorn, setPreviewMorphPhase, tabMorph, tabPathAt, setEditionLayout, setLowerKey, setTabMorph, editionLayout, tab, lowerKey, lowerRef, wasInitialPreviewActive, menuPathAt, menuContainerRef };
}
