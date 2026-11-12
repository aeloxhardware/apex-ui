// Actions de sélection partagées entre le clic simple (selectMesh) et le rectangle de sélection.
import * as BABYLON from 'babylonjs';
import type { InspectableMaterial } from './viewportTypes';
import type { ViewportState } from './viewportState';

import { emitApex } from '@/events/apexEvents';
/** Vide la sélection : plus de surbrillance ni de gizmo, et l'interface en est informée. */
export function clearSelection(st: ViewportState) {
  const { gizmoManager, selectedMeshesRef, setSelectedMeshName, updateHighlight } = st;
  selectedMeshesRef.current.clear();
  setSelectedMeshName(null);
  updateHighlight();
  gizmoManager.positionGizmoEnabled = false;
  gizmoManager.rotationGizmoEnabled = false;
  gizmoManager.scaleGizmoEnabled = false;
  gizmoManager.attachToMesh(null);
  emitApex('apex-mesh-selected', { name: null, names: [], subMeshes: [] });
}

/** Parties d'un modèle (lui-même et ses enfants) avec leur couleur, pour l'éditeur de textures. */
export function describeSubMeshes(target: BABYLON.AbstractMesh): { id: string; name: string; color: string }[] {
  return [target, ...target.getChildMeshes()].map((cm, idx) => {
    let hex = '#f59e0b';
    if (cm.material) {
      const mat = cm.material as InspectableMaterial;
      if (mat.albedoColor) hex = mat.albedoColor.toHexString();
      else if (mat.diffuseColor) hex = mat.diffuseColor.toHexString();
    }
    return { id: `${target.name}-${idx}`, name: cm.name || `Partie ${idx + 1}`, color: hex };
  });
}

/** Active le gizmo de l'outil courant (déplacer / tourner / mettre à l'échelle) sur `gizmoTarget`. */
export function attachGizmoForTool(st: ViewportState, gizmoTarget: BABYLON.AbstractMesh | null) {
  const { applyCustomGizmoColors, currentToolRef, gizmoManager, setupGizmoDragEnd } = st;
  if (currentToolRef.current === 'move') {
    gizmoManager.rotationGizmoEnabled = false;
    gizmoManager.scaleGizmoEnabled = false;
    gizmoManager.positionGizmoEnabled = !!gizmoTarget;
    if (gizmoTarget) {
      applyCustomGizmoColors();
      setupGizmoDragEnd();
    }
    gizmoManager.attachToMesh(gizmoTarget);
  } else if (currentToolRef.current === 'rotate') {
    gizmoManager.positionGizmoEnabled = false;
    gizmoManager.scaleGizmoEnabled = false;
    gizmoManager.rotationGizmoEnabled = !!gizmoTarget;
    if (gizmoTarget) applyCustomGizmoColors();
    gizmoManager.attachToMesh(gizmoTarget);
  } else if (currentToolRef.current === 'scale') {
    gizmoManager.positionGizmoEnabled = false;
    gizmoManager.rotationGizmoEnabled = false;
    gizmoManager.scaleGizmoEnabled = !!gizmoTarget;
    gizmoManager.attachToMesh(gizmoTarget);
  } else {
    gizmoManager.positionGizmoEnabled = false;
    gizmoManager.rotationGizmoEnabled = false;
    gizmoManager.scaleGizmoEnabled = false;
    gizmoManager.attachToMesh(null);
  }
}
