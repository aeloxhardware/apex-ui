import React, { useState } from 'react';
import { GlassPanel } from '@/components/GlassPanel';
import { ApexSlider } from '@/components/ApexSlider';
import { AMS_BASE_SPOOLS, AMS_HOVER_SPOOLS, AMS_MAX_SPOOLS } from './amsLayout';
import { AmsBox } from './AmsBox';
import styles from './AmsPanel.module.scss';

const QUICK_COUNTS = [1, 4, 8, 12, AMS_MAX_SPOOLS];

const CountSelector: React.FC<{ count: number; onChange: (n: number) => void }> = ({ count, onChange }) => (
  <div className={styles.sub}>
    <div className={styles.heading}>Nombre de bobines</div>
    <div className={styles.readout}>{count}</div>
    <ApexSlider value={count} onChange={onChange} min={1} max={AMS_MAX_SPOOLS} step={1} defaultValue={4}
      format={(v) => String(Math.round(v))} ariaLabel="Nombre de bobines" />
    <div className={styles.chips}>
      {QUICK_COUNTS.map((n) => (
        <button key={n} type="button" className={n === count ? styles.chipActive : styles.chip} onClick={() => onChange(n)}>{n}</button>
      ))}
    </div>
    <p className={styles.note}>
      L'AMS montre {AMS_BASE_SPOOLS} bobines. Au-delà, la dernière s'estompe au bout ; survolez l'AMS pour le développer
      (jusqu'à {AMS_HOVER_SPOOLS}). Plus loin, le bout reste estompé et un clic affiche tous les filaments.
    </p>
  </div>
);

/** Onglet Dev : grand panneau de verre, sous-panneau du nombre de bobines à gauche, rectangle de l'AMS dessous (à construire). */
export const AmsPanel: React.FC = () => {
  const [count, setCount] = useState(4);
  return (
    <GlassPanel portal className={styles.board} contentClassName={styles.boardContent}>
      <CountSelector count={count} onChange={(n) => setCount(Math.round(n))} />
      <AmsBox count={count} />
    </GlassPanel>
  );
};
