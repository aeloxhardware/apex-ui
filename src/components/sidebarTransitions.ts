import type React from 'react';
import { playUiSound } from '@/utils/uiSound';
import { CONTAINER_RESHAPE_DURATION, SPACE_LABELS, SPACE_SOUNDS } from './sidebarData';
import type { SidebarTool, TabName } from './sidebarHooks';

import { emitApex } from '@/events/apexEvents';
type Geometry = { x: number; y: number; width: number; height: number; borderRadius: number };

/** Ce dont les transitions d'espace ont besoin : forme du conteneur d'outils et mutations d'état de la barre. */
export interface TransitionCtx {
  bottomToolbarRef: React.RefObject<HTMLDivElement | null>;
  targetGeometry: Geometry;
  setFromGeometry: (geometry: Geometry) => void;
  setSketchReshape: (reshape: null) => void;
  isModeling: boolean;
  onTabChange: (tab: TabName, toPreview?: boolean) => void;
  setActiveTool: (tool: SidebarTool) => void;
  setIsPreviewActive: (active: boolean) => void;
}

export type PlaySpaceTransition = (space: keyof typeof SPACE_LABELS, onCovered: () => void) => void;

  /**
   * Joue le rideau "APEX / <espace>" (voir SpaceTransitionOverlay) puis exécute `onCovered`
   * une fois l'écran masqué — c'est là, et pas avant, que le vrai changement d'onglet doit
   * avoir lieu pour ne jamais être visible pendant la transition. Mesure aussi la forme
   * actuelle du conteneur d'outils juste avant : quel que soit le mode de départ (slicer,
   * prévisualisation ou modélisation), c'est de là que doit partir l'animation de
   * déformation vers le mode suivant — jamais une valeur figée valable pour un seul sens.
   */
export function makePlaySpaceTransition(c: TransitionCtx): PlaySpaceTransition {
  const { bottomToolbarRef, targetGeometry, setFromGeometry, setSketchReshape } = c;
  return (space: keyof typeof SPACE_LABELS, onCovered: () => void) => {
    const label = SPACE_LABELS[space];
    const sound = SPACE_SOUNDS[space];
    if (sound) playUiSound(sound);
    if (bottomToolbarRef.current) {
      const rect = bottomToolbarRef.current.getBoundingClientRect();
      const computedRadius = parseFloat(getComputedStyle(bottomToolbarRef.current).borderTopLeftRadius) || 22;
      // `x`/`y` ne sont pas lisibles depuis le DOM (ce sont des translate posés par
      // framer-motion, pas une position absolue) : on reprend ceux du mode qu'on est en
      // train de quitter, calculés par la même table que `targetGeometry` ci-dessous.
      setFromGeometry({
        x: targetGeometry.x,
        y: targetGeometry.y,
        width: rect.width,
        height: rect.height,
        borderRadius: computedRadius,
      });
      setSketchReshape(null); // transition d'espace : séquencement normal de la barre
    }
    emitApex('apex-space-transition', {
        label,
        onCovered,
      });
  };
}

export function makeTopTabClick(c: TransitionCtx, playSpaceTransition: PlaySpaceTransition) {
  const { isModeling, onTabChange, setActiveTool, setIsPreviewActive } = c;
  return (tabName: TabName) => {
    if (tabName === 'settings' && !isModeling) {
      // Signale DÈS LE CLIC — avant même que le rideau plein écran ne commence à monter, pas
      // seulement une fois l'écran couvert (`onCovered`, ~900ms plus tard) — que les éléments sans
      // place dans l'espace Modélisation (ModelStatusBox, panneau du bas de Prévisualisation)
      // doivent commencer à disparaître : ce fondu-glissement doit être visible EN TRANSPARENCE À
      // TRAVERS le rideau (z-index 1000+ pour ces éléments, contre 30 pour le rideau), jamais
      // caché derrière lui comme le vrai changement d'onglet (`onTabChange`, lui, reste dans
      // `onCovered` ci-dessous : le panneau Modélisation ne doit apparaître qu'une fois l'écran
      // couvert).
      emitApex('apex-entering-modeling');
    } else if (tabName !== 'settings' && isModeling) {
      // Symétrique : le contenu du panneau Modélisation disparaît en cascade dès le clic, avant
      // que sa forme ne commence à se déformer (à `onCovered`, cf. ModelingSidebar).
      emitApex('apex-leaving-modeling');
    }
    const loadingModeling = tabName === 'settings' && !isModeling;
    playSpaceTransition(tabName, () => {
      setActiveTool('select');
      onTabChange(tabName);
      setIsPreviewActive(false);
      emitApex('apex-preview-toggled', { active: false });
    });
    // Modélisation : le rideau reste jusqu'à ce que la scène soit réellement prête (Viewport3D
    // relâche `apex-gcode-loading` après `apex-mode-changed`), pas pour une durée fixe. Garde-fou
    // à 8 s si le signal n'arrive jamais.
    if (loadingModeling) {
      emitApex('apex-gcode-loading', { active: true, label: 'Modélisation' });
      window.setTimeout(
        () => emitApex('apex-gcode-loading', { active: false }),
        8000,
      );
    }
  };
}

  /**
   * Bascule animée vers l'espace Prévisualisation (rideau + déformation de la pilule), factorisée
   * hors de `handleLayerClick` pour être aussi déclenchée par le dépôt d'un fichier G-code en
   * Préparation (cf. l'écouteur `drop` plus bas) — même geste que le clic sur l'icône Prévisualisation,
   * simplement déclenché autrement. `pendingFile`, s'il est fourni, est réémis (`apex-gcode-loaded`
   * en pointillé via `apex-entering-preview-with-file`) une fois l'écran couvert, PAS avant : au
   * moment du dépôt, l'espace Prévisualisation n'a pas encore son hook de lecture actif
   * (`useGCodePreview(isPreviewActive)` dans Index.tsx), lequel n'écoute le dépôt/chargement que
   * lorsque `active` — le charger avant ce basculement n'aurait donc aucun effet.
   */
