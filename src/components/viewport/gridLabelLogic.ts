// Choix des graduations de la grille de modélisation à étiqueter (logique pure, sans Babylon).

/**
 * Pas de décimation retenu pour la graduation `tileValue` : le plus petit de `decimations`
 * (croissants) pour lequel les chiffres tiennent à l'écran, ou undefined si aucun ne convient.
 *
 * Le pas est choisi PAR BLOC, pas par étiquette : un bloc (de la taille du pas suivant) garde un
 * pas uniforme, décidé sur sa graduation la plus serrée (l'une de ses deux bornes, l'écart
 * variant de façon monotone le long de l'axe). Sinon un bloc se remplissait à moitié à la
 * transition, d'où des suites comme 30, 38, 40.
 *
 * @param needed Place (px) qu'occupe un chiffre, marge comprise.
 * @param spacingPxAt Écart à l'écran (px) entre la graduation de rang `rank` et la suivante.
 */
export function labelDecimation(
  tileValue: number,
  needed: number,
  decimations: readonly number[],
  spacingPxAt: (rank: number) => number,
): number | undefined {
  for (let i = 0; i < decimations.length; i++) {
    const d = decimations[i];
    const blockSize = decimations[i + 1] ?? d * 10;
    const lo = Math.floor(tileValue / blockSize) * blockSize;
    const tightest = Math.min(spacingPxAt(lo), spacingPxAt(lo + blockSize - 1));
    if (d * tightest >= needed) return d;
  }
  return undefined;
}

/** Une étiquette est affichée si sa graduation tombe sur un multiple du pas de décimation retenu. */
export const isLabelVisible = (tileValue: number, decimation: number | undefined): boolean =>
  decimation !== undefined && Math.abs(tileValue) % decimation === 0;
