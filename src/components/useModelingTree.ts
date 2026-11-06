import React, { useState, useEffect } from 'react';
import { nextId, type Feature } from '@/modeling/types';
import type { SubMeshItem, ModelNode } from './modelingData';

import { emitApex } from '@/events/apexEvents';
/**
 * L'arborescence reflète les corps réellement présents dans la scène : on suit les mêmes
 * événements que ModelStatusBox plutôt que de tenir une liste parallèle qui divergerait.
 */
function useMeshEvents(
  setModels: React.Dispatch<React.SetStateAction<ModelNode[]>>,
  setSelectedModel: React.Dispatch<React.SetStateAction<string | null>>,
) {
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
}

/** Arbre des corps/features : état, événements de la scène et mutations. */
export function useModelingTree() {
  const [models, setModels] = useState<ModelNode[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useMeshEvents(setModels, setSelectedModel);

  /** L'arbre est la source de vérité : toute mutation déclenche un replay côté viewport. */
  useEffect(() => {
    emitApex('apex-feature-tree-updated', { models });
  }, [models]);

  const updateFeature = (modelId: string, featureId: string, patch: Partial<Feature>) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id !== modelId
          ? m
          : { ...m, features: m.features.map((f) => (f.id === featureId ? ({ ...f, ...patch } as Feature) : f)) },
      ),
    );
  };

  const deleteFeature = (modelId: string, featureId: string) => {
    setModels((prev) =>
      prev.map((m) => (m.id !== modelId ? m : { ...m, features: m.features.filter((f) => f.id !== featureId) })),
    );
    setSelectedFeatureId((cur) => (cur === featureId ? null : cur));
  };

  const toggleSuppress = (modelId: string, featureId: string) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id !== modelId
          ? m
          : { ...m, features: m.features.map((f) => (f.id === featureId ? { ...f, suppressed: !f.suppressed } : f)) },
      ),
    );
  };

  const selectModelInViewport = (name: string) => {
    setSelectedModel(name);
    emitApex('apex-select-model', { name });
  };

  const toggleExpand = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return {
    models, setModels, selectedModel, setSelectedModel, selectedFeatureId, setSelectedFeatureId,
    expanded, setExpanded, updateFeature, deleteFeature, toggleSuppress, selectModelInViewport, toggleExpand,
  };
}

export type ModelingTree = ReturnType<typeof useModelingTree>;
