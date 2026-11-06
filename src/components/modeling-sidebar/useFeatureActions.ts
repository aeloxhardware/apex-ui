import { Feature } from '@/modeling/types';
import React, { useState, useEffect } from 'react';
import type { ModelNode } from './constants';

/** Actions sur l'arborescence : modifier, supprimer, supprimer l'effet, déplier, sélectionner. */
export function useFeatureActions({ setModels, setSelectedFeatureId, setSelectedModel, setExpanded, targetModel, selectedFeatureId }: {
  setModels: React.Dispatch<React.SetStateAction<ModelNode[]>>;
  setSelectedFeatureId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedModel: React.Dispatch<React.SetStateAction<string>>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  targetModel: ModelNode;
  selectedFeatureId: string;
}) {


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
    window.dispatchEvent(new CustomEvent('apex-select-model', { detail: { name } }));
  };

  const toggleExpand = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedFeature =
    targetModel?.features.find((f) => f.id === selectedFeatureId) ?? null;

  // Slot exposé par Sidebar (même conteneur physique que la barre d'outils slicer, voir
  // Sidebar.tsx) : Sidebar est toujours monté en parallèle, donc le noeud existe déjà quand
  // ce composant apparaît — pas de souci d'ordre de montage à gérer.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setToolbarSlot(document.getElementById('apex-modeling-toolbar-slot'));
  }, []);
  return { selectModelInViewport, toggleExpand, toggleSuppress, deleteFeature, selectedFeature, updateFeature, toolbarSlot };
}
