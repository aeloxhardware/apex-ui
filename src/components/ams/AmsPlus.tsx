import React from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { SLOT_HIDDEN, SLOT_TRANSITION } from './amsMotion';
import type { AmsLayout } from './amsLayout';
import { AmsSpoolFace, type GhostSpool } from './AmsSpoolFace';
import { bottomTip } from '@/components/edit-node/bottomTooltip';
import { ADD_MATERIAL_TIP } from '@/utils/amsTooltips';
import styles from './AmsBox.module.scss';

/** Une bobine voisine du bouton et la position (px, depuis le CENTRE du bouton) de son bord le plus proche. */
interface PlusNeighbor {
  spool: GhostSpool;
  edge: number;
}

interface AmsPlusButtonProps {
  /** Largeur d'une bobine, px. */
  size: number;
  /** Bobine à gauche : `edge` = position de son bord DROIT. */
  left: PlusNeighbor;
  /** Bobine à droite : `edge` = position de son bord GAUCHE. */
  right: PlusNeighbor;
  onAdd: (anchor: HTMLElement) => void;
}

/**
 * Bouton « + » ENTRE DEUX BOBINES : ajouter un matériau de la bibliothèque à cet endroit de l'AMS. Son flou est une COPIE des bobines
 * voisines, floutée (`filter: blur`) et découpée en rond : pas de `backdrop-filter`, qui ne s'applique pas partout.
 */
export const AmsPlusButton: React.FC<AmsPlusButtonProps> = ({ size, left, right, onAdd }) => (
  <button
    type="button"
    className={styles.plus}
    aria-label="Ajouter un matériau"
    {...bottomTip('Ajouter un matériau', ADD_MATERIAL_TIP)}
    onClick={(e) => onAdd(e.currentTarget)}
  >
    <span className={styles.plusBlur} aria-hidden>
      <span className={styles.plusGhosts}>
        <span className={styles.ghost} style={{ left: left.edge - size, width: size }}>
          <AmsSpoolFace {...left.spool} />
        </span>
        <span className={styles.ghost} style={{ left: right.edge, width: size }}>
          <AmsSpoolFace {...right.spool} />
        </span>
      </span>
    </span>
    <Plus size={15} strokeWidth={2.4} />
  </button>
);

/**
 * « + » de fin de rangée : un EMPLACEMENT de bobine vide, avec juste un « + » blanc. Il compte comme une bobine dans la
 * mise en page (largeur, fondu du bout, développement au survol) ; seul son contenu diffère.
 */
export const AmsAddSlot: React.FC<{ layout: AmsLayout; onAdd: (anchor: HTMLElement) => void }> = ({ layout, onAdd }) => (
  <motion.div
    className={styles.addSlot}
    initial={SLOT_HIDDEN}
    animate={{ width: layout.size, marginLeft: layout.gap, opacity: 1 }}
    exit={SLOT_HIDDEN}
    transition={SLOT_TRANSITION}
  >
    <button
      type="button"
      className={styles.addSlotButton}
      aria-label="Ajouter un matériau"
      {...bottomTip('Ajouter un matériau', ADD_MATERIAL_TIP)}
      onClick={(e) => onAdd(e.currentTarget)}
    >
      <Plus size={26} strokeWidth={2.2} />
    </button>
  </motion.div>
);
