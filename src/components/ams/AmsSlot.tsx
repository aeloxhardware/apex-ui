import React, { useRef, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import clsx from 'clsx';
import { User } from '@/lib/icons';
import { AmsPlusButton } from './AmsPlus';
import { AmsSpoolFace, type GhostSpool } from './AmsSpoolFace';
import { SLOT_HIDDEN, SLOT_TRANSITION } from './amsMotion';
import type { AmsLayout } from './amsLayout';
import { bottomTip } from '@/components/edit-node/bottomTooltip';
import { spoolSlotTip } from '@/utils/amsTooltips';
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
  /** Poubelle (le « + » de fin) : sa position, si la bobine glissée en est proche, et le retrait au relâchement. */
  trashRef: React.RefObject<HTMLElement>;
  near: boolean;
  onDragState: (dragging: boolean, near: boolean) => void;
  onRemove: (id: string) => void;
}

/** Le pointeur (en `x`,`y` dans la page) est-il DANS la poubelle ? */
function nearTrash(trash: HTMLElement | null, x: number, y: number): boolean {
  if (!trash) return false;
  const r = trash.getBoundingClientRect();
  const px = x - window.scrollX;
  const py = y - window.scrollY;
  return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
}

/**
 * Une bobine de l'AMS : se glisse pour changer de place (donc de numéro), un clic ouvre la fiche de son profil ; les
 * joues sont bleues et une icône « personne » apparaît au survol quand le profil a été modifié par l'utilisateur ; un
 * « + » apparaît entre elle et la précédente quand on passe entre les deux.
 */
export const AmsSlot: React.FC<AmsSlotProps> = ({ self, prev, index, layout, onOpen, onAdd, trashRef, near, onDragState, onRemove }) => {
  const { entry, profile } = self;
  const controls = useDragControls();
  const dragged = useRef(false);
  const nearRef = useRef(false);
  const [held, setHeld] = useState(false);
  const tip = profile ? bottomTip(materialNameOf(profile), spoolSlotTip(profile)) : {};
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
      whileDrag={near ? { scale: 0.8, zIndex: 5 } : { scale: 1.06, zIndex: 5 }}
      onDragStart={() => {
        dragged.current = true;
        nearRef.current = false;
        setHeld(true);
        onDragState(true, false);
      }}
      onDrag={(_, info) => {
        const now = nearTrash(trashRef.current, info.point.x, info.point.y);
        if (now === nearRef.current) return;
        nearRef.current = now;
        onDragState(true, now);
      }}
      onDragEnd={() => {
        const drop = nearRef.current;
        nearRef.current = false;
        onDragState(false, false);
        setHeld(false);
        if (drop) onRemove(entry.id);
        setTimeout(() => {
          dragged.current = false;
        }, 0);
      }}
    >
      <div
        className={clsx(styles.spoolBody, held && styles.held)}
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
