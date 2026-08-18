import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import styles from './TopRightMenu.module.scss';

export const TopRightMenu: React.FC = () => {
  const [tooltipDesc, setTooltipDesc] = useState("Survolez n'importe quel élément interactif de l'interface pour afficher sa description détaillée en temps réel.");

  useEffect(() => {
    if (!document.getElementById('google-font-oxanium')) {
      const link = document.createElement('link');
      link.id = 'google-font-oxanium';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Oxanium:wght@400;500;600;700&display=swap';
      document.head.appendChild(link);
    }

    const handleGlobalTooltip = (e: CustomEvent<{ title: string; desc: string }>) => {
      if (e.detail) {
        setTooltipDesc(e.detail.desc);
      }
    };

    const handleResetTooltip = () => {
      setTooltipDesc("Survolez n'importe quel élément interactif de l'interface pour afficher sa description détaillée en temps réel.");
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
      <div className={clsx(styles.toolbar, styles.secondaryToolbar)}>
        <div className={styles.infoDisplayBottom}>
          {tooltipDesc}
        </div>
      </div>
    </div>
  );
};