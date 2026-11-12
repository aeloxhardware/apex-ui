import { brandOf, deOrD, materialNameOf } from './filamentText';
import type { FilamentProfile } from './filamentCatalog';

/**
 * Textes de bas d'écran de l'AMS. Ceux de la bobine, de la partie basse et du « + » sont fournis par l'utilisateur
 * (2026-11-11) ; les autres sont marqués « à valider ».
 */

/** Bobine : « Matériau : [nom] provenant [de/d'] [marque] [modifié par l'utilisateur]. Cliquer pour voir le profil … ». */
export function spoolTip(p: FilamentProfile): string {
  const edited = p.user === true;
  const origin = `provenant ${deOrD(brandOf(p))}${edited ? " modifié par l'utilisateur" : ''}`;
  const actions = edited ? "Cliquer pour voir le profil, éditer ou revenir au profil d'usine." : 'Cliquer pour voir le profil ou éditer.';
  return `Matériau : ${materialNameOf(p)} ${origin}. ${actions}`;
}

/** Partie basse sombre de l'AMS. */
export const materialsTip = (count: number): string =>
  `${count} ${count > 1 ? 'matériaux' : 'matériau'}. Cliquer pour afficher les filaments sélectionnés.`;

export const ADD_MATERIAL_TIP = 'Cliquez pour ajouter un matériau provenant de la bibliothèque.';

// À valider avec l'utilisateur.
export const SHEET_EDIT_TIP =
  "Éditer le profil : l'enregistrement crée toujours une copie, le profil d'origine n'est jamais modifié. (à valider)";
export const SHEET_REVERT_TIP =
  "Revenir au profil d'usine : la bobine reprend le profil d'origine, la copie modifiée reste conservée. (à valider)";
export const SHEET_SAVE_TIP = 'Enregistrer les modifications dans une nouvelle copie du profil. (à valider)';
export const SHEET_CANCEL_TIP = 'Annuler les modifications. (à valider)';
export const CLOSE_TIP = 'Fermer. (à valider)';
