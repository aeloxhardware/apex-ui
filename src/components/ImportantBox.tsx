import React from 'react';
import { Loader2, X } from '@/lib/icons';
import styles from './ImportantBox.module.scss';

interface ImportantBoxProps {
  /** Icône devant le titre (déjà dimensionnée et colorée). */
  icon: React.ReactNode;
  title: string;
  /** Bouton de fermeture dans l'en-tête ; absent, la boîte ne se ferme pas d'elle-même. */
  onClose?: () => void;
  /** Contenu de la seconde carte, sous l'en-tête. */
  children?: React.ReactNode;
  /** Boutons sous les cartes (annuler, confirmer…). */
  footer?: React.ReactNode;
}

/**
 * Boîte d'information importante : panneau flouté derrière, une carte d'en-tête (icône, titre, croix) et une carte
 * de contenu — l'apparence de la boîte de découpe, partagée avec la boîte d'enregistrement avant fermeture.
 */
export const ImportantBox: React.FC<ImportantBoxProps> = ({ icon, title, onClose, children, footer }) => (
  <div className={styles.backdrop}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className={styles.modalCard} style={{ width: '440px', padding: '16px 20px', gap: '0' }}>
        <div className={styles.header} style={{ borderBottom: 'none', paddingBottom: '0' }}>
          <div className={styles.title}>
            {icon}
            <span>{title}</span>
          </div>
          {onClose && (
            <button className={styles.closeBtn} onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.modalCard} style={{ width: '440px', padding: '18px 20px', gap: '14px' }}>
        {children}
      </div>
    </div>
    {footer && <div className={styles.externalButtonsContainer}>{footer}</div>}
  </div>
);

/** Tourniquet pour l'en-tête d'une boîte dont l'opération est en cours. */
export const ImportantBoxSpinner: React.FC = () => (
  <span className={styles.spinner}>
    <Loader2 size={16} />
  </span>
);

/** Paragraphe de la carte de contenu. */
export const ImportantBoxText: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className={styles.text}>{children}</p>;
