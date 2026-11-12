import React from 'react';
import { GlassPanel } from '@/components/GlassPanel';
import { ApexSlider } from '@/components/ApexSlider';
import { AMS_BASE_SPOOLS, AMS_HOVER_SPOOLS, AMS_MAX_SPOOLS } from './amsLayout';
import { AmsWithDialogs } from './AmsWithDialogs';
import { updateAmsEntries, useAmsEntries } from './amsStore';
import { resizeEntries } from './amsSpoolsState';
import styles from './AmsPanel.module.scss';

const QUICK_COUNTS = [1, 4, 8, 12, AMS_MAX_SPOOLS];

const CountSelector: React.FC<{ count: number; onChange: (n: number) => void }> = ({ count, onChange }) => (
  <div className={styles.sub}>
    <div className={styles.heading}>Nombre de bobines</div>
    <div className={styles.readout}>{count}</div>
    <ApexSlider
      value={count}
      onChange={onChange}
      min={1}
      max={AMS_MAX_SPOOLS}
      step={1}
      defaultValue={4}
      format={(v) => String(Math.round(v))}
      ariaLabel="Nombre de bobines"
    />
    <div className={styles.chips}>
      {QUICK_COUNTS.map((n) => (
        <button key={n} type="button" className={n === count ? styles.chipActive : styles.chip} onClick={() => onChange(n)}>
          {n}
        </button>
      ))}
    </div>
    <p className={styles.note}>
      L'AMS montre {AMS_BASE_SPOOLS} emplacements ; le « + » de fin compte comme une bobine. Au-delà, le dernier s'estompe au bout ;
      survolez l'AMS pour le développer (jusqu'à {AMS_HOVER_SPOOLS}). Plus loin, le bout reste estompé. Cliquer la partie basse affiche tous
      les filaments.
    </p>
  </div>
);

/**
 * Onglet Dev : grand panneau de verre, sous-panneau du nombre de bobines en haut à gauche et l'AMS dessous (le même AMS,
 * le même contenu partagé que dans Préparation).
 */
export const AmsPanel: React.FC = () => {
  const entries = useAmsEntries();
  return (
    <GlassPanel portal className={styles.board} contentClassName={styles.boardContent}>
      <CountSelector count={entries.length} onChange={(n) => updateAmsEntries((list) => resizeEntries(list, Math.round(n)))} />
      <AmsWithDialogs />
    </GlassPanel>
  );
};
