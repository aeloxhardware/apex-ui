// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';
import { OrcaRotateGizmo } from '../orcaRotateGizmo';
import { OrcaScaleGizmo } from '../orcaScaleGizmo';
import { localPointOf, scaleKeepingPoint } from '@/utils/meshScale';
import type { GizmoAxisInternal, InspectableMaterial } from './viewportTypes';
import type { ViewportState } from './viewportState';

import { emitApex } from '@/events/apexEvents';
function setupUpdateFlatOutline(st: ViewportState) {
  const { gizmoManagerRef, scene, selectedMeshesRef } = st;
  const gizmoManager = new BABYLON.GizmoManager(scene); 
  gizmoManagerRef.current = gizmoManager; 
  gizmoManager.usePointerToAttachGizmos = false;
  gizmoManager.positionGizmoEnabled = false;
  gizmoManager.rotationGizmoEnabled = false;
  gizmoManager.scaleGizmoEnabled = false;

  // Les gizmos se placent par défaut sur l'ORIGINE du maillage (celle du fichier), pas sur son pivot :
  // ils restaient loin de la pièce, et la rotation se faisait autour de ce point. Les gizmos sont créés
  // à leur premier affichage, donc l'ancrage est réappliqué à chaque rattachement à un maillage.
  gizmoManager.onAttachedToMeshObservable.add(() => {
    const { positionGizmo, rotationGizmo, scaleGizmo } = gizmoManager.gizmos;
    for (const gizmo of [positionGizmo, rotationGizmo, scaleGizmo]) {
      if (gizmo) gizmo.anchorPoint = BABYLON.GizmoAnchorPoint.Pivot;
    }
  });

  // Interface classique : sélection = contour blanc (renderOutline), sans HighlightLayer (passes de rendu + flou).
  const outlinedMeshes = new Set<BABYLON.AbstractMesh>();
  const updateFlatOutline = () => {
    outlinedMeshes.forEach((m) => { if (!m.isDisposed()) m.renderOutline = false; });
    outlinedMeshes.clear();
    selectedMeshesRef.current.forEach((mesh) => {
      if (!mesh || mesh.isDisposed()) return;
      [mesh, ...mesh.getChildMeshes(false)].forEach((m) => {
        if (!(m instanceof BABYLON.Mesh) || m.getTotalVertices() === 0 || m.isDisposed()) return;
        m.renderOutline = true;
        m.outlineColor = BABYLON.Color3.White();
        m.outlineWidth = 0.6;
        outlinedMeshes.add(m);
      });
    });
  };
  Object.assign(st, { gizmoManager, updateFlatOutline });
}

function setupUpdateHighlight(st: ViewportState) {
  const { flat, hlRef, selectedMeshesRef, updateFlatOutline } = st;
  const updateHighlight = () => {
    if (flat) { updateFlatOutline(); return; }
    if (!hlRef.current) return;
    hlRef.current.removeAllMeshes();
    selectedMeshesRef.current.forEach((mesh) => {
      if (mesh && !mesh.isDisposed()) {
        if (mesh instanceof BABYLON.Mesh && mesh.getTotalVertices() > 0) {
          hlRef.current?.addMesh(mesh, new BABYLON.Color3(0, 0.94, 1));
        }
        mesh.getChildMeshes(false).forEach((child) => {
          if (child instanceof BABYLON.Mesh && child.getTotalVertices() > 0 && !child.isDisposed()) {
            hlRef.current?.addMesh(child, new BABYLON.Color3(0, 0.94, 1));
          }
        });
      }
    });
  };
  Object.assign(st, { updateHighlight });
}

