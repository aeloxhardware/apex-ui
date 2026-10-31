import * as BABYLON from 'babylonjs';

/**
 * Mise à l'échelle d'un maillage en gardant fixe un point de la pièce.
 *
 * Le maillage peut avoir un pivot décalé de son origine (setPivotPoint, posé à l'import) : Babylon applique alors
 * l'échelle autour de ce pivot, et la position ne suffit plus à savoir où la pièce se trouve. On ne fait donc pas
 * de calcul sur la position : on note le point dans le repère LOCAL du maillage, on applique l'échelle, puis on
 * recale la position pour que ce point revienne à l'endroit monde voulu (typiquement le centre de la base, pour
 * que la pièce reste posée sur le plateau).
 */

/** Point monde → repère local du maillage, à l'état actuel (avant une mise à l'échelle). */
export function localPointOf(mesh: BABYLON.AbstractMesh, worldPoint: BABYLON.Vector3): BABYLON.Vector3 {
  mesh.computeWorldMatrix(true);
  return BABYLON.Vector3.TransformCoordinates(worldPoint, mesh.getWorldMatrix().clone().invert());
}

/**
 * Pose la position de base et l'échelle locale, puis décale la position pour que `localPoint` tombe sur
 * `worldPoint`. Le point doit avoir été relevé avec `localPointOf` avant l'opération.
 */
export function scaleKeepingPoint(
  mesh: BABYLON.AbstractMesh,
  base: { position: BABYLON.Vector3; scaling: BABYLON.Vector3 },
  localPoint: BABYLON.Vector3,
  worldPoint: BABYLON.Vector3,
) {
  mesh.position.copyFrom(base.position);
  mesh.scaling.copyFrom(base.scaling);
  mesh.computeWorldMatrix(true);
  const moved = BABYLON.Vector3.TransformCoordinates(localPoint, mesh.getWorldMatrix());
  mesh.position.addInPlace(worldPoint.subtract(moved));
  mesh.computeWorldMatrix(true);
}
