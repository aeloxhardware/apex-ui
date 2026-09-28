import React, { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import styles from './AxisSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { showSuccess } from '@/utils/toast';
import type { ParsedGCode } from './gcodeLayer';

type AxisMode = '3-axes' | '5-axes';

export const AxisSidebar: React.FC = () => {
  const [axisMode, setAxisMode] = useState<AxisMode>('5-axes');
  const axisModeRef = useRef(axisMode);
  axisModeRef.current = axisMode;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});

  const handleSelect = (mode: AxisMode) => {
    setAxisMode(mode);
    showSuccess(`Mode d'impression configuré : ${mode === '3-axes' ? '3 Axes Standard' : '5 Axes Avancé'}`);
    window.dispatchEvent(new CustomEvent('apex-axis-changed', { detail: { mode } }));
  };

  useEffect(() => {
    // Notify initial state on mount
    window.dispatchEvent(new CustomEvent('apex-axis-changed', { detail: { mode: '5-axes' } }));
  }, []);

  // Bascule automatique sur le type de G-code chargé en Prévisualisation : cartésien → 3 axes,
  // polaire Apex → 4 axes.
  useEffect(() => {
    const onGCodeLoaded = (e: Event) => {
      const kind = (e as CustomEvent<{ parsed: ParsedGCode }>).detail?.parsed?.kind;
      if (!kind) return;
      const mode: AxisMode = kind === 'cartesian' ? '3-axes' : '5-axes';
      if (mode === axisModeRef.current) return;
      setAxisMode(mode);
      showSuccess(`G-code ${mode === '3-axes' ? '3 axes' : '4 axes'} détecté : mode ${mode === '3-axes' ? '3 AXES' : '4 AXES'} activé.`);
      window.dispatchEvent(new CustomEvent('apex-axis-changed', { detail: { mode } }));
    };
    window.addEventListener('apex-gcode-loaded', onGCodeLoaded);
    return () => window.removeEventListener('apex-gcode-loaded', onGCodeLoaded);
  }, []);

  useEffect(() => {
    if (toolbarRef.current && buttonRefs.current.size > 0) {
      const activeBtn = buttonRefs.current.get(axisMode);
      if (activeBtn) {
        const toolbarRect = toolbarRef.current.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();

        setIndicatorStyle({
          width: btnRect.width,
          height: btnRect.height,
          left: btnRect.left - toolbarRect.left,
          top: btnRect.top - toolbarRect.top,
          opacity: 1,
        });
      }
    }
  }, [axisMode]);

  return (
    <div className={styles.container} data-apex-chrome-panel>
      <div ref={toolbarRef} className={styles.toolbar}>
        <div className={styles.activeIndicator} style={indicatorStyle} />

        <CustomTooltip content="Mode 3 Axes" description="Impression 3D cartésienne / delta standard (X, Y, Z).">
          <button
            ref={(el) => { if (el) buttonRefs.current.set('3-axes', el); }}
            className={clsx(styles.button, {
              [styles.active]: axisMode === '3-axes',
            })}
            onClick={() => handleSelect('3-axes')}
          >
            3 AXES
          </button>
        </CustomTooltip>

        <CustomTooltip content="Mode 5 Axes" description="Impression continue 5 axes avec tête inclinable et plateau rotatif (Cinématique avancée).">
          <button
            ref={(el) => { if (el) buttonRefs.current.set('5-axes', el); }}
            className={clsx(styles.button, {
              [styles.active]: axisMode === '5-axes',
            })}
            onClick={() => handleSelect('5-axes')}
          >
            4 AXES
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};