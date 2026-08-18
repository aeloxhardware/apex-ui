import React from 'react';
import styles from './PrinterDetailModal.module.scss';
import { Info, X } from 'lucide-react';
import { motion } from 'framer-motion';

interface PrinterDetailModalProps {
  printerName: string | null;
  onClose: () => void;
}

export const PrinterDetailModal: React.FC<PrinterDetailModalProps> = ({ printerName, onClose }) => {
  if (!printerName || !printerName.toLowerCase().includes('aetheris')) return null;

  return (
    <motion.div 
      className={styles.container}
      initial={{ opacity: 0, scale: 0.95, x: -10 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95, x: -10 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Info size={16} className="text-[#00f0ff]" />
          <span>Fiche Technique : {printerName}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div className={styles.content}>
        <div className={styles.imageContainer}>
          <img src="/aetheris-4-preview.png" alt="Aetheris-4" onError={(e) => {
            // Fallback placeholder if image doesn't exist
            (e.target as HTMLElement).style.display = 'none';
          }} />
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400 font-orbitron bg-neutral-900/80">
            Aetheris-4 3D Printer
          </div>
        </div>

        <div className={styles.infoList}>
          <div className={styles.infoRow}>
            <span className={styles.label}>Support 4 axes :</span>
            <span className={`${styles.value} ${styles.yes}`}>OUI</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Support multicouleur :</span>
            <span className={`${styles.value} ${styles.no}`}>NON</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};