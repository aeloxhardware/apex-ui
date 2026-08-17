import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import styles from './TopRightMenu.module.scss';

export const TopRightMenu: React.FC = () => {
  const [tooltipTitle, setTooltipTitle] = useState("Apex");
  const [tooltipDesc, setTooltipDesc] = useState("Survolez n'importe quel élément interactif de l'interface pour afficher son titre et sa description détaillée en temps réel.");

  useEffect(() => {
    const handleGlobalTooltip = (e: CustomEvent<{ title: string; desc: string }>) => {
      if (e.detail) {
        setTooltipTitle(e.detail.title);
        setTooltipDesc(e.detail.desc);
      }
    };

    const handleResetTooltip = () => {
      setTooltipTitle("Apex");
      setTooltipDesc("Survolez n'importe quel élément interactif de l'interface pour afficher son titre et sa description détaillée en temps réel.");
    };

    window.addEventListener('apex-set-tooltip', handleGlobalTooltip as EventListener);
    window.addEventListener('apex-reset-tooltip', handleResetTooltip);

    return () => {
      window.removeEventListener('apex-set-tooltip', handleGlobalTooltip as EventListener);
      window.removeEventListener('apex-reset-tooltip', handleResetTooltip);
    };
  }, []);

  return (
    <div className={styles.container}>
      {/* Panneau du haut : Titre en grand */}
      <div className={styles.toolbar}>
        <div className={styles.infoDisplayTop} style={{ fontFamily: "'Orbitron', sans-serif" }}>
          {tooltipTitle}
        </div>
      </div>

      {/* Panneau du bas : Description détaillée (hauteur 2.5x) */}
      <div className={clsx(styles.toolbar, styles.secondaryToolbar)}>
        <div className={styles.infoDisplayBottom}>
          {tooltipDesc}
        </div>
      </div>
    </div>
  );
};