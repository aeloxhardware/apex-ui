import React from 'react';
import styles from './EditNode.module.scss';

/**
 * Nœud d'édition du G-code (second style de poignée, cf. CLAUDE.md « Bézier-editor node »).
 * Ancré en 3D sur un point de trajectoire, dessiné en 2D par-dessus la vue : `x`/`y` sont la
 * projection écran de son ancre, en pixels, dans le repère du conteneur parent.
 *
 * Stade actuel : le cœur seul (point coloré). Le nœud développé (état actif) est en cours de
 * conception dans le banc d'essai `pnpm dev:lab-node` (src/lab/edit-node).
 */
export interface EditNodeProps {
  x: number;
  y: number;
  /** Nœud sélectionné : forme développée. */
  active: boolean;
  /** Rognage en cas de dépassement (bascule au double-clic). */
  trimming: boolean;
  onActivate?: () => void;
  onToggleTrimming?: () => void;
}

const EditNode: React.FC<EditNodeProps> = ({ x, y, active, trimming, onActivate, onToggleTrimming }) => (
  <div
    className={`${styles.node} ${active ? styles.active : ''} ${trimming ? styles.trimming : ''}`}
    style={{ transform: `translate(${x}px, ${y}px)` }}
    onClick={(e) => {
      e.stopPropagation();
      onActivate?.();
    }}
    onDoubleClick={(e) => {
      e.stopPropagation();
      onToggleTrimming?.();
    }}
  >
    <div className={styles.core} />
  </div>
);

export default React.memo(EditNode);
