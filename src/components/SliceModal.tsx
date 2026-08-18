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
  const [is5Axes, setIs5Axes] = useState(true);
  const [modelCount, setModelCount] = useState(1);
  const [triangleCount, setTriangleCount] = useState(48200);

  useEffect(() => {
    const handleAxisChanged = (e: CustomEvent<{ mode: string }>) => {
      if (e.detail?.mode) {
        setIs5Axes(e.detail.mode === '5-axes');
      }
    };

    const handleMeshSelected = (e: CustomEvent<{ name: string | null; subMeshes?: any[] }>) => {
      if (e.detail?.name) {
        setModelCount(1);
        setTriangleCount(Math.floor(Math.random() * 60000) + 25000);
      }
    };

    window.addEventListener('apex-axis-changed', handleAxisChanged as EventListener);
    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);

    return () => {
      window.removeEventListener('apex-axis-changed', handleAxisChanged as EventListener);
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div className={styles.backdrop}>
      {is5Axes ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Boîte 1 : Le Titre */}
          <div className={styles.modalCard} style={{ width: '440px', padding: '16px 20px', gap: '0' }}>
            <div className={styles.header} style={{ borderBottom: 'none', paddingBottom: '0' }}>
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
          <div className={styles.modalCard} style={{ width: '440px', padding: '14px 20px', gap: '0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#ef4444', fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span>Attention</span>
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            </div>
          </div>

          {/* Boîte 3 : Le Texte d'avertissement */}
          <div className={styles.modalCard} style={{ width: '440px', padding: '18px 20px', gap: '0' }}>
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
        </div>
      ) : (
        <div className={styles.modalCard} style={{ width: '440px' }}>
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