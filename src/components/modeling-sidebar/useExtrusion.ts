import { ExtrudeParams } from '../ExtrudePanel';
import { ExtrudeFeature, Feature, nextId, FEATURE_LABELS } from '@/modeling/types';
import { showSuccess, showError } from '@/utils/toast';
import type { ModelNode } from './constants';
import type { FloatingSketch } from './constants';
import type React from 'react';

/** Confirmation et annulation de l'outil Extrusion. */
export function useExtrusion({ targetModel, floatingSketchRef, models, setModels, setSelectedFeatureId, setExpanded, setSelectedModel, setFloatingSketchName, sketchIdRef, setActiveTool, leaveExtrudeSelectionMode }: {
  targetModel: ModelNode;
  floatingSketchRef: React.RefObject<FloatingSketch>;
  models: ModelNode[];
  setModels: React.Dispatch<React.SetStateAction<ModelNode[]>>;
  setSelectedFeatureId: React.Dispatch<React.SetStateAction<string>>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSelectedModel: React.Dispatch<React.SetStateAction<string>>;
  setFloatingSketchName: React.Dispatch<React.SetStateAction<string>>;
  sketchIdRef: React.RefObject<string>;
  setActiveTool: React.Dispatch<React.SetStateAction<FeatureKind>>;
  leaveExtrudeSelectionMode: () => void;
}) {


  /** OK du panneau Extrusion : crée la feature avec les réglages du panneau, puis ferme l'outil. */
  const handleExtrudeConfirm = (params: ExtrudeParams) => {
    const sketch = targetModel?.features.filter((f) => f.kind === 'sketch').slice(-1)[0];
    const floating = floatingSketchRef.current;
    const makeFeature = (sketchId: string, index: number, faceRef?: ExtrudeFeature['faceRef']): Feature => ({
      id: nextId('extrude'), name: `${FEATURE_LABELS.extrude} ${index}`, kind: 'extrude', sketchId,
      distance: params.distance, symmetric: params.direction === 'symmetric',
      bodyType: params.bodyType, startFrom: params.startFrom, operation: params.operation,
      ...(faceRef ? { faceRef } : {}),
    });

    if (params.face && params.face.kind === 'mesh') {
      // Face plane d'un modèle : extrusion directe, sans esquisse, portée par le corps du modèle.
      const faceRef = { origin: params.face.origin, normal: params.face.normal, modelName: params.face.modelName ?? undefined };
      const owner = models.find((m) => m.name === params.face!.modelName) ?? targetModel;
      if (owner) {
        const feature = makeFeature('', owner.features.filter((f) => f.kind === 'extrude').length + 1, faceRef);
        setModels((prev) => prev.map((m) => (m.id === owner.id ? { ...m, features: [...m.features, feature] } : m)));
        setSelectedFeatureId(feature.id);
        setExpanded((prev) => ({ ...prev, [owner.id]: true }));
        showSuccess(`${feature.name} ajoutée à ${owner.name}.`);
      } else {
        const bodyName = params.face.modelName ?? `Corps ${models.length + 1}`;
        const feature = makeFeature('', 1, faceRef);
        const body: ModelNode = { id: nextId('body'), name: bodyName, children: [], features: [feature] };
        setModels((prev) => [...prev, body]);
        setSelectedModel(bodyName);
        setSelectedFeatureId(feature.id);
        setExpanded((prev) => ({ ...prev, [body.id]: true }));
        showSuccess(`${feature.name} créée dans ${bodyName}.`);
      }
    } else if (targetModel && sketch) {
      const feature = makeFeature(sketch.id, targetModel.features.filter((f) => f.kind === 'extrude').length + 1);
      setModels((prev) =>
        prev.map((m) => (m.id === targetModel.id ? { ...m, features: [...m.features, feature] } : m)),
      );
      setSelectedFeatureId(feature.id);
      setExpanded((prev) => ({ ...prev, [targetModel.id]: true }));
      showSuccess(`${feature.name} ajoutée à ${targetModel.name}.`);
    } else if (floating) {
      // Esquisse flottante : l'extrusion crée le corps qui la porte.
      const bodyName = `Corps ${models.length + 1}`;
      const body: ModelNode = {
        id: nextId('body'), name: bodyName, children: [],
        features: [
          { id: floating.id, name: floating.name, kind: 'sketch', planeRef: floating.planeRef, entities: floating.entities },
          makeFeature(floating.id, 1),
        ],
      };
      setModels((prev) => [...prev, body]);
      setSelectedModel(bodyName);
      setSelectedFeatureId(body.features[1].id);
      setExpanded((prev) => ({ ...prev, [body.id]: true }));
      floatingSketchRef.current = null;
      setFloatingSketchName(null);
      sketchIdRef.current = null;
      showSuccess(`${body.features[1].name} créée dans ${bodyName}.`);
    } else {
      showError('Aucune esquisse à extruder.');
      return;
    }
    // Le corps extrudé (aperçu en temps réel) reste dans la scène : annoncé AVANT la fin de l'outil.
    window.dispatchEvent(new CustomEvent('apex-extrude-commit'));
    setActiveTool(null);
    window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
    leaveExtrudeSelectionMode();
  };

  const handleExtrudeCancel = () => {
    setActiveTool(null);
    window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
    leaveExtrudeSelectionMode();
  };
  return { handleExtrudeConfirm, handleExtrudeCancel };
}
