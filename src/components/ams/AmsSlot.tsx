import React, { useRef } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import clsx from 'clsx';
import { User } from 'lucide-react';
import { AmsPlusButton } from './AmsPlus';
import { AmsSpoolFace, type GhostSpool } from './AmsSpoolFace';
import { SLOT_HIDDEN, SLOT_TRANSITION } from './amsMotion';
import type { AmsLayout } from './amsLayout';
import { bottomTip } from '@/components/edit-node/bottomTooltip';
import { spoolTip } from '@/utils/amsTooltips';
import { materialNameOf } from '@/utils/filamentText';
import styles from './AmsBox.module.scss';

/** « + » entre la bobine et la précédente, avec un trait blanc au-dessus et au-dessous (apparaissent ensemble au survol). */
const AmsSlotPlus: React.FC<{
  index: number;
  layout: AmsLayout;
  self: GhostSpool;
  prev: GhostSpool | undefined;
  onAdd: (at: number, anchor: HTMLElement) => void;
}> = ({ index, layout, self, prev, onAdd }) =>
  index > 0 && prev ? (
    <div className={styles.plusZone} style={{ left: -layout.gap / 2 }}>
      <span className={clsx(styles.plusLine, styles.plusLineTop)} />
      <AmsPlusButton
        size={layout.size}
        left={{ spool: prev, edge: -layout.gap / 2 }}
        right={{ spool: self, edge: layout.gap / 2 }}
        onAdd={(el) => onAdd(index, el)}
      />
      <span className={clsx(styles.plusLine, styles.plusLineBottom)} />
    </div>
  ) : null;

interface AmsSlotProps {
  self: GhostSpool;
  /** Bobine précédente (à gauche), pour la copie floutée du « + » qui les sépare. */
  prev: GhostSpool | undefined;
  index: number;
  layout: AmsLayout;
  onOpen: (id: string) => void;
  /** Insère un matériau à la position `at` (0 = avant la première bobine). */
  onAdd: (at: number, anchor: HTMLElement) => void;
}

/**
 * Une bobine de l'AMS : se glisse pour changer de place (donc de numéro), un clic ouvre la fiche de son profil ; les
 * joues sont bleues et une icône « personne » apparaît au survol quand le profil a été modifié par l'utilisateur ; un
 * « + » apparaît entre elle et la précédente quand on passe entre les deux.
 */
export const AmsSlot: React.FC<AmsSlotProps> = ({ self, prev, index, layout, onOpen, onAdd }) => {
  const { entry, profile } = self;
  const controls = useDragControls();
  const dragged = useRef(false);
  const tip = profile ? bottomTip(materialNameOf(profile), spoolTip(profile)) : {};
  return (
    <Reorder.Item
      as="div"
      value={entry.id}
      className={styles.slot}
      dragListener={false}
      dragControls={controls}
      initial={SLOT_HIDDEN}
      animate={{ width: layout.size, marginLeft: index === 0 ? 0 : layout.gap, opacity: 1 }}
      exit={SLOT_HIDDEN}
      transition={SLOT_TRANSITION}
      whileDrag={{ scale: 1.06, zIndex: 5 }}
      onDragStart={() => {
        dragged.current = true;
      }}
      onDragEnd={() => {
        setTimeout(() => {
          dragged.current = false;
        }, 0);
      }}
    >
      <div
        className={styles.spoolBody}
        onPointerDown={(e) => controls.start(e)}
        onClick={() => {
          if (!dragged.current) onOpen(entry.id);
        }}
        {...tip}
      >
        <AmsSpoolFace {...self} />
        {profile?.user === true && (
          <span className={styles.person}>
            <User size={12} strokeWidth={2.2} />
          </span>
        )}
      </div>
      <AmsSlotPlus index={index} layout={layout} self={self} prev={prev} onAdd={onAdd} />
    </Reorder.Item>
  );
};
