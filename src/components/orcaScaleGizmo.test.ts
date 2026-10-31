import { describe, expect, it } from 'vitest';
import * as BABYLON from 'babylonjs';
import { OrcaScaleGizmo } from './orcaScaleGizmo';

describe('gizmo de mise à l\'échelle (Orca)', () => {
  it('pose ses poignées sur les faces de la boîte, le centre de la base en bas', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    new BABYLON.ArcRotateCamera('cam', 0, 1, 300, BABYLON.Vector3.Zero(), scene);
    // Boîte hors de son origine : géométrie en x 90..110, y -10..10, z -60..-40, posée à y = 10.
    const box = BABYLON.MeshBuilder.CreateBox('b', { size: 20 }, scene);
    box.bakeTransformIntoVertices(BABYLON.Matrix.Translation(100, 0, -50));
    box.position.set(0, 10, 0);

    const gizmo = new OrcaScaleGizmo(scene, { onScaled: () => {} });
    gizmo.attach(box);
    scene.render();

    // Sur la boîte monde : x 90..110, y 0..20, z -60..-40.
    const grabbers = gizmo['grabbers'] as BABYLON.Mesh[];
    const near = (a: BABYLON.Vector3, b: BABYLON.Vector3) => expect(BABYLON.Vector3.Distance(a, b)).toBeLessThan(1e-6);
    near(grabbers[4].position, new BABYLON.Vector3(100, 0, -50)); // centre de la base
    near(grabbers[5].position, new BABYLON.Vector3(100, 20, -50)); // dessus
    near(grabbers[1].position, new BABYLON.Vector3(110, 0, -50)); // face +X
    near(grabbers[3].position, new BABYLON.Vector3(100, 0, -40)); // face avant (profondeur)
    near(grabbers[6].position, new BABYLON.Vector3(90, 0, -60)); // angle de la base
  });

});
