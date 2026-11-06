/** Textes (info-bulles de bas d'écran) et entrées du menu contextuel du viewport. */
// Info-bulles de bas d'écran des éléments du menu contextuel (cf. CLAUDE.md : chaque élément porte
// son texte). Un élément dont la commande n'existe pas encore le dit dans sa description.
export const showTooltip = (tip: { title: string; desc: string }) =>
  window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: tip }));
export const hideTooltip = () => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));
export const menuTooltip = (tip: { title: string; desc: string }) => ({
  onMouseEnter: () => showTooltip(tip),
  onMouseLeave: hideTooltip,
});
export const SELECT_ALL_TOOLTIP = { title: 'Tout sélectionner', desc: 'Sélectionne tous les modèles du plateau.' };
export const DELETE_ALL_TOOLTIP = { title: 'Tout supprimer', desc: 'Supprime tous les modèles du plateau.' };
export const SCALE_TOOLTIP = {
  title: 'Échelle',
  desc: "Unité dans laquelle le fichier de ce modèle a été dessiné. Un STL n'en porte pas : s'il a été dessiné en pouces, il apparaît 25,4 fois trop petit.",
};
// Même courbe que le reste de l'application (cf. utils/easing.ts), au format attendu par Framer Motion.
export const UNIT_PILL_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const SCALE_INCH_TOOLTIP = { title: 'Pouces', desc: 'Lit le modèle en pouces : il est agrandi 25,4 fois, autour de son centre, et reste posé sur le plateau.' };
export const SCALE_MM_TOOLTIP = { title: 'Millimètres', desc: 'Lit le modèle en millimètres (unité par défaut) : annule le passage en pouces.' };
// Outils pas encore disponibles : grisés et inactifs, seule l'info-bulle « Bientôt disponible ».
export const SOON_TOOLTIP = { title: 'Bientôt disponible', desc: 'Bientôt disponible' };
export const ORGANIZE_TOOLTIP = SOON_TOOLTIP;

// Menu contextuel par espace. Préparation a son propre menu (JSX dédié, dans le rendu) ; les autres
// espaces listent ici des idées de fonctions, non raccordées : elles sont grisées et renvoient
// « Bientôt disponible ». `plateBlur` : le réglage de flou sous le plateau y a sa place.
export type ContextMenuSpace = 'home' | 'preparation' | 'preview' | 'modeling' | 'dev';
export const SPACE_MENU_ITEMS: Record<Exclude<ContextMenuSpace, 'preparation'>, { labels: string[]; plateBlur: boolean }> = {
  home: {
    plateBlur: false,
    labels: [
      'Nouveau projet', 'Ouvrir un projet récent', 'Ouvrir un G-code', 'Modèles d\'exemple',
      'Tutoriels de démarrage', 'Épingler un projet', 'Historique des projets', 'Ouvrir le dossier de travail',
      'Vérifier les mises à jour', 'Signaler un problème',
    ],
  },
  preview: {
    plateBlur: true,
    labels: [
      'Lecture / pause', 'Pas à pas précédent', 'Pas à pas suivant', 'Isoler la couche courante',
      'Masquer les déplacements à vide', 'Mesurer une distance', 'Coloration par vitesse',
      'Exporter une capture d\'écran', 'Afficher les temps d\'impression', 'Revenir au début du tracé',
    ],
  },
  modeling: {
    plateBlur: true,
    labels: [
      'Ajouter une sphère', 'Ajouter un cylindre', 'Ajouter un cône', 'Ajouter un tore',
      'Esquisse sur le plateau', 'Extruder la sélection', 'Symétrie', 'Union booléenne',
      'Soustraction booléenne', 'Congé / chanfrein',
    ],
  },
  dev: {
    plateBlur: false,
    labels: [
      'Afficher les logs de la console', 'Afficher les FPS', 'Inspecter la scène Babylon', 'Vider le cache des modèles',
      'Exporter l\'état de la scène', 'Afficher les normales', 'Afficher les collisions', 'Mesurer le rendu',
      'Simuler une erreur', 'Réinitialiser les préférences',
    ],
  },
};
export const PRIMITIVE_TOOLTIP = { title: 'Ajouter une primitive', desc: 'Ajoute une forme simple, à dessiner directement sur le plateau.' };
export const BOX_TOOLTIP = { title: 'Boîte', desc: 'Dessinez un pavé sur le plateau, puis donnez-lui sa hauteur.' };
export const PYRAMID_TOOLTIP = { title: 'Pyramide 4 côtés', desc: 'Dessinez une base sur le plateau, puis donnez-lui sa hauteur : la pyramide se pose sur le plateau.' };
export const MODELS_TOOLTIP = { title: 'Ajouter des modèles pratiques', desc: 'Ouvre une sélection de modèles de test à poser sur le plateau.' };

export const BLUR_TOOLTIP = {
  title: 'Niveau de flou sous le plateau',
  desc: "Intensité du flou de la capture sous le plateau. Double-cliquez sur le curseur pour revenir à la valeur par défaut.",
};
