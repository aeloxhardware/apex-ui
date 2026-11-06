import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import styles from './ApexSlider.module.scss';

import { emitApex } from '@/events/apexEvents';
import { isFlatUi } from '@/utils/interfaceMode';
// Curseur unique d'Apex, sur le modèle du curseur de vitesse de Prévisualisation (piste fendue
// autour d'une poignée en verre, valeur cyan). Tout curseur de réglage doit l'utiliser : ne pas
// recréer d'<input type="range"> ni de piste dédiée.

interface ApexSliderTooltip {
  title: string;
  desc: string;
}

export interface ApexSliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  /** `log` exige min > 0 : chaque ordre de grandeur occupe une portion égale de la piste. */
  scale?: 'linear' | 'log' | undefined;
  /** Arrondi de la valeur (souris, clavier). */
  step?: number | undefined;
  /** Valeurs aimantées : le curseur s'y arrête à proximité, pour pouvoir y revenir exactement. */
  snapPoints?: number[];
  /** Valeur de retour au double-clic sur la piste. */
  defaultValue?: number | undefined;
  /** Texte affiché à droite de la piste. */
  format: (value: number) => string;
  /** Libellé affiché à gauche de la piste. */
  label?: string;
  ariaLabel?: string | undefined;
  tooltip?: ApexSliderTooltip;
  /** Apparition en trois temps, `delayS` secondes après le montage (à n'utiliser que dans une cascade). */
  intro?: { delayS: number };
  className?: string | undefined;
}

// Décalage d'aimantation et pas du clavier, en fraction de la piste (0 à 1).
const SNAP_RATIO = 0.02;
const KEY_STEP_RATIO = 0.025;

// Le curseur d'intro se joue en TROIS temps distincts, jamais tous à la vitesse du fondu-montée de
// la cascade : (1) la ligne apparaît d'abord SEULE, déjà à son minimum, sans la poignée ; (2) la
// poignée apparaît ensuite par-dessus, en « coupant » la ligne (jamais un fondu) ; (3) le tout
// glisse, ensemble, du minimum jusqu'à la valeur réelle, sur une courbe expo-out.
const INTRO_LINE_APPEAR_S = 0.18;
const INTRO_HANDLE_APPEAR_S = 0.15;
const INTRO_GLIDE_S = 0.5;
const INTRO_GLIDE_EASE = [0.16, 1, 0.3, 1] as const;

export const ApexSlider: React.FC<ApexSliderProps> = ({
  value,
  onChange,
  min,
  max,
  scale = 'linear',
  step,
  snapPoints,
  defaultValue,
  format,
  label,
  ariaLabel,
  tooltip,
  intro,
  className,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  // framer-motion applique `transition` à CHAQUE changement de cible, pas seulement au montage :
  // sans ce drapeau, un clic ou un glisser rejouerait délai + glissade de l'intro (~1 s de retard).
  const [introDone, setIntroDone] = useState(false);
  const follow = { duration: 0 };
  const playIntro = intro !== undefined && !introDone;

  const isLog = scale === 'log';
  const toRatio = (v: number) => (isLog ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromRatio = (r: number) => {
    const raw = isLog ? min * Math.exp(r * Math.log(max / min)) : min + r * (max - min);
    const rounded = step ? Math.round(raw / step) * step : raw;
    return Math.min(max, Math.max(min, rounded));
  };
  const ratio = Math.min(1, Math.max(0, toRatio(value)));

  const setFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const localRatio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    const snapped = snapPoints?.find((point) => Math.abs(toRatio(point) - localRatio) < SNAP_RATIO);
    onChange(snapped ?? fromRatio(localRatio));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const direction = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!direction) return;
    e.preventDefault();
    onChange(fromRatio(Math.min(1, Math.max(0, ratio + direction * KEY_STEP_RATIO))));
  };

  // Phases d'intro, décalées après `intro.delayS` (la ligne) puis derrière la ligne (la poignée) et
  // la glissade (cf. les constantes ci-dessus).
  const lineDelay = intro?.delayS ?? 0;
  const handleDelay = lineDelay + INTRO_LINE_APPEAR_S;
  const glideDelay = handleDelay + INTRO_HANDLE_APPEAR_S;

  return (
    <div
      className={clsx(styles.root, className)}
      onMouseEnter={() => tooltip && emitApex('apex-set-tooltip', tooltip)}
      onMouseLeave={() => tooltip && emitApex('apex-reset-tooltip')}
    >
      {label && <span className={styles.label} data-apex-slider="text">{label}</span>}
      <div
        ref={trackRef}
        className={styles.track}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) setFromClientX(e.clientX);
        }}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="slider"
        aria-label={ariaLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
      >
        {isFlatUi() ? (
          // Interface classique : mêmes éléments (piste scindée, poignée), posés sans aucune animation ;
          // flat.css les met en noir et blanc par les attributs data-apex-slider.
          <>
            <div
              className={styles.trackFill}
              data-apex-slider="fill"
              style={{ right: `calc(${100 - ratio * 100}% + var(--handle-gap))` }}
            />
            <div
              className={styles.trackRemainder}
              data-apex-slider="remainder"
              style={{ left: `calc(${ratio * 100}% + var(--handle-gap))` }}
            />
            <div className={styles.trackHandle} data-apex-slider="handle" style={{ left: `${ratio * 100}%` }} />
          </>
        ) : (
          <>
            {/* Animation de MONTAGE seule (`initial` figé quand il y a une intro, absent sinon) : la
                valeur cible suit ensuite 1:1 sans rejouer les phases. */}
            <motion.div
              className={styles.trackFill}
              initial={intro ? { opacity: 0, right: 'calc(100% + var(--handle-gap))' } : false}
              animate={{ opacity: 1, right: `calc(${100 - ratio * 100}% + var(--handle-gap))` }}
              transition={playIntro ? {
                opacity: { duration: INTRO_LINE_APPEAR_S, delay: lineDelay },
                right: { duration: INTRO_GLIDE_S, delay: glideDelay, ease: INTRO_GLIDE_EASE },
              } : follow}
            />
            <motion.div
              className={styles.trackRemainder}
              initial={intro ? { opacity: 0, left: 'var(--handle-gap)' } : false}
              animate={{ opacity: 1, left: `calc(${ratio * 100}% + var(--handle-gap))` }}
              transition={playIntro ? {
                opacity: { duration: INTRO_LINE_APPEAR_S, delay: lineDelay },
                left: { duration: INTRO_GLIDE_S, delay: glideDelay, ease: INTRO_GLIDE_EASE },
              } : follow}
            />
            {/* La poignée n'existe pas avant son instant d'intro (opacité 0), puis apparaît d'un coup. */}
            <motion.div
              className={styles.trackHandle}
              data-ui-sound
              initial={intro ? { opacity: 0, left: '0%' } : false}
              animate={{ opacity: 1, left: `${ratio * 100}%` }}
              transition={playIntro ? {
                opacity: { duration: 0, delay: handleDelay },
                left: { duration: INTRO_GLIDE_S, delay: glideDelay, ease: INTRO_GLIDE_EASE },
              } : follow}
              onAnimationComplete={() => setIntroDone(true)}
            />
          </>
        )}
      </div>
      <span className={styles.value} data-apex-slider="text">{format(value)}</span>
    </div>
  );
};
