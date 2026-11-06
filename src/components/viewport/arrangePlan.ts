// Qui bouge à la disposition automatique, et ce que fait la bascule de verrouillage. Logique pure, sans Babylon : testée
// seule (arrangePlan.test.ts). Un modèle verrouillé n'est jamais déplacé ; quand on ne dispose que la sélection, les modèles
// non sélectionnés restent aussi en place. Tous deux servent d'obstacles aux modèles qui bougent.
export interface ArrangeCandidate {
  locked: boolean;
  selected: boolean;
}

/** `fixed[i]` vaut vrai pour un modèle qui reste où il est. */
export function fixedFlags(models: ArrangeCandidate[], selectedOnly: boolean): boolean[] {
  return models.map((m) => m.locked || (selectedOnly && !m.selected));
}

/** Vrai quand rien ne peut bouger : la disposition n'a alors rien à faire. */
export function nothingToMove(fixed: boolean[]): boolean {
  return fixed.every(Boolean);
}

/** Verrouiller, sauf si toute la sélection l'est déjà (alors déverrouiller). */
export function lockToggleTarget(selectedLocked: boolean[]): boolean {
  return !(selectedLocked.length > 0 && selectedLocked.every(Boolean));
}
