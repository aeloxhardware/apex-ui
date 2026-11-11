import React, { useState } from 'react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { AmsSpool } from './AmsSpool';
import { AMS_SAMPLE_SPOOLS, useFilamentIndex } from './amsSamples';
import { AMS_MAX_SPOOLS, amsLayout, type AmsLayout, type AmsMetrics } from './amsLayout';
import type { FilamentProfile } from '@/utils/filamentCatalog';
import styles from './AmsBox.module.scss';

/** Texte noir sur un filament clair, blanc sur un filament sombre (luminance relative approchée). */
function labelColor(hex: string): string {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#14171c' : '#fff';
}

// Rectangle 240 × 192 px, largeur réglée sur 4 bobines (le cas le plus courant) ; la partie haute (110 px) porte les bobines.
// `maxSize` est ici la LARGEUR d'une bobine ; la hauteur est fixe (94 px, celle d'une bobine à pleine largeur) : réduire une bobine ne change que sa largeur.
const SPOOL_HEIGHT = 94;

// Ajout / retrait / changement de taille d'une bobine : sa largeur et son écart s'animent (elle se déploie ou se
// replie, les autres glissent), même courbe que le reste d'Apex.
const SLOT_HIDDEN = { width: 0, marginLeft: 0, opacity: 0 };
const SLOT_TRANSITION = { duration: 0.4, ease: [0.16, 1, 0.3, 1] } as const;
const METRICS: AmsMetrics = { caseW: 240, pad: 8, maxSize: 52, gapRatio: 0.1 };

/** Bobine et, posé dessus à la verticale, le matériau de son profil ; l'éclat de la bobine suit l'aspect du profil. */
const SpoolWithMaterial: React.FC<{ index: number; profiles: ReadonlyMap<string, FilamentProfile> }> = ({ index, profiles }) => {
  const sample = AMS_SAMPLE_SPOOLS[index % AMS_SAMPLE_SPOOLS.length];
  const profile = sample ? profiles.get(sample.key) : undefined;
  const color = sample?.color ?? '#888888';
  return (
    <>
      <AmsSpool color={color} finish={profile?.finish ?? null} />
      <span className={styles.material} style={{ color: labelColor(color) }}>{profile?.type ?? ''}</span>
    </>
  );
};

/** Une rangée de bobines (ou de leurs numéros) : mêmes largeurs, écarts et animations d'une rangée à l'autre. */
const SlotRow: React.FC<{
  slots: number[];
  layout: AmsLayout;
  slotClassName: string;
  children: (index: number) => React.ReactNode;
}> = ({ slots, layout, slotClassName, children }) => (
  <div className={styles.track}>
    <AnimatePresence initial={false}>
      {slots.map((i) => (
        <motion.div
          key={i}
          className={slotClassName}
          initial={SLOT_HIDDEN}
          animate={{ width: layout.size, marginLeft: i === 0 ? 0 : layout.gap, opacity: 1 }}
          exit={SLOT_HIDDEN}
          transition={SLOT_TRANSITION}
        >
          {children(i)}
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);

/**
 * AMS vu de face : bobines dans la partie haute, leur numéro dessous dans la partie basse (plus sombre). Il montre
 * 4 bobines ; au-delà, le bout s'estompe (masque animé par --apex-fade) et le survol allonge le boîtier, jusqu'à
 * 12 bobines. Au-delà de 12 le bout reste estompé et un clic affiche tous les filaments.
 */
export const AmsBox: React.FC<{ count: number }> = ({ count }) => {
  const [showAll, setShowAll] = useState(false);
  const layout = amsLayout(count, METRICS);
  const profiles = useFilamentIndex();
  const pinned = layout.truncated && showAll;
  const vars = {
    '--w-collapsed': `${layout.collapsedW}px`,
    '--w-expanded': `${layout.expandedW}px`,
    '--w-full': `${layout.fullW}px`,
    '--pad': `${METRICS.pad}px`,
    '--h': `${SPOOL_HEIGHT}px`,
  } as React.CSSProperties;
  const slots = Array.from({ length: Math.min(Math.max(count, 1), AMS_MAX_SPOOLS) }, (_, i) => i);
  const total = slots.length;

  return (
    <div
      className={clsx(styles.ams, layout.overflowing && styles.overflowing, layout.truncated && styles.truncated, pinned && styles.pinned)}
      style={vars}
      role={layout.truncated ? 'button' : undefined}
      tabIndex={layout.truncated ? 0 : undefined}
      onClick={layout.truncated ? () => setShowAll((v) => !v) : undefined}
      onKeyDown={layout.truncated ? (e) => { if (e.key === 'Enter' || e.key === ' ') setShowAll((v) => !v); } : undefined}
    >
      <div className={styles.top}>
        <SlotRow slots={slots} layout={layout} slotClassName={styles.slot}>
          {(i) => <SpoolWithMaterial index={i} profiles={profiles} />}
        </SlotRow>
      </div>
      <div className={styles.bottom}>
        <SlotRow slots={slots} layout={layout} slotClassName={styles.number}>{(i) => i + 1}</SlotRow>
        {layout.truncated && !pinned && (
          <div className={styles.more}>Cliquer pour afficher tous les filaments, {total} filaments au total</div>
        )}
      </div>
    </div>
  );
};
