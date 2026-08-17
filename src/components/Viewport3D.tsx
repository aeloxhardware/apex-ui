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
  const pipelineRef = useRef<BABYLON.DefaultRenderingPipeline | null>(null);
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

    // Post-processing pipeline for slight blur / depth of field effect when unselected
    const pipeline = new BABYLON.DefaultRenderingPipeline("defaultPipeline", true, scene, [camera]);
    pipeline.depthOfFieldEnabled = false; // We can use image processing or blur
    pipelineRef.current = pipeline;

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
      
      const hasSelection = selectedMeshesRef.current.size > 0;

      modelsRef.current.forEach((mesh) => {
        if (mesh && !mesh.isDisposed()) {
          if (selectedMeshesRef.current.has(mesh)) {
            hlRef.current?.addMesh(mesh as BABYLON.Mesh, new BABYLON.Color3(0, 0.94, 1));
            mesh.visibility = 1.0;
          } else if (hasSelection) {
            // Slight blur/transparency or dimming for unselected models
            mesh.visibility = 0.6;
          } else {
            mesh.visibility = 1.0;
          }
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

    const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
        const pick = pointerInfo.pickInfo;
        const excluded: BABYLON.AbstractMesh[] = [plate, outline, topOutline];
        if (pick?.hit && pick.pickedMesh && !excluded.includes(pick.pickedMesh) && !pick.pickedMesh.name.includes("Gizmo")) {
          const topMesh = pick.pickedMesh;
          
          // Toggle selection if clicking the same mesh again
          if (selectedMeshesRef.current.has(topMesh)) {
            selectedMeshesRef.current.clear();
            setSelectedMeshName(null);
            updateHighlight();
            gizmoManager.positionGizmoEnabled = false;
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.attachToMesh(null);
            window.dispatchEvent(new CustomEvent('apex-mesh-selected', { detail: { name: null } }));
            return;
          }

          selectedMeshesRef.current.clear();
          selectedMeshesRef.current.add(topMesh);
          setSelectedMeshName(topMesh.name || "Modèle 3D");
          updateHighlight();
          updateSelectedPosition();
          updateSelectedRotation();
          window.dispatchEvent(new CustomEvent('apex-mesh-selected', { detail: { name: topMesh.name || "Modèle 3D" } }));

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
      
      try {
        const res = await BABYLON.SceneLoader.ImportMeshAsync("", "", file, scene, null, ".stl");
        if (scene.isDisposed) return;

        const r = res.meshes[0];
        if (r) {
          r.computeWorldMatrix(true);
          const boundingInfo = r.getHierarchyBoundingVectors(true);
          const center = boundingInfo.min.add(boundingInfo.max).scale(0.5);
          const size = boundingInfo.max.subtract(boundingInfo.min);
          
          r.position.set(0, 0, 0);
          r.locallyTranslate(center.scale(-1));
          (r as BABYLON.Mesh).bakeCurrentTransformIntoVertices();
          
          r.position.set(0, size.y / 2, 0);

          r.material = createBoundaryMaterial(scene);
          modelsRef.current.add(r);
          selectedMeshesRef.current.clear();
          selectedMeshesRef.current.add(r);
          setSelectedMeshName(r.name || "Modèle 3D");
          updateHighlight();
          updateSelectedPosition();
          updateSelectedRotation();
          window.dispatchEvent(new CustomEvent('apex-mesh-selected', { detail: { name: r.name || "Modèle 3D" } }));

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
        console.error("Failed to import STL:", err);
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