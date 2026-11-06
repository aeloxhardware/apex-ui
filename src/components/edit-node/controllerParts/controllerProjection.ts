// Issu de la découpe de createGCodeEditController (gcodeEditController.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (controllerState.ts).
import * as BABYLON from 'babylonjs';
import { nozzleTip } from '../../gcodeParse';
import { type NodeState } from './controllerShared';
import type { EditControllerState } from './controllerState';

function setupViewport(st: EditControllerState) {
  const { camera, canvas, engine, layer } = st;
  // --- projections écran ↔ plateau ----------------------------------------------------------------

  const viewport = () => camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const cssScale = () => canvas.clientWidth / Math.max(1, engine.getRenderWidth());
  const scratchWorld = new BABYLON.Vector3();
  const scratchTransform = new BABYLON.Matrix();

  /** Position écran (px CSS) et profondeur (0..1) d'un point local. */
  const project = (local: BABYLON.Vector3) => {
    BABYLON.Vector3.TransformCoordinatesToRef(local, layer.getPlateWorldMatrix(), scratchWorld);
    // Vue × projection de LA caméra de la vue, recalculées ici : la matrice de la scène est celle
    // du dernier rendu (une autre caméra, captures et vignettes), et `getTransformationMatrix` de
    // la caméra n'est pas tenue à jour dans cette scène.
    camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), scratchTransform);
    const p = BABYLON.Vector3.Project(scratchWorld, BABYLON.Matrix.IdentityReadOnly, scratchTransform, viewport());
    const s = cssScale();
    return { x: p.x * s, y: p.y * s, z: p.z };
  };

  /** Point local à la profondeur `z` sous le point écran (px CSS). */
  const unproject = (x: number, y: number, z: number) => {
    const s = cssScale();
    const world = BABYLON.Vector3.Unproject(
      new BABYLON.Vector3(x / s, y / s, z),
      engine.getRenderWidth(), engine.getRenderHeight(),
      BABYLON.Matrix.IdentityReadOnly, camera.getViewMatrix(), camera.getProjectionMatrix(),
    );
    const inv = layer.getPlateWorldMatrix().clone().invert();
    return BABYLON.Vector3.TransformCoordinates(world, inv);
  };

  const nodeLocal = (n: NodeState) => n.dragTip ?? n.anchor.add(n.applied);
  const tipScratch = { r: 0, z: 0 };
  /** Pointe (local) de valeurs firmware R, C, Z, B — même formule que le rendu et le noyau. */
  const tipOfFirmware = (v: ArrayLike<number>) => {
    nozzleTip(v[0], v[2], (v[3] * Math.PI) / 180, tipScratch);
    const c = (v[1] * Math.PI) / 180;
    return new BABYLON.Vector3(tipScratch.r * Math.cos(c), tipScratch.z, tipScratch.r * Math.sin(c));
  };
  Object.assign(st, { cssScale, project, unproject, nodeLocal, tipOfFirmware });
}

export function setupEditControllerProjection(st: EditControllerState) {
  setupViewport(st);
}
