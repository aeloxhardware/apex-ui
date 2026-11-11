// Géométrie de la pile de notifications (pure) : positions des cartes repliées ou dépliées.

/** Part de chaque carte du fond qui dépasse sous la carte de face (pile repliée). */
export const PEEK = 10;
/** Nombre de cartes visibles derrière la carte de face quand la pile est repliée. */
const VISIBLE_BEHIND = 2;
export const GAP = 8;
/** Hauteur utilisée tant qu'une carte n'est pas mesurée. */
export const FALLBACK_HEIGHT = 76;
const SCALE_STEP = 0.05;

export interface StackLayout {
  /** Décalage vertical de chaque carte dépliée (dans l'ordre de `order`). */
  offsets: number[];
  frontHeight: number;
  height: number;
}

/** `order` : ids des cartes qui comptent (celles qui s'en vont n'occupent plus de place). */
export function layoutStack(order: string[], heightOf: (id: string) => number, expanded: boolean): StackLayout {
  const heights = order.map(heightOf);
  const offsets: number[] = [];
  let running = 0;
  for (const h of heights) {
    offsets.push(running);
    running += h + GAP;
  }
  const frontHeight = heights[0] ?? 0;
  const behind = Math.min(Math.max(order.length - 1, 0), VISIBLE_BEHIND);
  const height = expanded ? Math.max(running - GAP, 0) : frontHeight + behind * PEEK;
  return { offsets, frontHeight, height };
}

export interface CardPose {
  y: number;
  scale: number;
  /** Carte hors de la pile visible : invisible et sans pointeur. */
  hidden: boolean;
  /** Carte derrière la face, repliée : seule sa bande basse dépasse. */
  peek: boolean;
}

/** Pose d'une carte à la profondeur `depth` (0 = face) ; `ownHeight` : sa hauteur mesurée. */
export function cardPose(depth: number, expanded: boolean, layout: StackLayout, ownHeight: number): CardPose {
  const scale = expanded ? 1 : 1 - depth * SCALE_STEP;
  // Repliée : cartes alignées par le bas, pour qu'une bande de chacune dépasse sous la face.
  const y = expanded ? (layout.offsets[depth] ?? 0) : layout.frontHeight + depth * PEEK - ownHeight * scale;
  return {
    y,
    scale,
    hidden: !(expanded || depth <= VISIBLE_BEHIND),
    peek: !expanded && depth > 0,
  };
}
