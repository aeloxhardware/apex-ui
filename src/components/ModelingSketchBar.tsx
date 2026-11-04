import { SKETCH_ENTITIES } from './modelingData';
import React from 'react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import styles from './ModelingSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { FinishSketchIcon } from './ModelingIcons';
import {
  SKETCH_ENTITY_LABELS,
  type FeatureKind,
  type SketchEntityKind,
} from '@/modeling/types';


export interface SketchBarProps {
  activeTool: FeatureKind | null;
  sketchEntity: SketchEntityKind | null;
  handleSketchEntity: (kind: SketchEntityKind) => void;
  handleFinishSketch: () => void;
}

export const SketchBar: React.FC<SketchBarProps> = ({ activeTool, sketchEntity, handleSketchEntity, handleFinishSketch }) => (
  <>
      <AnimatePresence initial={false}>
        {activeTool === 'sketch' && (
          <motion.div
            className={styles.sketchBar}
            data-apex-chrome-panel
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Groupe centré : la barre d'outils reste au milieu de l'écran, le bouton « Terminer
                l'esquisse » est posé sur son côté (positionné hors du flux, à droite de la barre). */}
            <div className={styles.sketchBarGroup}>
            <CustomTooltip
              inline
              container
              content="Boîte à outils Esquisse"
              description="Suite d'outils permettant la définition des contours d'une conception tridimensionnelle."
            >
            <div className={styles.sketchBarInner}>
              {SKETCH_ENTITIES.map(({ kind, icon: Icon }) => (
                <CustomTooltip
                  key={kind}
                  content={SKETCH_ENTITY_LABELS[kind]}
                  description={kind === 'rectangle' ? 'Tracer un rectangle sur la grille (aimantée).' : 'Arrive bientôt.'}
                >
                  <button
                    className={clsx(styles.barButton, { [styles.active]: sketchEntity === kind })}
                    onClick={() => handleSketchEntity(kind)}
                    disabled={kind !== 'rectangle'}
                    aria-label={SKETCH_ENTITY_LABELS[kind]}
                  >
                    <Icon className="w-5 h-5" />
                  </button>
                </CustomTooltip>
              ))}
            </div>
            </CustomTooltip>
            <CustomTooltip
              inline
              wrapperStyle={{ position: 'absolute', left: '100%', top: 0, marginLeft: 8 }}
              content="Terminer l'esquisse"
              description="Valide l'esquisse en cours et quitte l'outil Esquisse ; l'orbite de la vue est de nouveau possible."
            >
              <button
                type="button"
                className={styles.finishSketchButton}
                onClick={handleFinishSketch}
                aria-label="Terminer l'esquisse"
              >
                <FinishSketchIcon className="h-7 w-14" />
              </button>
            </CustomTooltip>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
  </>
);
