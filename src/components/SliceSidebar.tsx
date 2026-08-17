import React, { useMemo } from 'react';
import clsx from 'clsx';
import { Play } from 'lucide-react';
import { motion } from 'framer-motion';
import styles from './SliceSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';

interface SliceSidebarProps {
  onSlice?: () => void;
}

const StaggeredDotsPattern = ({ isSelected }: { isSelected: boolean }) => {
  const dots = useMemo(() => {
    const list = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 12; col++) {
        list.push({ 
          id: `${row}-${col}`, 
          x: col * 20 + 10, 
          y: row * 20 + 10, 
          delay: Math.random() * 0.8,
          duration: 0.6 + Math.random() * 0.8,
          maxOpacity: 0.3 + Math.random() * 0.5
        });
      }
    }
    return list;
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[16px]">
      <svg className="w-full h-full" viewBox="0 0 240 80" preserveAspectRatio="none">
        {dots.map((dot) => (
          <motion.circle
            key={dot.id}
            cx={dot.x}
            cy={dot.y}
            r="1.5"
            animate={{
              fill: "#00F0FF",
              opacity: isSelected ? [0, dot.maxOpacity, dot.maxOpacity * 0.3, dot.maxOpacity] : [0.1, 0.4, 0.1],
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

export const SliceSidebar: React.FC<SliceSidebarProps> = ({ onSlice }) => {
  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <StaggeredDotsPattern isSelected={true} />
        <CustomTooltip content="Slice Plate">
          <button
            className={clsx(styles.button, styles.sliceButton)}
            onClick={onSlice}
          >
            <Play size={16} className="fill-current mr-2 z-10 relative" />
            <span className="font-semibold text-xs tracking-wide z-10 relative">SLICE</span>
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};