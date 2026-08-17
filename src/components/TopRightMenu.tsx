import React, { useEffect, useState, useRef } from 'react';
import clsx from 'clsx';
import styles from './TopRightMenu.module.scss';

export const TopRightMenu: React.FC = () => {
  const [tooltipTitle, setTooltipTitle] = useState("Apex");
  const [tooltipDesc, setTooltipDesc] = useState("Survolez n'importe quel élément interactif de l'interface pour afficher son titre et sa description détaillée en temps réel.");
  const [isOverflowing, setIsOverflowing] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Inject Orbitron font link into document head if not present
    if (!document.getElementById('google-font-orbitron')) {
      const link = document.createElement('link');
      link.id = 'google-font-orbitron';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;800;900&display=swap';
      document.head.appendChild(link);
    }

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

  useEffect(() => {
    if (textRef.current && containerRef.current) {
      const textWidth = textRef.current.scrollWidth;
      const containerWidth = containerRef.current.clientWidth;
      setIsOverflowing(textWidth > containerWidth);
    }
  }, [tooltipTitle]);

  return (
    <div className={styles.container}>
      {/* Panneau du haut : Titre en grand avec défilement si trop long */}
      <div className={styles.toolbar} ref={containerRef}>
        <div className={styles.infoDisplayTopWrapper}>
          <div 
            ref={textRef}
            className={clsx(styles.infoDisplayTop, { [styles.scrolling]: isOverflowing })} 
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            {tooltipTitle}
          </div>
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