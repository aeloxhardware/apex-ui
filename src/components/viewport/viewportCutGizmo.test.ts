import { describe, expect, it } from 'vitest';
import * as BABYLON from 'babylonjs';
import { createCutGizmo } from './viewportCutGizmo';

function setup() {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  new BABYLON.ArcRotateCamera('cam', 0, 1, 300, BABYLON.Vector3.Zero(), scene);
  const node = () => scene.getTransformNodeByName('apexCutGizmoNode');
  return { engine, scene, node };
}

describe('gizmo du plan de coupe', () => {
  it('se place au centre du plan, sa flèche le long de la normale', () => {
    const { engine, scene, node } = setup();
    const gizmo = createCutGizmo(
      scene,
      () => {},
      () => {},
    );
    const normal = new BABYLON.Vector3(1, 1, 0).normalize();
    gizmo.place({ point: new BABYLON.Vector3(10, 20, -5), normal });
    scene.render();

    const n = node();
    expect(n).toBeTruthy();
    expect(n?.getAbsolutePosition().asArray()).toEqual([10, 20, -5]);
    const up = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0, 1, 0), n?.getWorldMatrix() ?? BABYLON.Matrix.Identity());
    expect(up.x).toBeCloseTo(normal.x, 6);
    expect(up.y).toBeCloseTo(normal.y, 6);
    expect(up.z).toBeCloseTo(normal.z, 6);
    expect(gizmo.dragging).toBe(false);

    gizmo.place(null);
    gizmo.dispose();
    expect(node()).toBeNull();
    scene.dispose();
    engine.dispose();
  });
});
