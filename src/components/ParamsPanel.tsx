import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  isColorByDeferred,
  setColorByDeferred,
  subscribeColorByDeferred,
} from '@/utils/gcodeColorByPrefs';
import { isEditJournalEnabled, setEditJournalEnabled, subscribeEditJournal } from '@/utils/editJournalPrefs';
import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  getUiScale,
  isUiNeutral,
  setUiNeutral,
  setUiScale,
  subscribeUiScale,
} from '@/utils/uiScalePrefs';
import styles from './ParamsPanel.module.scss';

const UI_NEUTRAL_TOOLTIP = {
  title: 'Apex Neutral',
  desc: "Adapte l'échelle à la résolution de la fenêtre pour afficher la même quantité d'éléments que sur un écran 2K (2560 × 1440). Le curseur d'échelle se multiplie à ce facteur.",
};

const EDIT_JOURNAL_TOOLTIP = {
  title: 'Historique des modifications',
  desc: "Écrit le journal des modifications de l'onglet Édition dans l'en-tête chiffré du G-code, pour pouvoir annuler après réouverture du fichier. Désactivé : rien n'est écrit, l'annulation ne vaut que pour la session.",
};

const COLOR_BY_DEFER_TOOLTIP = {
  title: 'Coloration G-code différée',
  desc: "Sur un très gros fichier, recalcule la coloration du tracé une image après le changement de mode plutôt que dans le même instant, pour ne jamais bloquer le clic. Sans effet visible sur un fichier de taille courante.",
};

/**
 * Espace Paramètres : le Viewport3D est entièrement démonté (cf. Index.tsx), donc ce panneau
 * est tout ce qui s'affiche sous la barre d'onglets et la barre fichier/son.
 */
export const ParamsPanel: React.FC = () => {
  // Miroir React du singleton localStorage (cf. utils/gcodeColorByPrefs.ts, même patron que
  // utils/uiSound.ts) : ce panneau n'est pas la seule source de vérité, il ne fait que refléter et
  // modifier l'état partagé, que gcodeLayer.ts lit directement au moment de recolorer.
  const [colorByDeferred, setColorByDeferredState] = useState(isColorByDeferred);
  useEffect(() => subscribeColorByDeferred(setColorByDeferredState), []);
  const [editJournal, setEditJournalState] = useState(isEditJournalEnabled);
  useEffect(() => subscribeEditJournal(setEditJournalState), []);

  const [, forceRender] = useState(0);
  useEffect(() => subscribeUiScale(() => forceRender((n) => n + 1)), []);
  const uiScale = getUiScale();
  const uiNeutral = isUiNeutral();

  return (
    <div className={styles.container}>
      <motion.div
        className={styles.panel}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className={styles.title}>Paramètres</h2>
        <p className={styles.subtitle}>Réglages généraux de l'application.</p>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Affichage</h3>
          <div className={styles.sliderRow}>
            <span>Échelle de l'interface</span>
            <input
              type="range"
              className={styles.slider}
              min={UI_SCALE_MIN}
              max={UI_SCALE_MAX}
              step={UI_SCALE_STEP}
              value={uiScale}
              onChange={(e) => setUiScale(parseFloat(e.target.value))}
            />
            <span className={styles.sliderValue}>{Math.round(uiScale * 100)} %</span>
          </div>
          <label
            className={styles.checkboxRow}
            onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: UI_NEUTRAL_TOOLTIP }))}
            onMouseLeave={() => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'))}
          >
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={uiNeutral}
              onChange={(e) => setUiNeutral(e.target.checked)}
            />
            <span>Apex Neutral</span>
          </label>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Prévisualisation G-code</h3>
          <label
            className={styles.checkboxRow}
            onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: COLOR_BY_DEFER_TOOLTIP }))}
            onMouseLeave={() => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'))}
          >
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={colorByDeferred}
              onChange={(e) => setColorByDeferred(e.target.checked)}
            />
            <span>Différer la coloration du tracé sur les très gros fichiers</span>
          </label>
          <label
            className={styles.checkboxRow}
            onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: EDIT_JOURNAL_TOOLTIP }))}
            onMouseLeave={() => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'))}
          >
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={editJournal}
              onChange={(e) => setEditJournalEnabled(e.target.checked)}
            />
            <span>Enregistrer l'historique des modifications dans le G-code</span>
          </label>
        </section>
      </motion.div>
    </div>
  );
};
