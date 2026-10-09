/**
 * Voile de changement d'espace : chronologie et dessin des tuiles, partagés entre le Worker qui le peint
 * (veil.worker.ts, hors du thread de l'interface) et le verre des panneaux (GlassPanelBackdrop.tsx), qui
 * doit redessiner le même voile par-dessus la scène 3D qu'il réfracte. Aucune dépendance au DOM.
 */
export const TILE_COLS = 14;
export const TILE_ROWS = 9;
/** Délai entre deux tuiles consécutives dans l'ordre de balayage (diagonale depuis le coin haut-droit). */
export const TILE_STEP_MS = 15;
/** Durée d'apparition d'une tuile individuelle. */
export const TILE_ANIM_MS = 260;
/** Le flou seul est entièrement installé avant la première tuile. */
export const BLUR_MS = 320;

export type VeilDirection = 'in' | 'out';
/** `start` : instant de départ en temps époque (`veilNow()`), commun au Worker et au thread principal. */
export interface VeilClock {
  dir: VeilDirection;
  start: number;
}

/** Horloge commune : `performance.now()` n'a pas la même origine dans un Worker. */
export const veilNow = () => performance.timeOrigin + performance.now();

/** Voile en cours côté thread principal (lu par le verre) ; null = aucun. */
export const veilState: { clock: VeilClock | null } = { clock: null };

// cubic-bezier(0.16, 1, 0.3, 1) — la courbe qu'utilisaient les tuiles sous framer-motion.
const BX1 = 0.16, BY1 = 1, BX2 = 0.3, BY2 = 1;
const bez = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
export function ease(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bez(BX1, BX2, mid) < x) lo = mid; else hi = mid;
  }
  return bez(BY1, BY2, (lo + hi) / 2);
}

/**
 * Dessine les tuiles à l'instant `now`. `ctx` est en pixels CSS du viewport (le transformé est posé par
 * l'appelant) ; `dpr` sert à caler les bords des tuiles sur la grille de pixels physiques (aucune
 * jointure visible). Renvoie vrai quand l'animation est terminée.
 */
export function drawVeilTiles(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  W: number,
  H: number,
  dpr: number,
  clock: VeilClock,
  now: number,
): boolean {
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  // Dégradé unique ancré sur le viewport (ellipse 140 % × 160 % centrée en haut à droite) : une fois
  // toutes les tuiles posées, il forme un voile continu.
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(150,152,156,0.9)');
  g.addColorStop(0.55, 'rgba(58,60,66,0.97)');
  g.addColorStop(1, 'rgba(20,21,24,1)');
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(1.4 * W, 1.6 * H);
  ctx.fillStyle = g;
  const base = now - clock.start - (clock.dir === 'in' ? BLUR_MS : 0);
  let done = true;
  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < TILE_COLS; col++) {
      const delay = (TILE_COLS - 1 - col + row) * TILE_STEP_MS;
      const p = Math.min(1, Math.max(0, (base - delay) / TILE_ANIM_MS));
      if (p < 1) done = false;
      const e = ease(p);
      const opacity = clock.dir === 'in' ? e : 1 - e;
      if (!(opacity > 0.001)) continue;
      const scale = clock.dir === 'in' ? 1.3 - 0.3 * e : 1 + 0.3 * e;
      let x0 = snap((col / TILE_COLS) * W);
      let x1 = col === TILE_COLS - 1 ? W : snap(((col + 1) / TILE_COLS) * W);
      let y0 = snap((row / TILE_ROWS) * H);
      let y1 = row === TILE_ROWS - 1 ? H : snap(((row + 1) / TILE_ROWS) * H);
      if (Math.abs(scale - 1) > 1e-3) {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        x0 = cx + (x0 - cx) * scale; x1 = cx + (x1 - cx) * scale;
        y0 = cy + (y0 - cy) * scale; y1 = cy + (y1 - cy) * scale;
      }
      ctx.globalAlpha = Math.min(1, opacity);
      ctx.fillRect((x0 - W) / (1.4 * W), y0 / (1.6 * H), (x1 - x0) / (1.4 * W), (y1 - y0) / (1.6 * H));
    }
  }
  ctx.restore();
  return done;
}
