import { useEffect, useRef, useState } from 'react';
import { showSuccess } from '@/utils/toast';
import {
  FEATURE_LABELS, nextId, type Feature, type SketchEntity, type SketchEntityKind, type SketchPlaneRef,
} from '@/modeling/types';
import type { ModelNode } from './modelingData';
import type { ModelingTree } from './useModelingTree';

import { emitApex } from '@/events/apexEvents';
/** Esquisse « flottante » : tracée sans corps sélectionné, elle attend l'extrusion, qui crée le corps. */
export interface FloatingSketch { id: string; name: string; planeRef: SketchPlaneRef; entities: SketchEntity[] }

/** État de l'esquisse en cours : forme active, plan choisi, esquisse courante et esquisse flottante. */
export function useSketchState() {
  // Aucune forme n'est active à la création d'une esquisse : l'utilisateur choisit (pour l'instant
  // seul le rectangle est disponible).
  const [sketchEntity, setSketchEntity] = useState<SketchEntityKind | null>(null);
  const [sketchPlaneChosen, setSketchPlaneChosen] = useState(false);
  const sketchIdRef = useRef<string | null>(null);
  const floatingSketchRef = useRef<FloatingSketch | null>(null);
  const [floatingSketchName, setFloatingSketchName] = useState<string | null>(null);
  // Le choix du plan se fait de façon asynchrone dans le viewport : au moment où l'événement arrive,
  // il faut la forme active *à cet instant*, pas celle capturée à l'inscription du listener.
  const sketchEntityRef = useRef<SketchEntityKind | null>(sketchEntity);
  useEffect(() => { sketchEntityRef.current = sketchEntity; }, [sketchEntity]);
  return {
    sketchEntity, setSketchEntity, sketchPlaneChosen, setSketchPlaneChosen, sketchIdRef, floatingSketchRef,
    floatingSketchName, setFloatingSketchName, sketchEntityRef,
  };
}

export type SketchState = ReturnType<typeof useSketchState>;

/** Plan choisi dans le viewport : crée la feature esquisse (ou l'esquisse flottante s'il n'y a pas de corps). */
function makePlaneHandler(tree: ModelingTree, modelRef: { current: ModelNode | null }, sk: SketchState) {
  return (e: CustomEvent<SketchPlaneRef>) => {
    const planeRef = e.detail;
    const model = modelRef.current;
    // Nouveau plan : plus aucune forme active, l'utilisateur en choisit une.
    sk.setSketchEntity(null);
    sk.sketchEntityRef.current = null;
    sk.setSketchPlaneChosen(true);
    sk.sketchIdRef.current = null;

    if (!model) {
      // Pas de corps existant : l'esquisse reste « flottante » jusqu'à l'extrusion, qui en créera
      // un. Elle est gardée à part (pas dans l'arborescence) avec ses formes, pour que l'outil
      // Extrusion puisse la prendre pour profil.
      const floatingId = nextId('sketch');
      const floatingName = `${FEATURE_LABELS.sketch} 1`;
      sk.floatingSketchRef.current = { id: floatingId, name: floatingName, planeRef, entities: [] };
      sk.setFloatingSketchName(floatingName);
      sk.sketchIdRef.current = floatingId;
      emitApex('apex-sketch-tool', { entity: sk.sketchEntityRef.current, sketchId: floatingId, planeRef });
      return;
    }

    const id = nextId('sketch');
    const index = model.features.filter((f) => f.kind === 'sketch').length + 1;
    const name = `${FEATURE_LABELS.sketch} ${index}`;
    const feature: Feature = { id, name, kind: 'sketch', planeRef, entities: [] };

    sk.sketchIdRef.current = id;
    tree.setModels((prev) => prev.map((m) => (m.id === model.id ? { ...m, features: [...m.features, feature] } : m)));
    tree.setSelectedFeatureId(id);
    tree.setExpanded((prev) => ({ ...prev, [model.id]: true }));
    showSuccess(`${name} ajoutée à ${model.name}.`);
    emitApex('apex-sketch-tool', { entity: sk.sketchEntityRef.current, sketchId: id, planeRef });
  };
}

/** Forme tracée dans le viewport : rangée dans les entités de l'esquisse courante. */
function makeEntityHandler(tree: ModelingTree, sk: SketchState) {
  return (e: CustomEvent<{ entity: SketchEntity }>) => {
    const sketchId = sk.sketchIdRef.current;
    if (!sketchId) return;
    const floating = sk.floatingSketchRef.current;
    if (floating && floating.id === sketchId) {
      floating.entities = [...floating.entities, e.detail.entity];
      return;
    }
    tree.setModels((prev) => prev.map((m) => ({
      ...m,
      features: m.features.map((f) => (
        f.id === sketchId && f.kind === 'sketch' ? { ...f, entities: [...f.entities, e.detail.entity] } : f
      )),
    })));
  };
}

/** Écoute le plan choisi et les formes tracées dans le viewport. */
export function useSketchEvents(tree: ModelingTree, targetModel: ModelNode | null, sk: SketchState) {
  // Le corps ciblé *à cet instant* (pas celui capturé à l'inscription du listener).
  const targetModelRef = useRef<ModelNode | null>(targetModel);
  useEffect(() => { targetModelRef.current = targetModel; }, [targetModel]);
  useEffect(() => {
    const handlePlaneSelected = makePlaneHandler(tree, targetModelRef, sk);
    const handleEntityAdded = makeEntityHandler(tree, sk);
    window.addEventListener('apex-sketch-plane-selected', handlePlaneSelected as EventListener);
    window.addEventListener('apex-sketch-entity-added', handleEntityAdded as EventListener);
    return () => {
      window.removeEventListener('apex-sketch-plane-selected', handlePlaneSelected as EventListener);
      window.removeEventListener('apex-sketch-entity-added', handleEntityAdded as EventListener);
    };
    // Les setters et refs de `tree` / `sk` sont stables : l'écouteur ne s'inscrit qu'une fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, []);
}
