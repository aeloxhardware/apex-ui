import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.scss';

interface CustomTooltipProps {
  content: string;
  description: string;
  children: React.ReactNode;
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({ content, description, children }) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 14,
        left: rect.left + rect.width / 2,
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

  return (
    <div 
      ref={wrapperRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={styles.tooltipWrapper}
    >
      {children}
      {visible && createPortal(
        <div 
          className={`${styles.tooltipBubble} ${styles.visible}`}
          style={{
            position: 'fixed',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            transform: 'translateX(-50%) translateY(0)',
            zIndex: 999999,
            pointerEvents: 'none'
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </div>
  );
};