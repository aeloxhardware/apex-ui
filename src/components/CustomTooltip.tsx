import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.scss';

interface CustomTooltipProps {
  content: string;
  description: string;
  children: React.ReactNode;
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({ content, description, children }) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; transform: string }>({ top: 0, left: 0, transform: '' });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      
      // Check if it's inside a vertical sidebar (left or right side of screen)
      const isVertical = rect.left < window.innerWidth / 4 || rect.right > (window.innerWidth * 3) / 4;

      if (isVertical && rect.left < window.innerWidth / 2) {
        // Left vertical sidebar -> show on the right of the button
        setCoords({
          top: rect.top + rect.height / 2,
          left: rect.right + 12,
          transform: 'translateY(-50%)',
        });
      } else if (isVertical) {
        // Right vertical sidebar -> show on the left of the button
        setCoords({
          top: rect.top + rect.height / 2,
          left: rect.left - 12,
          transform: 'translateY(-50%) translateX(-100%)',
        });
      } else {
        // Horizontal toolbar -> show below the button
        setCoords({
          top: rect.bottom + 14,
          left: rect.left + rect.width / 2,
          transform: 'translateX(-50%)',
        });
      }
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
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            transform: coords.transform,
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </div>
  );
};