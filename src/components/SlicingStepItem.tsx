import React from 'react';
import styles from './SlicingProgressModal.module.scss';
import { Check, Loader2, X } from '@/lib/icons';
import { SlicingSubsteps } from './SlicingSubsteps';

export type StepStatus = 'done' | 'running' | 'pending' | 'error';

interface SlicingStepItemProps {
  slug: string;
  label: string;
  status: StepStatus;
  fraction: number;
  substeps: Record<string, number> | undefined;
  itemRef: (el: HTMLDivElement | null) => void;
}

const ICON_CLASS: Record<StepStatus, string> = {
  done: styles.iconDone,
  running: styles.iconRunning,
  error: styles.iconError,
  pending: styles.iconPending,
};

/** Une étape de la fenêtre de tranchage : icône d'état, nom, barre d'avancement et sous-étapes. */
export const SlicingStepItem: React.FC<SlicingStepItemProps> = ({ slug, label, status, fraction, substeps, itemRef }) => {
  const shown = status === 'done' ? 1 : status === 'running' ? fraction : 0;
  return (
    <div
      ref={itemRef}
      className={`${styles.stepItem} ${status === 'pending' ? styles.stepPending : ''} ${status === 'running' ? styles.stepActive : ''}`}
    >
      <span className={`${styles.stepIcon} ${ICON_CLASS[status]}`}>
        {status === 'done' && <Check size={13} strokeWidth={3.5} />}
        {status === 'error' && <X size={13} strokeWidth={3.5} />}
        {status === 'running' && <Loader2 size={20} />}
      </span>
      <div className={styles.stepBody}>
        <span className={styles.stepName}>{label}</span>
        <div className={styles.stepBarTrack}>
          <div
            className={`${styles.stepBarFill} ${status === 'done' ? styles.stepBarDone : ''}`}
            style={{ width: `${Math.round(shown * 100)}%` }}
          />
        </div>
        <SlicingSubsteps stepSlug={slug} fractions={substeps} stepDone={status === 'done'} />
      </div>
    </div>
  );
};
