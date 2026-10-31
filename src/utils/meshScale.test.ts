import { describe, expect, it } from 'vitest';
import * as BABYLON from 'babylonjs';
import { localPointOf, scaleKeepingPoint } from './meshScale';

/** Boîte de 20 mm dont la géométrie est en x 90..110, y -10..10, z -60..-40, posée à y = 10. */
function makeBox(scene: BABYLON.Scene, pivotAtCenter: boolean) {
  const box = BABYLON.MeshBuilder.CreateBox('b', { size: 20 }, scene);
  box.bakeTransformIntoVertices(BABYLON.Matrix.Translation(100, 0, -50));
  box.position.set(0, 10, 0);
  if (pivotAtCenter) box.setPivotPoint(new BABYLON.Vector3(100, 0, -50));
  box.computeWorldMatrix(true);
  return box;
}

/** Centre de la base (monde) : x et z du centre de la boîte, y du dessous. */
function baseCenter(mesh: BABYLON.AbstractMesh) {
  mesh.computeWorldMatrix(true);
  const b = mesh.getHierarchyBoundingVectors(true);
  return new BABYLON.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
}

describe('scaleKeepingPoint', () => {
  for (const pivotAtCenter of [false, true]) {
    it(`garde le centre de la base fixe (pivot décalé : ${pivotAtCenter})`, () => {
      const scene = new BABYLON.Scene(new BABYLON.NullEngine());
      const box = makeBox(scene, pivotAtCenter);
      const anchor = baseCenter(box);
      const local = localPointOf(box, anchor);

      scaleKeepingPoint(box, { position: box.position.clone(), scaling: new BABYLON.Vector3(1, 2, 1) }, local, anchor);

      const after = baseCenter(box);
      expect(BABYLON.Vector3.Distance(after, anchor)).toBeLessThan(1e-6);
      // Hauteur doublée : la boîte va de y = 0 à y = 40, elle n'a pas glissé dans le plateau.
      const bounds = box.getHierarchyBoundingVectors(true);
      expect(bounds.min.y).toBeCloseTo(0, 6);
      expect(bounds.max.y).toBeCloseTo(40, 6);
    });
  }

  it('ne déplace pas la pièce quand on revient à l\'échelle de départ', () => {
    const scene = new BABYLON.Scene(new BABYLON.NullEngine());
    const box = makeBox(scene, true);
    const start = box.position.clone();
    const anchor = baseCenter(box);
    const local = localPointOf(box, anchor);

    scaleKeepingPoint(box, { position: start, scaling: new BABYLON.Vector3(3, 3, 3) }, local, anchor);
    scaleKeepingPoint(box, { position: start, scaling: BABYLON.Vector3.One() }, local, anchor);

    expect(BABYLON.Vector3.Distance(box.position, start)).toBeLessThan(1e-6);
  });
});
