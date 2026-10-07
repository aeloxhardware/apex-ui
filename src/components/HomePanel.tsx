import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { CreditsPanel } from './CreditsPanel';
import styles from './HomePanel.module.scss';

/**
 * Espace Accueil : comme Paramètres, le Viewport3D est entièrement démonté (cf. Index.tsx).
 * Page d'accueil d'Apex ; les remerciements et attributions sont dans le panneau latéral.
 */
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
const AELOX_URL = 'https://aeloxhardware.com';

export const HomePanel: React.FC = () => {
  const [licenseOpen, setLicenseOpen] = useState(false);

  useEffect(() => {
    if (!licenseOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLicenseOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [licenseOpen]);

  return (
    <div className={styles.container}>
      <div className={styles.column}>
        <motion.div
          className={styles.panel}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <img src="/logo.svg" alt="" className={styles.logo} />
          <h2 className={styles.title}>Apex Slicer Studio</h2>
          <p className={styles.tagline}>
            Openware de tranchage de modèles 3D destiné à la fabrication additive non-planaire à plan de
            construction dynamique.
          </p>
          <p className={styles.by}>Aelox Hardware</p>
        </motion.div>
        <motion.div
          className={styles.panel}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.45, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className={styles.promise}>
            Ce logiciel, ainsi que toutes ses versions, y compris les versions futures, sont{' '}
            <strong><em>et resteront</em></strong> gratuits et open-source, pour tout le monde et pour
            toujours, même pour <strong>vous</strong>, que vous soyez particulier, professionnel ou
            entreprise, comme le stipule la licence{' '}
            <button type="button" className={styles.link} onClick={() => setLicenseOpen(true)}>
              AGPL3
            </button>{' '}
            sous laquelle est enregistré ce logiciel ainsi que son code. Sachez que cette promesse est
            verrouillée dans les statuts initiaux d'
            <a className={styles.link} href={AELOX_URL} target="_blank" rel="noopener noreferrer">
              Aelox Hardware
            </a>
            , l'entreprise responsable du développement de ce logiciel, et ne pourra donc pas être
            modifiée.
          </p>
        </motion.div>
      </div>
      <CreditsPanel />
      {licenseOpen &&
        createPortal(
          <div className={styles.backdrop} onClick={() => setLicenseOpen(false)}>
            <div
              className={styles.modal}
              role="dialog"
              aria-modal="true"
              aria-label="Licence"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className={styles.modalTitle}>Licence AGPL</h3>
              <p className={styles.tagline}>
                Apex Slicer Studio et son code source sont publiés sous la GNU Affero General Public
                License. Le texte officiel et complet de la licence est consultable ici :
              </p>
              <a className={styles.link} href={LICENSE_URL} target="_blank" rel="noopener noreferrer">
                gnu.org/licenses/agpl-3.0
              </a>
              <div className={styles.modalActions}>
                <button type="button" className={styles.close} onClick={() => setLicenseOpen(false)}>
                  Fermer
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
