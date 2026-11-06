// Pose d'un modèle (position, rotation, échelle, unité) : de quoi détecter qu'un modèle a bougé et le
// remettre exactement comme il était. Utilisé par l'historique Ctrl+Z (viewportHistory.ts).
import type * as BABYLON from 'babylonjs';

export interface Pose {
  mesh: BABYLON.AbstractMesh;
  position: BABYLON.Vector3;
  rotation: BABYLON.Vector3;
  quaternion: BABYLON.Quaternion | null;
  scaling: BABYLON.Vector3;
  unit: 'mm' | 'in';
}

const EPSILON = 1e-4;

export function capturePose(mesh: BABYLON.AbstractMesh): Pose {
  return {
    mesh,
    position: mesh.position.clone(),
    rotation: mesh.rotation.clone(),
    quaternion: mesh.rotationQuaternion ? mesh.rotationQuaternion.clone() : null,
    scaling: mesh.scaling.clone(),
    unit: mesh.metadata?.apexUnit === 'in' ? 'in' : 'mm',
  };
}

function poseValues(p: Pose): number[] {
  const q = p.quaternion;
  return [
    p.position.x,
    p.position.y,
    p.position.z,
    p.rotation.x,
    p.rotation.y,
    p.rotation.z,
    ...(q ? [q.x, q.y, q.z, q.w] : [0, 0, 0, 0]),
    p.scaling.x,
    p.scaling.y,
    p.scaling.z,
  ];
}

/** Vrai si la pose a changé (à une tolérance près : le flottant ne bouge pas « presque »). */
export function poseChanged(a: Pose, b: Pose): boolean {
  if (a.unit !== b.unit || (a.quaternion === null) !== (b.quaternion === null)) return true;
  const va = poseValues(a);
  const vb = poseValues(b);
  return va.some((v, i) => Math.abs(v - (vb[i] ?? 0)) > EPSILON);
}

/** Remet le modèle dans la pose donnée. */
export function applyPose(pose: Pose) {
  const { mesh } = pose;
  if (mesh.isDisposed()) return;
  mesh.position.copyFrom(pose.position);
  mesh.rotation.copyFrom(pose.rotation);
  mesh.rotationQuaternion = pose.quaternion ? pose.quaternion.clone() : null;
  mesh.scaling.copyFrom(pose.scaling);
  mesh.metadata = { ...(mesh.metadata ?? {}), apexUnit: pose.unit };
  mesh.computeWorldMatrix(true);
}
