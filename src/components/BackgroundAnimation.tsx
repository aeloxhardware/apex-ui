import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

export const BackgroundAnimation: React.FC = () => {
  const dots = useMemo(() => {
    const list = [];
    const rows = 18; // moitié pour symétrie verticale
    const cols = 32; // moitié pour symétrie horizontale
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * 60 + 30;
        const y = row * 60 + 30;
        const mirrorX = (cols * 60) - x;
        const mirrorY = (rows * 60) - y;
        
        // Identifiants uniques et paramètres partagés pour la symétrie exacte
        const baseDelay = Math.random() * 0.8;
        const baseDuration = 0.6 + Math.random() * 0.8;
        const maxOp = 0.3 + Math.random() * 0.5;

        // Point original
        list.push({
          id: `${row}-${col}-orig`,
          x,
          y,
          delay: baseDelay,
          duration: baseDuration,
          maxOpacity: maxOp
        });

        // Symétrique X
        list.push({
          id: `${row}-${col}-symX`,
          x: mirrorX,
          y,
          delay: baseDelay,
          duration: baseDuration,
          maxOpacity: maxOp
        });

        // Symétrique Y
        list.push({
          id: `${row}-${col}-symY`,
          x,
          y: mirrorY,
          delay: baseDelay,
          duration: baseDuration,
          maxOpacity: maxOp
        });

        // Symétrique X et Y (centre/diagonal)
        list.push({
          id: `${row}-${col}-symXY`,
          x: mirrorX,
          y: mirrorY,
          delay: baseDelay,
          duration: baseDuration,
          maxOpacity: maxOp
        });
      }
    }
    return list;
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 bg-[#070913]">
      <svg className="w-full h-full" viewBox="0 0 1920 1080" preserveAspectRatio="none">
        {dots.map((dot) => (
          <motion.circle
            key={dot.id}
            cx={dot.x}
            cy={dot.y}
            r="1.5"
            animate={{
              fill: "#00F0FF",
              opacity: [0, dot.maxOpacity, dot.maxOpacity * 0.3, dot.maxOpacity],
            }}
            transition={{
              opacity: {
                duration: dot.duration,
                delay: dot.delay,
                repeat: Infinity,
                repeatType: "mirror",
                ease: "easeInOut"
              }
            }}
          />
        ))}
      </svg>
    </div>
  );
};