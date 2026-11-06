import React from 'react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import styles from './ModelingSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { FEATURE_LABELS, type FeatureKind } from '@/modeling/types';
import { TOOLS } from './modelingData';

/**
 * Boutons d'opérations CAD, injectés par portail dans le conteneur de la barre d'outils slicer (voir Sidebar.tsx :
 * c'est LUI qui se vide / se déplace / se déforme entre les modes). Esquisse active : les autres icônes et la barre
 * de séparation disparaissent en cascade, la barre se raccourcit autour du seul bouton Esquisse et reste centrée.
 */
export const ModelingToolbar: React.FC<{
  activeTool: FeatureKind | null;
  sketchModeActive: boolean;
  handleToolClick: (kind: FeatureKind) => void;
}> = ({ activeTool, sketchModeActive, handleToolClick }) => (
<CustomTooltip
  container
  content="Outils de modélisation"
  description="Outils permettant la création et l'édition de représentations tridimensionnelles."
  wrapperStyle={{
    position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 0, padding: 6,
  }}
>
  {/* Esquisse active : les autres icônes et la barre de séparation disparaissent en cascade
      (sortie échelonnée de gauche à droite), la barre se raccourcit autour du seul bouton
      Esquisse (cf. `apex-modeling-sketch-active` dans Sidebar.tsx) et reste centrée. */}
  <AnimatePresence initial={false}>
    {TOOLS.flatMap(({ kind, icon: Icon, description }, index) => {
      if (sketchModeActive && kind !== 'sketch') return [];
      // Chaque élément se replie en largeur (et en marge) en même temps qu'il s'efface : le
      // bouton Esquisse, centré, glisse alors sans à-coup au lieu de sauter à chaque
      // démontage. L'espacement est porté par le padding de l'élément, pas par un `gap`.
      // `overflow: hidden` ne sert qu'au repli : une fois l'élément déployé il redevient visible,
      // sinon le halo (box-shadow) du bouton actif serait rogné en rectangle par l'enveloppe.
      const folded = { opacity: 0, scale: 0.6, width: 0, paddingLeft: 0, paddingRight: 0, overflow: 'hidden' };
      const shown = { opacity: 1, scale: 1, width: 'auto', paddingLeft: 2, paddingRight: 2 };
      // Apparition : après l'élargissement de la barre (ENTER_AFTER_S), en cascade et plus
      // lentement que la sortie, pour qu'elle se lise sans à-coup.
      const ENTER_AFTER_S = 0.22;
      const fade = (delay: number) => ({
        initial: folded,
        animate: {
          ...shown,
          transition: { duration: 0.42, delay: ENTER_AFTER_S + delay, ease: [0.16, 1, 0.3, 1] as const },
          transitionEnd: { overflow: 'visible' },
        },
        exit: { ...folded, transition: { duration: 0.3, delay, ease: [0.4, 0, 0.2, 1] as const } },
      });
      const items = [
        <motion.div key={kind} style={{ display: 'flex' }} {...fade(kind === 'sketch' ? 0 : index * 0.05)}>
          <CustomTooltip content={FEATURE_LABELS[kind]} description={description}>
            <button
              className={clsx(styles.barButton, { [styles.active]: activeTool === kind })}
              onClick={() => handleToolClick(kind)}
              aria-label={FEATURE_LABELS[kind]}
            >
              <Icon className="w-5 h-5" />
            </button>
          </CustomTooltip>
        </motion.div>,
      ];
      // Petite barre : l'outil Esquisse (qui ouvre sa propre boîte à outils) est à part des
      // opérations sur les corps.
      if (kind === 'sketch' && !sketchModeActive) {
        items.push(
          <motion.div key="sketch-separator" style={{ display: 'flex' }} {...fade(0.05)}>
            <div className={styles.toolSeparator} aria-hidden />
          </motion.div>,
        );
      }
      return items;
    })}
  </AnimatePresence>
</CustomTooltip>
);
