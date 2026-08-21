import React from 'react';
import styles from './PrinterDetailModal.module.scss';
import { Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface PrinterDetailModalProps {
  printerName: string | null;
  onClose: () => void;
  onSelect: (printerName: string) => void;
}

export const PrinterDetailModal: React.FC<PrinterDetailModalProps> = ({ printerName, onClose, onSelect }) => {
  const isAetheris = !!printerName && printerName.toLowerCase().includes('aetheris');

  const boxVariants = {
    initial: { opacity: 0, scale: 0.95, x: -10 },
    animate: { opacity: 1, scale: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
  };
  const transition = { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };
  const exitTransition = { opacity: { duration: 0.2, ease: 'linear' as const }, x: { duration: 0.2, ease: 'easeInOut' as const } };

  return (
    <AnimatePresence>
      {isAetheris && (
    <div className={styles.container}>
      <motion.div className={styles.headerBox} {...boxVariants} transition={transition} exit={{ ...boxVariants.exit, transition: exitTransition }}>
        <div className={styles.headerTitle}>
          <Info size={16} className="text-[#00f0ff]" />
          <span>Fiche Technique : {printerName}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          <X size={14} />
        </button>
      </motion.div>

      <motion.div className={styles.imageBox} {...boxVariants} transition={{ ...transition, delay: 0.03 }} exit={{ ...boxVariants.exit, transition: exitTransition }}>
        <div className={styles.imageContainer}>
          <img src="/aetheris-4-preview.png" alt="Aetheris-4" onError={(e) => {
            // Fallback placeholder if image doesn't exist
            (e.target as HTMLElement).style.display = 'none';
          }} />
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400 font-orbitron bg-neutral-900/80">
            Aetheris-4 3D Printer
          </div>
        </div>
      </motion.div>

      <motion.div className={styles.infoBox} {...boxVariants} transition={{ ...transition, delay: 0.06 }} exit={{ ...boxVariants.exit, transition: exitTransition }}>
        <div className={styles.infoList}>
          <div className={styles.infoRow}>
            <span className={styles.label}>Support 4 axes :</span>
            <span className={`${styles.value} ${styles.yes}`}>OUI</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Support multicouleur :</span>
            <span className={`${styles.value} ${styles.no}`}>NON</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Forme de plateau :</span>
            <span className={styles.value}>Circulaire</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Cinématique :</span>
            <span className={styles.value}>Polaire à plan de fabrication dynamique</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Volume d'impression :</span>
            <span className={styles.value}>250 (R) × 140 (H) mm</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Température max. buse :</span>
            <span className={styles.value}>280 °C</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Température max. plateau :</span>
            <span className={styles.value}>80 °C</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Vitesse d'impression max. :</span>
            <span className={styles.value}>150 mm/s</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Nivellement automatique :</span>
            <span className={`${styles.value} ${styles.yes}`}>OUI</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Connectivité :</span>
            <span className={styles.value}>Wi-Fi, carte SD</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Chambre fermée :</span>
            <span className={`${styles.value} ${styles.no}`}>NON</span>
          </div>
        </div>
      </motion.div>

      <motion.button
        className={styles.selectBtn}
        onClick={() => printerName && onSelect(printerName)}
        {...boxVariants}
        transition={{ ...transition, delay: 0.09 }}
        exit={{ ...boxVariants.exit, transition: exitTransition }}
      >
        Sélectionner cette imprimante
      </motion.button>
    </div>
      )}
    </AnimatePresence>
  );
};
