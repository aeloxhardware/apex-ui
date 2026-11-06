import { useRef, useEffect } from 'react';
import { SketchEntityKind, SketchPlaneRef, nextId, FEATURE_LABELS, Feature, SketchEntity } from '@/modeling/types';
import { showSuccess } from '@/utils/toast';
import type { ModelNode } from './constants';
import type { FloatingSketch } from './constants';
import type React from 'react';

/** Création de l'esquisse une fois le plan choisi dans le viewport. */
export function useSketchPlane({ models, selectedModel, sketchEntity, setSketchEntity, setSketchPlaneChosen, sketchIdRef, floatingSketchRef, setFloatingSketchName, setModels, setSelectedFeatureId, setExpanded }: {
  models: ModelNode[];
  selectedModel: string;
  sketchEntity: SketchEntityKind;
  setSketchEntity: React.Dispatch<React.SetStateAction<SketchEntityKind>>;
  setSketchPlaneChosen: React.Dispatch<React.SetStateAction<boolean>>;
  sketchIdRef: React.RefObject<string>;
  floatingSketchRef: React.RefObject<FloatingSketch>;
  setFloatingSketchName: React.Dispatch<React.SetStateAction<string>>;
  setModels: React.Dispatch<React.SetStateAction<ModelNode[]>>;
  setSelectedFeatureId: React.Dispatch<React.SetStateAction<string>>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {


  const targetModel = models.find((m) => m.name === selectedModel) ?? null;

  // Le choix du plan d'esquisse se fait de façon asynchrone dans le viewport (l'utilisateur
  // clique une plaque de plan ou une face) : au moment où `apex-sketch-plane-selected`
  // arrive, il faut le corps ciblé et la forme active *à cet instant*, pas ceux capturés à
  // l'inscription du listener — d'où ces refs tenues à jour à chaque rendu.
  const targetModelRef = useRef<ModelNode | null>(targetModel);
  useEffect(() => { targetModelRef.current = targetModel; }, [targetModel]);
  const sketchEntityRef = useRef<SketchEntityKind | null>(sketchEntity);
  useEffect(() => { sketchEntityRef.current = sketchEntity; }, [sketchEntity]);

  /** Reçoit le plan choisi dans le viewport et crée seulement alors la feature esquisse. */
  useEffect(() => {
    const handlePlaneSelected = (e: CustomEvent<SketchPlaneRef>) => {
      const planeRef = e.detail;
      const model = targetModelRef.current;
      // Nouveau plan : plus aucune forme active, l'utilisateur en choisit une.
      setSketchEntity(null);
      sketchEntityRef.current = null;
      setSketchPlaneChosen(true);
      sketchIdRef.current = null;

      if (!model) {
        // Pas de corps existant : l'esquisse reste « flottante » jusqu'à l'extrusion, qui en créera
        // un. Elle est gardée à part (pas dans l'arborescence) avec ses formes, pour que l'outil
        // Extrusion puisse la prendre pour profil.
        const floatingId = nextId('sketch');
        const floatingName = `${FEATURE_LABELS.sketch} 1`;
        floatingSketchRef.current = { id: floatingId, name: floatingName, planeRef, entities: [] };
        setFloatingSketchName(floatingName);
        sketchIdRef.current = floatingId;
        window.dispatchEvent(
          new CustomEvent('apex-sketch-tool', {
            detail: { entity: sketchEntityRef.current, sketchId: floatingId, planeRef },
          }),
        );
        return;
      }

      const id = nextId('sketch');
      const index = model.features.filter((f) => f.kind === 'sketch').length + 1;
      const name = `${FEATURE_LABELS.sketch} ${index}`;
      const feature: Feature = { id, name, kind: 'sketch', planeRef, entities: [] };

      sketchIdRef.current = id;
      setModels((prev) => prev.map((m) => (m.id === model.id ? { ...m, features: [...m.features, feature] } : m)));
      setSelectedFeatureId(id);
      setExpanded((prev) => ({ ...prev, [model.id]: true }));
      showSuccess(`${name} ajoutée à ${model.name}.`);
      window.dispatchEvent(
        new CustomEvent('apex-sketch-tool', { detail: { entity: sketchEntityRef.current, sketchId: id, planeRef } }),
      );
    };

    // Forme tracée dans le viewport : rangée dans les entités de l'esquisse courante.
    const handleEntityAdded = (e: CustomEvent<{ entity: SketchEntity }>) => {
      const sketchId = sketchIdRef.current;
      if (!sketchId) return;
      const floating = floatingSketchRef.current;
      if (floating && floating.id === sketchId) {
        floating.entities = [...floating.entities, e.detail.entity];
        return;
      }
      setModels((prev) => prev.map((m) => ({
        ...m,
        features: m.features.map((f) => (
          f.id === sketchId && f.kind === 'sketch' ? { ...f, entities: [...f.entities, e.detail.entity] } : f
        )),
      })));
    };

    window.addEventListener('apex-sketch-plane-selected', handlePlaneSelected as EventListener);
    window.addEventListener('apex-sketch-entity-added', handleEntityAdded as EventListener);
    return () => {
      window.removeEventListener('apex-sketch-plane-selected', handlePlaneSelected as EventListener);
      window.removeEventListener('apex-sketch-entity-added', handleEntityAdded as EventListener);
    };
  }, []);
  return { targetModel };
}
