import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { GCODE_SPEED_OPTIONS } from '@/hooks/use-gcode-preview';
import styles from './GCodeSpeedSelector.module.scss';

interface GCodeSpeedSelectorProps {
  /** Multiplicateur du temps machine réel (cf. GCODE_SPEED_OPTIONS). */
  speed: number;
  setSpeed: (speed: number) => void;
  /** Tête d'outil complète (glTF entier) ou tronquée à la buse (cf. apex-gcode-show-full-head). */
  showFullHead: boolean;
  setShowFullHead: (show: boolean) => void;
}

const TOOLTIP = {
  title: "Vitesse d'impression",
  desc: 'Vitesse de lecture de la prévisualisation, en multiple de la vitesse réelle de la machine (avances F du G-code).',
};

const HEAD_TOOLTIP = {
  title: "Tête d'outil complète",
  desc: "Décochez pour ne plus afficher que la buse, en masquant le reste de la tête d'outil.",
};

// Curseur en échelle logarithmique entre le plus petit et le plus grand préréglage : chaque
// préréglage (×4 du précédent) est ainsi à intervalle régulier sur la piste, et les faibles
// vitesses restent précises.
const MIN_SPEED = GCODE_SPEED_OPTIONS[0];
const MAX_SPEED = GCODE_SPEED_OPTIONS[GCODE_SPEED_OPTIONS.length - 1];
const LOG_RANGE = Math.log(MAX_SPEED / MIN_SPEED);
const speedToRatio = (speed: number) => Math.log(speed / MIN_SPEED) / LOG_RANGE;
const ratioToSpeed = (ratio: number) => MIN_SPEED * Math.exp(ratio * LOG_RANGE);

const formatSpeed = (speed: number) => {
  if (speed < 1) return `${speed.toFixed(2)}×`;
  if (speed < 10) return `${speed.toFixed(1)}×`;
  return `${Math.round(speed)}×`;
};

// Apparition à l'entrée dans l'espace Prévisualisation : jamais d'un coup avec le panneau qui le
// porte (cf. previewPanelFooter dans CategoriesSidebar.module.scss, qui ne fait qu'apparaître avec
// lui) — case puis curseur+préréglages, l'un après l'autre en cascade, même vocabulaire que la
// cascade de contenu de ModelingSidebar (CONTENT_STAGGER_MS/contentGroupVariants) : fondu-montée,
// easing "standard" Material.
const REVEAL_STAGGER_S = 0.09;
const REVEAL_ITEM_DURATION_S = 0.22;
const revealContainerVariants = {
  hidden: { transition: { staggerChildren: REVEAL_STAGGER_S } },
  visible: { transition: { staggerChildren: REVEAL_STAGGER_S } },
};
const revealItemVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: REVEAL_ITEM_DURATION_S, ease: [0.4, 0, 0.2, 1] as const } },
};
// Décalage jusqu'à ce que .sliderGroup (second groupe de la cascade, cf. staggerChildren
// ci-dessus) ait lui-même fini d'apparaître : les trois phases du curseur (cf. plus bas) doivent
// se jouer une fois ce groupe pleinement visible, jamais en même temps que son propre fondu-montée
// — sinon la ligne s'estomperait en même temps que son conteneur encore transparent, terminant
// avant même que celui-ci ait fini d'apparaître.
const SLIDER_GROUP_REVEAL_S = REVEAL_STAGGER_S + REVEAL_ITEM_DURATION_S;

// Le curseur se joue en TROIS temps distincts, jamais tous à la vitesse du fondu-montée du reste
// de la cascade (revealItemVariants) : (1) la ligne (trackFill/trackRemainder) apparaît d'abord
// SEULE, déjà à son minimum, sans la poignée ; (2) la poignée apparaît ensuite par-dessus, en la
// « coupant » (elle n'existe pas avant cet instant — jamais un fondu, jamais présente ni
// transparente pendant la phase 1, sans quoi elle se contenterait de s'éclaircir sur place au lieu
// de sembler couper la ligne) ; (3) le tout glisse alors, ensemble, du minimum jusqu'à la valeur
// réelle, sur une courbe expo-out — même famille que le glissement des panneaux/barres depuis le
// bord de l'écran (GCodePreviewBar, [0.16, 1, 0.3, 1]).
const SLIDER_LINE_APPEAR_S = 0.18;
const SLIDER_HANDLE_APPEAR_S = 0.15;
// La poignée apparaît une fois la ligne posée, la glissade démarrant juste après elle (cf. les
// `delay` ci-dessous, dérivés de ces deux constantes plutôt que répétés en dur) — le tout décalé
// après l'apparition de .sliderGroup lui-même (SLIDER_GROUP_REVEAL_S).
const SLIDER_LINE_DELAY_S = SLIDER_GROUP_REVEAL_S;
const SLIDER_HANDLE_DELAY_S = SLIDER_LINE_DELAY_S + SLIDER_LINE_APPEAR_S;
const SLIDER_GLIDE_DELAY_S = SLIDER_HANDLE_DELAY_S + SLIDER_HANDLE_APPEAR_S;
const SLIDER_GLIDE_S = 0.5;
const SLIDER_GLIDE_EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Sélecteur de vitesse de lecture de l'espace Prévisualisation, posé au bas du panneau du bas de
 * CategoriesSidebar (cf. `previewLowerContent`) : curseur continu, puis contrôle segmenté sur
 * GCODE_SPEED_OPTIONS juste en dessous.
 */
