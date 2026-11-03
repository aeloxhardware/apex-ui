import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

export const BackgroundAnimation: React.FC = () => {
  const gridLines = useMemo(() => {
    const lines: ({ id: string; type: 'h'; y: number } | { id: string; type: 'v'; x: number })[] = [];
    const step = 40;
    
    // Horizontal lines
    for (let y = 0; y <= 1080; y += step) {
      lines.push({ id: `h-${y}`, type: 'h', y });
    }
    
    // Vertical lines
    for (let x = 0; x <= 1920; x += step) {
      lines.push({ id: `v-${x}`, type: 'v', x });
    }
    
    return lines;
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 bg-[#070913]">
      <svg className="w-full h-full opacity-40" viewBox="0 0 1920 1080" preserveAspectRatio="none">
        <defs>
          <linearGradient id="grid-glow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00F0FF" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#00F0FF" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {gridLines.map((line) => {
          if (line.type === 'h') {
            return (
              <motion.line
                key={line.id}
                x1="0"
                y1={line.y}
                x2="1920"
                y2={line.y}
                stroke="url(#grid-glow)"
                strokeWidth="1"
                animate={{
                  opacity: [0.15, 0.4, 0.15],
                }}
                transition={{
                  duration: 3 + (line.y % 5),
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: (line.y % 100) / 50
                }}
              />
            );
          } else {
            return (
              <motion.line
                key={line.id}
                x1={line.x}
                y1="0"
                x2={line.x}
                y2="1080"
                stroke="url(#grid-glow)"
                strokeWidth="1"
                animate={{
                  opacity: [0.15, 0.4, 0.15],
                }}
                transition={{
                  duration: 3 + (line.x % 5),
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: (line.x % 100) / 50
                }}
              />
            );
          }
        })}
      </svg>
    </div>
  );
};