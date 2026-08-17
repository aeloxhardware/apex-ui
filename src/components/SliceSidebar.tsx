import React, { useState } from 'react';
import clsx from 'clsx';
import { Play, Layers } from 'lucide-react';
import styles from './SliceSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';

interface SliceSidebarProps {
  onSlice?: () => void;
}

export const SliceSidebar: React.FC<SliceSidebarProps> = ({ onSlice }) => {
  const [isLayerActive, setIsLayerActive] = useState(false);

  const handleLayerClick = () => {
    const newState = !isLayerActive;
    setIsLayerActive(newState);
    window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: newState ? 'layers' : 'select' } }));
  };

  return (
    <div className={styles.container}>
      <div className={styles.toolbar} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <CustomTooltip content="Lancer le Slicing (Découpe)" description="Lancez le calcul complet du G-code pour transformer votre modèle 3D en trajectoires d'impression exploitables.">
          <button
            className={clsx(styles.button, styles.sliceButton, "w-full")}
            onClick={onSlice}
          >
            <Play size={16} className="fill-current mr-2 shrink-0" />
            <span className="font-semibold text-xs tracking-wide">SLICE</span>
          </button>
        </CustomTooltip>

        <CustomTooltip content="Prévisualisation" description="Visualisez le parcours de la buse et ajustez différents paramètres si cela ne vous convient pas.">
          <button
            className={clsx(styles.button, "w-full py-2.5 px-4 rounded-xl flex items-center justify-center transition-all duration-200", {
              "bg-[rgba(0,240,255,0.22)] text-[#00f0ff] shadow-[0_0_12px_rgba(0,240,255,0.25)]": isLayerActive,
              "bg-white/5 hover:bg-white/10 text-zinc-300": !isLayerActive
            })}
            onClick={handleLayerClick}
          >
            <Layers size={16} className="mr-2 shrink-0" />
            <span className="font-semibold text-xs tracking-wide">LAYER VIEWER</span>
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};