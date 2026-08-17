import React from 'react';

interface CustomTooltipProps {
  content: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({ content, description, children, className }) => {
  const handleMouseEnter = () => {
    window.dispatchEvent(
      new CustomEvent('apex-set-tooltip', {
        detail: {
          title: content,
          desc: description || "Aucune description supplémentaire disponible pour cet élément."
        }
      })
    );
  };

  const handleMouseLeave = () => {
    window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));
  };

  return (
    <div 
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </div>
  );
};