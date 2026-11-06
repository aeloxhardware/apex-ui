import { useEffect, useRef } from 'react';
import { SelectionMode } from '@/modeling/types';
import type { ModelNode } from './constants';
import type React from 'react';

/** Mode de sélection (corps, face, arête…) et son passage automatique sur « Face » pendant l'extrusion. */
export function useSelectionMode({ models, setSelectionMode, selectionMode }: {
  models: ModelNode[];
  setSelectionMode: React.Dispatch<React.SetStateAction<SelectionMode>>;
  selectionMode: SelectionMode;
}) {


  /** L'arbre est la source de vérité : toute mutation déclenche un replay côté viewport. */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('apex-feature-tree-updated', { detail: { models } }));
  }, [models]);

  const handleSelectionMode = (mode: SelectionMode) => {
    setSelectionMode(mode);
    window.dispatchEvent(new CustomEvent('apex-selection-mode-changed', { detail: { mode } }));
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
  return { leaveExtrudeSelectionMode, enterExtrudeSelectionMode, handleSelectionMode };
}
