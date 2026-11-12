import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { usePortalRoot } from '@/components/GpuWarningFrame';
import { onApex } from '@/events/apexEvents';
import styles from './AmsOverlays.module.scss';

/**
 * Calque flouté qui recouvre toute l'interface (y compris le bandeau d'aide du bas, d'où le rappel du texte de bas
 * d'écran en bas du calque). Un clic dessus, hors de son contenu, ou Échap (si `active`) le ferme. `level` 2 passe
 * au-dessus d'un premier calque (la fiche technique ouverte depuis le panneau de tous les filaments).
 */
export const AmsBackdrop: React.FC<{
  onClose: () => void;
  active?: boolean;
  level?: 1 | 2;
  children: React.ReactNode;
}> = ({ onClose, active = true, level = 1, children }) => {
  const portalRoot = usePortalRoot();
  const [tip, setTip] = useState('');
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const offSet = onApex('apex-set-tooltip', (t) => setTip(t.desc));
    const offReset = onApex('apex-reset-tooltip', () => setTip(''));
    return () => {
      window.removeEventListener('keydown', onKey);
      offSet();
      offReset();
    };
  }, [active, onClose]);

  return createPortal(
    <motion.div
      className={clsx(styles.backdrop, level === 2 && styles.level2)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
      {active && tip && <div className={styles.tipEcho}>{tip}</div>}
    </motion.div>,
    portalRoot,
  );
};
