import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CREDITS, CREDITS_NOTE } from '@/utils/credits';
import { ExternalScrollArea } from './ExternalScrollArea';
import { SoundLibrary } from './SoundLibrary';
import { CustomTooltip } from './CustomTooltip';
import { GlassPanelBackdrop } from './edit-node/GlassPanelBackdrop';
import styles from './CreditsPanel.module.scss';

const regionNames = new Intl.DisplayNames(['fr'], { type: 'region' });

/** Pays d'un drapeau emoji (deux indicateurs régionaux) : nom en français et lien Google Earth ; 🌍 : le globe entier. */
function flagInfo(flag: string): { name: string; url: string } {
  const letters = [...flag]
    .map((c) => (c.codePointAt(0) ?? 0) - 0x1f1e6)
    .filter((n) => n >= 0 && n < 26)
    .map((n) => String.fromCharCode(65 + n))
    .join('');
  const name = letters.length === 2 ? regionNames.of(letters) : undefined;
  if (!name) return { name: 'Monde entier', url: 'https://earth.google.com/web/' };
  return { name, url: `https://earth.google.com/web/search/${encodeURIComponent(name)}` };
}

/** Panneau latéral des « Merci à » de l'espace Accueil : volontairement énorme, curseur externe. */
export const CreditsPanel: React.FC = () => {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  return (
    <>
      <GlassPanelBackdrop targetRef={panelRef} corner={20} warp={1.3} blurPx={5} distortion={8} whiteRim />
      <motion.aside
        ref={panelRef}
        className={styles.panel}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 24 }}
        transition={{ duration: 0.45, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
      >
        <ExternalScrollArea className={styles.scrollArea} contentClassName={styles.content}>
          <h2 className={styles.title}>Merci à eux</h2>
          <p className={styles.subtitle}>
            La réalisation d'Apex aurait été vouée à l'échec sans le merveilleux travail de :
          </p>
          {CREDITS.map((group) => (
            <section key={group.title} className={styles.group}>
              <h3 className={styles.groupTitle}>{group.title}</h3>
              {group.subtitle && <p className={styles.groupSubtitle}>{group.subtitle}</p>}
              {group.entries.map((entry) => (
                <div key={entry.name} className={styles.entry}>
                  <div className={styles.name}>{entry.name}</div>
                  <div className={styles.by}>
                    {entry.flag && (
                      <>
                        <CustomTooltip inline content={flagInfo(entry.flag).name} description="Cliquez pour ouvrir ce pays dans Google Earth.">
                          <a
                            className={styles.flag}
                            href={flagInfo(entry.flag).url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {entry.flag}
                          </a>
                        </CustomTooltip>
                        {entry.flagGuess && <span className={styles.flagGuess}>(?)</span>}
                      </>
                    )} {entry.by} <span className={styles.license}>{entry.license}</span>
                  </div>
                  {entry.licenseNote && <div className={styles.licenseNote}>{entry.licenseNote}</div>}
                  <div className={styles.use}>{entry.use}</div>
                  {entry.citation && <blockquote className={styles.citation}>{entry.citation}</blockquote>}
                  {entry.obligation && <div className={styles.obligation}>{entry.obligation}</div>}
                  {entry.url && (
                    <a className={styles.link} href={entry.url} target="_blank" rel="noopener noreferrer">
                      {entry.url.replace(/^https:\/\//, '')}
                    </a>
                  )}
                  {entry.link?.opens === 'sound-library' && (
                    <button type="button" className={styles.link} onClick={() => setLibraryOpen(true)}>
                      {entry.link.label}
                    </button>
                  )}
                </div>
              ))}
            </section>
          ))}
          <p className={styles.note}>{CREDITS_NOTE}</p>
        </ExternalScrollArea>
      </motion.aside>
      <SoundLibrary open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </>
  );
};
