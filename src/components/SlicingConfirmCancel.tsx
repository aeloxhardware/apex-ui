import React from 'react';
import styles from './SlicingProgressModal.module.scss';

interface SlicingConfirmCancelProps {
  onConfirm: () => void;
  onKeepGoing: () => void;
}

/** Question posée avant d'annuler un tranchage en cours. */
export const SlicingConfirmCancel: React.FC<SlicingConfirmCancelProps> = ({ onConfirm, onKeepGoing }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', width: '100%' }}>
    <span className={styles.stepLabel}>Êtes-vous sûr de vouloir annuler le tranchage ?</span>
    <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
      <button className={styles.cancelBtn} onClick={onConfirm}>Oui</button>
      <button className={styles.confirmBtn} onClick={onKeepGoing}>Non, continuer</button>
    </div>
  </div>
);
