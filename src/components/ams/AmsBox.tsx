import React from 'react';
import clsx from 'clsx';
import { AnimatePresence, Reorder, motion } from 'framer-motion';
import { AmsAddSlot } from './AmsPlus';
import { AmsSlot } from './AmsSlot';
import type { GhostSpool } from './AmsSpoolFace';
import { SLOT_HIDDEN, SLOT_TRANSITION } from './amsMotion';
import { AMS_MAX_SPOOLS, amsLayout, type AmsMetrics } from './amsLayout';
import type { AmsEntry } from './amsSpoolsState';
import { bottomTip } from '@/components/edit-node/bottomTooltip';
import { materialsTip } from '@/utils/amsTooltips';
import type { FilamentProfile } from '@/utils/filamentCatalog';
import styles from './AmsBox.module.scss';

// Rectangle 240 × 176 px, largeur réglée sur 4 bobines (le cas le plus courant) ; la partie haute (110 px) porte les bobines.
// `maxSize` est ici la LARGEUR d'une bobine ; la hauteur est fixe (94 px, celle d'une bobine à pleine largeur) : réduire une bobine ne change que sa largeur.
const SPOOL_HEIGHT = 94;
const METRICS: AmsMetrics = { caseW: 240, pad: 8, maxSize: 52, gapRatio: 0.1 };

export interface AmsBoxProps {
  entries: AmsEntry[];
  profiles: ReadonlyMap<string, FilamentProfile>;
  /** Glisser-déposer : nouvel ordre des identifiants (le numéro d'une bobine suit sa position). */
  onReorder: (ids: string[]) => void;
  /** Clic sur une bobine : fiche de son profil. */
  onOpenSheet: (id: string) => void;
  /** Clic sur la partie basse : tous les filaments, chacun avec sa fiche. */
  onOpenAll: () => void;
  /** « + » : ajouter un matériau à la position `at`, le menu s'ouvrant près de `anchor`. */
  onAdd: (at: number, anchor: HTMLElement) => void;
}

/** Rangée des numéros, sous les bobines : même largeur, mêmes écarts et mêmes animations que les bobines. */
const NumberRow: React.FC<{ count: number; size: number; gap: number }> = ({ count, size, gap }) => (
  <div className={styles.track}>
    <AnimatePresence initial={false}>
      {Array.from({ length: count }, (_, i) => (
        <motion.div
          key={i}
          className={styles.number}
          initial={SLOT_HIDDEN}
          animate={{ width: size, marginLeft: i === 0 ? 0 : gap, opacity: 1 }}
          exit={SLOT_HIDDEN}
          transition={SLOT_TRANSITION}
        >
          {i + 1}
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);

/**
 * AMS vu de face : bobines dans la partie haute, leur numéro dessous dans la partie basse (plus sombre, cliquable :
 * elle ouvre tous les filaments). Il montre 4 bobines ; au-delà, le bout s'estompe (masque animé par --apex-fade) et le
 * survol allonge le boîtier, jusqu'à 12 bobines. Au-delà de 12 le bout reste estompé même au survol.
 */
export const AmsBox: React.FC<AmsBoxProps> = ({ entries, profiles, onReorder, onOpenSheet, onOpenAll, onAdd }) => {
  const count = entries.length;
  // Le « + » de fin est un emplacement de bobine vide : il compte comme une bobine dans la mise en page.
  const hasAddSlot = count < AMS_MAX_SPOOLS;
  const layout = amsLayout(count + (hasAddSlot ? 1 : 0), METRICS);
  const ghosts: GhostSpool[] = entries.map((entry) => ({ entry, profile: profiles.get(entry.key) }));
  const vars = {
    '--w-collapsed': `${layout.collapsedW}px`,
    '--w-expanded': `${layout.expandedW}px`,
    '--pad': `${METRICS.pad}px`,
    '--h': `${SPOOL_HEIGHT}px`,
  } as React.CSSProperties;

  return (
    <div className={clsx(styles.ams, layout.overflowing && styles.overflowing, layout.truncated && styles.truncated)} style={vars}>
      <div className={styles.top}>
        <Reorder.Group as="div" axis="x" values={entries.map((e) => e.id)} onReorder={onReorder} className={styles.track}>
          <AnimatePresence initial={false}>
            {ghosts.map((self, i) => (
              <AmsSlot key={self.entry.id} self={self} prev={ghosts[i - 1]} index={i} layout={layout} onOpen={onOpenSheet} onAdd={onAdd} />
            ))}
          </AnimatePresence>
          <AnimatePresence initial={false}>{hasAddSlot && <AmsAddSlot layout={layout} onAdd={(el) => onAdd(count, el)} />}</AnimatePresence>
        </Reorder.Group>
      </div>
      <div
        className={styles.bottom}
        role="button"
        tabIndex={0}
        aria-label="Afficher les filaments sélectionnés"
        onClick={onOpenAll}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onOpenAll();
        }}
        {...bottomTip('Matériaux', materialsTip(count))}
      >
        <NumberRow count={count} size={layout.size} gap={layout.gap} />
        {layout.truncated && <div className={styles.more}>Cliquer pour afficher tous les filaments, {count} filaments au total</div>}
      </div>
    </div>
  );
};
