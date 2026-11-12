// Ajout / retrait / changement de taille d'une bobine : sa largeur et son écart s'animent (elle se déploie ou se
// replie, les autres glissent), même courbe que le reste d'Apex.
export const SLOT_HIDDEN = { width: 0, marginLeft: 0, opacity: 0 };
export const SLOT_TRANSITION = { duration: 0.4, ease: [0.16, 1, 0.3, 1] } as const;
