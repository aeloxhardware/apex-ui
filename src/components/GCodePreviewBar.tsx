import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause } from 'lucide-react';
import { type GCodeFileInfo } from '@/hooks/use-gcode-preview';
import styles from './GCodePreviewBar.module.scss';

interface GCodePreviewBarProps {
  /** Espace Prévisualisation affiché. Nécessaire mais pas suffisant pour afficher la barre : elle
   * reste en plus masquée tant qu'aucun G-code n'est chargé ni en cours de chargement (cf.
   * `fileInfo`/`isLoading`). */
  active: boolean;
  fileInfo: GCodeFileInfo | null;
  isLoading: boolean;
  t: number;
  lastIndex: number;
  isPlaying: boolean;
  togglePlay: () => void;
  seek: (value: number) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  openFilePicker: () => void;
}

// `active` (isPreviewActive) devient vrai dans `onCovered` (cf. Sidebar.tsx), à l'instant précis
// où le rideau plein écran (SpaceTransitionOverlay) vient de finir de se peindre — PAS quand il a
// fini de se lever. À ce même instant démarrent aussi, tous masqués par le rideau : la mitose
// pilule → panneaux de CategoriesSidebar (PREVIEW_MORPH_MS = 1370ms) et le déplacement de la barre
// d'aide TopRightMenu (RESHAPE_DURATION = 1100ms) — les deux plus longues animations de la
// séquence. Le rideau lui-même reste peint (phase "text") 1000ms puis met 575ms à se lever
// (phase "fadeout", cf. getTextMs/FADEOUT_MS) : il ne révèle donc la scène qu'à 1575ms après
// `onCovered`, quand tout le reste est déjà terminé. Pour que cette barre apparaisse EN DERNIER
// dans la séquence perçue (au lieu d'être déjà là, toute faite, dès que le rideau se lève comme
// tout le reste), son glissement-fondu ne démarre qu'une fois le rideau entièrement levé.
const CURTAIN_REVEAL_MS = 1575;

/** Positions CSS du segment parcouru, du segment restant et de la poignée pour un ratio 0–1. */
const trackStyles = (ratio: number) => ({
  fillRight: `calc(${100 - ratio * 100}% + var(--handle-gap))`,
  remainderLeft: `calc(${ratio * 100}% + var(--handle-gap))`,
  handleLeft: `${ratio * 100}%`,
});

/**
 * Barre de lecture de l'espace Prévisualisation : play/pause, curseur de progression, vitesse,
 * affichage des trajets à vide et import de fichier. Toute la logique vient de
 * `useGCodePreview` (voir Index.tsx, qui possède le hook et transmet ses props ici).
 *
 * Pour l'instant seuls le bouton Play/Pause et le curseur de progression sont branchés ; le reste
 * des props (vitesse, trajets à vide, import) restent transmises sans être encore affichées, pour
 * ne pas avoir à retoucher Index.tsx quand ce contenu sera ajouté.
 *
 * N'apparaît que si un G-code est chargé ou en cours de chargement (`fileInfo`/`isLoading`) — pas
 * seulement parce que l'espace Prévisualisation est affiché : sans trajectoire à montrer, la barre
 * de lecture n'a rien à piloter et reste masquée comme le reste du contenu ci-dessus.
 *
 * Glissement-fondu depuis le bas de l'écran à l'entrée dans l'espace, et inverse à la sortie —
 * comme le panneau du bas de CategoriesSidebar (cf. FROM_PREVIEW_FADE_MS), mais vertical plutôt
 * qu'horizontal puisque cette barre vient du bord bas de l'écran plutôt que du bord gauche.
 * Retardée (CURTAIN_REVEAL_MS) pour apparaître en tout dernier, une fois le rideau levé et le
 * reste de la séquence terminé — jamais à la sortie de l'espace, où elle disparaît normalement.
 * Cette même transition sert aussi à l'apparition/disparition au chargement/déchargement d'un
 * G-code une fois l'espace déjà affiché, sans le délai CURTAIN_REVEAL_MS (non pertinent hors de
 * la séquence d'entrée dans l'espace, cf. `visible` ci-dessous).
 */