function setupApplyCustomGizmoColors(st: ViewportState) {
  const { flat, gizmoManager } = st;
  const applyCustomGizmoColors = () => {
    const setGizmoColor = (axisGizmo: GizmoAxisInternal | undefined, axisColor: BABYLON.Color3) => {
      if (!axisGizmo) return;
      const color = flat ? BABYLON.Color3.White() : axisColor; // interface classique : noir et blanc
      if (axisGizmo._coloredMaterial) {
        axisGizmo._coloredMaterial.diffuseColor = color;
        axisGizmo._coloredMaterial.emissiveColor = color;
      }
      if (axisGizmo._hoverMaterial) {
        axisGizmo._hoverMaterial.diffuseColor = color.add(new BABYLON.Color3(0.2, 0.2, 0.2));
        axisGizmo._hoverMaterial.emissiveColor = color.add(new BABYLON.Color3(0.2, 0.2, 0.2));
      }
      if (axisGizmo.gizmoMesh) {
        axisGizmo.gizmoMesh.getChildMeshes().forEach((mesh) => {
          const mat = mesh.material as BABYLON.StandardMaterial | null;
          if (mat) {
            if (mat.diffuseColor) mat.diffuseColor = color;
            if (mat.emissiveColor) mat.emissiveColor = color;
          }
        });
      }
    };

    // Les interfaces publiques IAxisDragGizmo/IPlaneRotationGizmo ne déclarent pas les champs
    // internes ci-dessus : passage par `unknown` nécessaire pour ce cast structurel ciblé.
    const asInternal = (g: unknown) => g as GizmoAxisInternal | undefined;

    const posGizmo = gizmoManager.gizmos.positionGizmo;
    if (posGizmo) {
      setGizmoColor(asInternal(posGizmo.yGizmo), new BABYLON.Color3(0, 0, 1));
      setGizmoColor(asInternal(posGizmo.zGizmo), new BABYLON.Color3(0, 1, 0));
    }

    const rotGizmo = gizmoManager.gizmos.rotationGizmo;
    if (rotGizmo) {
      setGizmoColor(asInternal(rotGizmo.yGizmo), new BABYLON.Color3(0, 0, 1));
      setGizmoColor(asInternal(rotGizmo.zGizmo), new BABYLON.Color3(0, 1, 0));
    }
  };
  Object.assign(st, { applyCustomGizmoColors });
}

function setupUpdateSelectedPosition(st: ViewportState) {
  const { scene, selectedMeshesRef } = st;
  const updateSelectedPosition = () => {
    if (scene.isDisposed) return;
    const selection = selectedMeshesRef.current;
    if (selection.size > 0) {
      const activeMesh = Array.from(selection)[selection.size - 1];
      if (activeMesh && !activeMesh.isDisposed()) {
        emitApex('apex-model-positioned', {
              x: activeMesh.position.x,
              y: activeMesh.position.y,
              z: activeMesh.position.z
            });
        st.emitTransformState();
      }
    }
  };

  const updateSelectedRotation = () => {
    if (scene.isDisposed) return;
    const selection = selectedMeshesRef.current;
    if (selection.size > 0) {
      const activeMesh = Array.from(selection)[selection.size - 1];
      if (activeMesh && !activeMesh.isDisposed()) {
        let rotation = BABYLON.Vector3.Zero();
        if (activeMesh.rotationQuaternion) {
          rotation = activeMesh.rotationQuaternion.toEulerAngles();
        } else {
          rotation = activeMesh.rotation;
        }
        const rx = BABYLON.Tools.ToDegrees(rotation.x);
        const ry = BABYLON.Tools.ToDegrees(rotation.y);
        const rz = BABYLON.Tools.ToDegrees(rotation.z);
        emitApex('apex-model-rotated', { x: rx, y: ry, z: rz });
      }
    }
  };
  Object.assign(st, { updateSelectedPosition, updateSelectedRotation });
}

