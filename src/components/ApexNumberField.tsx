import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import styles from './ApexNumberField.module.scss';

// Sélecteur numérique par défaut d'Apex : tout réglage numérique saisi au clavier doit l'utiliser, jamais un
// champ numérique brut du navigateur, dont les flèches (blanches, collées à la valeur, visibles au survol
// seulement) jurent avec le reste de l'interface. Ici : valeur à droite, deux flèches toujours visibles, maintien
// pour répéter, ↑ / ↓ au clavier, virgule ou point décimal, validation à Entrée ou en quittant le champ.

export interface ApexNumberFieldProps {
  /** `null` : aucune valeur (champ vide, seulement si `nullable`). */
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number | undefined;
  max?: number | undefined;
  /** Pas des flèches et du clavier (défaut 1). */
  step?: number | undefined;
  /** Un champ vidé donne `null` au lieu de revenir à la valeur précédente. */
  nullable?: boolean;
  placeholder?: string | undefined;
  /** Unité affichée à droite de la valeur (hors saisie). */
  suffix?: string | undefined;
  ariaLabel?: string | undefined;
  className?: string | undefined;
}

const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 70;

const decimalsOf = (x: number) => {
  const s = String(x);
  return s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
};

const format = (v: number | null) => (v === null ? '' : v.toLocaleString('fr-FR', { useGrouping: false, maximumFractionDigits: 6 }));

export const ApexNumberField: React.FC<ApexNumberFieldProps> = ({
  value, onChange, min, max, step = 1, nullable = false, placeholder, suffix, ariaLabel, className,
}) => {
  const [draft, setDraft] = useState<string | null>(null); // texte en cours de saisie, null hors saisie
  const timers = useRef<{ delay?: number; repeat?: number }>({});
  const latest = useRef({ value, min, max, step, onChange });
  latest.current = { value, min, max, step, onChange };

  const stepBy = (direction: 1 | -1) => {
    const c = latest.current;
    const base = c.value ?? c.min ?? 0;
    const next = Number((base + direction * c.step).toFixed(Math.max(decimalsOf(c.step), decimalsOf(base))));
    c.onChange(Math.min(c.max ?? Infinity, Math.max(c.min ?? -Infinity, next)));
  };

  const stopRepeat = () => {
    window.clearTimeout(timers.current.delay);
    window.clearInterval(timers.current.repeat);
  };
  useEffect(() => stopRepeat, []);
  const startRepeat = (direction: 1 | -1) => {
    stepBy(direction);
    stopRepeat();
    timers.current.delay = window.setTimeout(() => {
      timers.current.repeat = window.setInterval(() => stepBy(direction), REPEAT_INTERVAL_MS);
    }, REPEAT_DELAY_MS);
  };

  const commit = (text: string) => {
    setDraft(null);
    const trimmed = text.trim();
    if (trimmed === '') { if (nullable) onChange(null); return; }
    const parsed = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(parsed)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed)));
  };

  const atMin = value !== null && min !== undefined && value <= min;
  const atMax = value !== null && max !== undefined && value >= max;

  return (
    <div className={clsx(styles.root, className)}>
      <input
        type="text"
        inputMode="decimal"
        className={styles.input}
        value={draft ?? format(value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onFocus={(e) => { setDraft(format(value)); e.currentTarget.select(); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(e.currentTarget.value); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            setDraft(null);
            stepBy(e.key === 'ArrowUp' ? 1 : -1);
          }
        }}
      />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
      <div className={styles.steppers}>
        <button type="button" tabIndex={-1} className={styles.stepper} aria-label="Augmenter" disabled={atMax}
          onPointerDown={(e) => { e.preventDefault(); startRepeat(1); }} onPointerUp={stopRepeat} onPointerLeave={stopRepeat} onPointerCancel={stopRepeat}>
          <ChevronUp size={12} strokeWidth={3} />
        </button>
        <button type="button" tabIndex={-1} className={styles.stepper} aria-label="Diminuer" disabled={atMin}
          onPointerDown={(e) => { e.preventDefault(); startRepeat(-1); }} onPointerUp={stopRepeat} onPointerLeave={stopRepeat} onPointerCancel={stopRepeat}>
          <ChevronDown size={12} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
};
