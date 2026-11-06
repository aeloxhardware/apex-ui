import React from 'react';
import clsx from 'clsx';
import styles from '../CategoriesSidebar.module.scss';
import { motion } from 'framer-motion';
import { FROM_PREVIEW_FADE_MS } from '@/utils/spaceMorphGeometry';
import type { PreviewTabId } from '@/components/PreviewUpperTabs';

interface PreviewPanelsProps {
  previewMorphPhase: "forward" | "reverse";
  tabMorph: "cascade" | "absorb" | "release";
  editionLayout: boolean;
  previewUpperContent: React.ReactNode;
  tab: PreviewTabId;
  leavingToModeling: boolean;
  lowerKey: number;
  lowerRef: React.RefObject<HTMLDivElement>;
  wasInitialPreviewActive: boolean;
  previewLowerHeader: React.ReactNode;
  previewLowerContent: React.ReactNode;
  previewBelowContent: React.ReactNode;
}

/** Panneaux du haut et du bas de l'espace Prévisualisation. */
export function PreviewPanels({ previewMorphPhase, tabMorph, editionLayout, previewUpperContent, tab, leavingToModeling, lowerKey, lowerRef, wasInitialPreviewActive, previewLowerHeader, previewLowerContent, previewBelowContent }: PreviewPanelsProps) {
  return (
    <React.Fragment>
      <div
        data-scroll-edge
        data-apex-tooltip="Panneau de l'espace Prévisualisation : onglets Coloration, Édition et Fonction pour analyser et modifier le G-code affiché."
        className={clsx(styles.previewPanelUpper, {
          [styles.morphing]: previewMorphPhase === 'reverse' || tabMorph === 'absorb' || tabMorph === 'release',
          [styles.previewPanelUpperExpanded]: editionLayout,
        })}
      >
        {/* Le contenu s'efface dès le clic vers Modélisation : seule la forme du panneau est
            reprise par ModelingSidebar. */}
        {previewUpperContent && (
          <motion.div
            className={clsx(styles.previewPanelBody, {
              // Le contenu de l'onglet n'apparaît qu'une fois le panneau à sa forme finale.
              [styles.previewPanelBodyWaiting]: tabMorph !== null || (tab === 'edition') !== editionLayout,
            })}
            animate={{ opacity: leavingToModeling ? 0 : 1 }}
            transition={{ duration: FROM_PREVIEW_FADE_MS / 1000, ease: 'easeInOut' }}
          >
            {previewUpperContent}
          </motion.div>
        )}
      </div>
      {/* Fusionné dans le panneau du haut en mode Édition : démonté, puis remonté (ses éléments
          réapparaissent en cascade) au retour à Coloration. */}
      {(!editionLayout || tabMorph === 'cascade' || tabMorph === 'absorb') && (
        <motion.div
          key={`lower-${lowerKey}`}
          ref={lowerRef}
          data-apex-tooltip="Panneau d'informations du G-code affiché : légende et réglages d'affichage du tracé."
          className={clsx(styles.previewPanelLower, {
            [styles.morphing]: previewMorphPhase === 'reverse' || tabMorph === 'absorb',
          })}
          initial={wasInitialPreviewActive && lowerKey === 0 ? { opacity: 0, x: -20 } : false}
          animate={{
            opacity: leavingToModeling ? 0 : 1,
            x: leavingToModeling ? -20 : 0,
            transition: { duration: FROM_PREVIEW_FADE_MS / 1000, ease: 'easeInOut' },
          }}
        >
          {previewLowerHeader && <div className={styles.previewPanelHeader} data-cascade="header">{previewLowerHeader}</div>}
          {previewLowerContent && <div className={styles.previewPanelFooter} data-cascade="footer">{previewLowerContent}</div>}
        </motion.div>
      )}
      {/* Opacité seule (jamais de transform) : le contenu est en `position: fixed`. */}
      {previewBelowContent && (
        <motion.div
          className={clsx(styles.previewBelow, { [styles.morphing]: previewMorphPhase === 'reverse' })}
          animate={{ opacity: leavingToModeling ? 0 : 1 }}
          transition={{ duration: FROM_PREVIEW_FADE_MS / 1000, ease: 'easeInOut' }}
        >
          {previewBelowContent}
        </motion.div>
      )}
    </React.Fragment>
  );
}
