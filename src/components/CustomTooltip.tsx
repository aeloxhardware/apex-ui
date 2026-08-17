import React, { useRef } from 'react';
import styles from './Tooltip.module.scss';

interface CustomTooltipProps {
  content: string;
  description: string;
  children: React.ReactNode;
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({ content, description, children }) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
    }, 150);

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
    window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));
  };

  return (
    <div 
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={styles.tooltipWrapper}
    >
      {children}
    </div>
  );
};