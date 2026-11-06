import { showError, showSuccess } from '@/utils/toast';
import { FEATURE_LABELS, nextId, type ExtrudeFeature, type Feature, type FeatureKind } from '@/modeling/types';
import type { ExtrudeParams } from './ExtrudePanel';
import type { ModelNode } from './modelingData';
import type { ModelingTree } from './useModelingTree';
import type { SketchState } from './modelingSketch';

import { emitApex } from '@/events/apexEvents';
/** Ce dont les actions de la barre d'outils ont besoin : arbre, corps ciblé, esquisse, outil actif. */
export interface ToolCtx {
  tree: ModelingTree;
  targetModel: ModelNode | null;
  sketch: SketchState;
  activeTool: FeatureKind | null;
  setActiveTool: (tool: FeatureKind | null) => void;
  enterExtrudeSelectionMode: () => void;
  leaveExtrudeSelectionMode: () => void;
}

const selectTool = () => emitApex('apex-tool-changed', { tool: 'select' });

/** Ajoute une feature au corps `modelId`, la sélectionne et déplie le corps. */
function addFeatureTo(tree: ModelingTree, modelId: string, feature: Feature) {
  tree.setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, features: [...m.features, feature] } : m)));
  tree.setSelectedFeatureId(feature.id);
  tree.setExpanded((prev) => ({ ...prev, [modelId]: true }));
}

/** Crée un corps portant `features` (extrusion d'une face libre ou d'une esquisse flottante) et le sélectionne. */
function addBody(tree: ModelingTree, bodyName: string, features: Feature[], selectedFeature: Feature) {
  const body: ModelNode = { id: nextId('body'), name: bodyName, children: [], features };
  tree.setModels((prev) => [...prev, body]);
  tree.setSelectedModel(bodyName);
  tree.setSelectedFeatureId(selectedFeature.id);
  tree.setExpanded((prev) => ({ ...prev, [body.id]: true }));
}

/** OK du panneau Extrusion : crée la feature avec les réglages du panneau, puis ferme l'outil. */
export function makeExtrudeConfirm(c: ToolCtx) {
  const { tree, targetModel, sketch } = c;
  return (params: ExtrudeParams) => {
    const sk = targetModel?.features.filter((f) => f.kind === 'sketch').slice(-1)[0];
    const floating = sketch.floatingSketchRef.current;
    const makeFeature = (sketchId: string, index: number, faceRef?: ExtrudeFeature['faceRef']): Feature => ({
      id: nextId('extrude'), name: `${FEATURE_LABELS.extrude} ${index}`, kind: 'extrude', sketchId,
      distance: params.distance, symmetric: params.direction === 'symmetric',
      bodyType: params.bodyType, startFrom: params.startFrom, operation: params.operation,
      ...(faceRef ? { faceRef } : {}),
    });

    if (params.face && params.face.kind === 'mesh') {
      // Face plane d'un modèle : extrusion directe, sans esquisse, portée par le corps du modèle.
      const faceRef = { origin: params.face.origin, normal: params.face.normal, modelName: params.face.modelName ?? undefined };
      const owner = tree.models.find((m) => m.name === params.face!.modelName) ?? targetModel;
      if (owner) {
        const feature = makeFeature('', owner.features.filter((f) => f.kind === 'extrude').length + 1, faceRef);
        addFeatureTo(tree, owner.id, feature);
        showSuccess(`${feature.name} ajoutée à ${owner.name}.`);
      } else {
        const bodyName = params.face.modelName ?? `Corps ${tree.models.length + 1}`;
        const feature = makeFeature('', 1, faceRef);
        addBody(tree, bodyName, [feature], feature);
        showSuccess(`${feature.name} créée dans ${bodyName}.`);
      }
    } else if (targetModel && sk) {
      const feature = makeFeature(sk.id, targetModel.features.filter((f) => f.kind === 'extrude').length + 1);
      addFeatureTo(tree, targetModel.id, feature);
      showSuccess(`${feature.name} ajoutée à ${targetModel.name}.`);
    } else if (floating) {
      // Esquisse flottante : l'extrusion crée le corps qui la porte.
      const bodyName = `Corps ${tree.models.length + 1}`;
      const extrude = makeFeature(floating.id, 1);
      const floatingFeature: Feature = { id: floating.id, name: floating.name, kind: 'sketch', planeRef: floating.planeRef, entities: floating.entities };
      addBody(tree, bodyName, [floatingFeature, extrude], extrude);
      sketch.floatingSketchRef.current = null;
      sketch.setFloatingSketchName(null);
      sketch.sketchIdRef.current = null;
      showSuccess(`${extrude.name} créée dans ${bodyName}.`);
    } else {
      showError('Aucune esquisse à extruder.');
      return;
    }
    // Le corps extrudé (aperçu en temps réel) reste dans la scène : annoncé AVANT la fin de l'outil.
    emitApex('apex-extrude-commit');
    c.setActiveTool(null);
    selectTool();
    c.leaveExtrudeSelectionMode();
  };
}

