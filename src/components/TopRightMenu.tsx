import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { animate, motion, useMotionValue, type AnimationPlaybackControls } from 'framer-motion';
import { GlassPanelBackdrop } from './edit-node/GlassPanelBackdrop';
import styles from './TopRightMenu.module.scss';

// Même tempo que la barre d'outils de la Sidebar au changement d'espace
// (CONTAINER_RESHAPE_DURATION = 1.1 s, immobile pendant les 45 % premiers, même courbe). Le
// déplacement se fait ensuite en L, un axe après l'autre, jamais en diagonale :
//  - vers la Prévisualisation : vers la gauche, puis vers le haut ;
//  - retour : vers le bas, puis vers la droite.
const RESHAPE_DURATION = 1.1;
const RESHAPE_TIMES = [0, 0.45, 0.725, 1];
const RESHAPE_EASE = [0.25, 1, 0.5, 1] as const;

interface Geometry {
  left: number;
  bottom: number;
  width: number;
}

const DEFAULT_TOOLTIP_DESC = "Survolez n'importe quel élément interactif de l'interface pour afficher sa description détaillée en temps réel.";

export const TopRightMenu: React.FC = () => {
  const [tooltipDesc, setTooltipDesc] = useState(DEFAULT_TOOLTIP_DESC);
  // Texte « ambiant » : celui de l'élément non interactif survolé qui porte `data-apex-tooltip`
  // (scène 3D, panneaux…), affiché dans le bandeau du bas sans bulle de souris. Un tooltip précis
  // (bouton, `CustomTooltip`, `apex-set-tooltip`) le recouvre le temps du survol, puis le bandeau
  // y revient au lieu de retomber sur le texte par défaut.
  const ambientRef = useRef<string | null>(null);
  // En Prévisualisation, la barre d'aide quitte le centre pour le coin bas gauche.
  const [previewActive, setPreviewActive] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Position de départ, mesurée juste avant le changement d'espace.
  const fromRef = useRef<Geometry | null>(null);
  const animationsRef = useRef<AnimationPlaybackControls[]>([]);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const width = useMotionValue<number | string>('auto');

  useEffect(() => {
    const handleGlobalTooltip = (e: CustomEvent<{ title: string; desc: string }>) => {
      if (e.detail) {
        setTooltipDesc(e.detail.desc);
      }
    };

    const handleResetTooltip = () => {
      setTooltipDesc(ambientRef.current ?? DEFAULT_TOOLTIP_DESC);
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest) return;
      const next = target.closest<HTMLElement>('[data-apex-tooltip]')?.dataset.apexTooltip ?? null;
      if (next === ambientRef.current) return;
      ambientRef.current = next;
      // Un élément interactif gère lui-même son texte (CustomTooltip, apex-set-tooltip).
      if (target.closest('button, label, input, select, textarea, a, [role="button"]')) return;
      setTooltipDesc(next ?? DEFAULT_TOOLTIP_DESC);
    };

    const handlePreviewToggled = (e: CustomEvent<{ active: boolean }>) => {
      const el = toolbarRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        fromRef.current = { left: r.left, bottom: window.innerHeight - r.bottom, width: r.width };
      }
      setPreviewActive(!!e.detail?.active);
    };

    window.addEventListener('apex-set-tooltip', handleGlobalTooltip as EventListener);
    window.addEventListener('apex-reset-tooltip', handleResetTooltip);
    window.addEventListener('mouseover', handleMouseOver);
    window.addEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);

    return () => {
      window.removeEventListener('apex-set-tooltip', handleGlobalTooltip as EventListener);
      window.removeEventListener('apex-reset-tooltip', handleResetTooltip);
      window.removeEventListener('mouseover', handleMouseOver);
      window.removeEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    };
  }, []);

  // Au changement d'espace, avant affichage : la barre est d'abord posée par le CSS à sa place
  // de repos dans le nouvel espace pour mesurer l'arrivée, puis le conteneur passe en
  // positionnement libre (coin bas gauche de la fenêtre) le temps de l'animation, et x / y /
  // largeur parcourent le trajet en pixels. À la fin, le CSS reprend la main à la même place.
  useLayoutEffect(() => {
    const from = fromRef.current;
    const container = containerRef.current;
    const el = toolbarRef.current;
    fromRef.current = null;
    // Largeur ajustée au texte dans les deux espaces (une ligne, bornée par `max-width` en CSS).
    const restWidth = 'auto';
    animationsRef.current.forEach((a) => a.stop());
    animationsRef.current = [];
    if (!from || !container || !el) {
      width.set(restWidth);
      return;
    }

    // framer-motion n'écrit les MotionValue dans le DOM qu'à l'image suivante : on écrit aussi le
    // style tout de suite, pour mesurer juste et basculer la classe sans image intermédiaire.
    const setNow = (xv: number, yv: number, wv: number | string) => {
      x.set(xv);
      y.set(yv);
      width.set(wv);
      el.style.transform = `translateX(${xv}px) translateY(${yv}px)`;
      el.style.width = typeof wv === 'number' ? `${wv}px` : wv;
    };

    container.classList.remove(styles.containerAnimating);
    setNow(0, 0, restWidth);
    const r = el.getBoundingClientRect();
    const to: Geometry = { left: r.left, bottom: window.innerHeight - r.bottom, width: r.width };

    container.classList.add(styles.containerAnimating);
    // Aller : horizontal puis vertical ; retour : vertical puis horizontal.
    const horizontalFirst = previewActive;
    const path = (a: number, b: number, first: boolean) => (first ? [a, a, b, b] : [a, a, a, b]);
    const transition = { duration: RESHAPE_DURATION, times: RESHAPE_TIMES, ease: RESHAPE_EASE };
    const xs = path(from.left, to.left, horizontalFirst);
    const ys = path(-from.bottom, -to.bottom, !horizontalFirst);
    const ws = path(from.width, to.width, horizontalFirst);
    setNow(xs[0], ys[0], ws[0]);

    const done = animate(x, xs, transition);
    animationsRef.current = [done, animate(y, ys, transition), animate(width, ws, transition)];
    done.then(() => {
      if (!animationsRef.current.includes(done)) return; // remplacée par une animation plus récente
      container.classList.remove(styles.containerAnimating);
      setNow(0, 0, restWidth);
    });
    // `x`, `y`, `width` sont des MotionValue stables : seul le changement d'espace compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [previewActive]);

  return (
    <div
      ref={containerRef}
      className={clsx(styles.container, previewActive && styles.containerPreview)}
      data-apex-chrome-panel
    >
      <GlassPanelBackdrop targetRef={toolbarRef} corner={20} warp={1.8} />
      <motion.div
        ref={toolbarRef}
        data-apex-tooltip="Guide pratique indiquant l'opération réalisée par l'élément couramment survolé de l'interface"
        className={clsx(styles.toolbar, styles.secondaryToolbar)}
        style={{ x, y, width }}
      >
        <div className={styles.infoDisplayBottom}>
          {tooltipDesc}
        </div>
      </motion.div>
    </div>
  );
};
