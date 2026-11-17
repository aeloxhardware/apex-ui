// Gizmo du plan de l'outil Couper, comme celui d'Orca Slicer : une flèche le long de la normale pousse le plan, deux anneaux
// l'inclinent autour de son centre. Gizmos de Babylon sur leur propre calque : un clic dessus n'atteint pas la scène (le
// modèle reste sélectionné). Ils déplacent un nœud invisible ; chaque mouvement est relu (centre, normale) et rendu à
// viewportCut.ts, qui le traduit en réglages du plan.
import * as BABYLON from 'babylonjs';

const ARROW_COLOR = new BABYLON.Color3(0.82, 0.88, 1);
const RING_A_COLOR = new BABYLON.Color3(1, 0.36, 0.36);
const RING_B_COLOR = new BABYLON.Color3(0.36, 0.62, 1);
const UP = new BABYLON.Vector3(0, 1, 0);
const GIZMO_SCALE = 1.4;

export interface CutGizmo {
  /** Un glissement est en cours : le plan suit le nœud, on ne le replace pas depuis les réglages. */
  readonly dragging: boolean;
  /** Place le gizmo au centre du plan, sa flèche le long de la normale ; null le masque. */
  place(pose: { point: BABYLON.Vector3; normal: BABYLON.Vector3 } | null): void;
  dispose(): void;
}

type DragGizmo = BABYLON.AxisDragGizmo | BABYLON.PlaneRotationGizmo;

/** `onMove` reçoit le centre et la normale du plan à chaque mouvement ; `onEnd` est appelé au relâchement. */
export function createCutGizmo(
  scene: BABYLON.Scene,
  onMove: (point: BABYLON.Vector3, normal: BABYLON.Vector3) => void,
  onEnd: () => void,
): CutGizmo {
  const layer = new BABYLON.UtilityLayerRenderer(scene);
  const node = new BABYLON.TransformNode('apexCutGizmoNode', scene);
  node.rotationQuaternion = new BABYLON.Quaternion();
  const gizmos: DragGizmo[] = [
    new BABYLON.AxisDragGizmo(UP, ARROW_COLOR, layer),
    // Anneaux autour des deux axes du plan : chacun l'incline d'un côté.
    new BABYLON.PlaneRotationGizmo(new BABYLON.Vector3(1, 0, 0), RING_A_COLOR, layer),
    new BABYLON.PlaneRotationGizmo(new BABYLON.Vector3(0, 0, 1), RING_B_COLOR, layer),
  ];
  let dragging = false;

  const emit = () => {
    node.computeWorldMatrix(true);
    const normal = BABYLON.Vector3.TransformNormal(UP, node.getWorldMatrix()).normalize();
    onMove(node.getAbsolutePosition().clone(), normal);
  };
  for (const gizmo of gizmos) {
    gizmo.updateGizmoRotationToMatchAttachedMesh = true;
    gizmo.scaleRatio = GIZMO_SCALE;
    // Glisser ne détache pas les contrôles de la caméra (voir keepCameraControlsDuringGizmoDrag, viewportGizmos.ts).
    gizmo.dragBehavior.detachCameraControls = false;
    gizmo.dragBehavior.onDragStartObservable.add(() => {
      dragging = true;
    });
    gizmo.dragBehavior.onDragObservable.add(emit);
    gizmo.dragBehavior.onDragEndObservable.add(() => {
      dragging = false;
      emit();
      onEnd();
    });
  }

  return {
    get dragging() {
      return dragging;
    },
    place(pose) {
      if (dragging) return;
      for (const gizmo of gizmos) gizmo.attachedNode = pose ? node : null;
      if (!pose) return;
      node.position.copyFrom(pose.point);
      BABYLON.Quaternion.FromUnitVectorsToRef(UP, pose.normal, node.rotationQuaternion ?? new BABYLON.Quaternion());
      node.computeWorldMatrix(true);
    },
    dispose() {
      gizmos.forEach((g) => g.dispose());
      node.dispose();
      layer.dispose();
    },
  };
}
