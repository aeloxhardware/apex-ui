import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  isColorByDeferred,
  setColorByDeferred,
  subscribeColorByDeferred,
} from '@/utils/gcodeColorByPrefs';
import styles from './ParamsPanel.module.scss';

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
        </section>
      </motion.div>
    </div>
  );
};
