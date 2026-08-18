import React, { useEffect, useState } from 'react';
import styles from './SliceModal.module.scss';
import { Play, X, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

interface SliceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const SliceModal: React.FC<SliceModalProps> = ({ isOpen, onClose, onConfirm }) => {
  const [is5Axes, setIs5Axes] = useState(false);
  const [modelCount, setModelCount] = useState(1);
  const [triangleCount, setTriangleCount] = useState(48200);

  useEffect(() => {
    const handleAxisChanged = (e: CustomEvent<{ mode: string }>) => {
      if (e.detail?.mode) {
        setIs5Axes(e.detail.mode === '5-axes');
      }
    };

    window.addEventListener('apex-axis-changed', handleAxisChanged as EventListener);
    return () => {
      window.removeEventListener('apex-axis-changed', handleAxisChanged as EventListener);
    };
  }, []);

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
        {is5Axes ? (
          <>
            {/* Boîte 1 : Le Titre */}
            <div className={styles.boxContainer}>
              <div className={styles.header}>
                <div className={styles.title}>
                  <Play size={16} className="fill-current text-[#00f0ff]" />
                  <span>Lancer la découpe des modèles</span>
                </div>
                <button className={styles.closeBtn} onClick={onClose}>
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Boîte 2 : Le Panneau Attention */}
            <div className={styles.boxContainer}>
              <div className="flex items-center justify-center gap-2 text-red-500 font-bold text-xs uppercase tracking-wider py-1">
                <AlertTriangle size={15} className="shrink-0" />
                <span>Attention</span>
                <AlertTriangle size={15} className="shrink-0" />
              </div>
            </div>

            {/* Boîte 3 : Le Texte d'avertissement */}
            <div className={styles.boxContainer}>
              <div className={styles.body}>
                <p>
                  Vous êtes sur le point de lancer une opération de tranchage de <span className="text-white font-semibold">{modelCount}</span> modèles pour un total de <span className="text-white font-semibold">{triangleCount.toLocaleString()}</span> triangles en mode 5 axes.
                </p>
                <p>
                  Selon la puissance de votre ordinateur et la complexité du maillage, cette opération peut prendre plusieurs minutes.
                </p>
                <p>
                  Vous ne pourrez plus modifier de nombreux paramètres de base.
                </p>
                <p className="font-semibold text-white pt-1">
                  Êtes-vous absolument sûr de vouloir continuer cette opération?
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.boxContainer}>
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
            </div>
          </div>
        )}
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