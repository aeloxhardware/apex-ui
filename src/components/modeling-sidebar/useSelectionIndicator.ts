import { useEffect } from 'react';
import { SELECTION_LOCKED } from './constants';
import type React from 'react';

/** Indicateur coulissant du sélecteur de granularité. */
export function useSelectionIndicator({ segmentedRef, segmentRefs, selectionMode, setIndicatorStyle }: {
  segmentedRef: React.RefObject<HTMLDivElement>;
  segmentRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  selectionMode: SelectionMode;
  setIndicatorStyle: React.Dispatch<React.SetStateAction<React.CSSProperties>>;
}) {


  /**
   * Indicateur coulissant du sélecteur de granularité (même technique que AxisSidebar).
   * Mesuré par rectangles ramenés à l'échelle locale de la barre (insensible aux transformations
   * d'animation d'entrée du panneau) et remesuré quand la taille change :
   * à l'ouverture depuis un autre espace, le panneau est encore en cours d'apparition au
   * premier passage, d'où un indicateur trop large jusqu'au prochain changement de mode.
   */
  useEffect(() => {
    const bar = segmentedRef.current;
    if (!bar) return;
    const measure = () => {
      const activeBtn = segmentRefs.current.get(selectionMode);
      if (!activeBtn) return;
      // Les boutons sont enveloppés (CustomTooltip) : leur offsetParent n'est pas la barre, donc
      // offsetLeft/offsetTop ne conviennent pas. On prend les rectangles écran et on les ramène à
      // l'échelle locale de la barre (rapport offsetWidth / largeur écran), ce qui neutralise la
      // transformation d'animation d'entrée du panneau.
      const barRect = bar.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      if (barRect.width === 0 || barRect.height === 0) return;
      const sx = bar.offsetWidth / barRect.width;
      const sy = bar.offsetHeight / barRect.height;
      setIndicatorStyle({
        width: btnRect.width * sx,
        height: btnRect.height * sy,
        left: (btnRect.left - barRect.left) * sx,
        top: (btnRect.top - barRect.top) * sy,
        opacity: SELECTION_LOCKED ? 0 : 1,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    segmentRefs.current.forEach((btn) => observer.observe(btn));
    return () => observer.disconnect();
  }, [selectionMode]);
  return {  };
}
