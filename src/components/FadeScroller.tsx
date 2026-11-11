import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/** Largeur de la zone qui s'estompe, px (cf. `.categoriesScroll` dans CategoriesSidebar.module.scss). */
const FADE_PX = 28;

/**
 * Défilement horizontal dont le contenu s'estompe vers le bord où il continue : le bout des textes coupés en
 * fondu dit qu'il y en a davantage. Un bord n'est estompé que s'il reste du contenu de ce côté. L'estompage est un
 * masque sur le défilement SEUL (le verre de la pilule, lui, reste net). Ses variables (`--fade-left` /
 * `--fade-right`, 0 = estompé) sont posées sans re-rendu.
 */
export const FadeScroller = forwardRef<HTMLDivElement, { className?: string; children: React.ReactNode }>(
  ({ className, children }, ref) => {
    const inner = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => inner.current as HTMLDivElement);

    useEffect(() => {
      const el = inner.current;
      if (!el) return;
      const update = () => {
        const max = el.scrollWidth - el.clientWidth;
        el.style.setProperty('--fade-left', el.scrollLeft > 1 ? '0' : '1');
        el.style.setProperty('--fade-right', max - el.scrollLeft > 1 ? '0' : '1');
        el.style.setProperty('--fade-px', `${FADE_PX}px`);
      };
      update();
      el.addEventListener('scroll', update, { passive: true });
      const observer = new ResizeObserver(update);
      observer.observe(el);
      // Les polices arrivent après le premier rendu : la largeur du contenu change sans que l'élément bouge.
      void document.fonts?.ready.then(update);
      const late = window.setTimeout(update, 600);
      return () => {
        el.removeEventListener('scroll', update);
        observer.disconnect();
        window.clearTimeout(late);
      };
    }, []);

    return <div ref={inner} className={className}>{children}</div>;
  },
);
FadeScroller.displayName = 'FadeScroller';
