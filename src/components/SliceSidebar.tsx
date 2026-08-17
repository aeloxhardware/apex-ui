import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Play } from 'lucide-react';
import styles from './SliceSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { motion, AnimatePresence } from 'framer-motion';

interface SliceSidebarProps {
  onSlice?: () => void;
}

export const SliceSidebar: React.FC<SliceSidebarProps> = ({ onSlice }) => {
  const [isPreviewActive, setIsPreviewActive] = useState(false);

  useEffect(() => {
    const handlePreviewToggled = (e: CustomEvent<{ active: boolean }>) => {
      if (e.detail) {
        setIsPreviewActive(e.detail.active);
      }
    };
    window.addEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    return () => {
      window.removeEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    };
  }, []);

  return (
    <AnimatePresence>
      {!isPreviewActive && (
        <motion.div 
          className={styles.container}
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -320 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className={styles.toolbar}>
            <CustomTooltip content="Lancer le Slicing (Découpe)" description="Lancez le calcul complet du G-code pour transformer votre modèle 3D en trajectoires d'impression exploitables.">
              <button
                className={clsx(styles.button, styles.sliceButton, "w-full")}
                onClick={onSlice}
              >
                <Play size={16} className="fill-current mr-2 shrink-0" />
                <span className="font-semibold text-xs tracking-wide">SLICE</span>
              </button>
            </CustomTooltip>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};