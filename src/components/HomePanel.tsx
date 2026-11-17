import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePortalRoot } from './GpuWarningFrame';
import { motion } from 'framer-motion';
import { GlassPanel } from './GlassPanel';
import { ExternalScrollArea } from './ExternalScrollArea';
import { CreditsPanel } from './CreditsPanel';
import DigitalStorm from './DigitalStorm';
import { GlassPanelBackdrop } from './edit-node/GlassPanelBackdrop';
import { HomeProjects } from './HomeProjects';
import { ShortcutsPage } from './ShortcutsPage';
import { CustomTooltip } from './CustomTooltip';
import { ApexButton } from './apex-ui';
import { APP_TAGLINE } from '@/utils/devModePrefs';
import { emitApex } from '@/events/apexEvents';
import styles from './HomePanel.module.scss';

/**
 * Espace Accueil : comme Paramètres, le Viewport3D est entièrement démonté (cf. Index.tsx).
 * Page d'accueil d'Apex ; les remerciements et attributions sont dans le panneau latéral.
 */
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
const AELOX_URL = 'https://aeloxhardware.com';

const notifyHomeReady = () => emitApex('apex-home-ready');

/** Fond de l'Accueil : orage numérique (un seul passage WebGL, plafonné en pixels) ; il reste animé sur GPU faible. */
const HomeBackground: React.FC = () => (
  <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', background: '#02040a' }}>
    <DigitalStorm onReady={notifyHomeReady} />
  </div>
);

export const HomePanel: React.FC = () => {
  const portalRoot = usePortalRoot();
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [licenseText, setLicenseText] = useState<string | null>(null);
  const identityRef = useRef<HTMLDivElement>(null);
  const projectsRef = useRef<HTMLDivElement>(null);
  const promiseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!licenseOpen || licenseText !== null) return;
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}agpl-3.0.txt`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => !cancelled && setLicenseText(t))
      .catch(() => !cancelled && setLicenseText('Texte indisponible hors ligne. Consultez gnu.org/licenses/agpl-3.0'));
    return () => {
      cancelled = true;
    };
  }, [licenseOpen, licenseText]);

  useEffect(() => {
    if (!licenseOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLicenseOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [licenseOpen]);

  return (
    <>
      <HomeBackground />
      {shortcutsOpen ? (
        <div className={styles.container}>
          <ShortcutsPage onBack={() => setShortcutsOpen(false)} />
        </div>
      ) : (
      <>
      <GlassPanelBackdrop targetRef={identityRef} corner={20} warp={1.3} blurPx={5} distortion={8} whiteRim />
      <GlassPanelBackdrop targetRef={projectsRef} corner={20} warp={1.3} blurPx={5} distortion={8} whiteRim />
      <GlassPanelBackdrop targetRef={promiseRef} corner={20} warp={1.3} blurPx={5} distortion={8} whiteRim />
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
          <h2 className={styles.title}>Apex Studio</h2>
          <p className={styles.tagline}>{APP_TAGLINE}</p>
          <p className={styles.by}>Aelox Hardware</p>
          <CustomTooltip inline content="Raccourcis" description="Ouvre la liste de tous les raccourcis clavier d'Apex.">
            <ApexButton size="sm" onClick={() => setShortcutsOpen(true)}>Raccourcis</ApexButton>
          </CustomTooltip>
        </motion.div>
        <HomeProjects panelRef={projectsRef} panelClassName={styles.panel} />
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
          <div className={styles.backdrop} onClick={() => setLicenseOpen(false)} />,
          portalRoot,
        )}
      <GlassPanel
        open={licenseOpen}
        portal
        flush
        radius={20}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Licence AGPL"
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.4, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.modalBody}>
          <h3 className={styles.modalTitle}>GNU Affero General Public License v3</h3>
          <p className={styles.modalSub}>
            Apex Studio et son code source sont publiés sous cette licence. Version officielle :{' '}
            <a className={styles.link} href={LICENSE_URL} target="_blank" rel="noopener noreferrer">
              gnu.org/licenses/agpl-3.0
            </a>
          </p>
          <ExternalScrollArea className={styles.scrollArea} contentClassName={styles.licenseText}>
            <pre>{licenseText ?? 'Chargement du texte de la licence…'}</pre>
          </ExternalScrollArea>
          <div className={styles.modalActions}>
            <button type="button" className={styles.closeBtn} onClick={() => setLicenseOpen(false)} autoFocus>
              Fermer
            </button>
          </div>
        </div>
      </GlassPanel>
    </div>
      </>
      )}
    </>
  );
};
