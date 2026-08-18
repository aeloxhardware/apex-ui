"use client";

import React, { useRef, useState, useLayoutEffect } from 'react';
import * as BABYLON from 'babylonjs';
import 'babylonjs-loaders';

export const Viewport3D = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewcubeCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BABYLON.Engine | null>(null);
  const sceneRef = useRef<BABYLON.Scene | null>(null);
  const cameraRef = useRef<BABYLON.ArcRotateCamera | null>(null);
  const hlRef = useRef<BABYLON.HighlightLayer | null>(null);
  const gizmoManagerRef = useRef<BABYLON.GizmoManager | null>(null);
  const selectedMeshesRef = useRef<Set<BABYLON.AbstractMesh>>(new Set());
  const modelsRef = useRef<Set<BABYLON.AbstractMesh>>(new Set());
  const currentToolRef = useRef<string>("select");
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

    // Viewcube 3D scene setup (mini viewport)
    let viewcubeScene: BABYLON.Scene | null = null;
    let viewcubeEngine: BABYLON.Engine | null = null;
    let cubeMesh: BABYLON.Mesh | null = null;

    if (viewcubeCanvasRef.current) {
      viewcubeEngine = new BABYLON.Engine(viewcubeCanvasRef.current, true, { preserveDrawingBuffer: true });
      viewcubeScene = new BABYLON.Scene(viewcubeEngine);
      viewcubeScene.clearColor = new BABYLON.Color4(0, 0, 0, 0);

      const vcCamera = new BABYLON.ArcRotateCamera("vcCam", Math.PI / 4, Math.PI / 3, 5, BABYLON.Vector3.Zero(), viewcubeScene);
      vcCamera.inputs.clear();

      const vcLight = new BABYLON.HemisphericLight("vcLight", new BABYLON.Vector3(0, 1, 0), viewcubeScene);
      vcLight.intensity = 0.9;

      const dirLight = new BABYLON.DirectionalLight("vcDirLight", new BABYLON.Vector3(-1, -2, -1), viewcubeScene);
      dirLight.intensity = 0.5;

      cubeMesh = BABYLON.MeshBuilder.CreateBox("viewcubeBox", { size: 2.2 }, viewcubeScene);
      cubeMesh.isPickable = true;

      const facesData = [
        { name: "AVANT", color: "#3b82f6", textColor: "#ffffff" },
        { name: "ARRIÈRE", color: "#64748b", textColor: "#ffffff" },
        { name: "DROITE", color: "#0ea5e9", textColor: "#ffffff" },
        { name: "GAUCHE", color: "#64748b", textColor: "#ffffff" },
        { name: "DESSUS", color: "#6366f1", textColor: "#ffffff" },
        { name: "DESSOUS", color: "#475569", textColor: "#ffffff" },
      ];

      const multiMat = new BABYLON.MultiMaterial("vcMultiMat", viewcubeScene);
      
      facesData.forEach((face, idx) => {
        const dynTex = new BABYLON.DynamicTexture(`dynTex_${idx}`, { width: 256, height: 256 }, viewcubeScene, true);
        const ctx = dynTex.getContext();
        ctx.fillStyle = face.color;
        ctx.fillRect(0, 0, 256, 256);

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 12;
        ctx.strokeRect(6, 6, 244, 244);

        ctx.fillStyle = face.textColor;
        ctx.font = "bold 34px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(face.name, 128, 128);
        dynTex.update();

        const mat = new BABYLON.StandardMaterial(`vcMat_${idx}`, viewcubeScene);
        mat.diffuseTexture = dynTex;
        mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        multiMat.subMaterials.push(mat);
      });

      cubeMesh.material = multiMat;

      viewcubeScene.registerBeforeRender(() => {
        if (cameraRef.current && cubeMesh) {
          cubeMesh.rotation.y = -cameraRef.current.alpha - Math.PI / 2;
          cubeMesh.rotation.x = -cameraRef.current.beta + Math.PI / 2;
        }
      });

      viewcubeScene.onPointerObservable.add((pointerInfo) => {
        if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
          const pick = viewcubeScene?.pick(viewcubeScene.pointerX, viewcubeScene.pointerY);
          if (pick?.hit && cameraRef.current) {
            const subMeshId = pick.subMeshId;
            const targetAngles: { [key: number]: { alpha: number; beta: number } } = {
              0: { alpha: Math.PI / 2, beta: Math.PI / 3 },     // ARRIERE
              1: { alpha: -Math.PI / 2, beta: Math.PI / 3 },    // AVANT
              2: { alpha: 0, beta: Math.PI / 3 },               // DROITE
              3: { alpha: Math.PI, beta: Math.PI / 3 },         // GAUCHE
              4: { alpha: Math.PI / 4, beta: 0.01 },            // DESSUS
              5: { alpha: Math.PI / 4, beta: Math.PI - 0.01 },  // DESSOUS
            };

            const target = targetAngles[subMeshId];
            if (target) {
              const cam = cameraRef.current;
              const frameCount = 20;
              let currentFrame = 0;
              const startAlpha = cam.alpha;
              const startBeta = cam.beta;
              const diffAlpha = target.alpha - startAlpha;

              const animObserver = scene.onBeforeRenderObservable.add(() => {
                currentFrame++;
                const t = currentFrame / frameCount;
                const easeT = 1 - Math.pow(1 - t, 3);
                cam.alpha = startAlpha + diffAlpha * easeT;
                cam.beta = startBeta + (target.beta - startBeta) * easeT;

                if (currentFrame >= frameCount) {
                  scene.onBeforeRenderObservable.remove(animObserver);
                }
              });
            }
          }
        }
      });

      viewcubeEngine.runRenderLoop(() => {
        if (viewcubeScene && !viewcubeScene.isDisposed) {
          viewcubeScene.render();
        }
      });
    }

    const updateHighlight = () => {
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

    const handleDragEnd = () => {
      const selection = selectedMeshesRef.current;
      if (selection.size === 0) return;
      const activeMesh = Array.from(selection)[selection.size - 1];
      if (!activeMesh || activeMesh.isDisposed()) return;

      const boundingInfo = activeMesh.getHierarchyBoundingVectors(true);
      const minHeight = boundingInfo.min.y;
      const targetY = (activeMesh.position.y - minHeight) > 0 ? (activeMesh.position.y - minHeight) : 0;

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

    gizmoManager.gizmos.positionGizmo?.xGizmo.dragBehavior.onDragObservable.add(updateSelectedPosition);
    gizmoManager.gizmos.positionGizmo?.yGizmo.dragBehavior.onDragObservable.add(updateSelectedPosition);
    gizmoManager.gizmos.positionGizmo?.zGizmo.dragBehavior.onDragObservable.add(updateSelectedPosition);

    gizmoManager.gizmos.rotationGizmo?.xGizmo.dragBehavior.onDragObservable.add(updateSelectedRotation);
    gizmoManager.gizmos.rotationGizmo?.yGizmo.dragBehavior.onDragObservable.add(updateSelectedRotation);
    gizmoManager.gizmos.rotationGizmo?.zGizmo.dragBehavior.onDragObservable.add(updateSelectedRotation);

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
                const meshName = mesh.name;
                modelsRef.current.delete(mesh);
                mesh.dispose();
                window.dispatchEvent(new CustomEvent('apex-mesh-deleted', { detail: { name: meshName } }));
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

    const getRootModel = (mesh: BABYLON.AbstractMesh): BABYLON.AbstractMesh => {
      let curr: BABYLON.Node | null = mesh;
      let topValid: BABYLON.AbstractMesh = mesh;
      while (curr && curr.parent) {
        curr = curr.parent;
        if (curr instanceof BABYLON.AbstractMesh) {
          topValid = curr;
        }
      }
      return topValid;
    };

    const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
      const excluded: BABYLON.AbstractMesh[] = [plate, outline, topOutline];

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => !excluded.includes(mesh) && !mesh.name.includes("Gizmo"));
        const clientX = pointerInfo.event.clientX;
        const clientY = pointerInfo.event.clientY;

        if (pick?.hit && pick.pickedMesh) {
          let hoveredMesh = pick.pickedMesh;
          if (currentToolRef.current !== 'texture') {
            hoveredMesh = getRootModel(hoveredMesh);
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
          let targetMesh = pick.pickedMesh;
          
          if (currentToolRef.current !== 'texture') {
            targetMesh = getRootModel(targetMesh);
          }
          
          if (selectedMeshesRef.current.has(targetMesh)) {
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
          selectedMeshesRef.current.add(targetMesh);
          setSelectedMeshName(targetMesh.name || "Modèle 3D");
          updateHighlight();
          updateSelectedPosition();
          updateSelectedRotation();

          const subMeshesList: { id: string; name: string; color: string }[] = [];
          const childMeshes = [targetMesh, ...targetMesh.getChildMeshes()];
          childMeshes.forEach((cm, idx) => {
            let hex = '#00f0ff';
            if (cm.material) {
              const mat = cm.material as any;
              if (mat.albedoColor) hex = mat.albedoColor.toHexString();
              else if (mat.diffuseColor) hex = mat.diffuseColor.toHexString();
            }
            subMeshesList.push({
              id: `${targetMesh.name}-${idx}`,
              name: cm.name || `Partie ${idx + 1}`,
              color: hex
            });
          });

          window.dispatchEvent(
            new CustomEvent('apex-mesh-selected', { 
              detail: { 
                name: targetMesh.name || "Modèle 3D",
                subMeshes: subMeshesList
              } 
            })
          );

          if (currentToolRef.current === 'move') {
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.positionGizmoEnabled = true;
            applyCustomGizmoColors();
            gizmoManager.attachToMesh(targetMesh);
            setupGizmoDragEnd();
          } else if (currentToolRef.current === 'rotate') {
            gizmoManager.positionGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.rotationGizmoEnabled = true;
            applyCustomGizmoColors();
            gizmoManager.attachToMesh(targetMesh);
          } else if (currentToolRef.current === 'scale') {
            gizmoManager.positionGizmoEnabled = false;
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = true;
            gizmoManager.attachToMesh(targetMesh);
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

          if (currentToolRef.current === 'move') {
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.positionGizmoEnabled = true;
            applyCustomGizmoColors();
            gizmoManager.attachToMesh(r);
            setupGizmoDragEnd();
          } else if (currentToolRef.current === 'rotate') {
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.rotationGizmoEnabled = true;
            applyCustomGizmoColors();
            gizmoManager.attachToMesh(r);
          } else if (currentToolRef.current === 'scale') {
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
      if (viewcubeEngine) viewcubeEngine.resize();
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
      
      if (viewcubeScene) viewcubeScene.dispose();
      if (viewcubeEngine) viewcubeEngine.dispose();

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
      
      {/* Viewcube interactif aligné en bas à gauche */}
      <div 
        style={{
          position: 'absolute',
          bottom: '24px',
          left: '24px',
          width: '120px',
          height: '120px',
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(8px)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
        }}
        className="group hover:border-cyan-500/50 hover:scale-105 transition-all duration-200"
      >
        <canvas 
          ref={viewcubeCanvasRef} 
          style={{ 
            width: '100%', 
            height: '100%', 
            outline: 'none', 
            touchAction: 'none',
            cursor: 'pointer'
          }} 
        />
        <div style={{
          position: 'absolute',
          bottom: '4px',
          fontSize: '9px',
          fontWeight: 600,
          color: '#94a3b8',
          letterSpacing: '0.05em',
          pointerEvents: 'none',
          textTransform: 'uppercase',
          background: 'rgba(15, 23, 42, 0.8)',
          padding: '1px 6px',
          borderRadius: '4px'
        }}>
          Orientation
        </div>
      </div>
    </div>
  );
};