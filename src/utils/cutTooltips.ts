/**
 * Textes de l'outil Couper (bouton de la barre d'outils et panneau sous la barre). Rédigés pour la première version, à
 * faire valider par l'utilisateur (règle des infobulles : la formulation vient de lui). Bandeau du bas seulement dans le
 * panneau (`bottomTip`), bulle + bandeau sur le bouton de la barre (`CustomTooltip`).
 */
export interface CutTip {
  title: string;
  desc: string;
}

const ORCA_NOTE = "Basé sur l'outil Couper d'Orca Slicer v2.4.2.";

export const CUT_TOOL_TIP: CutTip = {
  title: 'Outil Couper (Cut - C)',
  desc: `Coupez le modèle sélectionné en deux le long d'un plan réglable. (Raccourci : C) ${ORCA_NOTE}`,
};

export const CUT_PANEL_TIP: CutTip = {
  title: 'Couper',
  desc: 'Réglez la position du plan de coupe, ce que deviennent les deux parties, puis lancez la coupe.',
};

export const CUT_NO_TARGET_TIP: CutTip = {
  title: 'Couper',
  desc: 'Sélectionnez un seul modèle pour le couper.',
};

export const CUT_HEIGHT_TIP: CutTip = {
  title: 'Hauteur de coupe',
  desc: 'Hauteur du centre du plan de coupe au-dessus du plateau, en mm. Dans la scène, la flèche du plan le pousse le long de sa normale et les anneaux l’inclinent.',
};

export const CUT_ROTATION_TIP: CutTip = {
  title: 'Inclinaison du plan',
  desc: 'Rotation du plan de coupe en degrés : A autour de X, B autour de Y, C autour de Z. 0, 0, 0 : plan horizontal.',
};

export const CUT_FLIP_TIP: CutTip = {
  title: 'Retourner le plan',
  desc: 'Inverse le sens du plan : la partie haute devient la partie basse, et inversement.',
};

export const CUT_UPPER_TIP: CutTip = {
  title: 'Partie haute',
  desc: 'Partie située du côté de la face supérieure du plan. Décochez « Garder » pour la supprimer après la coupe.',
};

export const CUT_LOWER_TIP: CutTip = {
  title: 'Partie basse',
  desc: 'Partie située sous le plan. Décochez « Garder » pour la supprimer après la coupe.',
};

export const CUT_PLACEMENT_TIPS = {
  keep: 'La partie garde son orientation et se pose sur le plateau.',
  'on-cut': 'La partie est tournée pour reposer à plat sur sa face coupée.',
  flip: 'La partie est retournée tête en bas, puis posée sur le plateau.',
} as const;

export const CUT_PERFORM_TIP: CutTip = {
  title: 'Couper',
  desc: 'Coupe le modèle le long du plan et referme les deux sections. Ctrl+Z rend le modèle d’origine.',
};
