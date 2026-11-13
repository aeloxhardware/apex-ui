import { describe, expect, it } from 'vitest';
import * as BABYLON from 'babylonjs';
import { OrcaRotateGizmo } from './orcaRotateGizmo';

describe('gizmo de rotation (Orca)', () => {
  it('se centre sur la boîte englobante, pas sur l\'origine du maillage', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    new BABYLON.ArcRotateCamera('cam', 0, 1, 300, BABYLON.Vector3.Zero(), scene);
    // Boîte dont l'origine est loin de sa géométrie, comme un STL modélisé hors de (0,0,0).
    const box = BABYLON.MeshBuilder.CreateBox('b', { size: 20 }, scene);
    box.bakeTransformIntoVertices(BABYLON.Matrix.Translation(100, 0, -50));
    box.position.set(0, 10, 0);

    const gizmo = new OrcaRotateGizmo(scene, { onRotated: () => {} });
    gizmo.attach(box);
    scene.render();

    const ring = scene.getTransformNodeByName('orcaRotateRing0') ?? gizmo['layer'].utilityLayerScene.getTransformNodeByName('orcaRotateRing0');
    expect(ring).toBeTruthy();
    expect(ring!.position.x).toBeCloseTo(100, 5);
    expect(ring!.position.y).toBeCloseTo(10, 5);
    expect(ring!.position.z).toBeCloseTo(-50, 5);
    // Rayon : demi-diagonale de la boîte (10·√3) + 5 mm.
    expect(ring!.scaling.x).toBeCloseTo(10 * Math.sqrt(3) + 5, 4);
    gizmo.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe('gizmo de rotation (Orca) : rotation', () => {
  it('fait tourner le modèle autour de son centre, dans le sens du pointeur', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    // Vue de dessus : l'anneau vertical (axe Y) est vu de face.
    const camera = new BABYLON.ArcRotateCamera('cam', 0, 0.001, 400, BABYLON.Vector3.Zero(), scene);
    const box = BABYLON.MeshBuilder.CreateBox('b', { size: 20 }, scene);
    box.bakeTransformIntoVertices(BABYLON.Matrix.Translation(60, 0, -30));
    // Comme à l'import (placeImportedModel) : pivot au centre de la boîte, loin de l'origine du maillage.
    // `rotateAround` de Babylon l'ignorait et faisait tourner la pièce autour d'un point décalé d'autant.
    box.setPivotPoint(new BABYLON.Vector3(60, 0, -30));
    box.position.set(15, 0, 25);

    // La repose sur le plateau (simulée : +7 mm) n'a lieu qu'au relâchement.
    let steps = 0;
    const gizmo = new OrcaRotateGizmo(scene, {
      onRotated: () => { steps++; },
      onDragEnd: () => { box.position.y += 7; },
    });
    gizmo.attach(box);
    scene.render();

    const ring = gizmo['rings'][1];
    const center = gizmo['center'].clone();
    const radius = gizmo['radius'] as number;
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    const pointAt = (deg: number) => {
      const a = BABYLON.Tools.ToRadians(deg);
      const world = center.add(ring.u.scale(Math.cos(a) * radius)).add(ring.v.scale(Math.sin(a) * radius));
      const px = BABYLON.Vector3.Project(world, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(width, height));
      return px;
    };
    const send = (type: number, deg: number) => {
      const px = pointAt(deg);
      scene.pointerX = px.x;
      scene.pointerY = px.y;
      scene.onPointerObservable.notifyObservers(new BABYLON.PointerInfo(type, { button: 0 } as PointerEvent, null as unknown as BABYLON.PickingInfo));
    };

    send(BABYLON.PointerEventTypes.POINTERMOVE, 0);
    send(BABYLON.PointerEventTypes.POINTERDOWN, 0);
    expect(gizmo['dragging']).toBe(1);
    const boxCenter = () => {
      box.computeWorldMatrix(true);
      const { min, max } = box.getHierarchyBoundingVectors(true);
      return min.add(max).scale(0.5);
    };
    const ringNode = gizmo['layer'].utilityLayerScene.getTransformNodeByName('orcaRotateRing1');
    // Pendant le glissement : ni l'anneau ni le centre de la pièce ne bougent, à aucun angle.
    for (const deg of [30, 60, 90]) {
      send(BABYLON.PointerEventTypes.POINTERMOVE, deg);
      scene.render();
      expect(BABYLON.Vector3.Distance(ringNode?.position ?? BABYLON.Vector3.Zero(), center)).toBeLessThan(1e-6);
      expect(BABYLON.Vector3.Distance(boxCenter(), center)).toBeLessThan(1e-3);
    }
    expect(steps).toBe(3);
    send(BABYLON.PointerEventTypes.POINTERUP, 90);

    // Au relâchement seulement : la hauteur est ajustée, et l'anneau rejoint la pièce.
    expect(BABYLON.Vector3.Distance(boxCenter(), center.add(new BABYLON.Vector3(0, 7, 0)))).toBeLessThan(1e-3);
    scene.render();
    expect(BABYLON.Vector3.Distance(ringNode?.position ?? BABYLON.Vector3.Zero(), center.add(new BABYLON.Vector3(0, 7, 0)))).toBeLessThan(1e-3);

    // La direction (0°) a suivi le pointeur jusqu'à 90° : u est devenu v.
    const turned = new BABYLON.Vector3();
    ring.u.rotateByQuaternionToRef(box.rotationQuaternion!, turned);
    expect(BABYLON.Vector3.Distance(turned, ring.v)).toBeLessThan(1e-3);
    gizmo.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe('gizmo de rotation (Orca) : poignées', () => {
  it('place une poignée par axe, à des endroits distincts et sur son anneau', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    new BABYLON.ArcRotateCamera('cam', 0, 1, 300, BABYLON.Vector3.Zero(), scene);
    const box = BABYLON.MeshBuilder.CreateBox('b', { size: 20 }, scene);
    box.bakeTransformIntoVertices(BABYLON.Matrix.Translation(100, 0, -50));
    const gizmo = new OrcaRotateGizmo(scene, { onRotated: () => {} });
    gizmo.attach(box);
    scene.render();

    const center = gizmo['center'] as BABYLON.Vector3;
    const radius = gizmo['radius'] as number;
    const rings = gizmo['rings'] as { axis: BABYLON.Vector3; grabber: BABYLON.Mesh }[];
    for (const ring of rings) {
      const offset = ring.grabber.position.subtract(center);
      expect(Math.abs(BABYLON.Vector3.Dot(offset, ring.axis))).toBeLessThan(1e-4); // dans le plan de l'anneau
      expect(offset.length()).toBeCloseTo(radius * 1.15, 4);
    }
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        expect(BABYLON.Vector3.Distance(rings[i].grabber.position, rings[j].grabber.position)).toBeGreaterThan(radius * 0.5);
      }
    }
    gizmo.dispose();
    scene.dispose();
    engine.dispose();
  });
});
