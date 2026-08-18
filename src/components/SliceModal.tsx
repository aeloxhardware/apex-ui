import React from 'react';
import styles from './SliceModal.module.scss';
import { Play, X } from 'lucide-react';
import { motion } from 'framer-motion';

interface SliceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const SliceModal: React.FC<SliceModalProps> = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;

  return (
    <div className={styles.backdrop}>
      <motion.div 
        className={styles.modalCard}
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.header}>
          <div className={styles.title}>
            <Play size={16} className="fill-current text-[#00f0ff]" />
            <span>Lancer la découpe (Slicing)</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <p>
            Voulez-vous lancer le calcul complet des trajectoires G-code pour le plateau d'impression actuel ?
          </p>

          <div className={styles.statsGrid}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Temps estimé :</span>
              <span className={styles.statValue}>2h 14m</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Consommation fil :</span>
              <span className={styles.statValue}>28.4 g (9.5 m)</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Hauteur de couche :</span>
              <span className={styles.statValue}>0.2 mm</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Nombre de couches :</span>
              <span className={styles.statValue}>240 couches</span>
            </div>
          </div>
        </div>
      </motion.div>

      <div className={styles.externalButtonsContainer}>
        <button className={styles.cancelBtn} onClick={onClose}>
          Annuler
        </button>
        <button className={styles.confirmBtn} onClick={onConfirm}>
          Lancer le Slicing
        </button>
      </div>
    </div>
  );
};