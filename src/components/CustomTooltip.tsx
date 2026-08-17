import React, { useState } from 'react';

interface CustomTooltipProps {
  content: string;
  description: string;
  children: React.ReactNode;
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({ content, description, children }) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });

  const handleMouseEnter = (e: React.MouseEvent) => {
    setCoords({ x: e.clientX + 12, y: e.clientY + 16 });
    setVisible(true);
    window.dispatchEvent(
      new CustomEvent('apex-set-tooltip', {
        detail: { title: content, desc: description }
      })
    );
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setCoords({ x: e.clientX + 12, y: e.clientY + 16 });
  };

  const handleMouseLeave = () => {
    setVisible(false);
    window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));
  };

  return (
    <div 
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="inline-flex"
    >
      {children}
      {visible && (
        <div 
          style={{ top: coords.y, left: coords.x }}
          className="fixed z-[9999] pointer-events-none px-2.5 py-1 rounded bg-[#0a0f1a]/90 backdrop-blur-md border border-[#00f0ff]/30 text-[#00f0ff] text-xs font-orbitron shadow-[0_0_12px_rgba(0,240,255,0.3)] animate-in fade-in zoom-in-95 duration-150"
        >
          {content}
        </div>
      )}
    </div>
  );
};