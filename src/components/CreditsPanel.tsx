import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CREDITS, CREDITS_NOTE } from '@/utils/credits';
import { ExternalScrollArea } from './ExternalScrollArea';
import { SoundLibrary } from './SoundLibrary';
import styles from './CreditsPanel.module.scss';

/** Panneau latéral des « Merci à » de l'espace Accueil : volontairement énorme, curseur externe. */
export const CreditsPanel: React.FC = () => {
  const [libraryOpen, setLibraryOpen] = useState(false);

  return (
    <>
      <motion.aside
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
                    {entry.flag && <span className={styles.flag}>{entry.flag}</span>} {entry.by} <span className={styles.license}>{entry.license}</span>
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
