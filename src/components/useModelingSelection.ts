import React, { useState, useRef, useEffect } from 'react';
import { SELECTION_LOCKED } from './modelingData';
import type { SelectionMode } from '@/modeling/types';

import { emitApex } from '@/events/apexEvents';
/**
 * Indicateur coulissant du sélecteur de granularité (même technique que AxisSidebar).
 * Mesuré par rectangles ramenés à l'échelle locale de la barre (insensible aux transformations
 * d'animation d'entrée du panneau) et remesuré quand la taille change :
 * à l'ouverture depuis un autre espace, le panneau est encore en cours d'apparition au
 * premier passage, d'où un indicateur trop large jusqu'au prochain changement de mode.
 */
function useSelectionIndicator(selectionMode: SelectionMode) {
  const segmentedRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});

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

  return { segmentedRef, segmentRefs, indicatorStyle };
}

/** Mode de sélection (corps/face/arête/sommet), son indicateur et la bascule temporaire de l'Extrusion. */
export function useModelingSelection() {
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('body');
  const indicator = useSelectionIndicator(selectionMode);

  const handleSelectionMode = (mode: SelectionMode) => {
    setSelectionMode(mode);
    emitApex('apex-selection-mode-changed', { mode });
  };

  // L'outil Extrusion choisit des faces : le sélecteur passe sur « Face » (mode précédent mémorisé,
  // rendu à la fin de l'outil).
  const modeBeforeExtrudeRef = useRef<SelectionMode | null>(null);
  const enterExtrudeSelectionMode = () => {
    if (modeBeforeExtrudeRef.current === null) modeBeforeExtrudeRef.current = selectionMode;
    handleSelectionMode('face');
  };
  const leaveExtrudeSelectionMode = () => {
    const previous = modeBeforeExtrudeRef.current;
    modeBeforeExtrudeRef.current = null;
    if (previous) handleSelectionMode(previous);
  };

  return { selectionMode, handleSelectionMode, enterExtrudeSelectionMode, leaveExtrudeSelectionMode, ...indicator };
}
