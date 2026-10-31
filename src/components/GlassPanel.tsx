import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, type HTMLMotionProps } from 'framer-motion';
import clsx from 'clsx';
import { usePortalRoot } from './GpuWarningFrame';
import styles from './GlassPanel.module.scss';

/**
 * Panneau latéral / boîte de dialogue en verre : à utiliser pour TOUT nouveau panneau flottant.
 *
 * Il règle une fois pour toutes ce qui se cassait panneau après panneau :
 *  - le verre (fond, flou, ombres) est un calque à part qui porte lui-même son fondu : un parent
 *    translucide ou animé en opacité désactiverait le flou de ses enfants ;
 *  - l'animation d'ouverture / fermeture (échelle 0,95 + glissement de 10 px, 0,2 s) est celle du reste d'Apex ;
 *  - le contenu a la marge (16 px), l'espacement (8 px) et le défilement sans barre natives des panneaux ;
 *  - `portal` sort le panneau de son parent : un ancêtre avec `backdrop-filter` ou `transform` fausse le flou
 *    et le positionnement `fixed` de ses descendants.
 *
 * `open` : si fourni, le panneau est monté/démonté avec son animation de sortie (AnimatePresence inclus) ;
 * sinon il est toujours monté et c'est à l'appelant de l'animer (`initial` / `animate` / `exit` surchargent).
 * Position : par `className` ou `style` de l'appelant (`position: fixed` dès que `portal` est vrai).
 */
export interface GlassPanelProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: React.ReactNode;
  open?: boolean;
  portal?: boolean;
  /** Classe du conteneur interne (marge, défilement). */
  contentClassName?: string;
  /** Sans marge interne (ex. une carte dont le contenu gère déjà la sienne). */
  flush?: boolean;
  /** Rayon des coins, px. */
  radius?: number;
}

export const GlassPanel = React.forwardRef<HTMLDivElement, GlassPanelProps>(({
  children, open, portal = false, contentClassName, flush = false, radius = 16,
  className, style, initial, animate, exit, transition, ...rest
}, ref) => {
  const portalRoot = usePortalRoot();

  const panel = (
    <motion.div
      ref={ref}
      className={clsx(styles.panel, portal && styles.fixed, className)}
      style={{ borderRadius: radius, ...style }}
      data-apex-chrome-panel
      initial={initial ?? { scale: 0.95, x: -10 }}
      animate={animate ?? { scale: 1, x: 0 }}
      exit={exit ?? { scale: 0.95, x: -10 }}
      transition={transition ?? { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      {...rest}
    >
      <motion.div
        className={styles.glass}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      />
      <motion.div
        className={clsx(styles.content, flush && styles.flush, contentClassName)}
        style={{ borderRadius: radius }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        {children}
      </motion.div>
    </motion.div>
  );

  if (open === undefined) return portal ? createPortal(panel, portalRoot) : panel;
  const presence = <AnimatePresence>{open && panel}</AnimatePresence>;
  return portal ? createPortal(presence, portalRoot) : presence;
});
GlassPanel.displayName = 'GlassPanel';
