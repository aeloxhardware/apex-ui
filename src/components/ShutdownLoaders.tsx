import React from 'react';
import styles from './ShutdownLoaders.module.scss';

/**
 * Animation de chargement du rideau de fermeture (SpaceTransitionOverlay), au-dessus du message : cinq strates de trois
 * cellules. Elles se déposent de bas en haut, comme les couches d'une impression 3D, et dans chaque strate les cellules
 * surgissent en vague diagonale ; puis tout se retire et recommence.
 * Pas d'équivalent en interface classique (aucune animation, par décision).
 */
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export const ShutdownLoaders: React.FC = () => (
  <div className={styles.loader} aria-hidden>
    {range(5).map((row) => (
      <div key={row} className={styles.strata}>
        {range(3).map((col) => (
          <span key={col} style={{ animationDelay: `${row * 0.22 + col * 0.07}s` }} />
        ))}
      </div>
    ))}
  </div>
);
