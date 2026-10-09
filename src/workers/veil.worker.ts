import { drawVeilTiles, veilNow, type VeilClock } from '@/utils/veilTimeline';

/**
 * Peint le voile de changement d'espace (tuiles) dans un OffscreenCanvas, HORS du thread de l'interface :
 * l'animation continue pendant que le thread principal initialise le viewport 3D, monte un espace ou
 * construit un maillage (là où une animation pilotée en JS s'y figeait). Un seul canevas : pas de
 * jointures entre tuiles. Le flou est un élément CSS à part (SpaceTransitionOverlay).
 */
type Msg =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'size'; w: number; h: number; dpr: number }
  | { type: 'play'; clock: VeilClock }
  | { type: 'clear' };

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let w = 0, h = 0, dpr = 1;
let clock: VeilClock | null = null;
let scheduled = false;

const raf: (cb: () => void) => void =
  (self as unknown as { requestAnimationFrame?: (cb: () => void) => void }).requestAnimationFrame?.bind(self)
  ?? ((cb) => { setTimeout(cb, 16); });

function frame() {
  scheduled = false;
  if (!canvas || !ctx || w === 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!clock) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const done = drawVeilTiles(ctx, w, h, dpr, clock, veilNow());
  if (!done) { schedule(); return; }
  // Posé : l'image reste telle quelle (aucun travail jusqu'au prochain ordre). Retiré : plus rien à dessiner.
  if (clock.dir === 'out') {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    clock = null;
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  raf(frame);
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === 'init') {
    canvas = m.canvas;
    ctx = canvas.getContext('2d');
  } else if (m.type === 'size') {
    w = m.w; h = m.h; dpr = m.dpr;
    if (canvas) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    schedule();
  } else if (m.type === 'play') {
    clock = m.clock;
    schedule();
  } else if (m.type === 'clear') {
    clock = null;
    schedule();
  }
};