export const GCodePreviewBar: React.FC<GCodePreviewBarProps> = ({
  active,
  fileInfo,
  isLoading,
  t,
  lastIndex,
  isPlaying,
  togglePlay,
  seek,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const visible = active && (!!fileInfo || isLoading);

  // CURTAIN_REVEAL_MS ne doit retarder que la toute première apparition de la barre après l'entrée
  // dans l'espace (rideau qui se lève) — pas une réapparition ultérieure au chargement d'un
  // G-code alors que l'espace est déjà affiché depuis longtemps, qui doit être immédiate.
  const revealDelayMs = useRef(CURTAIN_REVEAL_MS);
  useLayoutEffect(() => {
    if (!active) revealDelayMs.current = CURTAIN_REVEAL_MS;
  }, [active]);
  const delay = revealDelayMs.current;
  if (visible) revealDelayMs.current = 0;
  // Pas de mouvement chargé : curseur figé au tout début plutôt que masqué, la barre reste posée.
  const ratio = lastIndex > 0 ? Math.min(1, Math.max(0, t / lastIndex)) : 0;
  const track = trackStyles(ratio);

  // Poignée et segments déplacés directement dans le DOM, dès l'événement pointeur : le point suit
  // la souris à l'image près, sans attendre le re-rendu de la page (resynchronisé ensuite par
  // `seek`, avec exactement la même valeur).
  const fillRef = useRef<HTMLDivElement>(null);
  const remainderRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const seekFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || lastIndex <= 0) return;
    const rect = track.getBoundingClientRect();
    const localRatio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    const index = Math.round(localRatio * lastIndex);
    const style = trackStyles(index / lastIndex);
    if (fillRef.current) fillRef.current.style.right = style.fillRight;
    if (remainderRef.current) remainderRef.current.style.left = style.remainderLeft;
    if (handleRef.current) handleRef.current.style.left = style.handleLeft;
    seek(index);
  }, [lastIndex, seek]);

  // Glisser depuis n'importe où sur la piste, y compris hors de son rectangle une fois le drag
  // commencé (pointer capture) : convention standard des curseurs de lecture.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (lastIndex <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    seekFromClientX(e.clientX);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.bar}
          data-apex-chrome-panel
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.4, delay: delay / 1000, ease: [0.16, 1, 0.3, 1] } }}
          exit={{ opacity: 0, y: 40, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } }}
        >
          <button
            type="button"
            className={styles.playButton}
            onClick={togglePlay}
            disabled={lastIndex <= 0}
            aria-label={isPlaying ? 'Pause' : 'Lecture'}
            aria-pressed={isPlaying}
          >
            {isPlaying ? <Pause size={14} className="fill-current" /> : <Play size={14} className="fill-current" />}
          </button>

          <div
            ref={trackRef}
            className={styles.track}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            role="slider"
            aria-label="Ligne de prévisualisation"
            aria-valuemin={0}
            aria-valuemax={lastIndex}
            aria-valuenow={Math.round(t)}
            aria-disabled={lastIndex <= 0}
          >
            <div ref={fillRef} className={styles.trackFill} style={{ right: track.fillRight }} />
            <div ref={remainderRef} className={styles.trackRemainder} style={{ left: track.remainderLeft }} />
            {/* Seul le point du curseur doit avoir le son de survol des éléments interactifs
                (voir use-ui-sounds.ts), pas toute la piste : `data-ui-sound` ciblé ici, et
                `pointer-events: auto` en SCSS (styles.trackHandle) pour que le survol désigne
                bien ce point comme cible plutôt que de remonter directement à .track — ses
                propres handlers de drag restent déclenchés via la remontée normale de
                l'événement jusqu'au parent. */}
            <div
              ref={handleRef}
              className={styles.trackHandle}
              style={{ left: track.handleLeft }}
              data-ui-sound
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
