import { FeatureKind, nextId, FEATURE_LABELS, Feature, SketchEntityKind } from '@/modeling/types';
import { showError, showSuccess } from '@/utils/toast';
import { useEffect } from 'react';
import type { ModelNode } from './constants';
import type React from 'react';

/** Outils de modélisation : choix d'un outil, esquisse active, fin d'esquisse, forme à dessiner. */
export function useModelingTools({ activeTool, setActiveTool, leaveExtrudeSelectionMode, setSketchEntity, setSketchPlaneChosen, targetModel, enterExtrudeSelectionMode, setModels, setSelectedFeatureId, setExpanded, morph, contentLeaving, sketchIdRef, sketchPlaneChosen, sketchEntity }: {
  activeTool: FeatureKind;
  setActiveTool: React.Dispatch<React.SetStateAction<FeatureKind>>;
  leaveExtrudeSelectionMode: () => void;
  setSketchEntity: React.Dispatch<React.SetStateAction<SketchEntityKind>>;
  setSketchPlaneChosen: React.Dispatch<React.SetStateAction<boolean>>;
  targetModel: ModelNode;
  enterExtrudeSelectionMode: () => void;
  setModels: React.Dispatch<React.SetStateAction<ModelNode[]>>;
  setSelectedFeatureId: React.Dispatch<React.SetStateAction<string>>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  morph: { direction: "enter" | "exit"; fromPreview: boolean; onDone: () => void; };
  contentLeaving: boolean;
  sketchIdRef: React.RefObject<string>;
  sketchPlaneChosen: boolean;
  sketchEntity: SketchEntityKind;
}) {


  const handleToolClick = (kind: FeatureKind) => {
    // Re-cliquer sur l'outil actif le désactive (même convention que la Sidebar principale).
    if (activeTool === kind) {
      setActiveTool(null);
      window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
      if (kind === 'extrude') leaveExtrudeSelectionMode();
      if (kind === 'sketch') {
        setSketchEntity(null);
        setSketchPlaneChosen(false);
        window.dispatchEvent(new CustomEvent('apex-sketch-plane-pick-cancel'));
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

    if (activeTool === 'extrude') leaveExtrudeSelectionMode();
    setActiveTool(kind);
    window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: kind } }));

    // Extrusion : le panneau latéral droit (ExtrudePanel) règle puis crée la feature (OK) ; on
    // choisit la face à tirer dans la vue, d'où le passage automatique du sélecteur sur « Face ».
    if (kind === 'extrude') {
      enterExtrudeSelectionMode();
      return;
    }

    if (kind === 'sketch') {
      // Le plan se choisit dans le viewport (plaque d'axe ou face d'un corps) : la feature
      // n'est créée qu'à la réception de `apex-sketch-plane-selected` (effet dédié plus haut).
      setSketchEntity(null);
      setSketchPlaneChosen(false);
      window.dispatchEvent(new CustomEvent('apex-sketch-plane-pick-start'));
      return;
    }

    if (!targetModel) return; // uniquement possible pour 'sketch', déjà traité ci-dessus

    const id = nextId(kind);
    const index = targetModel.features.filter((f) => f.kind === kind).length + 1;
    const name = `${FEATURE_LABELS[kind]} ${index}`;

    let feature: Feature;
    switch (kind) {
      case 'revolve':
        feature = { id, name, kind, sketchId: sketchId!, axis: { x: 0, y: 1, z: 0 }, angle: 360 };
        break;
      case 'fillet':
        feature = { id, name, kind, targetIds: [], radius: 2 };
        break;
      case 'chamfer':
        feature = { id, name, kind, targetIds: [], distance: 2 };
        break;
      case 'mirror':
        feature = { id, name, kind, center: { x: 0, y: 0, z: 0 } };
        break;
    }

    setModels((prev) =>
      prev.map((m) => (m.id === targetModel.id ? { ...m, features: [...m.features, feature] } : m)),
    );
    setSelectedFeatureId(id);
    setExpanded((prev) => ({ ...prev, [targetModel.id]: true }));
    showSuccess(`${name} ajoutée à ${targetModel.name}.`);
  };

  // Esquisse active : cf. la barre d'outils (icônes en cascade) et la largeur de la pilule (Sidebar).
  const sketchModeActive = activeTool === 'sketch';
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('apex-modeling-sketch-active', { detail: { active: sketchModeActive } }));
    return () => {
      window.dispatchEvent(new CustomEvent('apex-modeling-sketch-active', { detail: { active: false } }));
    };
  }, [sketchModeActive]);

  // Touche E : lance l'Extrusion (comme un clic sur l'outil). Une face déjà choisie dans la vue est
  // reprise par l'outil (cf. `carriedFace` dans Viewport3D). Sans effet pendant la saisie de texte,
  // avec un modificateur, en pleine esquisse, ou si l'Extrusion est déjà active.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (morph || contentLeaving || activeTool === 'sketch' || activeTool === 'extrude') return;
      e.preventDefault();
      handleToolClick('extrude');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Termine l'esquisse : plus de forme active, le plan est abandonné, l'orbite est rendue. */
  const handleFinishSketch = () => {
    setActiveTool(null);
    setSketchEntity(null);
    setSketchPlaneChosen(false);
    sketchIdRef.current = null;
    window.dispatchEvent(new CustomEvent('apex-sketch-tool', { detail: { entity: null, sketchId: null } }));
    // Rend la vue d'avant l'outil Esquisse (doit partir AVANT le pick-cancel, qui efface l'instantané).
    window.dispatchEvent(new CustomEvent('apex-sketch-finished'));
    // Même signal que le retrait de l'outil : déverrouille l'orbite et désactive le tracé.
    window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
    window.dispatchEvent(new CustomEvent('apex-sketch-plane-pick-cancel'));
    showSuccess('Esquisse terminée.');
  };

  const handleSketchEntity = (kind: SketchEntityKind) => {
    if (!sketchPlaneChosen) {
      showError('Choisissez d\'abord un plan ou une face plane.');
      return;
    }
    // Re-cliquer sur la forme active la désactive.
    const next = sketchEntity === kind ? null : kind;
    setSketchEntity(next);
    window.dispatchEvent(
      new CustomEvent('apex-sketch-tool', { detail: { entity: next, sketchId: sketchIdRef.current } }),
    );
  };
  return { sketchModeActive, handleToolClick, handleSketchEntity, handleFinishSketch };
}
