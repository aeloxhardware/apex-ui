import React, { useEffect, useRef, useState } from 'react';
import styles from './SlicingProgressModal.module.scss';
import { Play, X } from 'lucide-react';
import { SLICING_STEPS } from './slicingSteps';

interface SlicingProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFinished: () => void;
}

// Langue/voix pour la lecture TTS des etapes (synthese vocale du navigateur).
const TTS_LANG = 'fr-FR';

// Reduction orale ciblee de "de" en "d'" pour sonner plus naturel a l'ecoute
// (le texte AFFICHE dans la modale reste inchange, seul ce qui est envoye au
// TTS est transforme). Liste explicite, pas une regle generale sur "de + mot"
// qui abregerait a tort des cas ou "de" doit rester prononce pleinement.
const ORAL_CONTRACTIONS: [RegExp, string][] = [
  [/\bde programmes\b/gi, "d'programmes"],
  [/\bde maillage\b/gi, "d'maillage"],
];

function toSpokenText(label: string): string {
  return ORAL_CONTRACTIONS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    label,
  );
}

export const SlicingProgressModal: React.FC<SlicingProgressModalProps> = ({ isOpen, onClose, onFinished }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isDone, setIsDone] = useState(false);

  const advancedRef = useRef(false);

  const advanceToNextStep = () => {
    if (advancedRef.current) return;
    advancedRef.current = true;

    setCurrentStepIndex((prev) => {
      const next = prev + 1;
      if (next >= SLICING_STEPS.length) {
        setIsDone(true);
        return prev;
      }
      return next;
    });
  };

  // Reinitialise le pipeline a chaque ouverture de la boite de dialogue.
  useEffect(() => {
    if (!isOpen) return;
    setCurrentStepIndex(0);
    setIsDone(false);
  }, [isOpen]);

  // Lit l'etape courante via la synthese vocale du navigateur (Web Speech API).
  // L'evenement 'end' natif marque la fin reelle de la lecture.
  useEffect(() => {
    if (!isOpen || isDone) return;
    if (!('speechSynthesis' in window)) {
      // TTS indisponible dans ce navigateur : ne bloque pas la sequence.
      const t = setTimeout(advanceToNextStep, 1200);
      return () => clearTimeout(t);
    }

    const step = SLICING_STEPS[currentStepIndex];
    advancedRef.current = false;

    const utterance = new SpeechSynthesisUtterance(toSpokenText(step.label));
    utterance.lang = TTS_LANG;
    utterance.onend = () => advanceToNextStep();
    utterance.onerror = () => advanceToNextStep();

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);

    return () => {
      window.speechSynthesis.cancel();
    };
  }, [isOpen, currentStepIndex, isDone]);

  // Coupe la synthese vocale a la fermeture de la boite de dialogue.
  useEffect(() => {
    if (isOpen) return;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (!isOpen) return null;

  const progressPercent = isDone
    ? 100
    : Math.round(((currentStepIndex) / SLICING_STEPS.length) * 100);

  return (
    <div className={styles.backdrop}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className={styles.modalCard} style={{ width: '440px', padding: '16px 20px', gap: '0' }}>
          <div className={styles.header} style={{ borderBottom: 'none', paddingBottom: '0' }}>
            <div className={styles.title}>
              <Play size={16} className="fill-current text-[#00f0ff]" />
              <span>Découpe des modèles en cours</span>
            </div>
            <button className={styles.closeBtn} onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className={styles.modalCard} style={{ width: '440px', padding: '18px 20px', gap: '14px' }}>
          <div className={styles.progressBarTrack}>
            <div
              className={styles.progressBarFill}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className={styles.stepRow}>
            <span className={styles.stepIndex}>
              {isDone ? SLICING_STEPS.length : currentStepIndex + 1} / {SLICING_STEPS.length}
            </span>
            <span className={styles.stepLabel}>
              {isDone
                ? "Prévisualisation prête"
                : SLICING_STEPS[currentStepIndex].label}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.externalButtonsContainer}>
        {isDone ? (
          <button className={styles.confirmBtn} onClick={onFinished}>
            Voir le résultat
          </button>
        ) : (
          <button className={styles.cancelBtn} onClick={onClose}>
            Annuler
          </button>
        )}
      </div>
    </div>
  );
};
