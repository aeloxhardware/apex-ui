import React, { useMemo, useState } from 'react';
import styles from './EditionPanel.module.scss';

export const fmtSigned = (v: number, digits: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
export const fmtMm = (v: number) => v.toFixed(3).replace('.', ',');

/** Champ numérique : texte libre pendant la saisie, valeur du noyau sinon ; Entrée valide, Tab applique l'aperçu. */
export const NumberField: React.FC<{
  value: number | undefined;
  digits: number;
  className?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
  signed?: boolean;
  onCommit: (value: number, enter: boolean) => void;
}> = ({ value, digits, className, disabled, min, max, step, ariaLabel, signed, onCommit }) => {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === undefined || !Number.isFinite(value) ? '' : signed ? fmtSigned(value, digits) : value.toFixed(digits));
  const finish = (enter: boolean) => {
    if (text === null) return;
    const parsed = parseFloat(text.replace(',', '.').replace('−', '-'));
    setText(null);
    if (Number.isFinite(parsed) && (min === undefined || parsed >= min) && (max === undefined || parsed <= max)) {
      onCommit(parsed, enter);
    }
  };
  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      disabled={disabled}
      value={shown}
      step={step}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { finish(true); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { setText(null); e.currentTarget.blur(); }
        e.stopPropagation();
      }}
      onBlur={() => finish(false)}
    />
  );
};

/** Courbe de l'écart tête / normale le long de la zone jugée (échantillonnée par le noyau). */
export const NormalGraph: React.FC<{ indices: Uint32Array; values: Float32Array; worst: number }> = ({ indices, values, worst }) => {
  const path = useMemo(() => {
    const n = values.length;
    if (n < 2) return '';
    const top = Math.max(5, Math.ceil(worst / 5) * 5);
    const i0 = indices[0], i1 = indices[n - 1];
    const span = Math.max(1, i1 - i0);
    let d = '';
    for (let i = 0; i < n; i++) {
      const x = ((indices[i] - i0) / span) * 100;
      const y = 40 - (Math.min(values[i], top) / top) * 38;
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    return d;
  }, [indices, values, worst]);
  if (!path) return <div className={styles.help}>Pas assez de points pour tracer l’écart.</div>;
  const top = Math.max(5, Math.ceil(worst / 5) * 5);
  return (
    <div className={styles.graphWrap}>
      <svg className={styles.graph} viewBox="0 0 100 42" preserveAspectRatio="none" role="img" aria-label="Écart entre l’axe de tête et la normale de couche">
        <line x1="0" y1="40" x2="100" y2="40" className={styles.graphAxis} />
        <path d={path} className={styles.graphLine} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={styles.graphMax}>{top}°</span>
    </div>
  );
};
