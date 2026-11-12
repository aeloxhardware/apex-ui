/**
 * Géométrie d'un AMS vu de face (prototypes de l'onglet Dev) : logique pure, sans React, pour être testée.
 *
 * Règle (ordre de l'utilisateur, 2026-11-11) : le boîtier est réglé sur `AMS_BASE_SPOOLS` bobines. Jusqu'à ce nombre, les
 * bobines gardent leur taille (elles ne rétrécissent que si le boîtier est réglé plus court qu'elles). Au-delà, elles
 * gardent la taille qu'elles ont à `AMS_BASE_SPOOLS` : le boîtier ne montre que sa longueur de base, la dernière bobine
 * s'estompe au bout, et le survol l'allonge pour tout développer — jusqu'à `AMS_HOVER_SPOOLS` bobines. Au-delà, le bout
 * reste estompé même au survol (`truncated`) ; la partie basse de l'AMS ouvre alors tous les filaments.
 */

export const AMS_BASE_SPOOLS = 4;
/** Bobines que le survol peut dévoiler ; au-delà, il faut cliquer pour tout afficher. */
export const AMS_HOVER_SPOOLS = 12;
export const AMS_MAX_SPOOLS = 24;

export interface AmsMetrics {
  /** Longueur du boîtier replié, px. */
  caseW: number;
  /** Marge intérieure gauche et droite, px. */
  pad: number;
  /** Diamètre maximal d'une bobine (peu de bobines), px. */
  maxSize: number;
  /** Écart entre deux bobines, en fraction de leur diamètre (négatif = chevauchement). */
  gapRatio: number;
}

export interface AmsLayout {
  size: number;
  gap: number;
  collapsedW: number;
  /** Longueur au survol : jusqu'à AMS_HOVER_SPOOLS bobines. */
  expandedW: number;
  /** Plus de AMS_HOVER_SPOOLS bobines : le bout reste estompé au survol, clic pour tout afficher. */
  truncated: boolean;
  /** Plus de bobines que le boîtier replié n'en montre : bout estompé, développé au survol. */
  overflowing: boolean;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Diamètre qui fait tenir `n` bobines dans la longueur utile du boîtier. */
function fitSize(n: number, m: AmsMetrics): number {
  const span = n + (n - 1) * m.gapRatio;
  return Math.min(m.maxSize, (m.caseW - 2 * m.pad) / span);
}

const widthFor = (n: number, size: number, gap: number, m: AmsMetrics) => Math.ceil(n * size + (n - 1) * gap + 2 * m.pad);

export function amsLayout(count: number, m: AmsMetrics): AmsLayout {
  const n = Math.min(Math.max(Math.round(count), 1), AMS_MAX_SPOOLS);
  const size = round1(fitSize(Math.min(n, AMS_BASE_SPOOLS), m));
  const gap = round1(size * m.gapRatio);
  const overflowing = n > AMS_BASE_SPOOLS;
  return {
    size,
    gap,
    collapsedW: m.caseW,
    expandedW: overflowing ? widthFor(Math.min(n, AMS_HOVER_SPOOLS), size, gap, m) : m.caseW,
    truncated: n > AMS_HOVER_SPOOLS,
    overflowing,
  };
}
