/**
 * Textes de bas d'écran de la disposition automatique (menu de la barre d'outils et menu contextuel du plateau).
 * Libellés fournis par l'utilisateur (2026-11-06), à ne pas reformuler. Aucune bulle de souris : seulement le bandeau du bas
 * (`apex-set-tooltip`, qui n'affiche que `desc`). Source unique pour les deux menus.
 */
export interface ArrangeTip {
  title: string;
  desc: string;
}

const ORCA_NOTE = "Basé sur des outils provenant d'Orca Slicer v2.4.2.";
const ARRANGE_GOAL = "de manière à ce qu'ils s'impriment sans se toucher et le plus rapidement possible.";

export const ARRANGE_ALL_TIP: ArrangeTip = {
  title: 'Disposer automatiquement',
  desc: `Organise tous les objets posés sur le plateau actif, ${ARRANGE_GOAL} ${ORCA_NOTE}`,
};

export const ARRANGE_SELECTION_TIP: ArrangeTip = {
  title: 'Disposer la sélection',
  desc: `Organise tous les objets sélectionnés, ${ARRANGE_GOAL} ${ORCA_NOTE}`,
};

export const LOCK_TIP: ArrangeTip = {
  title: 'Verrouiller / déverrouiller la sélection',
  desc: "Verrouille ou déverrouille les modèles sélectionnés. Les éléments verrouillés sont insensibles à la fonction d'auto-arrangement.",
};

export const SPACING_TIP: ArrangeTip = {
  title: 'Écart entre les modèles',
  desc: "Distance minimale entre deux modèles à l'auto-arrangement. 0 pour espacement auto.",
};

export const ROTATIONS_TIP: ArrangeTip = {
  title: 'Autoriser les rotations',
  desc: "Permet ou non la rotation lors de l'auto-arrangement.",
};

export const ON_IMPORT_TIP: ArrangeTip = {
  title: 'Disposer à l’import',
  desc: "Disposer à l'import : Dispose automatiquement les modèles dès qu'un fichier est importé. Les modèles verrouillés restent en place.",
};

/** Texte non fourni par l'utilisateur : à valider. */
export const ALIGN_Y_TIP: ArrangeTip = {
  title: 'Aligner sur l’axe Y',
  desc: "Redresse le grand axe de chaque modèle allongé le long de l'axe Y avant de le ranger, comme l'option « Aligner sur l'axe Y » d'OrcaSlicer. Sans effet quand les rotations sont autorisées.",
};

/** Texte non fourni par l'utilisateur : à valider. */
export const ARRANGE_BUTTON_TIP: ArrangeTip = {
  title: 'Auto-disposition',
  desc: 'Auto-disposition : ouvre le menu de la disposition automatique des modèles.',
};

/** Texte de l'action « Organiser » : la sélection s'il y en a une, sinon tout le plateau. */
export const arrangeTipFor = (hasSelection: boolean): ArrangeTip => (hasSelection ? ARRANGE_SELECTION_TIP : ARRANGE_ALL_TIP);
