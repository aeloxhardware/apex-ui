import { useCallback, useEffect, useRef } from 'react';
import { EASE_OUT, EXIT_MS, createFrameRunner, flightStep, opacityFor, prefersReducedMotion, springStep } from './notificationMotion';

interface MotionOptions {
  /** Appelé quand une carte commence à partir (avant l'animation). */
  onStart: (id: string) => void;
  /** Appelé quand elle a disparu : c'est là qu'on la retire du magasin. */
  onEnd: (id: string) => void;
}

/** Animations par carte (retour en ressort, envol, fondu), écrites directement dans le DOM. */
export function useCardMotion({ onStart, onEnd }: MotionOptions) {
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const swipeX = useRef(new Map<string, number>());
  const frames = useRef(new Map<string, number>());
  const dismissed = useRef(new Set<string>());
  const timers = useRef<number[]>([]);
  const runner = createFrameRunner(frames.current);

  useEffect(() => {
    const [pending, running] = [timers.current, frames.current];
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
      running.forEach((f) => cancelAnimationFrame(f));
    };
  }, []);

  const register = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  const getX = (id: string) => swipeX.current.get(id) ?? 0;

  const paint = (id: string, x: number, opacity = opacityFor(x)) => {
    swipeX.current.set(id, x);
    const node = nodes.current.get(id);
    if (!node) return;
    node.style.transform = x === 0 ? '' : `translateX(${x}px)`;
    // L'opacité va sur la carte elle-même : sur un parent, elle couperait son flou d'arrière-plan.
    const card = node.querySelector<HTMLElement>('[data-card]');
    if (card) card.style.opacity = x === 0 ? '' : `${opacity}`;
    if (x === 0) delete node.dataset.moving;
    else node.dataset.moving = '1';
  };

  /** Retour en place, en partant de la vitesse à laquelle le doigt a lâché. */
  const snapBack = (id: string, velocity: number) => {
    if (prefersReducedMotion()) paint(id, 0);
    else
      runner.run(
        id,
        springStep(getX(id), velocity, (x) => paint(id, x)),
      );
  };

  const finish = (id: string) => {
    swipeX.current.delete(id);
    dismissed.current.delete(id);
    onEnd(id);
  };

  const fadeOut = (id: string, node: HTMLDivElement | null) => {
    runner.stop(id);
    const card = node?.querySelector<HTMLElement>('[data-card]');
    if (card) Object.assign(card.style, { transition: `opacity ${EXIT_MS}ms ${EASE_OUT}`, opacity: '0' });
    timers.current.push(window.setTimeout(() => finish(id), EXIT_MS));
  };

  /**
   * Envoie la carte sur le côté. Un balayage garde la vitesse du relâchement (un geste vif part plus
   * vite qu'un glissement lent) ; la croix et le clavier partent du repos à la vitesse minimale.
   */
  const dismiss = (id: string, direction: 1 | -1, velocity = 0) => {
    if (dismissed.current.has(id)) return;
    dismissed.current.add(id);
    onStart(id);
    const node = nodes.current.get(id) ?? null;
    if (!node || prefersReducedMotion()) {
      fadeOut(id, node);
      return;
    }
    const step = flightStep(getX(id), velocity, direction, node.offsetWidth * 1.1, (x, o) => paint(id, x, o));
    runner.run(id, step, () => finish(id));
  };

  return { register, getX, stopFrame: runner.stop, paint, snapBack, dismiss };
}

export type CardMotion = ReturnType<typeof useCardMotion>;
