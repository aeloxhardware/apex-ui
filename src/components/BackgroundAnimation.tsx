import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

export const BackgroundAnimation: React.FC = () => {
  const dots = useMemo(() => {
    const list = [];
    for (let row = 0; row < 18; row++) {
      for (let col = 0; col < 32; col++) {
        list.push({ 
          id: `${row}-${col}`, 
          x: col * 60 + 30, 
          y: row * 60 + 30, 
          delay: Math.random() * 2,
          duration: 1.5 + Math.random() * 2,
          maxOpacity: 0.2 + Math.random() * 0.4
        });
      }
    }
    return list;
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 bg-[#070913]">
      {/* Subtle deep gradient lighting */}
      <div className="absolute inset-0 bg-gradient-to-tr from-purple-950/20 via-transparent to-cyan-950/20" />
      
      <svg className="w-full h-full opacity-70" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
        {dots.map((dot) => (
          <motion.circle
            key={dot.id}
            cx={dot.x}
            cy={dot.y}
            r="1.8"
            animate={{
              fill: ["#00F0FF", "#3b82f6", "#8b5cf6", "#00F0FF"],
              opacity: [0.1, dot.maxOpacity, dot.maxOpacity * 0.2, dot.maxOpacity, 0.1],
              scale: [1, 1.3, 0.9, 1.2, 1]
            }}
            transition={{
              duration: dot.duration,
              delay: dot.delay,
              repeat: Infinity,
              repeatType: "mirror",
              ease: "easeInOut"
            }}
          />
        ))}
      </svg>
    </div>
  );
};