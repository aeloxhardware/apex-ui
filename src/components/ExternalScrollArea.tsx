import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIsPresent } from 'framer-motion';
import clsx from 'clsx';
import styles from './ExternalScrollArea.module.scss';

const THUMB_MARGIN = 8;
const THUMB_MIN = 32;

interface ExternalScrollAreaProps {
  children: React.ReactNode;
  /** Conteneur (doit être positionné par le parent : il remplit sa hauteur et ne rogne pas le curseur). */
  className?: string;
  /** Contenu défilant (marges intérieures). */
  contentClassName?: string;
}

/**
 * Zone défilante à curseur externe, comme les panneaux qualité / solidité / vitesse
 * (CategoriesSidebar) : la barre native est masquée, un curseur est dessiné à 4 px hors du bord
 * droit du conteneur. Il n'apparaît que si le contenu dépasse.
 */
export const ExternalScrollArea: React.FC<ExternalScrollAreaProps> = ({ children, className, contentClassName }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) {
      setThumb(null);
      return;
    }
    const track = clientHeight - THUMB_MARGIN * 2;
    const height = Math.max(THUMB_MIN, (clientHeight / scrollHeight) * track);
    const maxScroll = scrollHeight - clientHeight;
    setThumb({ top: THUMB_MARGIN + (scrollTop / maxScroll) * (track - height), height });
  }, []);

  useEffect(() => {
    update();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [update]);

  const onThumbDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    setDragging(true);
    const startY = e.clientY;
    const startScrollTop = el.scrollTop;
    const move = (ev: MouseEvent) => {
      const { scrollHeight, clientHeight } = el;
      const track = clientHeight - THUMB_MARGIN * 2;
      const height = Math.max(THUMB_MIN, (clientHeight / scrollHeight) * track);
      const maxThumbTop = track - height;
      if (maxThumbTop <= 0) return;
      const maxScroll = scrollHeight - clientHeight;
      el.scrollTop = Math.max(0, Math.min(maxScroll, startScrollTop + ((ev.clientY - startY) / maxThumbTop) * maxScroll));
    };
    const up = () => {
      setDragging(false);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  };

  // Bord de référence : le plus proche ancêtre `[data-scroll-edge]` (panneau de verre). S'il existe,
  // le curseur est posé à côté de SON bord droit et non de celui de la zone ; comme ces panneaux
  // rognent leur contenu (overflow: hidden), il est dessiné dans le body (position: fixed) et suit
  // le panneau image par image (déformation, glissement) avec son opacité.
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setEdge(rootRef.current?.closest<HTMLElement>('[data-scroll-edge]') ?? null);
  }, []);

  const thumbTop = thumb?.top ?? 0;
  useEffect(() => {
    if (!edge || !thumb) return;
    let raf = 0;
    const track = () => {
      const t = thumbRef.current;
      const root = rootRef.current;
      if (t && root) {
        const e = edge.getBoundingClientRect();
        const r = root.getBoundingClientRect();
        t.style.left = `${e.right + 4}px`;
        t.style.top = `${r.top + thumbTop}px`;
        let opacity = 1;
        for (let n: HTMLElement | null = edge; n; n = n.parentElement) {
          opacity *= parseFloat(getComputedStyle(n).opacity);
        }
        t.style.opacity = String(opacity);
        t.style.visibility = e.width > 0 && r.height > 0 ? 'visible' : 'hidden';
      }
      raf = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(raf);
  }, [edge, thumb !== null, thumbTop]);

  // Hors AnimatePresence, `isPresent` reste vrai : rien ne change.
  const isPresent = useIsPresent();

  const thumbEl = thumb && (
    <div
      ref={thumbRef}
      className={clsx(styles.thumb, {
        [styles.dragging]: dragging,
        [styles.fixed]: !!edge,
        [styles.leaving]: !isPresent,
      })}
      onMouseDown={onThumbDown}
      style={edge ? { height: `${thumb.height}px` } : { top: `${thumb.top}px`, height: `${thumb.height}px` }}
    />
  );

  return (
    <div ref={rootRef} className={clsx(styles.root, className)}>
      <div ref={scrollRef} className={styles.scroll} onScroll={update}>
        <div className={contentClassName}>{children}</div>
      </div>
      {edge ? thumbEl && createPortal(thumbEl, document.body) : thumbEl}
    </div>
  );
};