/** Annule l'outil Extrusion. */
export function makeExtrudeCancel(c: ToolCtx) {
  return () => {
    c.setActiveTool(null);
    selectTool();
    c.leaveExtrudeSelectionMode();
  };
}

/** Nouvelle feature « simple » (révolution, congé, chanfrein, miroir) sur le corps ciblé. */
function simpleFeature(kind: FeatureKind, id: string, name: string, sketchId: string | null): Feature {
  switch (kind) {
    case 'revolve': return { id, name, kind, sketchId: sketchId!, axis: { x: 0, y: 1, z: 0 }, angle: 360 };
    case 'fillet': return { id, name, kind, targetIds: [], radius: 2 };
    case 'chamfer': return { id, name, kind, targetIds: [], distance: 2 };
    default: return { id, name, kind: 'mirror', center: { x: 0, y: 0, z: 0 } } as Feature;
  }
}

/** Clic sur un outil de la barre : (dés)active l'outil, lance l'esquisse ou ajoute la feature. */
export function makeToolClick(c: ToolCtx) {
  const { tree, targetModel, sketch } = c;
  return (kind: FeatureKind) => {
    // Re-cliquer sur l'outil actif le désactive (même convention que la Sidebar principale).
    if (c.activeTool === kind) {
      c.setActiveTool(null);
      selectTool();
      if (kind === 'extrude') c.leaveExtrudeSelectionMode();
      if (kind === 'sketch') {
        sketch.setSketchEntity(null);
        sketch.setSketchPlaneChosen(false);
        emitApex('apex-sketch-plane-pick-cancel');
      }
      return;
    }

    // L'extrusion est toujours sélectionnable : son panneau indique s'il manque une esquisse.
    if (!targetModel && kind !== 'sketch' && kind !== 'extrude') {
      showError('Sélectionnez un corps dans l\'arborescence.');
      return;
    }
    const sketchId = targetModel?.features.filter((f) => f.kind === 'sketch').slice(-1)[0]?.id ?? null;
    if (kind === 'revolve' && !sketchId) {
      showError('Créez d\'abord une esquisse à extruder.');
      return;
    }

    if (c.activeTool === 'extrude') c.leaveExtrudeSelectionMode();
    c.setActiveTool(kind);
    emitApex('apex-tool-changed', { tool: kind });

    // Extrusion : le panneau latéral droit (ExtrudePanel) règle puis crée la feature (OK) ; on
    // choisit la face à tirer dans la vue, d'où le passage automatique du sélecteur sur « Face ».
    if (kind === 'extrude') {
      c.enterExtrudeSelectionMode();
      return;
    }
    if (kind === 'sketch') {
      // Le plan se choisit dans le viewport : la feature n'est créée qu'à la réception de
      // `apex-sketch-plane-selected` (cf. useSketchEvents).
      sketch.setSketchEntity(null);
      sketch.setSketchPlaneChosen(false);
      emitApex('apex-sketch-plane-pick-start');
      return;
    }
    if (!targetModel) return; // uniquement possible pour 'sketch', déjà traité ci-dessus

    const id = nextId(kind);
    const name = `${FEATURE_LABELS[kind]} ${targetModel.features.filter((f) => f.kind === kind).length + 1}`;
    addFeatureTo(tree, targetModel.id, simpleFeature(kind, id, name, sketchId));
    showSuccess(`${name} ajoutée à ${targetModel.name}.`);
  };
}
