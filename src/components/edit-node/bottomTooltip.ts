import { emitApex } from '@/events/apexEvents';
/**
 * Infobulle de bas d'écran (TopRightMenu écoute `apex-set-tooltip` / `apex-reset-tooltip`), pour
 * les composants de l'édition par nœuds. Les textes du nœud, du « + », du cadenas et des poignées
 * sont ceux fixés par l'utilisateur (2026-10-06) ; ne pas les reformuler.
 */
export interface BottomTip {
  title: string;
  desc: string;
}

export const showBottomTip = (tip: BottomTip) =>
  emitApex('apex-set-tooltip', tip);

export const hideBottomTip = () => emitApex('apex-reset-tooltip');

/** Gestionnaires de survol à étaler sur un élément. */
export const bottomTip = (title: string, desc: string) => ({
  onPointerEnter: () => showBottomTip({ title, desc }),
  onPointerLeave: hideBottomTip,
});

export const NODE_TIPS = {
  collapsed: { title: 'Nœud', desc: 'Nœud forçant les directions du G-Code. Cliquer pour afficher les options.' },
  expandedFree: {
    title: 'Nœud',
    desc: 'Cliquer une fois pour réduire. Double-cliquer pour changer le mode de déformation. Maintenir pour déplacer',
  },
  expandedLocked: {
    title: 'Nœud verrouillé',
    desc: 'Cliquer une fois pour réduire. Double-cliquer pour changer le mode de déformation. Maintenir pour déplacer les trajectoires.',
  },
  add: { title: 'Ajouter', desc: 'Ajouter un Point de Contrainte au Nœud.' },
  lock: {
    title: 'Cadenas',
    desc: 'Verrouiller le nœud sur ses trajectoires allouées et les déplacer en même temps que le nœud.',
  },
  unlock: {
    title: 'Cadenas',
    desc: 'Déverrouiller le nœud : le maintenir le fait de nouveau glisser le long des trajectoires, sans les déplacer.',
  },
  handle: {
    title: 'Point de Contrainte',
    // Texte de l'utilisateur, puis les gestes (exigés par D2, ajout validé par l'utilisateur).
    desc:
      'Point de Contrainte influençant les directions des trajectoires par rapport au Nœud. Cliquer pour verrouiller la position relative aux trajectoires.' +
      ' Glisser : tourner la déformation et régler l’influence · Ctrl (⌘) + glisser : tourner seulement · Alt + glisser : régler l’influence seulement · Double-clic : remettre en place · Glisser dans le nœud : supprimer.',
  },
} satisfies Record<string, BottomTip>;
