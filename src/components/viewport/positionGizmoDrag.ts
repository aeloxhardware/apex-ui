/**
 * Déplacement exact par les flèches du gizmo de position.
 *
 * Les modèles ont un pivot décalé de l'origine du maillage (setPivotPoint, posé à l'import pour centrer les gizmos).
 * Or le gizmo de position de Babylon recalcule la position du maillage à chaque pas en ignorant ce pivot : dès que le
 * modèle est tourné ou mis à l'échelle (glb : ×1000), l'erreur est multipliée et la pièce s'envole à l'autre bout de
 * la scène (test `positionGizmoDrag.test.ts`). On ne s'appuie donc que sur le déplacement monde que le comportement de
 * glissement mesure : position au début du glissement + somme des déplacements, repassée dans le repère du parent.
 * Ce rappel est enregistré après celui de Babylon : il a le dernier mot.
 */
import * as BABYLON from 'babylonjs';

const wired = new WeakSet<object>();

/** Déplacement monde → déplacement de `position` (repère du parent du nœud, s'il en a un). */
function toParentSpace(node: BABYLON.TransformNode, world: BABYLON.Vector3): BABYLON.Vector3 {
  const parent = node.parent;
  if (!parent) return world;
  const inverse = parent.getWorldMatrix().clone().invert();
  return BABYLON.Vector3.TransformNormal(world, inverse);
}

function wireAxis(axisGizmo: BABYLON.IAxisDragGizmo | BABYLON.IPlaneDragGizmo | undefined) {
  const behavior = axisGizmo?.dragBehavior;
  if (!axisGizmo || !behavior || wired.has(behavior)) return;
  wired.add(behavior);
  const start = BABYLON.Vector3.Zero();
  const total = BABYLON.Vector3.Zero();
  behavior.onDragStartObservable.add(() => {
    const node = axisGizmo.attachedNode;
    if (node instanceof BABYLON.TransformNode) start.copyFrom(node.position);
    total.setAll(0);
  });
  behavior.onDragObservable.add((event) => {
    const node = axisGizmo.attachedNode;
    if (!(node instanceof BABYLON.TransformNode)) return;
    total.addInPlace(event.delta);
    node.position.copyFrom(start).addInPlace(toParentSpace(node, total));
    node.computeWorldMatrix(true);
  });
}

/** À appeler quand le gizmo de position existe (idempotent : chaque flèche n'est branchée qu'une fois). */
export function keepPositionDragExact(gizmo: BABYLON.Nullable<BABYLON.IPositionGizmo> | undefined) {
  if (!gizmo) return;
  for (const g of [gizmo.xGizmo, gizmo.yGizmo, gizmo.zGizmo, gizmo.xPlaneGizmo, gizmo.yPlaneGizmo, gizmo.zPlaneGizmo]) wireAxis(g);
}
