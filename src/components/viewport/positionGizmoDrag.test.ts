import { describe, expect, it } from 'vitest';
import * as BABYLON from 'babylonjs';
import { keepPositionDragExact } from './positionGizmoDrag';

/** Un pas de glissement sur la flèche X, comme le comportement de glissement de Babylon le notifie. */
function dragX(options: { rotated: boolean; scale: number; fixed: boolean; pivot: boolean }) {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  new BABYLON.ArcRotateCamera('cam', 0, 1, 300, BABYLON.Vector3.Zero(), scene);
  const box = BABYLON.MeshBuilder.CreateBox('b', { size: 20 }, scene);
  box.bakeTransformIntoVertices(BABYLON.Matrix.Translation(60, 0, -30));
  // Comme à l'import (placeImportedModel) : pivot au centre de la boîte, loin de l'origine du maillage.
  if (options.pivot) box.setPivotPoint(new BABYLON.Vector3(60, 0, -30));
  box.scaling.setAll(options.scale);
  if (options.rotated) box.rotationQuaternion = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, 0.7);
  box.position.set(10, 5, 20);

  const manager = new BABYLON.GizmoManager(scene);
  manager.usePointerToAttachGizmos = false;
  manager.positionGizmoEnabled = true;
  const gizmo = manager.gizmos.positionGizmo!;
  gizmo.anchorPoint = BABYLON.GizmoAnchorPoint.Pivot;
  manager.attachToMesh(box);
  if (options.fixed) keepPositionDragExact(gizmo);
  scene.render();

  const before = box.position.clone();
  const behavior = gizmo.xGizmo.dragBehavior;
  const step = (x: number) =>
    behavior.onDragObservable.notifyObservers({
      delta: new BABYLON.Vector3(x, 0, 0),
      dragPlanePoint: BABYLON.Vector3.Zero(),
      dragPlaneNormal: BABYLON.Vector3.Up(),
      dragDistance: x,
      pointerId: 1,
    });
  behavior.onDragStartObservable.notifyObservers({ dragPlanePoint: BABYLON.Vector3.Zero(), pointerId: 1 });
  step(5);
  step(3);
  const moved = box.position.subtract(before);
  scene.dispose();
  engine.dispose();
  return moved;
}

describe('déplacement par les flèches (pivot décalé)', () => {
  it('reproduit le défaut de Babylon sans correctif : la pièce saute', () => {
    expect(dragX({ rotated: true, scale: 1000, fixed: false, pivot: true }).length()).toBeGreaterThan(1000);
  });

  it.each([
    { rotated: false, scale: 1 },
    { rotated: true, scale: 1 },
    { rotated: false, scale: 1000 },
    { rotated: true, scale: 1000 },
  ])('suit exactement le pointeur (%o)', (o) => {
    const moved = dragX({ ...o, fixed: true, pivot: true });
    expect(moved.x).toBeCloseTo(8, 6);
    expect(moved.y).toBeCloseTo(0, 6);
    expect(moved.z).toBeCloseTo(0, 6);
  });
});
