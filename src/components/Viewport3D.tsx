"use client";

import React, { useRef, useState, useLayoutEffect } from 'react';
import * as BABYLON from 'babylonjs';
import 'babylonjs-loaders';

export const Viewport3D = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BABYLON.Engine | null>(null);
  const sceneRef = useRef<BABYLON.Scene | null>(null);
  const cameraRef = useRef<BABYLON.ArcRotateCamera | null>(null);
  const hlRef = useRef<BABYLON.HighlightLayer | null>(null);
  const gizmoManagerRef = useRef<BABYLON.GizmoManager | null>(null);
  const selectedMeshesRef = useRef<Set<BABYLON.AbstractMesh>>(new Set());
  const modelsRef = useRef<Set<BABYLON.AbstractMesh>>(new Set());
  const [selectedMeshName, setSelectedMeshName] = useState<string | null>(null);

  // Dimensions : 250mm de diamètre (rayon 125) et 130mm de haut
  const RADIUS = 125; 
  const HEIGHT = 130;
  const HOLE_RADIUS = 20; 

  const createBoundaryMaterial = (scene: BABYLON.Scene) => {
    BABYLON.Effect.ShadersStore["boundaryVertexShader"] = `
      precision highp float;
      attribute vec3 position;
      attribute vec3 normal;
      uniform mat4 worldViewProjection;
      uniform mat4 world;
      varying vec3 vPositionW;
      varying vec3 vNormalW;
      void main(void) {
          vec4 outPosition = worldViewProjection * vec4(position, 1.0);
          gl_Position = outPosition;
          vPositionW = vec3(world * vec4(position, 1.0));
          vNormalW = normalize(vec3(world * vec4(normal, 0.0)));
      }
    `;
    BABYLON.Effect.ShadersStore["boundaryFragmentShader"] = `
      precision highp float;
      varying vec3 vPositionW;
      varying vec3 vNormalW;
      uniform float radius;
      uniform float height;
      uniform vec3 cameraPosition;
      void main(void) {
          float dist = sqrt(vPositionW.x * vPositionW.x + vPositionW.z * vPositionW.z);
          bool isOut = (dist > radius || vPositionW.y < -0.1 || vPositionW.y > height);
          vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
          float diffuse = max(dot(vNormalW, lightDir), 0.4);
          vec3 viewDirW = normalize(cameraPosition - vPositionW);
          float fresnel = pow(1.0 - max(dot(vNormalW, viewDirW), 0.0), 3.0);
          if (isOut) {
              vec3 orange = vec3(1.0, 0.5, 0.0);
              vec3 glowRed = vec3(1.0, 0.0, 0.0);
              vec3 finalColor = mix(orange * diffuse, glowRed, fresnel * 0.8);
              gl_FragColor = vec4(finalColor, 1.0); 
          } else {
              float distToWall = abs(dist - radius);
              float distToTop = abs(vPositionW.y - height);
              float edgeDist = min(distToWall, distToTop);
              if (edgeDist < 0.8 && (dist > radius - 1.0 || vPositionW.y > height - 1.0 || vPositionW.y < 0.0)) {
                  gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
              } else {
                  vec3 neutralGrey = vec3(0.45, 0.45, 0.45);
                  gl_FragColor = vec4(neutralGrey * diffuse, 1.0);
              }
          }
      }
    `;
    const mat = new BABYLON.ShaderMaterial("boundaryMat", scene, { vertex: "boundary", fragment: "boundary" }, { attributes: ["position", "normal"], uniforms: ["worldViewProjection", "world", "radius", "height", "cameraPosition"] });
    mat.setFloat("radius", RADIUS);
    mat.setFloat("height", HEIGHT);
    mat.backFaceCulling = true;
    mat.forceDepthWrite = true;
    return mat;
  };

  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true });
    engineRef.current = engine;
    const scene = new BABYLON.Scene(engine);
    sceneRef.current = scene;
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);

    const camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 4, Math.PI / 3, 300, new BABYLON.Vector3(0, HEIGHT / 2, 0), scene);
    camera.attachControl(canvas, true); 
    camera.wheelPrecision = 2; 

    camera.angularSensibilityX = 3500;
    camera.angularSensibilityY = 3500;
    camera.panningSensibility = 40; 
    cameraRef.current = camera;

    new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
    const hl = new BABYLON.HighlightLayer("hl1", scene);
    hl.blurHorizontalSize = 0.5;
    hl.blurVerticalSize = 0.5;
    hlRef.current = hl;

    const gizmoManager = new BABYLON.GizmoManager(scene); 
    gizmoManagerRef.current = gizmoManager; 
    gizmoManager.usePointerToAttachGizmos = false;
    gizmoManager.positionGizmoEnabled = false;
    gizmoManager.rotationGizmoEnabled = false;
    gizmoManager.scaleGizmoEnabled = false;

    let currentTool = "select";

    const updateHighlight = () => {
      if (!hlRef.current) return;
      hlRef.current.removeAllMeshes();
      selectedMeshesRef.current.forEach((mesh) => {
        if (mesh && !mesh.isDisposed()) {
          hlRef.current?.addMesh(mesh as BABYLON.Mesh, new BABYLON.Color3(0, 0.94, 1));
        }
      });
    };

    const applyCustomGizmoColors = () => {
      const setGizmoColor = (axisGizmo: any, color: BABYLON.Color3) => {
        if (!axisGizmo) return;
        if (axisGizmo._coloredMaterial) {
          axisGizmo._coloredMaterial.diffuseColor = color;
          axisGizmo._coloredMaterial.emissiveColor = color;
        }
        if (axisGizmo._hoverMaterial) {
          axisGizmo._hoverMaterial.diffuseColor = color.add(new BABYLON.Color3(0.2, 0.2, 0.2));
          axisGizmo._hoverMaterial.emissiveColor = color.add(new BABYLON.Color3(0.2, 0.2, 0.2));
        }
        if (axisGizmo.gizmoMesh) {
          axisGizmo.gizmoMesh.getChildMeshes().forEach((mesh: any) => {
            if (mesh.material) {
              if (mesh.material.diffuseColor) mesh.material.diffuseColor = color;
              if (mesh.material.emissiveColor) mesh.material.emissiveColor = color;
            }
          });
        }
      };

      const posGizmo = gizmoManager.gizmos.positionGizmo;
      if (posGizmo) {
        setGizmoColor(posGizmo.yGizmo, new BABYLON.Color3(0, 0, 1));
        setGizmoColor(posGizmo.zGizmo, new BABYLON.Color3(0, 1, 0));
      }

      const rotGizmo = gizmoManager.gizmos.rotationGizmo;
      if (rotGizmo) {
        setGizmoColor(rotGizmo.yGizmo, new BABYLON.Color3(0, 0, 1));
        setGizmoColor(rotGizmo.zGizmo, new BABYLON.Color3(0, 1, 0));
      }
    };

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
          window.dispatchEvent(
            new CustomEvent('apex-model-rotated', {
              detail: { x: rx, y: ry, z: rz }
            })
          );
        }
      }
    };

    gizmoManager.gizmos.positionGizmo?.xGizmo.dragBehavior.onDragObservable.add(updateSelectedPosition);
    gizmoManager.gizmos.positionGizmo?.yGizmo.dragBehavior.onDragObservable.add(updateSelectedPosition);
    gizmoManager.gizmos.positionGizmo?.zGizmo.dragBehavior.onDragObservable.add(updateSelectedPosition);

    gizmoManager.gizmos.rotationGizmo?.xGizmo.dragBehavior.onDragObservable.add(updateSelectedRotation);
    gizmoManager.gizmos.rotationGizmo?.yGizmo.dragBehavior.onDragObservable.add(updateSelectedRotation);
    gizmoManager.gizmos.rotationGizmo?.zGizmo.dragBehavior.onDragObservable.add(updateSelectedRotation);

    const onToolChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ tool: string }>;
      currentTool = customEvent.detail.tool;
      if (scene.isDisposed) return;

      const selection = selectedMeshesRef.current;
      if (currentTool === 'move' && selection.size > 0) {
        const activeMesh = Array.from(selection)[0];
        if (activeMesh) {
          gizmoManager.rotationGizmoEnabled = false;
          gizmoManager.scaleGizmoEnabled = false;
          gizmoManager.positionGizmoEnabled = true;
          applyCustomGizmoColors();
          gizmoManager.attachToMesh(activeMesh);
        }
      } else if (currentTool === 'rotate' && selection.size > 0) {
        const activeMesh = Array.from(selection)[0];
        if (activeMesh) {
          gizmoManager.positionGizmoEnabled = false;
          gizmoManager.scaleGizmoEnabled = false;
          gizmoManager.rotationGizmoEnabled = true;
          applyCustomGizmoColors();
          gizmoManager.attachToMesh(activeMesh);
        }
      } else if (currentTool === 'scale' && selection.size > 0) {
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

    const onRequestTextures = () => {
      const selection = selectedMeshesRef.current;
      let activeMesh = selection.size > 0 ? Array.from(selection)[selection.size - 1] : Array.from(modelsRef.current)[0];
      
      const textures: any[] = [];
      const visitedMats = new Set<string>();

      const inspectMaterial = (mat: any) => {
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
              (m.material as any).subMaterials.forEach((subMat: any) => inspectMaterial(subMat));
            } else {
              inspectMaterial(m.material);
            }
          }
        });
      }

      window.dispatchEvent(
        new CustomEvent('apex-textures-loaded', { detail: { textures } })
      );
    };

    window.addEventListener('apex-request-textures', onRequestTextures);

    const volumeRoot = new BABYLON.TransformNode("volumeRoot", scene);
    const plateLines = [];
    for (let i = 0; i < 64; i++) {
        const angle = (i / 64) * Math.PI * 2;
        const cos = Math.cos(angle); const sin = Math.sin(angle);
        plateLines.push([new BABYLON.Vector3(cos * HOLE_RADIUS, 0, sin * HOLE_RADIUS), new BABYLON.Vector3(cos * RADIUS, 0, sin * RADIUS)]);
    }
    const plate = BABYLON.MeshBuilder.CreateLineSystem("plate", { lines: plateLines }, scene) as BABYLON.LinesMesh;
    plate.color = new BABYLON.Color3(0.3, 0.3, 0.3); plate.parent = volumeRoot;

    const outlinePoints = [];
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      outlinePoints.push(new BABYLON.Vector3(Math.cos(angle) * RADIUS, 0, Math.sin(angle) * RADIUS));
    }
    const outline = BABYLON.MeshBuilder.CreateLines("plateOutline", { points: outlinePoints }, scene) as BABYLON.LinesMesh;
    outline.color = new BABYLON.Color3(0, 0.94, 1); 
    outline.parent = volumeRoot;

    const topOutlinePoints = [];
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      topOutlinePoints.push(new BABYLON.Vector3(Math.cos(angle) * RADIUS, HEIGHT, Math.sin(angle) * RADIUS));
    }
    const topOutline = BABYLON.MeshBuilder.CreateLines("topOutline", { points: topOutlinePoints }, scene) as BABYLON.LinesMesh;
    topOutline.color = new BABYLON.Color3(0, 0.94, 1);
    topOutline.parent = volumeRoot;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selection = selectedMeshesRef.current;
        if (selection.size > 0) {
          let confirmed = true;
          if (selection.size > 1) {
            confirmed = window.confirm(`Voulez-vous vraiment supprimer les ${selection.size} modèles sélectionnés ?`);
          }
          if (confirmed) {
            selection.forEach(mesh => {
              if (mesh && !mesh.isDisposed()) {
                modelsRef.current.delete(mesh);
                mesh.dispose();
              }
            });
            selection.clear();
            setSelectedMeshName(null);
            updateHighlight();
            gizmoManager.positionGizmoEnabled = false;
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.attachToMesh(null);
            window.dispatchEvent(new CustomEvent('apex-mesh-selected', { detail: { name: null, subMeshes: [] } }));
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
      const excluded: BABYLON.AbstractMesh[] = [plate, outline, topOutline];

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => !excluded.includes(mesh) && !mesh.name.includes("Gizmo"));
        const clientX = pointerInfo.event.clientX;
        const clientY = pointerInfo.event.clientY;

        if (pick?.hit && pick.pickedMesh) {
          let hoveredMesh = pick.pickedMesh;
          if (currentTool !== 'texture') {
            let root = hoveredMesh;
            while (root.parent && modelsRef.current.has(root.parent as BABYLON.AbstractMesh) === false) {
              root = root.parent as BABYLON.AbstractMesh;
            }
            if (modelsRef.current.has(root)) {
              hoveredMesh = root;
            }
          }
          const hasTexture = hoveredMesh.material && hoveredMesh.material.name !== "boundaryMat";
          window.dispatchEvent(
            new CustomEvent('apex-model-hover', {
              detail: {
                visible: true,
                x: clientX,
                y: clientY,
                modelName: hoveredMesh.name || "Modèle 3D",
                hasTexture: !!hasTexture,
              }
            })
          );
        } else {
          window.dispatchEvent(
            new CustomEvent('apex-model-hover', {
              detail: { visible: false, x: 0, y: 0, modelName: '', hasTexture: false }
            })
          );
        }
      }

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
        const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => !excluded.includes(mesh) && !mesh.name.includes("Gizmo"));
        if (pick?.hit && pick.pickedMesh) {
          let topMesh = pick.pickedMesh;
          
          // Si l'outil n'est pas 'texture', on remonte toujours au modèle racine complet
          if (currentTool !== 'texture') {
            let root = topMesh;
            while (root.parent && modelsRef.current.has(root.parent as BABYLON.AbstractMesh) === false) {
              root = root.parent as BABYLON.AbstractMesh;
            }
            if (modelsRef.current.has(root)) {
              topMesh = root;
            }
          }
          
          if (selectedMeshesRef.current.has(topMesh)) {
            selectedMeshesRef.current.clear();
            setSelectedMeshName(null);
            updateHighlight();
            gizmoManager.positionGizmoEnabled = false;
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.attachToMesh(null);
            window.dispatchEvent(new CustomEvent('apex-mesh-selected', { detail: { name: null, subMeshes: [] } }));
            return;
          }

          selectedMeshesRef.current.clear();
          selectedMeshesRef.current.add(topMesh);
          setSelectedMeshName(topMesh.name || "Modèle 3D");
          updateHighlight();
          updateSelectedPosition();
          updateSelectedRotation();

          // Extract real sub-meshes and colors from topMesh hierarchy
          const subMeshesList: { id: string; name: string; color: string }[] = [];
          const childMeshes = [topMesh, ...topMesh.getChildMeshes()];
          childMeshes.forEach((cm, idx) => {
            let hex = '#00f0ff';
            if (cm.material) {
              const mat = cm.material as any;
              if (mat.albedoColor) hex = mat.albedoColor.toHexString();
              else if (mat.diffuseColor) hex = mat.diffuseColor.toHexString();
            }
            subMeshesList.push({
              id: `${topMesh.name}-${idx}`,
              name: cm.name || `Partie ${idx + 1}`,
              color: hex
            });
          });

          window.dispatchEvent(
            new CustomEvent('apex-mesh-selected', { 
              detail: { 
                name: topMesh.name || "Modèle 3D",
                subMeshes: subMeshesList
              } 
            })
          );

          if (currentTool === 'move') {
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.positionGizmoEnabled = true;
            applyCustomGizmoColors();
            gizmoManager.attachToMesh(topMesh);
          } else if (currentTool === 'rotate') {
            gizmoManager.positionGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.rotationGizmoEnabled = true;
            applyCustomGizmoColors();
            gizmoManager.attachToMesh(topMesh);
          } else if (currentTool === 'scale') {
            gizmoManager.positionGizmoEnabled = false;
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = true;
            gizmoManager.attachToMesh(topMesh);
          } else {
            gizmoManager.positionGizmoEnabled = false;
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.attachToMesh(null);
          }
        }
      }
    });

    const onImportModel = async (e: any) => {
      const file = e.detail;
      if (scene.isDisposed) return;
      
      const fileName = file.name.toLowerCase();
      const isGlbOrGltf = fileName.endsWith('.glb') || fileName.endsWith('.gltf');
      const pluginExtension = isGlbOrGltf ? fileName.substring(fileName.lastIndexOf('.')) : ".stl";

      try {
        const res = await BABYLON.SceneLoader.ImportMeshAsync("", "", file, scene, null, pluginExtension);
        if (scene.isDisposed) return;

        const r = res.meshes[0];
        if (r) {
          r.name = file.name;
          r.computeWorldMatrix(true);
          const boundingInfo = r.getHierarchyBoundingVectors(true);
          const center = boundingInfo.min.add(boundingInfo.max).scale(0.5);
          const size = boundingInfo.max.subtract(boundingInfo.min);
          
          r.position.set(0, 0, 0);
          r.locallyTranslate(center.scale(-1));
          (r as BABYLON.Mesh).bakeCurrentTransformIntoVertices();
          
          r.position.set(0, size.y / 2, 0);

          if (!isGlbOrGltf) {
            r.material = createBoundaryMaterial(scene);
          }

          modelsRef.current.add(r);
          selectedMeshesRef.current.clear();
          selectedMeshesRef.current.add(r);
          setSelectedMeshName(file.name || "Modèle 3D");
          updateHighlight();
          updateSelectedPosition();
          updateSelectedRotation();

          const subMeshesList: { id: string; name: string; color: string }[] = [];
          const childMeshes = [r, ...r.getChildMeshes()];
          childMeshes.forEach((cm, idx) => {
            let hex = '#00f0ff';
            if (cm.material) {
              const mat = cm.material as any;
              if (mat.albedoColor) hex = mat.albedoColor.toHexString();
              else if (mat.diffuseColor) hex = mat.diffuseColor.toHexString();
            }
            subMeshesList.push({
              id: `${r.name}-${idx}`,
              name: cm.name || `Partie ${idx + 1}`,
              color: hex
            });
          });

          window.dispatchEvent(
            new CustomEvent('apex-mesh-selected', { 
              detail: { 
                name: file.name || "Modèle 3D",
                subMeshes: subMeshesList
              } 
            })
          );

          if (currentTool === 'move') {
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.positionGizmoEnabled = true;
            applyCustomGizmoColors();
            gizmoManager.attachToMesh(r);
          } else if (currentTool === 'rotate') {
            gizmoManager.positionGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.rotationGizmoEnabled = true;
            applyCustomGizmoColors();
            gizmoManager.attachToMesh(r);
          } else if (currentTool === 'scale') {
            gizmoManager.positionGizmoEnabled = false;
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = true;
            gizmoManager.attachToMesh(r);
          }
        }
      } catch (err) {
        console.error("Failed to import 3D model:", err);
      }
    };

    window.addEventListener('apex-import-model', onImportModel);

    const handleResize = () => {
      engine.resize();
    };
    window.addEventListener('resize', handleResize);

    engine.runRenderLoop(() => {
      if (!scene.isDisposed) {
        scene.render();
      }
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('apex-import-model', onImportModel);
      window.removeEventListener('apex-tool-changed', onToolChanged);
      window.removeEventListener('apex-request-textures', onRequestTextures);
      window.removeEventListener('keydown', handleKeyDown);
      scene.onPointerObservable.remove(pointerObserver);
      gizmoManager.dispose();
      scene.dispose();
      engine.dispose();
      
      engineRef.current = null;
      sceneRef.current = null;
      gizmoManagerRef.current = null;
      hlRef.current = null;
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas id="babylon-canvas" ref={canvasRef} style={{ width: '100%', height: '100%', outline: 'none', touchAction: 'none' }} />
    </div>
  );
};