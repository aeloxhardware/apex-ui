/**
 * Premier affichage du menu de catégorie (chargement, changement d'espace) : le menu glisse vers la droite en fondu,
 * comme la pilule qui le précède, puis son contenu — portée Global / Par objet, titres de section et lignes de
 * réglage, UN PAR UN — glisse vers la gauche en fondu, en cascade. Les lignes héritent de ces variantes du menu
 * (cf. CategoriesPanels.tsx, EngineItemRow.tsx) : `staggerChildren` s'applique à tous les éléments animés, dans
 * l'ordre de l'arbre.
 */
export const menuEnterVariants = {
  hidden: { opacity: 0, x: -20 },
  shown: {
    opacity: 1,
    x: 0,
    transition: {
      opacity: { duration: 0.7, ease: 'linear' },
      x: { duration: 0.7, ease: 'easeInOut' },
      delayChildren: 0.55,
      staggerChildren: 0.045,
    },
  },
} as const;

export const menuItemEnterVariants = {
  hidden: { opacity: 0, x: 18 },
  shown: { opacity: 1, x: 0, transition: { duration: 0.4, ease: 'easeOut' } },
} as const;
