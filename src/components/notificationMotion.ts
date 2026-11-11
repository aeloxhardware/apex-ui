// Constantes et fonctions pures du balayage des notifications (sans React, testables seules).

// Une carte est écartée quand le geste va assez loin, ou quand c'est un geste vif (px/ms).
const DISMISS_DISTANCE = 100;
const DISMISS_VELOCITY = 0.11;
// Mouvement avant de décider si le geste est un balayage horizontal ou un défilement vertical.
export const AXIS_LOCK = 6;
// Retour en place : ressort amorti critique (ne dépasse jamais le repos).
const SPRING_STIFFNESS = 520;
const SPRING_DAMPING = 2 * Math.sqrt(SPRING_STIFFNESS);
// Envol d'une carte écartée : elle garde sa vitesse (px/s), jamais moins que ce minimum, et accélère.
const FLIGHT_MIN_SPEED = 1400;
const FLIGHT_ACCEL = 4200;
// La vitesse se lit sur la fin du geste, pas sur la moyenne.
const VELOCITY_WINDOW_MS = 80;
export const EXIT_MS = 200;
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

export interface Sample {
  t: number;
  x: number;
}

export interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  /** Où la carte se trouvait déjà quand on l'a attrapée (retour en cours). */
  originX: number;
  dx: number;
  axis: 'x' | 'y' | null;
  samples: Sample[];
}

export const opacityFor = (x: number) => Math.max(1 - Math.abs(x) / 240, 0.3);

/** Vitesse de relâchement (px/ms) lue sur les derniers échantillons du pointeur. */
export function releaseVelocity(samples: Sample[]): number {
  const last = samples.at(-1);
  if (!last) return 0;
  let first = last;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (last.t - samples[i].t > VELOCITY_WINDOW_MS) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

/**
 * Côté par lequel une carte relâchée sort, ou 0 pour revenir. Un geste vif ne compte que s'il
 * s'éloigne du repos : renvoyer la carte vers le milieu la ramène.
 */
export function dismissDirection(dx: number, velocity: number): 1 | -1 | 0 {
  const flick = Math.abs(velocity) > DISMISS_VELOCITY && Math.sign(velocity) === Math.sign(dx);
  if (Math.abs(dx) < DISMISS_DISTANCE && !flick) return 0;
  return (dx === 0 ? velocity : dx) > 0 ? 1 : -1;
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Pas de simulation du retour en ressort : `paint` écrit la position, le pas renvoie vrai au repos. */
export function springStep(x0: number, velocity: number, paint: (x: number) => void) {
  let x = x0;
  let v = velocity * 1000;
  return (dt: number): boolean => {
    v += (-SPRING_STIFFNESS * x - SPRING_DAMPING * v) * dt;
    x += v * dt;
    const rest = Math.abs(x) < 0.5 && Math.abs(v) < 10;
    paint(rest ? 0 : x);
    return rest;
  };
}

/** Pas de simulation de l'envol : vitesse de départ au moins FLIGHT_MIN_SPEED, puis accélération. */
export function flightStep(x0: number, velocity: number, direction: 1 | -1, distance: number, paint: (x: number, opacity: number) => void) {
  let x = x0;
  let speed = Math.max(Math.abs(velocity) * 1000, FLIGHT_MIN_SPEED);
  return (dt: number): boolean => {
    speed += FLIGHT_ACCEL * dt;
    x += direction * speed * dt;
    const done = Math.abs(x) >= distance;
    paint(done ? direction * distance : x, Math.max(1 - Math.abs(x) / distance, 0));
    return done;
  };
}

/** Boucle rAF par clé : `step(dt)` est appelé jusqu'à ce qu'il renvoie vrai, puis `onDone`. */
export function createFrameRunner(frames: Map<string, number>) {
  const stop = (id: string) => {
    const frame = frames.get(id);
    if (frame === undefined) return;
    cancelAnimationFrame(frame);
    frames.delete(id);
  };
  const run = (id: string, step: (dt: number) => boolean, onDone?: () => void) => {
    stop(id);
    let last = performance.now();
    const tick = (now: number) => {
      // Pas plafonné : une image perdue ou un onglet en arrière-plan ne doit pas catapulter la simulation.
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      if (step(dt)) {
        frames.delete(id);
        onDone?.();
        return;
      }
      frames.set(id, requestAnimationFrame(tick));
    };
    frames.set(id, requestAnimationFrame(tick));
  };
  return { run, stop };
}
