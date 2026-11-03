import type { Variants } from 'framer-motion';
import type { UiSoundName } from '@/utils/uiSound';

// Tables statiques de la barre d'outils (Sidebar.tsx).

// Doit correspondre à ViewCube.module.scss (`.container`) : la colonne d'outils du mode
// Prévisualisation vient se coller au même bord droit, juste sous le gizmo.
export const VIEWCUBE_RIGHT = 24;
export const VIEWCUBE_BOTTOM = 70 + 130; // top + height
export const PREVIEW_TOOLBAR_TOP_GAP = 10; // marge entre le bas du ViewCube et le haut de la colonne
export const PREVIEW_TOOLBAR_WIDTH = 56; // largeur de la colonne de calques en mode Prévisualisation

// Position de repos (mode box, sans transformation) du haut de `.bottomToolbar` : top du
// `.container` (20px) + hauteur du `.topToolbar` (42px de bouton + 8px de padding de
// chaque côté = 58px) + le gap de la pile flex (10px). Doit rester en phase avec
// Sidebar.module.scss si ces valeurs changent.
export const BOTTOM_TOOLBAR_REST_TOP = 20 + 58 + 10;

// Durée totale de l'animation de déplacement/déformation du conteneur `.bottomToolbar`
// (voir son `transition` plus bas) : c'est le délai avant lequel les icônes du mode cible
// ne doivent JAMAIS commencer à apparaître (cf. `iconVariants.visible`), dans tous les sens
// de transition. Partagée par les deux pour qu'elles ne puissent pas diverger.
export const CONTAINER_RESHAPE_DURATION = 1.1;

export const SPACE_LABELS: Record<'box' | 'settings' | 'developer' | 'layers' | 'params' | 'home', string> = {
  home: 'Accueil',
  box: 'Préparation',
  settings: 'Modélisation',
  developer: 'Dev',
  layers: 'Prévisualisation',
  params: 'Paramètres',
};

// Son propre à l'espace d'arrivée. Pas de son pour la console Dev ni pour les Paramètres.
export const SPACE_SOUNDS: Record<'box' | 'settings' | 'developer' | 'layers' | 'params' | 'home', UiSoundName | null> = {
  home: null,
  box: 'spacePreparation',
  settings: 'spaceModeling',
  developer: null,
  layers: 'spacePreview',
  params: null,
};

export const TOOL_LABELS: Record<'select' | 'move' | 'rotate' | 'scale' | 'texture' | 'layers', string> = {
  select: 'Sélection',
  move: 'Déplacement',
  rotate: 'Rotation',
  scale: 'Échelle',
  texture: 'Texture',
  layers: 'Prévisualisation',
};

export const iconVariants: Variants = {
  // Les icônes du mode cible n'apparaissent qu'UNE FOIS le reshape du conteneur terminé
  // (durée totale de l'animation de `.bottomToolbar`, voir CONTAINER_RESHAPE_DURATION) —
  // dans tous les sens de transition, pas seulement Prévisualisation→Modélisation. Sans ce
  // délai de base, les icônes du nouveau mode démarraient leur propre petit délai en
  // cascade (`i*0.04`) dès le changement de state React, bien avant que le conteneur ait
  // fini de se déplacer/déformer.
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: CONTAINER_RESHAPE_DURATION + i * 0.04,
      duration: 0.3,
      ease: [0.16, 1, 0.3, 1] as const
    }
  }),
  // La sortie, elle, doit rester immédiate : les icônes du mode qu'on quitte doivent avoir
  // disparu AVANT que le conteneur ne commence à se déformer (cf. keyframes `times` de
  // `.bottomToolbar` : vidage sur les premiers 45%, déformation sur les 55% restants).
  hidden: (i: number) => ({
    opacity: 0,
    y: 15,
    scale: 0.95,
    transition: {
      delay: i * 0.04,
      duration: 0.25,
      ease: [0.25, 1, 0.5, 1] as const
    }
  })
};