export function makeEnterPreview(c: TransitionCtx, playSpaceTransition: PlaySpaceTransition) {
  const { isModeling, onTabChange, setActiveTool, setIsPreviewActive } = c;
  return (pendingFile?: File) => {
    // Depuis Modélisation : même signal au clic que handleTopTabClick (cf. apex-leaving-modeling).
    if (isModeling) emitApex('apex-leaving-modeling');
    // Depuis Préparation : la boîte des modèles et les icônes de la pilule disparaissent dès le
    // clic, avant que la pilule ne commence à se déformer (sous le rideau, à `onCovered`).
    else emitApex('apex-entering-preview');
    // L'ancien fondu séquencé des panneaux (avant le rideau plein écran) n'a plus de raison
    // d'être : le rideau masque déjà tout pendant que ce switch se produit, donc tout bascule
    // d'un coup sous le voile plutôt qu'en deux temps visibles.
    playSpaceTransition('layers', () => {
      setActiveTool('layers');
      // Prévisualisation est un sous-mode du slicer (Préparation), jamais de la
      // Modélisation : sans ce `onTabChange`, entrer en Prévisualisation depuis
      // Modélisation laissait `activeTab` sur 'settings', et donc le bouton
      // "Modélisation" restait actif (cyan) par-dessus "Prévisualisation". Le second argument
      // signale spécifiquement ce cas-là à Index.tsx (venant de Modélisation, vers
      // Prévisualisation et non vers Préparation), pour qu'il joue le bon morph de sortie.
      onTabChange('box', true);
      setIsPreviewActive(true);
      emitApex('apex-tool-changed', { tool: 'layers' });
      emitApex('apex-preview-toggled', { active: true });
      // Dispatché en DERNIER, une fois `apex-preview-toggled` déjà parti : useGCodePreview
      // (Index.tsx) doit être passé à `active` avant de recevoir le fichier, sans quoi son
      // écouteur de dépôt (qui double aussi comme point d'entrée de chargement, cf.
      // use-gcode-preview.ts) ignorerait l'événement.
      if (pendingFile) {
        emitApex('apex-entering-preview-with-file', { file: pendingFile });
      }
    });
  };
}

/** Animation du conteneur d'outils : de la forme mesurée juste avant la transition vers le gabarit du mode cible. */
export function toolbarMotion(
  fromGeometry: Geometry | null,
  targetGeometry: Geometry,
  sketchReshape: 'in' | 'out' | null,
  restWidth: number | string,
) {
  const ease = [0.25, 1, 0.5, 1] as [number, number, number, number];
  const animate = fromGeometry ? {
    // Toute transition part TOUJOURS de la forme réellement mesurée juste avant (`fromGeometry`) pour rejoindre
    // le gabarit du mode cible — un seul et même conteneur qui se vide de ses icônes, se déplace et se déforme.
    x: [fromGeometry.x, fromGeometry.x, targetGeometry.x],
    y: [fromGeometry.y, fromGeometry.y, targetGeometry.y],
    width: [fromGeometry.width, fromGeometry.width, targetGeometry.width],
    height: [fromGeometry.height, fromGeometry.height, targetGeometry.height],
    borderRadius: [fromGeometry.borderRadius, fromGeometry.borderRadius, targetGeometry.borderRadius],
    opacity: 1,
    marginTop: 0,
  } : {
    // État initial : forme de repos du mode courant, sans animation ("auto" tant que la largeur naturelle
    // n'a pas été mesurée, un nombre dès qu'elle l'est — évite un saut une fois `boxWidth` connu).
    x: targetGeometry.x,
    y: targetGeometry.y,
    width: restWidth,
    height: targetGeometry.height,
    borderRadius: targetGeometry.borderRadius,
    opacity: 1,
    marginTop: 0,
  };
  // Esquisse actif : les icônes se replient d'abord (~0,3 s), puis la barre se raccourcit ; à la fin de
  // l'esquisse, la barre s'élargit tout de suite et les icônes reviennent.
  const transition = sketchReshape === 'in'
    ? { duration: 0.8, times: [0, 0.35, 1], ease }
    : sketchReshape === 'out'
      ? { duration: 0.5, times: [0, 0.02, 1], ease }
      : { duration: CONTAINER_RESHAPE_DURATION, times: [0, 0.45, 1], ease };
  return { animate, transition };
}
