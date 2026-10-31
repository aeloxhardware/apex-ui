import React, { useSyncExternalStore } from 'react';
import styles from './SlicingProgressModal.module.scss';
import { Check, Loader2, Play, X } from 'lucide-react';
import { sliceController } from '@/utils/sliceController';

interface SlicingProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFinished: () => void;
}

// L'avancement vient uniquement des lignes de progression du moteur (cf. utils/sliceController.ts) :
// aucune minuterie ici.
export const SlicingProgressModal: React.FC<SlicingProgressModalProps> = ({ isOpen, onClose, onFinished }) => {
  const slice = useSyncExternalStore(sliceController.subscribe, sliceController.getState);
  const steps = slice.steps;
  const isDone = slice.phase === 'done';
  const isFailed = slice.phase === 'failed' || slice.phase === 'cancelled';

  const handleClose = () => {
    if (slice.phase === 'running') void sliceController.cancel();
    else sliceController.reset();
    onClose();
  };

  if (!isOpen) return null;

  // État de chaque étape et avancement de sa barre : uniquement ce que le moteur a annoncé.
  const stepStatus = (index: number): 'done' | 'running' | 'pending' | 'error' => {
    if (isDone || index < slice.stepIndex) return 'done';
    if (index === slice.stepIndex && slice.phase === 'running') return 'running';
    // L'étape en cours au moment de l'échec (pas celle d'une annulation volontaire).
    if (index === slice.stepIndex && slice.phase === 'failed' && slice.steps.length > 0) return 'error';
    return 'pending';
  };

  return (
    <div className={styles.backdrop}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className={styles.modalCard} style={{ width: '440px', padding: '16px 20px', gap: '0' }}>
          <div className={styles.header} style={{ borderBottom: 'none', paddingBottom: '0' }}>
            <div className={styles.title}>
              <Play size={16} className="fill-current text-[#00f0ff]" />
              <span>Découpe des modèles en cours</span>
            </div>
            <button className={styles.closeBtn} onClick={handleClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className={styles.modalCard} style={{ width: '440px', padding: '18px 20px', gap: '14px' }}>
          {steps.length === 0 && !isFailed && (
            <div className={`${styles.stepRow} ${styles.startingRow}`}>
              <span className={styles.startingSpinner}><Loader2 size={16} /></span>
              <span className={styles.stepLabel}>Démarrage du moteur…</span>
            </div>
          )}
          <div className={styles.stepList}>
            {steps.map((step, index) => {
              const status = stepStatus(index);
              const fraction = status === 'done' ? 1 : status === 'running' ? slice.fraction : 0;
              return (
                <div
                  key={step.slug}
                  className={`${styles.stepItem} ${status === 'pending' ? styles.stepPending : ''}`}
                >
                  <span
                    className={`${styles.stepIcon} ${
                      status === 'done' ? styles.iconDone : status === 'running' ? styles.iconRunning
                        : status === 'error' ? styles.iconError : styles.iconPending
                    }`}
                  >
                    {status === 'done' && <Check size={13} strokeWidth={3.5} />}
                    {status === 'error' && <X size={13} strokeWidth={3.5} />}
                    {status === 'running' && <Loader2 size={20} />}
                  </span>
                  <div className={styles.stepBody}>
                    <span className={styles.stepName}>{step.label}</span>
                    <div className={styles.stepBarTrack}>
                      <div
                        className={`${styles.stepBarFill} ${status === 'done' ? styles.stepBarDone : ''}`}
                        style={{ width: `${Math.round(fraction * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {isFailed && (
            <div className={styles.stepRow}>
              <span className={styles.stepLabel}>{slice.message}</span>
            </div>
          )}
          {isDone && slice.warnings.length > 0 && (
            <div className={styles.stepRow}>
              <span className={styles.stepLabel}>{slice.warnings.join(' · ')}</span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.externalButtonsContainer}>
        {isDone ? (
          <button className={styles.confirmBtn} onClick={onFinished}>
            Voir le résultat
          </button>
        ) : (
          <button className={styles.cancelBtn} onClick={handleClose}>
            {isFailed ? 'Fermer' : 'Annuler'}
          </button>
        )}
      </div>
    </div>
  );
};
