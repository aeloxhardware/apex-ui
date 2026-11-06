import * as BABYLON from 'babylonjs';
import { scaleKeepingPoint, localPointOf } from '@/utils/meshScale';
import type { InspectableMaterial } from './types';
import type { ViewportCtx } from './context';

/** Panneau de transformation numérique et demande de textures. */
export function setupTransformPanel(c: ViewportCtx) {
  const { scene, selectedMeshesRef, PLATE_SURFACE_Y, modelsRef } = c;


  // Saisie de valeurs exactes (TransformBox) : l'état du modèle actif part par `apex-transform-state`, une valeur
  // saisie arrive par `apex-transform-set`. Axes de l'imprimante : X = Babylon x, Y = Babylon z, Z = Babylon y
  // (vertical) ; rotations A / B / C autour de X / Y / Z. Position = centre de la boîte englobante, Z = hauteur de
  // la base au-dessus du plateau. Taille et échelle suivent les axes locaux du maillage, par rapport à l'état vu
  // la première fois (celui de l'import).
  const transformBases = new WeakMap<BABYLON.AbstractMesh, { scaling: BABYLON.Vector3; extent: BABYLON.Vector3 }>();

  const activeTransformMesh = () => {
    const selection = selectedMeshesRef.current;
    if (selection.size === 0) return null;
    const m = Array.from(selection)[selection.size - 1];
    return m && !m.isDisposed() ? m : null;
  };

  const transformBaseOf = (m: BABYLON.AbstractMesh) => {
    let base = transformBases.get(m);
    if (!base) {
      const bb = m.getHierarchyBoundingVectors(true);
      base = { scaling: m.scaling.clone(), extent: bb.max.subtract(bb.min) };
      transformBases.set(m, base);
    }
    return base;
  };

  const meshEuler = (m: BABYLON.AbstractMesh) => (m.rotationQuaternion ? m.rotationQuaternion.toEulerAngles() : m.rotation);

  function emitTransformState() {
    const m = activeTransformMesh();
    if (!m || scene.isDisposed) return;
    m.computeWorldMatrix(true);
    const bb = m.getHierarchyBoundingVectors(true);
    const base = transformBaseOf(m);
    const rot = meshEuler(m);
    const deg = BABYLON.Tools.ToDegrees;
    const ratio = (a: number, b: number) => (b !== 0 ? a / b : 1);
    const rx = ratio(m.scaling.x, base.scaling.x);
    const ry = ratio(m.scaling.y, base.scaling.y);
    const rz = ratio(m.scaling.z, base.scaling.z);
    window.dispatchEvent(new CustomEvent('apex-transform-state', {
      detail: {
        position: { x: (bb.min.x + bb.max.x) / 2, y: (bb.min.z + bb.max.z) / 2, z: bb.min.y - PLATE_SURFACE_Y },
        rotation: { x: deg(rot.x), y: deg(rot.z), z: deg(rot.y) },
        size: { x: base.extent.x * rx, y: base.extent.z * rz, z: base.extent.y * ry },
        scale: { x: rx * 100, y: rz * 100, z: ry * 100 },
      },
    }));
  }
  c.emitTransformState = emitTransformState;

  const onTransformSet = (e: Event) => {
    const { kind, axis, value, keepProportions } = (e as CustomEvent<{
      kind: 'position' | 'rotation' | 'size' | 'scale'; axis: 'x' | 'y' | 'z'; value: number; keepProportions: boolean;
    }>).detail;
    const m = activeTransformMesh();
    if (!m || scene.isDisposed || !Number.isFinite(value)) return;
    m.computeWorldMatrix(true);
    const bb = m.getHierarchyBoundingVectors(true);
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    const minY = bb.min.y;
    // Remet la base sur le plateau et le centre à sa place (après rotation ou échelle).
    const recenter = (baseCenter: boolean) => {
      m.computeWorldMatrix(true);
      const after = m.getHierarchyBoundingVectors(true);
      if (baseCenter) {
        m.position.x += cx - (after.min.x + after.max.x) / 2;
        m.position.z += cz - (after.min.z + after.max.z) / 2;
      }
      m.position.y += PLATE_SURFACE_Y - after.min.y;
      m.computeWorldMatrix(true);
    };

    if (kind === 'position') {
      if (axis === 'x') m.position.x += value - cx;
      else if (axis === 'y') m.position.z += value - cz;
      else m.position.y += PLATE_SURFACE_Y + Math.max(0, value) - minY;
      m.computeWorldMatrix(true);
    } else if (kind === 'rotation') {
      const cur = meshEuler(m);
      const next = { x: cur.x, y: cur.y, z: cur.z }; // Babylon : x = A, y = C, z = B
      const rad = BABYLON.Tools.ToRadians(value);
      if (axis === 'x') next.x = rad;
      else if (axis === 'y') next.z = rad;
      else next.y = rad;
      m.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(next.y, next.x, next.z);
      m.rotation.set(0, 0, 0);
      recenter(true);
    } else {
      const base = transformBaseOf(m);
      const local = { x: 'x', y: 'z', z: 'y' }[axis] as 'x' | 'y' | 'z'; // axe imprimante → axe Babylon
      const current = {
        x: base.scaling.x !== 0 ? m.scaling.x / base.scaling.x : 1,
        y: base.scaling.y !== 0 ? m.scaling.y / base.scaling.y : 1,
        z: base.scaling.z !== 0 ? m.scaling.z / base.scaling.z : 1,
      };
      const target = kind === 'size' ? value / (base.extent[local] || 1) : value / 100;
      const next = { ...current };
      if (keepProportions && current[local] !== 0) {
        const f = target / current[local];
        next.x *= f; next.y *= f; next.z *= f;
      } else {
        next[local] = target;
      }
      const newScaling = new BABYLON.Vector3(
        base.scaling.x * Math.max(1e-4, next.x),
        base.scaling.y * Math.max(1e-4, next.y),
        base.scaling.z * Math.max(1e-4, next.z),
      );
      const anchor = new BABYLON.Vector3(cx, minY, cz);
      scaleKeepingPoint(m, { position: m.position.clone(), scaling: newScaling }, localPointOf(m, anchor), anchor);
      recenter(false);
    }
    emitTransformState();
  };
  c.onTransformSet = onTransformSet;

  window.addEventListener('apex-transform-request', emitTransformState);

  window.addEventListener('apex-transform-set', onTransformSet);


  const onRequestTextures = () => {
    const selection = selectedMeshesRef.current;
    const activeMesh = selection.size > 0 ? Array.from(selection)[selection.size - 1] : Array.from(modelsRef.current)[0];

    const textures: { id: string; name: string; type: string; res: string; color: string }[] = [];
    const visitedMats = new Set<number>();

    const inspectMaterial = (mat: InspectableMaterial | null | undefined) => {
      if (!mat || visitedMats.has(mat.uniqueId)) return;
      visitedMats.add(mat.uniqueId);

      let hexColor = '#00f0ff';
      if (mat.albedoColor) {
        hexColor = mat.albedoColor.toHexString();
      } else if (mat.diffuseColor) {
        hexColor = mat.diffuseColor.toHexString();
      }

      textures.push({
        id: `tex-${mat.uniqueId}`,
        name: mat.name || 'Material',
        type: mat.albedoTexture ? 'Texture Albedo' : 'Couleur Pleine',
        res: mat.albedoTexture ? `${mat.albedoTexture.getSize().width} x ${mat.albedoTexture.getSize().height}` : 'Procédural',
        color: hexColor
      });
    };

    if (activeMesh) {
      const meshesToCheck = [activeMesh, ...activeMesh.getChildMeshes()];
      meshesToCheck.forEach(m => {
        if (m.material) {
          if (m.material.getClassName() === 'MultiMaterial') {
            (m.material as BABYLON.MultiMaterial).subMaterials.forEach((subMat) => inspectMaterial(subMat as InspectableMaterial | null));
          } else {
            inspectMaterial(m.material as InspectableMaterial);
          }
        }
      });
    }

    window.dispatchEvent(
      new CustomEvent('apex-textures-loaded', { detail: { textures } })
    );
  };
  c.onRequestTextures = onRequestTextures;


  window.addEventListener('apex-request-textures', onRequestTextures);
}
