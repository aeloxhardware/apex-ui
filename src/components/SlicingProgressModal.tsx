import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import styles from './SlicingProgressModal.module.scss';
import { Check, Loader2, Play, X } from 'lucide-react';
import { sliceController } from '@/utils/sliceController';

interface SlicingProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFinished: () => void;
}

const SLIDE_MS = 550;
const SLIDE_BUMP_PX = 5;
const CASCADE_MS = 70;

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

  // État de chaque étape et avancement de sa barre : uniquement ce que le moteur a annoncé.
  const stepStatus = (index: number): 'done' | 'running' | 'pending' | 'error' => {
    if (isDone || index < slice.stepIndex) return 'done';
    if (index === slice.stepIndex && slice.phase === 'running') return 'running';
    // L'étape en cours au moment de l'échec (pas celle d'une annulation volontaire).
    if (index === slice.stepIndex && slice.phase === 'failed' && slice.steps.length > 0) return 'error';
    return 'pending';
  };

  const statuses = steps.map((_, index) => stepStatus(index));
  const statusKey = statuses.join(',');

  // Étapes qui s'enchaînent trop vite pour glisser (durée de la transition CSS) : une petite
  // vague de SLIDE_BUMP_PX les traverse quand même, en cascade.
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const prevStatuses = useRef<string[]>([]);
  const runningSince = useRef<number[]>([]);
  useEffect(() => {
    const prev = prevStatuses.current;
    const now = performance.now();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cascade = 0;
    statuses.forEach((status, index) => {
      const before = prev[index];
      if (status === 'running' && before !== 'running') runningSince.current[index] = now;
      if (status !== 'done' || before === undefined || before === 'done') return;
      const tooFast = before === 'pending' || now - (runningSince.current[index] ?? now) < SLIDE_MS;
      if (!tooFast || reduceMotion) return;
      itemRefs.current[index]?.animate(
        [
          { transform: 'translateX(0)' },
          { transform: `translateX(${SLIDE_BUMP_PX}px)`, offset: 0.4 },
          { transform: 'translateX(0)' },
        ],
        { duration: SLIDE_MS, delay: cascade * CASCADE_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
      cascade += 1;
    });
    prevStatuses.current = statuses;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [statusKey]);

  if (!isOpen) return null;

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
              const status = statuses[index];
              const fraction = status === 'done' ? 1 : status === 'running' ? slice.fraction : 0;
              return (
                <div
                  key={step.slug}
                  ref={(el) => { itemRefs.current[index] = el; }}
                  className={`${styles.stepItem} ${status === 'pending' ? styles.stepPending : ''} ${status === 'running' ? styles.stepActive : ''}`}
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
