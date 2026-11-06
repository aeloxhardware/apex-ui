import { useEffect } from 'react';
import { nextId } from '@/modeling/types';
import type { SubMeshItem } from './constants';
import type { ModelNode } from './constants';
import type React from 'react';

/** Synchronise l'arborescence avec le viewport : mode modélisation et corps présents dans la scène. */
export function useModelTreeSync({ setSelectedModel, setModels }: {
  setSelectedModel: React.Dispatch<React.SetStateAction<string>>;
  setModels: React.Dispatch<React.SetStateAction<ModelNode[]>>;
}) {


  /** Le viewport a besoin de connaître l'état initial dès le montage du panneau. */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('apex-mode-changed', { detail: { mode: 'modeling' } }));
    window.dispatchEvent(new CustomEvent('apex-selection-mode-changed', { detail: { mode: 'body' } }));

    return () => {
      // Retour au slicer : le viewport doit restaurer plateau, boundary shader et gizmos.
      window.dispatchEvent(new CustomEvent('apex-mode-changed', { detail: { mode: 'slicer' } }));
      window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
    };
  }, []);

  /**
   * L'arborescence reflète les corps réellement présents dans la scène : on suit les mêmes
   * événements que ModelStatusBox plutôt que de tenir une liste parallèle qui divergerait.
   */
  useEffect(() => {
    const handleMeshSelected = (
      e: CustomEvent<{ name: string | null; names?: string[]; subMeshes?: SubMeshItem[] }>,
    ) => {
      const name = e.detail?.name ?? null;
      setSelectedModel(name);
      if (!name || !e.detail?.subMeshes) return;

      setModels((prev) => {
        const exists = prev.some((m) => m.name === name);
        if (!exists) {
          return [...prev, { id: nextId('body'), name, children: e.detail.subMeshes!, features: [] }];
        }
        return prev.map((m) => (m.name === name ? { ...m, children: e.detail.subMeshes! } : m));
      });
    };

    const handleMeshDeleted = (e: CustomEvent<{ name?: string }>) => {
      const deleted = e.detail?.name;
      if (deleted) {
        setModels((prev) => prev.filter((m) => m.name !== deleted));
        setSelectedModel((cur) => (cur === deleted ? null : cur));
      } else {
        setModels([]);
        setSelectedModel(null);
      }
    };

    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    window.addEventListener('apex-mesh-deleted', handleMeshDeleted as EventListener);
    window.addEventListener('apex-delete-all-models', handleMeshDeleted as EventListener);

    return () => {
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
      window.removeEventListener('apex-mesh-deleted', handleMeshDeleted as EventListener);
      window.removeEventListener('apex-delete-all-models', handleMeshDeleted as EventListener);
    };
  }, []);
  return {  };
}