function setupHandleDragEnd(st: ViewportState) {
  const { PLATE_SURFACE_Y, scene, selectedMeshesRef, updateSelectedPosition } = st;
  const handleDragEnd = () => {
    const selection = selectedMeshesRef.current;
    if (selection.size === 0) return;
    const activeMesh = Array.from(selection)[selection.size - 1];
    if (!activeMesh || activeMesh.isDisposed()) return;

    const boundingInfo = activeMesh.getHierarchyBoundingVectors(true);
    const minHeight = boundingInfo.min.y;
    // La base du modèle doit reposer sur la surface du plateau (PLATE_SURFACE_Y), jamais sur
    // y = 0 (le niveau du fond quadrillé, ~65mm plus bas) — cf. le commentaire sur cette
    // constante.
    const targetY = Math.max(activeMesh.position.y - minHeight + PLATE_SURFACE_Y, PLATE_SURFACE_Y);

    if (activeMesh.position.y > targetY + 1) {
      let currentY = activeMesh.position.y;
      let velocityY = 0;
      const gravity = 0.8;
      const restitution = 0.25;

      const observer = scene.onBeforeRenderObservable.add(() => {
        if (!activeMesh || activeMesh.isDisposed()) {
          scene.onBeforeRenderObservable.remove(observer);
          return;
        }

        velocityY -= gravity;
        currentY += velocityY;

        if (currentY <= targetY) {
          currentY = targetY;
          if (Math.abs(velocityY) > 1.5) {
            velocityY = -velocityY * restitution;
          } else {
            activeMesh.position.y = targetY;
            scene.onBeforeRenderObservable.remove(observer);
            updateSelectedPosition();
            return;
          }
        }

        activeMesh.position.y = currentY;
        updateSelectedPosition();
      });
    }
  };
  Object.assign(st, { handleDragEnd });
}

function setupSetupGizmoDragEnd(st: ViewportState) {
  const { PLATE_SURFACE_Y, gizmoManager, handleDragEnd, scene, selectedMeshesRef, updateSelectedPosition, updateSelectedRotation } = st;
  const setupGizmoDragEnd = () => {
    const posGizmo = gizmoManager.gizmos.positionGizmo;
    if (posGizmo) {
      posGizmo.yGizmo?.dragBehavior.onDragEndObservable.add(handleDragEnd);
      posGizmo.xGizmo?.dragBehavior.onDragEndObservable.add(handleDragEnd);
      posGizmo.zGizmo?.dragBehavior.onDragEndObservable.add(handleDragEnd);
    }
  };

  gizmoManager.gizmos.positionGizmo?.xGizmo.dragBehavior.onDragObservable.add(updateSelectedPosition);
  gizmoManager.gizmos.positionGizmo?.yGizmo.dragBehavior.onDragObservable.add(updateSelectedPosition);
  gizmoManager.gizmos.positionGizmo?.zGizmo.dragBehavior.onDragObservable.add(updateSelectedPosition);

  // Pendant une rotation, le point le plus bas du modèle reste collé au plateau : on corrige
  // la hauteur à chaque pas (le gizmo a déjà appliqué sa rotation, son observer est enregistré
  // avant le nôtre).
  const keepOnPlateAfterRotation = () => {
    if (scene.isDisposed) return;
    const selection = selectedMeshesRef.current;
    if (selection.size === 0) return;
    const activeMesh = Array.from(selection)[selection.size - 1];
    if (!activeMesh || activeMesh.isDisposed()) return;
    activeMesh.computeWorldMatrix(true);
    const minY = activeMesh.getHierarchyBoundingVectors(true).min.y;
    activeMesh.position.y += PLATE_SURFACE_Y - minY;
    activeMesh.computeWorldMatrix(true);
    updateSelectedPosition();
  };
  const onRotationDrag = () => {
    keepOnPlateAfterRotation();
    updateSelectedRotation();
  };

  // Gizmo de rotation d'OrcaSlicer (orcaRotateGizmo.ts) à la place de celui de Babylon : trois anneaux
  // autour du CENTRE du modèle, accroche de l'angle, rotation autour de ce centre. Le gestionnaire de
  // gizmos reste le point d'entrée : `rotationGizmoEnabled` et `attachToMesh` pilotent notre gizmo, celui
  // de Babylon n'est jamais créé.
  const orcaRotateGizmo = new OrcaRotateGizmo(scene, {
    onRotated: onRotationDrag,
    onDragEnd: () => { updateSelectedPosition(); updateSelectedRotation(); },
  });
  st.rotateToolOn = false;
  Object.assign(st, { setupGizmoDragEnd, keepOnPlateAfterRotation, onRotationDrag, orcaRotateGizmo });
}

