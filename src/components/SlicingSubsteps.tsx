import React from 'react';
import styles from './SlicingProgressModal.module.scss';
import { STEP_SUBSTEPS } from '@/utils/sliceStepLabels';

interface SlicingSubstepsProps {
  /** Étape parente (identifiant du moteur). */
  stepSlug: string;
  /** Fractions réelles déjà rapportées par le moteur (sous-étape → 0..1) ; `undefined` : le moteur n'en annonce pas. */
  fractions: Record<string, number> | undefined;
  /** L'étape parente est terminée : toutes ses sous-barres sont pleines. */
  stepDone: boolean;
}

// Petites barres tabulées sous une étape. Rien n'est affiché tant que le moteur n'a rien rapporté pour elle (TetGen ne
// publie pas de sous-étapes) ; ensuite chaque barre suit le travail réel de sa sous-étape, jamais une part de la barre mère.
export const SlicingSubsteps: React.FC<SlicingSubstepsProps> = ({ stepSlug, fractions, stepDone }) => {
  const substeps = STEP_SUBSTEPS[stepSlug];
  if (!substeps || !fractions) return null;
  return (
    <div className={styles.subList}>
      {substeps.map((sub) => {
        const fraction = stepDone ? 1 : (fractions?.[sub.slug] ?? 0);
        const finished = fraction >= 1;
        return (
          <div key={sub.slug} className={`${styles.subItem} ${fraction <= 0 ? styles.subPending : ''}`}>
            <span className={styles.subName}>{sub.label}</span>
            <div className={styles.subTrack}>
              <div
                className={`${styles.stepBarFill} ${finished ? styles.stepBarDone : ''}`}
                style={{ width: `${Math.round(fraction * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
