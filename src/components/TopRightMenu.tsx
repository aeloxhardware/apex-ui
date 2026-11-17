import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { GlassPanelBackdrop } from './edit-node/GlassPanelBackdrop';
import styles from './TopRightMenu.module.scss';

const DEFAULT_TOOLTIP_DESC = "Survolez n'importe quel élément interactif de l'interface pour afficher sa description détaillée en temps réel.";

export const TopRightMenu: React.FC = () => {
  const [tooltipDesc, setTooltipDesc] = useState(DEFAULT_TOOLTIP_DESC);
  // Texte « ambiant » : celui de l'élément non interactif survolé qui porte `data-apex-tooltip`
  // (scène 3D, panneaux…), affiché dans le bandeau du bas sans bulle de souris. Un tooltip précis
  // (bouton, `CustomTooltip`, `apex-set-tooltip`) le recouvre le temps du survol, puis le bandeau
  // y revient au lieu de retomber sur le texte par défaut.
  const ambientRef = useRef<string | null>(null);
  // En Prévisualisation, la barre d'aide est dans le coin bas gauche : elle y est posée d'un coup, derrière le rideau.
  const [previewActive, setPreviewActive] = useState(false);

  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleGlobalTooltip = (e: CustomEvent<{ title: string; desc: string }>) => {
      if (e.detail) {
        setTooltipDesc(e.detail.desc);
      }
    };

    const handleResetTooltip = () => {
      setTooltipDesc(ambientRef.current ?? DEFAULT_TOOLTIP_DESC);
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest) return;
      const next = target.closest<HTMLElement>('[data-apex-tooltip]')?.dataset.apexTooltip ?? null;
      if (next === ambientRef.current) return;
      ambientRef.current = next;
      // Un élément interactif gère lui-même son texte (CustomTooltip, apex-set-tooltip).
      if (target.closest('button, label, input, select, textarea, a, [role="button"]')) return;
      setTooltipDesc(next ?? DEFAULT_TOOLTIP_DESC);
    };

    const handlePreviewToggled = (e: CustomEvent<{ active: boolean }>) => setPreviewActive(!!e.detail?.active);

    window.addEventListener('apex-set-tooltip', handleGlobalTooltip as EventListener);
    window.addEventListener('apex-reset-tooltip', handleResetTooltip);
    window.addEventListener('mouseover', handleMouseOver);
    window.addEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);

    return () => {
      window.removeEventListener('apex-set-tooltip', handleGlobalTooltip as EventListener);
      window.removeEventListener('apex-reset-tooltip', handleResetTooltip);
      window.removeEventListener('mouseover', handleMouseOver);
      window.removeEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    };
  }, []);

  return (
    <div
      className={clsx(styles.container, previewActive && styles.containerPreview)}
      data-apex-chrome-panel
    >
      <GlassPanelBackdrop targetRef={toolbarRef} corner={20} warp={1.8} />
      <div
        ref={toolbarRef}
        data-apex-tooltip="Guide pratique indiquant l'opération réalisée par l'élément couramment survolé de l'interface"
        className={clsx(styles.toolbar, styles.secondaryToolbar)}
      >
        <div className={styles.infoDisplayBottom}>
          {tooltipDesc}
        </div>
      </div>
    </div>
  );
};