function setupKeepCameraControlsDuringGizmoDrag(st: ViewportState) {
  const { gizmoManager, handleDragEnd, keepOnPlateAfterRotation, orcaRotateGizmo, scene, updateSelectedPosition } = st;
  Object.defineProperty(gizmoManager, 'rotationGizmoEnabled', {
    configurable: true,
    get: () => st.rotateToolOn,
    set: (enabled: boolean) => {
      st.rotateToolOn = enabled;
      orcaRotateGizmo.attach(enabled ? gizmoManager.attachedMesh : null);
    },
  });
  gizmoManager.onAttachedToMeshObservable.add((mesh) => orcaRotateGizmo.attach(st.rotateToolOn ? mesh : null));

  // Gizmo de mise à l'échelle d'OrcaSlicer (orcaScaleGizmo.ts) à la place de celui de Babylon, même principe
  // que pour la rotation : `scaleGizmoEnabled` et `attachToMesh` pilotent notre gizmo, celui de Babylon n'est
  // jamais créé. La base du modèle reste sur le plateau pendant l'échelle.
  const orcaScaleGizmo = new OrcaScaleGizmo(scene, {
    onScaled: () => { keepOnPlateAfterRotation(); updateSelectedPosition(); },
    onDragEnd: () => { handleDragEnd(); updateSelectedPosition(); },
  });
  let scaleToolOn = false;
  Object.defineProperty(gizmoManager, 'scaleGizmoEnabled', {
    configurable: true,
    get: () => scaleToolOn,
    set: (enabled: boolean) => {
      scaleToolOn = enabled;
      orcaScaleGizmo.attach(enabled ? gizmoManager.attachedMesh : null);
    },
  });
  gizmoManager.onAttachedToMeshObservable.add((mesh) => orcaScaleGizmo.attach(scaleToolOn ? mesh : null));
  // Le gizmo de rotation n'est créé qu'à son premier affichage : on branche les observers dès
  // qu'il existe (une seule fois par instance).
  st.rotationGizmoWired = null;
  // Par défaut, glisser un gizmo détache puis ré-attache les contrôles de la caméra
  // (`PointerDragBehavior.detachCameraControls`) ; cette version de Babylon remet alors la table
  // `camera.movement.input.inputMap` à ses valeurs d'origine : l'orbite (clic droit) et le pan
  // (bouton du milieu) personnalisés plus haut disparaissaient après le premier déplacement /
  // rotation d'un modèle. Le gizmo ne s'utilise qu'avec le clic gauche, que la caméra ne gère
  // pas : on laisse donc ses contrôles en place.
  const gizmoDragsWired = new WeakSet<object>();
  const keepCameraControlsDuringGizmoDrag = (gizmo: unknown) => {
    if (!gizmo || typeof gizmo !== 'object') return;
    for (const sub of Object.values(gizmo as Record<string, unknown>)) {
      const behavior = (sub as { dragBehavior?: BABYLON.PointerDragBehavior } | null)?.dragBehavior;
      if (!behavior || gizmoDragsWired.has(behavior)) continue;
      gizmoDragsWired.add(behavior);
      behavior.detachCameraControls = false;
    }
  };
  Object.assign(st, { orcaScaleGizmo, keepCameraControlsDuringGizmoDrag });
}

