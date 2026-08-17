import React, { useState } from 'react';
import styles from './Tooltip.module.scss';
import clsx from 'clsx';

interface CustomTooltipProps {
  content: string;
  children: React.ReactNode;
  className?: string;
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({ content, children, className }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div 
      className={clsx(styles.tooltipWrapper, className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      <div className={clsx(styles.tooltipBubble, { [styles.visible]: visible })}>
        {content}
      </div>
    </div>
  );
};