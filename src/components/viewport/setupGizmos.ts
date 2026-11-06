import * as BABYLON from 'babylonjs';
import { OrcaRotateGizmo } from '../orcaRotateGizmo';
import { OrcaScaleGizmo } from '../orcaScaleGizmo';
import type { GizmoAxisInternal } from './types';
import type { ViewportCtx } from './context';

/** Gestionnaire de gizmos (déplacement, rotation, échelle), surlignage de la sélection et changement d'outil. */
export function setupGizmos(c: ViewportCtx) {
  const { scene, flat, gizmoManagerRef, selectedMeshesRef, hlRef, PLATE_SURFACE_Y, currentToolRef } = c;


  const gizmoManager = new BABYLON.GizmoManager(scene);
  c.gizmoManager = gizmoManager;
 
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
  c.updateHighlight = updateHighlight;


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
  c.applyCustomGizmoColors = applyCustomGizmoColors;


  const updateSelectedPosition = () => {
    if (scene.isDisposed) return;
    const selection = selectedMeshesRef.current;
    if (selection.size > 0) {
      const activeMesh = Array.from(selection)[selection.size - 1];
      if (activeMesh && !activeMesh.isDisposed()) {
        window.dispatchEvent(
          new CustomEvent('apex-model-positioned', {
            detail: {
              x: activeMesh.position.x,
              y: activeMesh.position.y,
              z: activeMesh.position.z
            }
          })
        );
        c.emitTransformState();
      }
    }
  };
  c.updateSelectedPosition = updateSelectedPosition;


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
        window.dispatchEvent(
          new CustomEvent('apex-model-rotated', {
            detail: { x: rx, y: ry, z: rz }
          })
        );
      }
    }
  };
  c.updateSelectedRotation = updateSelectedRotation;


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


  const setupGizmoDragEnd = () => {
    const posGizmo = gizmoManager.gizmos.positionGizmo;
    if (posGizmo) {
      posGizmo.yGizmo?.dragBehavior.onDragEndObservable.add(handleDragEnd);
      posGizmo.xGizmo?.dragBehavior.onDragEndObservable.add(handleDragEnd);
      posGizmo.zGizmo?.dragBehavior.onDragEndObservable.add(handleDragEnd);
    }
  };
  c.setupGizmoDragEnd = setupGizmoDragEnd;


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
  c.orcaRotateGizmo = orcaRotateGizmo;

  let rotateToolOn = false;

  Object.defineProperty(gizmoManager, 'rotationGizmoEnabled', {
    configurable: true,
    get: () => rotateToolOn,
    set: (enabled: boolean) => {
      rotateToolOn = enabled;
      orcaRotateGizmo.attach(enabled ? gizmoManager.attachedMesh : null);
    },
  });

  gizmoManager.onAttachedToMeshObservable.add((mesh) => orcaRotateGizmo.attach(rotateToolOn ? mesh : null));


  // Gizmo de mise à l'échelle d'OrcaSlicer (orcaScaleGizmo.ts) à la place de celui de Babylon, même principe
  // que pour la rotation : `scaleGizmoEnabled` et `attachToMesh` pilotent notre gizmo, celui de Babylon n'est
  // jamais créé. La base du modèle reste sur le plateau pendant l'échelle.
  const orcaScaleGizmo = new OrcaScaleGizmo(scene, {
    onScaled: () => { keepOnPlateAfterRotation(); updateSelectedPosition(); },
    onDragEnd: () => { handleDragEnd(); updateSelectedPosition(); },
  });
  c.orcaScaleGizmo = orcaScaleGizmo;

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
  let rotationGizmoWired: unknown = null;

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

  scene.onBeforeRenderObservable.add(() => {
    const gizmos = gizmoManager.gizmos;
    keepCameraControlsDuringGizmoDrag(gizmos.positionGizmo);
    keepCameraControlsDuringGizmoDrag(gizmos.rotationGizmo);
    keepCameraControlsDuringGizmoDrag(gizmos.scaleGizmo);
    const rg = gizmos.rotationGizmo;
    if (!rg || rg === rotationGizmoWired) return;
    rotationGizmoWired = rg;
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
  c.onToolChanged = onToolChanged;

  window.addEventListener('apex-tool-changed', onToolChanged);
}
