import React, { useEffect, useState } from 'react';
import styles from './SliceModal.module.scss';
import { Play, X, AlertTriangle } from 'lucide-react';
import { getSlicingMode, slicingAlgorithmName } from '@/utils/slicingMode';

interface SliceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const SliceModal: React.FC<SliceModalProps> = ({ isOpen, onClose, onConfirm }) => {
  const [triangleCount, setTriangleCount] = useState(0);

  useEffect(() => {
    const handleSliceModels = (e: CustomEvent<{ names: string[]; triangles?: number }>) => {
      setTriangleCount(e.detail?.triangles ?? 0);
    };

    window.addEventListener('apex-slice-models', handleSliceModels as EventListener);

    return () => {
      window.removeEventListener('apex-slice-models', handleSliceModels as EventListener);
      };
  }, []);

  if (!isOpen) return null;

  const algorithmName = slicingAlgorithmName(getSlicingMode());

  return (
    <div className={styles.backdrop}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className={styles.modalCard} style={{ width: '440px', padding: '16px 20px', gap: '0' }}>
          <div className={styles.header} style={{ borderBottom: 'none', paddingBottom: '0' }}>
            <div className={styles.title}>
              <Play size={16} className="fill-current text-[#f59e0b]" />
              <span>Lancer la découpe des modèles</span>
            </div>
            <button className={styles.closeBtn} onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className={styles.attentionBox}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#ef4444', fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span>Attention</span>
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          </div>
        </div>

        <div className={styles.modalCard} style={{ width: '440px', padding: '18px 20px', gap: '0' }}>
          <div className={styles.body}>
            <p>
              Vous êtes sur le point de lancer le traitement d'un maillage triangulé contenant un total de <span className="text-white font-semibold">{triangleCount.toLocaleString('fr-FR')}</span> facettes ayant dépassé le seuil de sécurité de l'algorithme <span className="text-white font-semibold">{algorithmName}</span>. Cette demande a déclenché les systèmes de vérification de sécurité du logiciel.
            </p>
            <p>
              Selon la puissance de votre ordinateur et la complexité du maillage, cette opération peut durer plusieurs minutes, heures, voire ne jamais aboutir.
            </p>
            <p className="font-semibold text-white pt-1">
              Êtes-vous sûr de vouloir continuer?
            </p>
          </div>
        </div>
      </div>

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