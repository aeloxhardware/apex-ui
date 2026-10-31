import React, { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import styles from './AxisSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { showSuccess } from '@/utils/toast';
import { PAN_PERSPECTIVE_EVENT, readPanPerspective, setPanPerspective } from '@/utils/panPerspectivePrefs';
import { hideBottomTip, showBottomTip } from './edit-node/bottomTooltip';
import type { ParsedGCode } from './gcodeLayer';

type AxisMode = '3-axes' | '5-axes';

export const AxisSidebar: React.FC = () => {
  const [axisMode, setAxisMode] = useState<AxisMode>('5-axes');
  const axisModeRef = useRef(axisMode);
  axisModeRef.current = axisMode;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});
  // Perspective (Viewport3D) : bas = désactivée (vue orthographique, l'image glisse, même angle de vue),
  // haut = activée (vue en perspective, la caméra se déplace).
  const [panPerspective, setPanPerspectiveState] = useState(readPanPerspective);
  // Suit aussi les bascules automatiques (Modélisation : désactivée, autres espaces : activée,
  // cf. modelingSpace.ts) ; l'utilisateur garde la main à tout moment.
  useEffect(() => {
    const onChange = (e: Event) => setPanPerspectiveState(!!(e as CustomEvent<{ enabled: boolean }>).detail?.enabled);
    window.addEventListener(PAN_PERSPECTIVE_EVENT, onChange);
    return () => window.removeEventListener(PAN_PERSPECTIVE_EVENT, onChange);
  }, []);
  const togglePanPerspective = () => setPanPerspective(!panPerspective);
  // Infobulle de bas d'écran gérée ici (pas CustomTooltip, qui la remet à son message par défaut
  // au clic) : elle suit l'état de l'interrupteur tant que la souris est dessus.
  const switchTip = {
    title: 'Perspective en translation',
    desc: panPerspective
      ? 'Activée : déplacer la vue (bouton du milieu) déplace la caméra, les objets changent d’angle comme dans la réalité. Cliquer pour la désactiver.'
      : 'Désactivée : vue orthographique, sans perspective (comme Fusion 360). Déplacer la vue (bouton du milieu) fait glisser l’image, la molette change l’échelle vers le curseur, et un plan vu de face ou de côté s’aligne exactement (vu de côté, le plateau n’est qu’un trait). Cliquer pour l’activer.',
  };
  const switchHovered = useRef(false);
  useEffect(() => {
    if (switchHovered.current) showBottomTip(switchTip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panPerspective]);

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
  // polaire Apex → 5 axes.
  useEffect(() => {
    const onGCodeLoaded = (e: Event) => {
      const kind = (e as CustomEvent<{ parsed: ParsedGCode }>).detail?.parsed?.kind;
      if (!kind) return;
      const mode: AxisMode = kind === 'cartesian' ? '3-axes' : '5-axes';
      if (mode === axisModeRef.current) return;
      setAxisMode(mode);
      showSuccess(`G-code ${mode === '3-axes' ? '3 axes' : '5 axes'} détecté : mode ${mode === '3-axes' ? '3 AXES' : '5 AXES'} activé.`);
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
      <button
        type="button"
        role="switch"
        aria-checked={panPerspective}
        aria-label="Perspective en translation"
        className={clsx(styles.perspectiveSwitch, panPerspective && styles.perspectiveOn)}
        onClick={togglePanPerspective}
        onPointerEnter={() => {
          switchHovered.current = true;
          showBottomTip(switchTip);
        }}
        onPointerLeave={() => {
          switchHovered.current = false;
          hideBottomTip();
        }}
      >
        <span className={styles.perspectiveKnob} />
      </button>
      <div
        ref={toolbarRef}
        className={styles.toolbar}
        data-apex-tooltip="Mode d'impression : 3 axes (cartésien standard) ou 5 axes (tête inclinable et plateau rotatif)."
      >
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
            5 AXES
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};