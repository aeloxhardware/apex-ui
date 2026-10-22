import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePortalRoot } from './GpuWarningFrame';
import { motion } from 'framer-motion';
import { CreditsPanel } from './CreditsPanel';
import Lightfall from './Lightfall';
import { GlassPanelBackdrop } from './edit-node/GlassPanelBackdrop';
import { APP_TAGLINE_DEV, APP_TAGLINE_PREVIEW, useDevMode } from '@/utils/devModePrefs';
import styles from './HomePanel.module.scss';

/**
 * Espace Accueil : comme Paramètres, le Viewport3D est entièrement démonté (cf. Index.tsx).
 * Page d'accueil d'Apex ; les remerciements et attributions sont dans le panneau latéral.
 */
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
const AELOX_URL = 'https://aeloxhardware.com';

const notifyHomeReady = () => window.dispatchEvent(new Event('apex-home-ready'));

/** Fond de l'Accueil (remplace TopoBackground, plus coûteux en calcul). Assez léger pour rester animé même sur GPU faible. */
const HomeLightfall: React.FC = () => (
  <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', background: '#05070b' }}>
    <Lightfall dpr={1} onReady={notifyHomeReady} />
  </div>
);

export const HomePanel: React.FC = () => {
  const devMode = useDevMode();
  const portalRoot = usePortalRoot();
  const [licenseOpen, setLicenseOpen] = useState(false);
  const identityRef = useRef<HTMLDivElement>(null);
  const promiseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!licenseOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLicenseOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [licenseOpen]);

  return (
    <>
      <HomeLightfall />
      <GlassPanelBackdrop targetRef={identityRef} corner={20} warp={1} blurPx={0.55} distortion={3} whiteRim />
      <GlassPanelBackdrop targetRef={promiseRef} corner={20} warp={1} blurPx={0.55} distortion={3} whiteRim />
    <div className={styles.container}>
      <div className={styles.column}>
        <motion.div
          ref={identityRef}
          className={styles.panel}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className={styles.logo} />
          <h2 className={styles.title}>Apex Slicer Studio</h2>
          <p className={styles.tagline}>{devMode ? APP_TAGLINE_DEV : APP_TAGLINE_PREVIEW}</p>
          <p className={styles.by}>Aelox Hardware</p>
        </motion.div>
        <motion.div
          ref={promiseRef}
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
          portalRoot,
        )}
    </div>
    </>
  );
};
