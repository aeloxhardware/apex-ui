import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { AXIS_LOCK, dismissDirection, releaseVelocity, type Drag } from './notificationMotion';
import type { CardMotion } from './useCardMotion';

type CardPointerEvent = ReactPointerEvent<HTMLDivElement>;

interface GestureOptions {
  motion: CardMotion;
  /** Seule la carte de face se balaie quand la pile est repliée ; une carte qui part ne se rattrape pas. */
  canStart: (id: string, depth: number) => boolean;
}

/** Une pression qui ne doit pas démarrer un balayage : bouton secondaire de souris, ou sur un bouton. */
function ignoresPress(event: CardPointerEvent): boolean {
  if (event.pointerType === 'mouse' && event.button !== 0) return true;
  return Boolean((event.target as HTMLElement).closest('button'));
}

const newDrag = (event: CardPointerEvent, originX: number): Drag => ({
  pointerId: event.pointerId,
  startX: event.clientX,
  startY: event.clientY,
  originX,
  dx: 0,
  axis: null,
  samples: [],
});

/** Décide de l'axe du geste une fois assez de mouvement ; renvoie false tant qu'il est indécis. */
function lockAxis(current: Drag, event: CardPointerEvent, dx: number, dy: number): boolean {
  if (current.axis !== null) return true;
  if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return false;
  current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  // Le balayage continue même quand le pointeur quitte la carte.
  if (current.axis === 'x') event.currentTarget.setPointerCapture(event.pointerId);
  return true;
}

/** Gestes de balayage (pointeur) des cartes ; l'animation est celle de `motion`. */
export function useSwipeGesture({ motion, canStart }: GestureOptions) {
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  // Termine un geste dont le pointeur a été relâché hors de la carte avant d'être capturé.
  const stopListening = useRef<(() => void) | null>(null);

  useEffect(() => () => stopListening.current?.(), []);

  const listenForRelease = (id: string, pointerId: number) => {
    const release = (up: PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      stopListening.current?.();
      // Les gestionnaires de la carte passent d'abord ; ceci ne nettoie qu'un geste fini hors carte.
      if (drag.current?.pointerId !== pointerId) return;
      drag.current = null;
      if (motion.getX(id)) motion.snapBack(id, 0);
    };
    stopListening.current?.();
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    stopListening.current = () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      stopListening.current = null;
    };
  };

  const onPointerDown = (event: CardPointerEvent, depth: number, id: string) => {
    if (drag.current || !canStart(id, depth)) return;
    suppressClick.current = false;
    if (ignoresPress(event)) return;
    // Rattrape une carte encore en train de revenir du dernier balayage.
    motion.stopFrame(id);
    listenForRelease(id, event.pointerId);
    drag.current = newDrag(event, motion.getX(id));
  };

  const onPointerMove = (event: CardPointerEvent, id: string) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!lockAxis(current, event, dx, dy) || current.axis !== 'x') return;
    current.dx = current.originX + dx;
    current.samples = [...current.samples.slice(-11), { t: event.timeStamp, x: current.dx }];
    // Écrit directement dans l'élément : pas de rendu à chaque mouvement.
    motion.paint(id, current.dx);
  };

  const onPointerUp = (event: CardPointerEvent, id: string) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (current.axis !== 'x') {
      // Un toucher ou un défilement qui a pris une carte en plein retour la laisse finir.
      if (motion.getX(id)) motion.snapBack(id, 0);
      return;
    }
    suppressClick.current = true;
    const velocity = releaseVelocity(current.samples);
    const direction = dismissDirection(current.dx, velocity);
    if (direction === 0) {
      motion.snapBack(id, velocity);
      return;
    }
    // Une vitesse qui pointe vers la pile ne doit pas passer dans l'envol.
    motion.dismiss(id, direction, Math.sign(velocity) === direction ? velocity : 0);
  };

  /** Vrai (une seule fois) si le clic qui suit vient de la fin d'un balayage : il ne doit rien faire. */
  const takeSuppressedClick = () => {
    const was = suppressClick.current;
    suppressClick.current = false;
    return was;
  };

  return { onPointerDown, onPointerMove, onPointerUp, takeSuppressedClick };
}

export type SwipeGesture = ReturnType<typeof useSwipeGesture>;
