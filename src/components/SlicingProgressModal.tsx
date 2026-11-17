import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import styles from './SlicingProgressModal.module.scss';
import { Loader2, Play } from '@/lib/icons';
import { ImportantBox } from './ImportantBox';
import { sliceController } from '@/utils/sliceController';
import { SlicingStepItem } from './SlicingStepItem';
import { SlicingConfirmCancel } from './SlicingConfirmCancel';

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

  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const closeNow = () => {
    setConfirmingCancel(false);
    if (slice.phase === 'running') void sliceController.cancel();
    else sliceController.reset();
    onClose();
  };

  // Annuler un tranchage en cours demande confirmation ; fermer un échec non.
  const handleClose = () => {
    if (slice.phase === 'running') setConfirmingCancel(true);
    else closeNow();
  };

  // La confirmation n'a plus lieu d'être dès que le tranchage n'est plus en cours.
  useEffect(() => {
    if (slice.phase !== 'running') setConfirmingCancel(false);
  }, [slice.phase]);

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

  // Fin du tranchage : on passe directement à la Prévisualisation, sans bouton intermédiaire.
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  useEffect(() => {
    if (isOpen && isDone) onFinishedRef.current();
  }, [isOpen, isDone]);

  if (!isOpen) return null;

  return (
    <ImportantBox
      icon={<Play size={16} className="fill-current text-[#f59e0b]" />}
      title="Découpe des modèles en cours"
      onClose={handleClose}
      footer={<>
        {confirmingCancel && (
          <SlicingConfirmCancel onConfirm={closeNow} onKeepGoing={() => setConfirmingCancel(false)} />
        )}
        {!isDone && !confirmingCancel && (
          <button className={styles.cancelBtn} onClick={handleClose}>
            {isFailed ? 'Fermer' : 'Annuler'}
          </button>
        )}
      </>}
    >
      {steps.length === 0 && !isFailed && (
        <div className={`${styles.stepRow} ${styles.startingRow}`}>
          <span className={styles.startingSpinner}><Loader2 size={16} /></span>
          <span className={styles.stepLabel}>Démarrage du moteur…</span>
        </div>
      )}
      <div className={styles.stepList}>
        {steps.map((step, index) => (
          <SlicingStepItem
            key={step.slug}
            slug={step.slug}
            label={step.label}
            status={statuses[index] ?? 'pending'}
            fraction={slice.fraction}
            substeps={slice.substeps[step.slug]}
            itemRef={(el) => { itemRefs.current[index] = el; }}
          />
        ))}
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
    </ImportantBox>
  );
};