export const GCodeSpeedSelector: React.FC<GCodeSpeedSelectorProps> = ({
  speed,
  setSpeed,
  showFullHead,
  setShowFullHead,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const ratio = Math.min(1, Math.max(0, speedToRatio(speed)));
  // framer-motion applique `transition` à CHAQUE changement de cible, pas seulement au montage :
  // sans ce drapeau, un clic ou un glisser rejouait délai + glissade de l'intro (~1 s de retard).
  // Une fois l'intro terminée, la poignée suit la valeur instantanément.
  const [introDone, setIntroDone] = useState(false);
  const follow = { duration: 0 };

  const setFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const localRatio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    // Aimanté sur les préréglages à proximité, pour pouvoir y revenir exactement au curseur.
    const snapped = GCODE_SPEED_OPTIONS.find((option) => Math.abs(speedToRatio(option) - localRatio) < 0.02);
    setSpeed(snapped ?? ratioToSpeed(localRatio));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    setSpeed(ratioToSpeed(Math.min(1, Math.max(0, ratio + step * 0.025))));
  };

  return (
    <motion.div
      className={styles.root}
      variants={revealContainerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.label
        className={styles.checkboxRow}
        variants={revealItemVariants}
        onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: HEAD_TOOLTIP }))}
        onMouseLeave={() => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'))}
      >
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={showFullHead}
          onChange={(e) => setShowFullHead(e.target.checked)}
        />
        <span>Afficher la tête d'outil complète</span>
      </motion.label>

      <motion.div className={styles.sliderGroup} variants={revealItemVariants}>
        <div
          className={styles.sliderRow}
          onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: TOOLTIP }))}
          onMouseLeave={() => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'))}
        >
          <span className={styles.label}>Vitesse</span>
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
            onKeyDown={handleKeyDown}
            tabIndex={0}
            role="slider"
            aria-label="Vitesse d'impression"
            aria-valuemin={MIN_SPEED}
            aria-valuemax={MAX_SPEED}
            aria-valuenow={speed}
            aria-valuetext={formatSpeed(speed)}
          >
            {/* Animation de MONTAGE seule (`initial` figé, jamais réévalué) : `ratio` ne change plus
                ensuite la forme de cette transition, seulement sa valeur cible (cf. `animate`),
                donc une interaction normale (drag, préréglage) suit 1:1 sans rejouer les trois
                phases. Phase 1, ligne seule à son minimum (right/left à la position `ratio = 0`) :
                un simple fondu, jamais de mouvement (elle EST déjà à sa position de départ).
                Phase 3 (glissade), retardée à SLIDER_GLIDE_DELAY_S : mouvement seul, plus de fondu
                (déjà pleinement opaque depuis la phase 1). */}
            <motion.div
              className={styles.trackFill}
              initial={{ opacity: 0, right: `calc(100% + var(--handle-gap))` }}
              animate={{
                opacity: 1,
                right: `calc(${100 - ratio * 100}% + var(--handle-gap))`,
              }}
              transition={introDone ? follow : {
                opacity: { duration: SLIDER_LINE_APPEAR_S, delay: SLIDER_LINE_DELAY_S },
                right: { duration: SLIDER_GLIDE_S, delay: SLIDER_GLIDE_DELAY_S, ease: SLIDER_GLIDE_EASE },
              }}
            />
            <motion.div
              className={styles.trackRemainder}
              initial={{ opacity: 0, left: 'var(--handle-gap)' }}
              animate={{
                opacity: 1,
                left: `calc(${ratio * 100}% + var(--handle-gap))`,
              }}
              transition={introDone ? follow : {
                opacity: { duration: SLIDER_LINE_APPEAR_S, delay: SLIDER_LINE_DELAY_S },
                left: { duration: SLIDER_GLIDE_S, delay: SLIDER_GLIDE_DELAY_S, ease: SLIDER_GLIDE_EASE },
              }}
            />
            {/* Phase 2, retardée à SLIDER_HANDLE_DELAY_S (une fois la ligne posée) : la poignée
                n'existe pas avant cet instant (opacité 0 jusque-là, jamais un fondu progressif
                depuis le montage) puis apparaît d'un coup à sa position minimale, avant de glisser
                à son tour en phase 3 — jamais de fondu pendant la glissade elle-même (`duration: 0`
                sur `opacity` dans son propre `transition`, qui saute directement à 1 dès que son
                délai est écoulé). */}
            <motion.div
              className={styles.trackHandle}
              data-ui-sound
              initial={{ opacity: 0, left: '0%' }}
              animate={{ opacity: 1, left: `${ratio * 100}%` }}
              transition={introDone ? follow : {
                opacity: { duration: 0, delay: SLIDER_HANDLE_DELAY_S },
                left: { duration: SLIDER_GLIDE_S, delay: SLIDER_GLIDE_DELAY_S, ease: SLIDER_GLIDE_EASE },
              }}
              onAnimationComplete={() => setIntroDone(true)}
            />
          </div>
          <span className={styles.value}>{formatSpeed(speed)}</span>
        </div>

        <div className={styles.segments} role="radiogroup" aria-label="Préréglages de vitesse">
          {GCODE_SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={speed === option}
              className={clsx(styles.segment, { [styles.active]: speed === option })}
              onClick={() => setSpeed(option)}
            >
              {option}×
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};
