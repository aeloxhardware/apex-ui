// Géométrie du menu et durées des animations de CategoriesSidebar.tsx.

// Géométrie du menu de catégorie, en px, dans le repère de la pilule (fixed, left 24 / top 212).
// Doit rester alignée sur CategoriesSidebar.module.scss (.leftSidebarContainer,
// .categoriesToolbar, .fusionMenuContainer).
export const MENU_OFFSET_Y = 68; // .fusionMenuContainer : top 280
export const MENU_W = 320;
export const MENU_R = 16;
// Panneau (max-height 400) + la marge que prend le col en s'étirant avant de se rompre.
export const MENU_STAGE_H = MENU_OFFSET_Y + 400 + 40;
export const MENU_MORPH_MS = 700;

// Prévisualisation : panneau du haut sur toute la hauteur disponible, panneau du bas de hauteur
// fixe, le tout s'arrêtant à 236px du bas de l'écran (au-dessus de la barre d'aide).
export const PREVIEW_STRETCH_MS = 520;
export const PREVIEW_HOLD_MS = 90; // temps mort entre l'étirement et la division : deux gestes distincts
export const PREVIEW_DIVIDE_MS = 760;
export const PREVIEW_MORPH_MS = PREVIEW_STRETCH_MS + PREVIEW_HOLD_MS + PREVIEW_DIVIDE_MS;

// Cascade des icônes de la pilule (Qualité/Solidité/Vitesse/...) autour d'un morph de Modélisation,
// dans l'ordre d'affichage (gauche → droite) : disparition dès le clic vers Modélisation
// (leavingToModeling), apparition au retour d'un morph de sortie (arrivingFromModeling). Symétrique
// à la cascade du contenu du panneau Modélisation (cf. CONTENT_STAGGER_MS dans ModelingSidebar.tsx).
// Avec ~8 catégories et 30ms de décalage, la cascade dure ~370ms : largement terminée avant que la
// déformation ne commence (`onCovered`, ~900ms après le clic).
const PILL_ICON_STAGGER_MS = 0.07;
const PILL_ICON_FADE_MS = 0.24;

export const pillIconsContainerVariants = {
  visible: { transition: { staggerChildren: PILL_ICON_STAGGER_MS } },
  hidden: { transition: { staggerChildren: PILL_ICON_STAGGER_MS } },
};

export const pillIconVariants = {
  visible: { opacity: 1, x: 0, y: 0, transition: { duration: PILL_ICON_FADE_MS, ease: [0.4, 0, 0.2, 1] as const } },
  hidden: { opacity: 0, x: -14, y: -4, transition: { duration: PILL_ICON_FADE_MS, ease: [0.4, 0, 0.2, 1] as const } },
};
