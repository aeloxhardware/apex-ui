import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

export const BackgroundAnimation: React.FC = () => {
  const dots = useMemo(() => {
    const list = [];
    for (let row = 0; row < 36; row++) {
      for (let col = 0; col < 64; col++) {
        list.push({ 
          id: `${row}-${col}`, 
          x: col * 30 + 15, 
          y: row * 30 + 15, 
          delay: Math.random() * 3,
          duration: 3 + Math.random() * 3,
          maxOpacity: 0.12 + Math.random() * 0.18
        });
      }
    }
    return list;
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 bg-[#070913]">
      <svg className="w-full h-full" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
        {dots.map((dot) => (
          <motion.circle
            key={dot.id}
            cx={dot.x}
            cy={dot.y}
            r="1.2"
            animate={{
              fill: "#00F0FF",
              opacity: [0.02, dot.maxOpacity, dot.maxOpacity * 0.2, dot.maxOpacity, 0.02],
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