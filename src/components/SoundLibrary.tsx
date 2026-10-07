import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, Play, Square, X } from 'lucide-react';
import { SOUND_LIBRARY, type LibrarySound } from '@/utils/soundLibrary';
import { ExternalScrollArea } from './ExternalScrollArea';
import styles from './SoundLibrary.module.scss';

/** Télécharge le fichier sous son nom d'origine (blob : fonctionne aussi pour une URL de ressource empaquetée). */
async function downloadSound(sound: LibrarySound) {
  try {
    const blob = await (await fetch(sound.src)).blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = sound.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    // no-op : pas de rapport d'erreur utile pour un téléchargement local.
  }
}

interface SoundLibraryProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Bibliothèque de sons : floute toute la fenêtre et ouvre un panneau de verre qui répertorie chaque
 * son (titre, où l'application le joue, écoute, téléchargement). Rendue dans <body> pour couvrir
 * aussi la barre d'onglets.
 */
export const SoundLibrary: React.FC<SoundLibraryProps> = ({ open, onClose }) => {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  };

  const toggle = (sound: LibrarySound) => {
    if (playingId === sound.id) {
      stop();
      return;
    }
    stop();
    const audio = new Audio(sound.src);
    audio.onended = () => setPlayingId((id) => (id === sound.id ? null : id));
    audioRef.current = audio;
    setPlayingId(sound.id);
    void audio.play().catch(() => setPlayingId(null));
  };

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => stop, []);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="sound-library"
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className={styles.window}
            role="dialog"
            aria-label="Bibliothèque de sons"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <header className={styles.header}>
              <h2 className={styles.title}>Bibliothèque de sons</h2>
              <button type="button" className={styles.close} onClick={onClose} aria-label="Fermer">
                <X size={20} />
              </button>
            </header>
            <ExternalScrollArea className={styles.body} contentClassName={styles.list}>
              {SOUND_LIBRARY.map((section) => (
                <section key={section.title}>
                  <h3 className={styles.sectionTitle}>{section.title}</h3>
                  {section.sounds.map((sound) => (
                    <article key={sound.id} className={styles.card}>
                      <div className={styles.cardText}>
                        <h4 className={styles.cardTitle}>{sound.title}</h4>
                        <p className={styles.cardDesc}>{sound.description}</p>
                      </div>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => toggle(sound)}
                        aria-label={playingId === sound.id ? 'Arrêter' : 'Écouter'}
                      >
                        {playingId === sound.id ? <Square size={16} /> : <Play size={16} />}
                      </button>
                      <button type="button" className={styles.download} onClick={() => void downloadSound(sound)}>
                        <Download size={16} />
                        Télécharger
                      </button>
                    </article>
                  ))}
                </section>
              ))}
            </ExternalScrollArea>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
