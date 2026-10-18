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
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({ content, description, children, inline = false }) => {
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
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      style={inline ? { width: 'auto' } : undefined}
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