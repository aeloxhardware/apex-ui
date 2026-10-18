import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePortalRoot } from '@/components/GpuWarningFrame';
import styles from './Tooltip.module.scss';

interface CustomTooltipProps {
  content: string;
  description: string;
  children: React.ReactNode;
  /** Enveloppe en ligne (au fil du texte) au lieu d'un bloc pleine largeur ; la bulle se centre alors sur l'enfant. */
  inline?: boolean;
  /**
   * Infobulle d'un CONTENEUR (barre d'outils) dont les boutons ont la leur : elle ne s'affiche que
   * sur le fond du conteneur, jamais par-dessus un bouton (qui garde son propre texte, dans la
   * bulle comme dans le bandeau du bas).
   */
  container?: boolean;
  /** Style de l'enveloppe, pour un conteneur qui doit remplir son parent (barre d'outils portée). */
  wrapperStyle?: React.CSSProperties;
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({
  content, description, children, inline = false, container = false, wrapperStyle,
}) => {
  const portalRoot = usePortalRoot();
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; transform: string }>({ top: 0, left: 0, transform: '' });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 12,
        left: rect.left + rect.width / 2,
        transform: 'translateX(-50%)',
      });
    }

    timeoutRef.current = setTimeout(() => {
      setVisible(true);
    }, 200);

    window.dispatchEvent(
      new CustomEvent('apex-set-tooltip', {
        detail: { title: content, desc: description }
      })
    );
  };

  // Conteneur : `mouseover` (qui remonte depuis les enfants) plutôt que `mouseenter`, pour distinguer
  // le fond de la barre d'un de ses boutons.
  const handleMouseOver = (e: React.MouseEvent) => {
    const button = (e.target as HTMLElement).closest?.('button');
    if (button && wrapperRef.current?.contains(button)) {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      setVisible(false);
      return;
    }
    if (visible || timeoutRef.current) {
      window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: { title: content, desc: description } }));
      return;
    }
    handleMouseEnter();
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setVisible(false);
    window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));
  };

  // Un clic est une intention d'action, pas un survol prolongé : sans ce reset, la bulle reste
  // affichée (la souris n'a pas bougé) et chevauche l'élément que le clic vient de faire
  // apparaître juste en dessous (ex. le panneau de catégorie qui naît sous son bouton).
  const handleMouseDown = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setVisible(false);
    window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));
  };

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={container ? undefined : handleMouseEnter}
      onMouseOver={container ? handleMouseOver : undefined}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      style={inline || wrapperStyle ? { ...(inline ? { width: 'auto' } : null), ...wrapperStyle } : undefined}
      className={`${styles.tooltipWrapper} ${inline ? 'inline-flex' : 'w-full flex'}`}
    >
      {children}
      {visible && createPortal(
        <div 
          className={`${styles.tooltipBubble} ${styles.visible}`}
          style={{
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            transform: coords.transform,
          }}
        >
          {content}
        </div>,
        portalRoot
      )}
    </div>
  );
};