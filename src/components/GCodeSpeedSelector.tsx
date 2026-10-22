import React from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { GCODE_SPEED_OPTIONS } from '@/hooks/use-gcode-preview';
import { ApexSlider } from './ApexSlider';
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

const SEGMENT_TOOLTIP = {
  title: 'Préréglage de vitesse',
  desc: "Vitesse de lecture prédéfinie, en multiple de la vitesse réelle de la machine. Double-cliquez sur le curseur pour revenir à ×1.",
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
// Double-clic sur le curseur : retour à la valeur par défaut (préréglage ×1).
const DEFAULT_SPEED = GCODE_SPEED_OPTIONS[1];

const formatSpeed = (speed: number) => {
  if (speed < 1) return `${speed.toFixed(2)}×`;
  if (speed < 10) return `${speed.toFixed(1)}×`;
  return `${Math.round(speed)}×`;
};

// Apparition à l'entrée dans l'espace Prévisualisation : jamais d'un coup avec le panneau qui le
// porte (cf. previewPanelFooter dans CategoriesSidebar.module.scss) — case puis curseur+préréglages,
// l'un après l'autre en cascade, même vocabulaire que la cascade de contenu de ModelingSidebar :
// fondu-montée, easing "standard" Material.
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
// Le curseur ne joue son intro qu'une fois son groupe (second de la cascade) pleinement visible.
const SLIDER_GROUP_REVEAL_S = REVEAL_STAGGER_S + REVEAL_ITEM_DURATION_S;

/**
 * Sélecteur de vitesse de lecture de l'espace Prévisualisation, posé au bas du panneau du bas de
 * CategoriesSidebar (cf. `previewLowerContent`) : curseur continu (ApexSlider), puis contrôle
 * segmenté sur GCODE_SPEED_OPTIONS juste en dessous.
 */
export const GCodeSpeedSelector: React.FC<GCodeSpeedSelectorProps> = ({
  speed,
  setSpeed,
  showFullHead,
  setShowFullHead,
}) => (
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
      <ApexSlider
        label="Vitesse"
        ariaLabel="Vitesse d'impression"
        value={speed}
        onChange={setSpeed}
        min={MIN_SPEED}
        max={MAX_SPEED}
        scale="log"
        snapPoints={GCODE_SPEED_OPTIONS}
        defaultValue={DEFAULT_SPEED}
        format={formatSpeed}
        tooltip={TOOLTIP}
        intro={{ delayS: SLIDER_GROUP_REVEAL_S }}
      />

      <div className={styles.segments} role="radiogroup" aria-label="Préréglages de vitesse">
        {GCODE_SPEED_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={speed === option}
            className={clsx(styles.segment, { [styles.active]: speed === option })}
            onClick={() => setSpeed(option)}
            onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: SEGMENT_TOOLTIP }))}
            onMouseLeave={() => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'))}
          >
            {option}×
          </button>
        ))}
      </div>
    </motion.div>
  </motion.div>
);