function setupOnToolChanged(st: ViewportState) {
  const { applyCustomGizmoColors, currentToolRef, gizmoManager, keepCameraControlsDuringGizmoDrag, onRotationDrag, scene, selectedMeshesRef, setupGizmoDragEnd } = st;
  scene.onBeforeRenderObservable.add(() => {
    const gizmos = gizmoManager.gizmos;
    keepCameraControlsDuringGizmoDrag(gizmos.positionGizmo);
    keepCameraControlsDuringGizmoDrag(gizmos.rotationGizmo);
    keepCameraControlsDuringGizmoDrag(gizmos.scaleGizmo);
    const rg = gizmos.rotationGizmo;
    if (!rg || rg === st.rotationGizmoWired) return;
    st.rotationGizmoWired = rg;
    [rg.xGizmo, rg.yGizmo, rg.zGizmo].forEach((g) => g.dragBehavior.onDragObservable.add(onRotationDrag));
  });

  const onToolChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{ tool: string }>;
    currentToolRef.current = customEvent.detail.tool;
    if (scene.isDisposed) return;

    const selection = selectedMeshesRef.current;
    if (currentToolRef.current === 'move' && selection.size > 0) {
      const activeMesh = Array.from(selection)[0];
      if (activeMesh) {
        gizmoManager.rotationGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = false;
        gizmoManager.positionGizmoEnabled = true;
        applyCustomGizmoColors();
        gizmoManager.attachToMesh(activeMesh);
        setupGizmoDragEnd();
      }
    } else if (currentToolRef.current === 'rotate' && selection.size > 0) {
      const activeMesh = Array.from(selection)[0];
      if (activeMesh) {
        gizmoManager.positionGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = false;
        gizmoManager.rotationGizmoEnabled = true;
        applyCustomGizmoColors();
        gizmoManager.attachToMesh(activeMesh);
      }
    } else if (currentToolRef.current === 'scale' && selection.size > 0) {
      const activeMesh = Array.from(selection)[0];
      if (activeMesh) {
        gizmoManager.positionGizmoEnabled = false;
        gizmoManager.rotationGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = true;
        gizmoManager.attachToMesh(activeMesh);
      }
    } else {
      gizmoManager.positionGizmoEnabled = false;
      gizmoManager.rotationGizmoEnabled = false;
      gizmoManager.scaleGizmoEnabled = false;
      gizmoManager.attachToMesh(null);
    }
  };
  window.addEventListener('apex-tool-changed', onToolChanged);
  Object.assign(st, { onToolChanged });
}

function setupActiveTransformMesh(st: ViewportState) {
  const { PLATE_SURFACE_Y, scene, selectedMeshesRef } = st;
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
    emitApex('apex-transform-state', {
        position: { x: (bb.min.x + bb.max.x) / 2, y: (bb.min.z + bb.max.z) / 2, z: bb.min.y - PLATE_SURFACE_Y },
        rotation: { x: deg(rot.x), y: deg(rot.z), z: deg(rot.y) },
        size: { x: base.extent.x * rx, y: base.extent.z * rz, z: base.extent.y * ry },
        scale: { x: rx * 100, y: rz * 100, z: ry * 100 },
      });
  }
  st.emitTransformState = emitTransformState;
  Object.assign(st, { activeTransformMesh, transformBaseOf, meshEuler });
}

function setupOnTransformSet(st: ViewportState) {
  const { PLATE_SURFACE_Y, activeTransformMesh, emitTransformState, meshEuler, scene, transformBaseOf } = st;
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
  Object.assign(st, { onTransformSet });
}

function setupOnRequestTextures(st: ViewportState) {
  const { emitTransformState, modelsRef, onTransformSet, selectedMeshesRef } = st;
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

    emitApex('apex-textures-loaded', { textures });
  };

  window.addEventListener('apex-request-textures', onRequestTextures);
  Object.assign(st, { onRequestTextures });
}

export function setupViewportGizmos(st: ViewportState) {
  setupUpdateFlatOutline(st);
  setupUpdateHighlight(st);
  setupApplyCustomGizmoColors(st);
  setupUpdateSelectedPosition(st);
  setupHandleDragEnd(st);
  setupSetupGizmoDragEnd(st);
  setupKeepCameraControlsDuringGizmoDrag(st);
  setupOnToolChanged(st);
  setupActiveTransformMesh(st);
  setupOnTransformSet(st);
  setupOnRequestTextures(st);
}
