"use client";

import React, { useRef, useState, useLayoutEffect } from 'react';
import * as BABYLON from 'babylonjs';
import 'babylonjs-loaders';
import { showSuccess } from '@/utils/toast';

const DEFAULT_BLUR_LEVEL = 40;

export const Viewport3D = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [blurLevel, setBlurLevel] = useState(DEFAULT_BLUR_LEVEL);
  const engineRef = useRef<BABYLON.Engine | null>(null);
  const sceneRef = useRef<BABYLON.Scene | null>(null);
  const cameraRef = useRef<BABYLON.ArcRotateCamera | null>(null);
  const hlRef = useRef<BABYLON.HighlightLayer | null>(null);
  const gizmoManagerRef = useRef<BABYLON.GizmoManager | null>(null);
  const selectedMeshesRef = useRef<Set<BABYLON.AbstractMesh>>(new Set());
  const modelsRef = useRef<Set<BABYLON.AbstractMesh>>(new Set());
  const currentToolRef = useRef<string>("select");
  const [, setSelectedMeshName] = useState<string | null>(null);

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
    camera.maxZ = 10000;
    cameraRef.current = camera;

    // Fond 3D : un plan texturé avec l'image de fond, parenté à la caméra pour toujours
    // remplir le cadre. Contrairement au fond CSS derrière le canvas, cette géométrie
    // réelle peut être capturée et floutée par le disque "verre dépoli" du plateau.
    const backdropDistance = 4000;
    const backdropHeight = 2 * backdropDistance * Math.tan(camera.fov / 2);
    const backdropWidth = backdropHeight * (engine.getRenderWidth() / engine.getRenderHeight());
    const backdrop = BABYLON.MeshBuilder.CreatePlane("backdrop", { width: backdropWidth, height: backdropHeight }, scene);
    backdrop.parent = camera;
    backdrop.position = new BABYLON.Vector3(0, 0, backdropDistance);
    backdrop.rotation.y = Math.PI;
    backdrop.isPickable = false;
    const backdropMat = new BABYLON.StandardMaterial("backdropMat", scene);
    backdropMat.emissiveTexture = new BABYLON.Texture("/background.jpg", scene);
    backdropMat.diffuseColor = BABYLON.Color3.Black();
    backdropMat.specularColor = BABYLON.Color3.Black();
    backdropMat.disableLighting = true;
    backdropMat.backFaceCulling = false;
    backdrop.material = backdropMat;

    // Broadcast camera position on move
    scene.onBeforeRenderObservable.add(() => {
      if (camera) {
        window.dispatchEvent(
          new CustomEvent('apex-camera-updated', {
            detail: { alpha: camera.alpha, beta: camera.beta }
          })
        );
      }
    });

    const handleSetView = (e: Event) => {
      const customEvent = e as CustomEvent<{ view: string }>;
      const view = customEvent.detail?.view;
      if (!camera) return;

      const targetRadius = 300;
      const targetLookAt = new BABYLON.Vector3(0, HEIGHT / 2, 0);
      camera.target = targetLookAt;
      camera.radius = targetRadius;

      let targetAlpha = camera.alpha;
      let targetBeta = camera.beta;

      switch (view) {
        case 'front':
          targetAlpha = Math.PI / 2;
          targetBeta = Math.PI / 2;
          break;
        case 'back':
          targetAlpha = -Math.PI / 2;
          targetBeta = Math.PI / 2;
          break;
        case 'right':
          targetAlpha = 0;
          targetBeta = Math.PI / 2;
          break;
        case 'left':
          targetAlpha = Math.PI;
          targetBeta = Math.PI / 2;
          break;
        case 'top':
          targetBeta = 0.01;
          break;
        case 'bottom':
          targetBeta = Math.PI - 0.01;
          break;
      }

      const animAlpha = new BABYLON.Animation("animAlpha", "alpha", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
      animAlpha.setKeys([{ frame: 0, value: camera.alpha }, { frame: 20, value: targetAlpha }]);

      const animBeta = new BABYLON.Animation("animBeta", "beta", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
      animBeta.setKeys([{ frame: 0, value: camera.beta }, { frame: 20, value: targetBeta }]);

      scene.beginDirectAnimation(camera, [animAlpha, animBeta], 0, 20, false);
    };

    const handleCustomView = (e: Event) => {
      const customEvent = e as CustomEvent<{ alpha: number; beta: number }>;
      const { alpha, beta } = customEvent.detail;
      if (!camera) return;

      const animAlpha = new BABYLON.Animation("animAlpha", "alpha", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
      animAlpha.setKeys([{ frame: 0, value: camera.alpha }, { frame: 20, value: alpha }]);

      const animBeta = new BABYLON.Animation("animBeta", "beta", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
      animBeta.setKeys([{ frame: 0, value: camera.beta }, { frame: 20, value: beta }]);

      scene.beginDirectAnimation(camera, [animAlpha, animBeta], 0, 20, false);
    };

    window.addEventListener('apex-set-camera-view', handleSetView);
    window.addEventListener('apex-set-camera-custom', handleCustomView);

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

    // Les gizmos Babylon exposent leur matériau via des champs internes non documentés dans les
    // types publics (_coloredMaterial/_hoverMaterial/gizmoMesh) — on décrit juste la forme utilisée
    // plutôt que de recourir à `any`.
    interface GizmoAxisInternal {
      _coloredMaterial?: BABYLON.StandardMaterial;
      _hoverMaterial?: BABYLON.StandardMaterial;
      gizmoMesh?: BABYLON.Mesh;
    }

    const applyCustomGizmoColors = () => {
      const setGizmoColor = (axisGizmo: GizmoAxisInternal | undefined, color: BABYLON.Color3) => {
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

    // Champs de matériau (PBR/Standard) inspectés pour la fiche texture, absents du type de
    // base BABYLON.Material — décrits explicitement plutôt que castés en `any`.
    interface InspectableMaterial extends BABYLON.Material {
      albedoColor?: BABYLON.Color3;
      diffuseColor?: BABYLON.Color3;
      albedoTexture?: BABYLON.BaseTexture;
    }

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

    window.addEventListener('apex-request-textures', onRequestTextures);

    const volumeRoot = new BABYLON.TransformNode("volumeRoot", scene);

    const originAxisLength = HOLE_RADIUS * 1.4;
    const originAxes: [BABYLON.Vector3, BABYLON.Color3][] = [
      [new BABYLON.Vector3(originAxisLength, 0, 0), new BABYLON.Color3(1, 0.23, 0.23)],
      [new BABYLON.Vector3(0, originAxisLength, 0), new BABYLON.Color3(0.23, 1, 0.36)],
      [new BABYLON.Vector3(0, 0, originAxisLength), new BABYLON.Color3(0.23, 0.48, 1)],
    ];
    originAxes.forEach(([dir, color], i) => {
      const axisLine = BABYLON.MeshBuilder.CreateLines(`originAxis${i}`, { points: [BABYLON.Vector3.Zero(), dir] }, scene) as BABYLON.LinesMesh;
      axisLine.color = color;
      axisLine.parent = volumeRoot;
    });

    // Disque flouté au centre du plateau : capture la scène dans une render target à pleine
    // résolution (le sous-échantillonnage introduisait un décalage d'alignement), floutée par
    // deux passes gaussiennes, puis un mesh circulaire échantillonne cette texture en
    // coordonnées écran ("verre dépoli").
    const rtWidth = engine.getRenderWidth();
    const rtHeight = engine.getRenderHeight();
    const blurRT = new BABYLON.RenderTargetTexture("blurRT", { width: rtWidth, height: rtHeight }, scene, { generateMipMaps: false });
    blurRT.activeCamera = camera;
    blurRT.ignoreCameraViewport = true;
    blurRT.clearColor = new BABYLON.Color4(0, 0, 0, 1);
    blurRT.updateSamplingMode(BABYLON.Texture.BILINEAR_SAMPLINGMODE);
    scene.customRenderTargets.push(blurRT);

    const blurH = new BABYLON.BlurPostProcess("blurH", new BABYLON.Vector2(1, 0), DEFAULT_BLUR_LEVEL, 1, null, BABYLON.Texture.BILINEAR_SAMPLINGMODE, engine, false);
    const blurV = new BABYLON.BlurPostProcess("blurV", new BABYLON.Vector2(0, 1), DEFAULT_BLUR_LEVEL, 1, null, BABYLON.Texture.BILINEAR_SAMPLINGMODE, engine, false);
    blurRT.addPostProcess(blurH);
    blurRT.addPostProcess(blurV);

    const onSetBlurLevel = (e: Event) => {
      const level = (e as CustomEvent<{ level: number }>).detail?.level;
      if (typeof level === 'number') {
        blurH.kernel = level;
        blurV.kernel = level;
      }
    };
    window.addEventListener('apex-set-blur-level', onSetBlurLevel);

    BABYLON.Effect.ShadersStore["glassDiscVertexShader"] = `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      varying vec4 vClip;
      void main(void) {
        vec4 outPosition = worldViewProjection * vec4(position, 1.0);
        gl_Position = outPosition;
        vClip = outPosition;
      }
    `;
    BABYLON.Effect.ShadersStore["glassDiscFragmentShader"] = `
      precision highp float;
      varying vec4 vClip;
      uniform sampler2D blurTex;
      void main(void) {
        vec2 ndc = vClip.xy / vClip.w;
        vec2 uv = ndc * 0.5 + 0.5;
        vec3 color = texture2D(blurTex, uv).rgb;
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    const glassDiscMat = new BABYLON.ShaderMaterial("glassDiscMat", scene, { vertex: "glassDisc", fragment: "glassDisc" }, {
      attributes: ["position"],
      uniforms: ["worldViewProjection"],
      samplers: ["blurTex"],
    });
    glassDiscMat.setTexture("blurTex", blurRT);
    glassDiscMat.backFaceCulling = false;

    const glassDisc = BABYLON.MeshBuilder.CreateDisc("glassDisc", { radius: RADIUS, tessellation: 96 }, scene);
    glassDisc.rotation.x = Math.PI / 2;
    glassDisc.position.y = -0.02;
    glassDisc.material = glassDiscMat;
    glassDisc.parent = volumeRoot;
    blurRT.renderList = scene.meshes.filter((m) => m !== glassDisc);
    scene.onNewMeshAddedObservable.add((m) => {
      if (m !== glassDisc && blurRT.renderList) blurRT.renderList.push(m);
    });

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
            window.dispatchEvent(new CustomEvent('apex-mesh-selected', { detail: { name: null, names: [], subMeshes: [] } }));
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

    // Sélectionne un modèle sur le plateau : remplace la sélection existante par défaut
    // (un seul modèle à la fois), ou l'ajoute/retire de la sélection si additive=true (Ctrl).
    const selectMesh = (targetMesh: BABYLON.AbstractMesh, additive: boolean) => {
      if (!additive && selectedMeshesRef.current.size === 1 && selectedMeshesRef.current.has(targetMesh)) {
        selectedMeshesRef.current.clear();
        setSelectedMeshName(null);
        updateHighlight();
        gizmoManager.positionGizmoEnabled = false;
        gizmoManager.rotationGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = false;
        gizmoManager.attachToMesh(null);
        window.dispatchEvent(new CustomEvent('apex-mesh-selected', { detail: { name: null, names: [], subMeshes: [] } }));
        return;
      }

      if (additive) {
        if (selectedMeshesRef.current.has(targetMesh)) {
          selectedMeshesRef.current.delete(targetMesh);
        } else {
          selectedMeshesRef.current.add(targetMesh);
        }
      } else {
        selectedMeshesRef.current.clear();
        selectedMeshesRef.current.add(targetMesh);
      }

      setSelectedMeshName(targetMesh.name || "Modèle 3D");
      updateHighlight();
      updateSelectedPosition();
      updateSelectedRotation();

      const subMeshesList: { id: string; name: string; color: string }[] = [];
      const childMeshes = [targetMesh, ...targetMesh.getChildMeshes()];
      childMeshes.forEach((cm, idx) => {
        let hex = '#00f0ff';
        if (cm.material) {
          const mat = cm.material as InspectableMaterial;
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
            names: Array.from(selectedMeshesRef.current).map((m) => m.name),
            subMeshes: subMeshesList
          }
        })
      );

      const gizmoTarget = selectedMeshesRef.current.size === 1 ? targetMesh : null;
      if (currentToolRef.current === 'move') {
        gizmoManager.rotationGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = false;
        gizmoManager.positionGizmoEnabled = !!gizmoTarget;
        if (gizmoTarget) {
          applyCustomGizmoColors();
          setupGizmoDragEnd();
        }
        gizmoManager.attachToMesh(gizmoTarget);
      } else if (currentToolRef.current === 'rotate') {
        gizmoManager.positionGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = false;
        gizmoManager.rotationGizmoEnabled = !!gizmoTarget;
        if (gizmoTarget) applyCustomGizmoColors();
        gizmoManager.attachToMesh(gizmoTarget);
      } else if (currentToolRef.current === 'scale') {
        gizmoManager.positionGizmoEnabled = false;
        gizmoManager.rotationGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = !!gizmoTarget;
        gizmoManager.attachToMesh(gizmoTarget);
      } else {
        gizmoManager.positionGizmoEnabled = false;
        gizmoManager.rotationGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = false;
        gizmoManager.attachToMesh(null);
      }
    };

    const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
      const excluded: BABYLON.AbstractMesh[] = [glassDisc, outline, topOutline, backdrop];

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

          const additive = !!(pointerInfo.event as PointerEvent).ctrlKey || !!(pointerInfo.event as PointerEvent).metaKey;
          selectMesh(targetMesh, additive);
        }
      }
    });

    const onSelectModel = (e: Event) => {
      const customEvent = e as CustomEvent<{ name: string; additive?: boolean }>;
      const name = customEvent.detail?.name;
      if (!name) return;
      const mesh = Array.from(modelsRef.current).find((m) => m.name === name);
      if (mesh) selectMesh(mesh, !!customEvent.detail?.additive);
    };
    window.addEventListener('apex-select-model', onSelectModel);

    // Trouve, sur le plateau circulaire, la position libre la plus proche du centre pour un
    // nouveau modèle (approximé par son cercle englobant en X/Z), par circle-packing : en
    // configuration optimale, une position libre la plus proche est toujours tangente soit au
    // bord du plateau, soit à un modèle existant, soit à deux modèles existants à la fois — on
    // génère donc ces candidats géométriques précis plutôt que d'échantillonner au hasard, avec
    // une recherche par grille fine en filet de sécurité si aucun candidat n'est valide.
    const findFreeSpot = (footprintRadius: number): { x: number; z: number } => {
      const existing = Array.from(modelsRef.current).map((m) => {
        m.computeWorldMatrix(true);
        const b = m.getHierarchyBoundingVectors(true);
        const c = b.min.add(b.max).scale(0.5);
        const fr = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
        return { x: c.x, z: c.z, r: fr };
      });

      const margin = 5;
      const maxReach = RADIUS - footprintRadius - 2;
      if (maxReach <= 0) return { x: 0, z: 0 };

      const collides = (x: number, z: number) =>
        existing.some((e) => Math.hypot(x - e.x, z - e.z) < footprintRadius + e.r + margin);

      if (existing.length === 0 || !collides(0, 0)) return { x: 0, z: 0 };

      const candidates: { x: number; z: number }[] = [];
      const ANGLE_STEPS = 180;

      // Tangent à chaque modèle existant, dans toutes les directions
      existing.forEach((e) => {
        const rr = footprintRadius + e.r + margin;
        for (let i = 0; i < ANGLE_STEPS; i++) {
          const a = (i / ANGLE_STEPS) * Math.PI * 2;
          candidates.push({ x: e.x + rr * Math.cos(a), z: e.z + rr * Math.sin(a) });
        }
      });

      // Tangent à deux modèles existants simultanément (intersection des deux cercles de
      // sécurité) — c'est là que se trouvent les emplacements les plus compacts en packing.
      for (let i = 0; i < existing.length; i++) {
        for (let j = i + 1; j < existing.length; j++) {
          const a = existing[i];
          const b = existing[j];
          const ra = footprintRadius + a.r + margin;
          const rb = footprintRadius + b.r + margin;
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const d = Math.hypot(dx, dz);
          if (d === 0 || d > ra + rb) continue;
          const aDist = (ra * ra - rb * rb + d * d) / (2 * d);
          const h2 = ra * ra - aDist * aDist;
          if (h2 < 0) continue;
          const h = Math.sqrt(h2);
          const mx = a.x + (aDist * dx) / d;
          const mz = a.z + (aDist * dz) / d;
          candidates.push({ x: mx + (h * dz) / d, z: mz - (h * dx) / d });
          candidates.push({ x: mx - (h * dz) / d, z: mz + (h * dx) / d });
        }
      }

      const valid = candidates
        .filter((c) => Math.hypot(c.x, c.z) <= maxReach && !collides(c.x, c.z))
        .sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));

      if (valid.length > 0) return valid[0];

      // Filet de sécurité : balayage fin de tout le plateau, on garde le point valide le
      // plus proche du centre rencontré.
      const step = 2;
      let best: { x: number; z: number } | null = null;
      let bestDist = Infinity;
      for (let x = -maxReach; x <= maxReach; x += step) {
        for (let z = -maxReach; z <= maxReach; z += step) {
          const d = Math.hypot(x, z);
          if (d > maxReach || d >= bestDist || collides(x, z)) continue;
          best = { x, z };
          bestDist = d;
        }
      }
      return best ?? { x: 0, z: 0 };
    };

    const onImportModel = async (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (scene.isDisposed) return;
      
      const fileName = file.name.toLowerCase();
      const isGlbOrGltf = fileName.endsWith('.glb') || fileName.endsWith('.gltf');
      const pluginExtension = isGlbOrGltf ? fileName.substring(fileName.lastIndexOf('.')) : ".stl";

      try {
        const res = await BABYLON.SceneLoader.ImportMeshAsync("", "", file, scene, null, pluginExtension);
        if (scene.isDisposed) return;

        const r = res.meshes[0];
        if (r) {
          // Autorise l'import de plusieurs exemplaires du même fichier : suffixe le nom
          // (2), (3)... s'il est déjà utilisé par un modèle présent sur le plateau.
          const existingNames = new Set(Array.from(modelsRef.current).map((m) => m.name));
          let uniqueName = file.name;
          let copyIndex = 2;
          while (existingNames.has(uniqueName)) {
            const dotIndex = file.name.lastIndexOf('.');
            uniqueName = dotIndex > 0
              ? `${file.name.slice(0, dotIndex)} (${copyIndex})${file.name.slice(dotIndex)}`
              : `${file.name} (${copyIndex})`;
            copyIndex++;
          }
          r.name = uniqueName;

          if (isGlbOrGltf) {
            // Les fichiers glTF/GLB utilisent le mètre par convention, alors que la scène et
            // le volume d'impression sont en millimètres (RADIUS/HEIGHT) — sans cette mise à
            // l'échelle, un modèle réel de quelques cm devient un point microscopique invisible.
            r.scaling.scaleInPlace(1000);
          }

          r.computeWorldMatrix(true);
          const boundingInfo = r.getHierarchyBoundingVectors(true);
          const center = boundingInfo.min.add(boundingInfo.max).scale(0.5);
          const footprintRadius = Math.max(boundingInfo.max.x - boundingInfo.min.x, boundingInfo.max.z - boundingInfo.min.z) / 2;
          const spot = findFreeSpot(footprintRadius);

          // Place le modèle sur un emplacement libre du plateau (au lieu de toujours l'origine,
          // ce qui le superposerait aux modèles déjà présents) et pose sa base sur y=0, sans
          // passer par bakeCurrentTransformIntoVertices : pour les GLB/GLTF, meshes[0] est souvent
          // le nœud racine __root__ sans géométrie propre, sur lequel le bake échoue silencieusement
          // et interrompt l'import avant que le modèle ne soit positionné/rendu visible.
          r.position.addInPlace(new BABYLON.Vector3(spot.x - center.x, -boundingInfo.min.y, spot.z - center.z));

          if (!isGlbOrGltf) {
            // Les STL ne portent aucune info de matériau : on applique une teinte neutre par
            // défaut (le shader de zone d'exclusion de l'imprimante est réservé aux parois du
            // volume et culle les faces arrière, ce qui rend invisible tout STL aux normales
            // inversées — cas fréquent selon le logiciel d'export).
            const defaultMat = new BABYLON.StandardMaterial("stlDefaultMat", scene);
            defaultMat.diffuseColor = new BABYLON.Color3(0.6, 0.65, 0.7);
            defaultMat.backFaceCulling = false;
            r.material = defaultMat;
          }

          modelsRef.current.add(r);
          selectedMeshesRef.current.clear();
          selectedMeshesRef.current.add(r);
          setSelectedMeshName(r.name || "Modèle 3D");
          updateHighlight();
          updateSelectedPosition();
          updateSelectedRotation();

          const subMeshesList: { id: string; name: string; color: string }[] = [];
          const childMeshes = [r, ...r.getChildMeshes()];
          childMeshes.forEach((cm, idx) => {
            let hex = '#00f0ff';
            if (cm.material) {
              const mat = cm.material as InspectableMaterial;
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
                name: r.name || "Modèle 3D",
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

    const onSelectAll = () => {
      const all = Array.from(modelsRef.current);
      if (all.length === 0) return;
      selectedMeshesRef.current = new Set(all);
      updateHighlight();
      const last = all[all.length - 1];
      setSelectedMeshName(last.name || "Modèle 3D");
      window.dispatchEvent(new CustomEvent('apex-mesh-selected', {
        detail: { name: last.name, names: all.map((m) => m.name), subMeshes: [] }
      }));
    };
    window.addEventListener('apex-select-all-models', onSelectAll);

    const onRequestSliceModels = () => {
      const names = Array.from(modelsRef.current).map((mesh) => mesh.name);
      window.dispatchEvent(new CustomEvent('apex-slice-models', { detail: { names } }));
    };

    const onSliceAllModels = () => {
      const allModels = Array.from(modelsRef.current);
      if (allModels.length === 0) return;

      selectedMeshesRef.current = new Set(allModels);
      updateHighlight();
      window.dispatchEvent(new CustomEvent('apex-slicing-started', {
        detail: { names: allModels.map((mesh) => mesh.name) }
      }));
    };

    window.addEventListener('apex-request-slice-models', onRequestSliceModels);
    window.addEventListener('apex-slice-all-models', onSliceAllModels);

    const onDeleteAll = () => {
      const all = Array.from(modelsRef.current);
      if (all.length === 0) return;
      if (!window.confirm(`Voulez-vous vraiment supprimer les ${all.length} modèle(s) du plateau ?`)) return;
      all.forEach((mesh) => {
        if (mesh && !mesh.isDisposed()) {
          const meshName = mesh.name;
          modelsRef.current.delete(mesh);
          mesh.dispose();
          window.dispatchEvent(new CustomEvent('apex-mesh-deleted', { detail: { name: meshName } }));
        }
      });
      selectedMeshesRef.current.clear();
      setSelectedMeshName(null);
      updateHighlight();
      gizmoManager.positionGizmoEnabled = false;
      gizmoManager.rotationGizmoEnabled = false;
      gizmoManager.scaleGizmoEnabled = false;
      gizmoManager.attachToMesh(null);
      window.dispatchEvent(new CustomEvent('apex-mesh-selected', { detail: { name: null, names: [], subMeshes: [] } }));
    };
    window.addEventListener('apex-delete-all-models', onDeleteAll);

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
      window.removeEventListener('apex-select-all-models', onSelectAll);
      window.removeEventListener('apex-request-slice-models', onRequestSliceModels);
      window.removeEventListener('apex-slice-all-models', onSliceAllModels);
      window.removeEventListener('apex-delete-all-models', onDeleteAll);
      window.removeEventListener('apex-set-blur-level', onSetBlurLevel);
      window.removeEventListener('apex-select-model', onSelectModel);
      window.removeEventListener('apex-tool-changed', onToolChanged);
      window.removeEventListener('apex-request-textures', onRequestTextures);
      window.removeEventListener('apex-set-camera-view', handleSetView);
      window.removeEventListener('apex-set-camera-custom', handleCustomView);
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

  const menuItemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 14px', fontSize: 13, color: 'rgba(255,255,255,0.9)',
    cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: 8,
  };

  const runAction = (fn: () => void) => {
    fn();
    setContextMenu(null);
  };

  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!contextMenu) {
      setMenuPos(null);
      return;
    }
    setMenuPos(contextMenu);
  }, [contextMenu]);

  React.useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    const margin = 8;

    const clamp = (x: number, y: number) => ({
      x: Math.min(Math.max(x, margin), window.innerWidth - width - margin),
      y: Math.min(Math.max(y, margin), window.innerHeight - height - margin),
    });

    // 4 candidats façon menu contextuel classique : sous/au-dessus, à droite/à gauche du clic.
    const candidates = [
      clamp(contextMenu.x, contextMenu.y),
      clamp(contextMenu.x, contextMenu.y - height),
      clamp(contextMenu.x - width, contextMenu.y),
      clamp(contextMenu.x - width, contextMenu.y - height),
    ];

    const chromeRects = Array.from(document.querySelectorAll('[data-apex-chrome-panel]')).map((el) =>
      el.getBoundingClientRect()
    );

    const overlapArea = (pos: { x: number; y: number }) => {
      const rect = { left: pos.x, top: pos.y, right: pos.x + width, bottom: pos.y + height };
      return chromeRects.reduce((total, r) => {
        const w = Math.max(0, Math.min(rect.right, r.right) - Math.max(rect.left, r.left));
        const h = Math.max(0, Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top));
        return total + w * h;
      }, 0);
    };

    let best = candidates[0];
    let bestOverlap = overlapArea(best);
    for (let i = 1; i < candidates.length && bestOverlap > 0; i++) {
      const overlap = overlapArea(candidates[i]);
      if (overlap < bestOverlap) {
        best = candidates[i];
        bestOverlap = overlap;
      }
    }

    if (best.x !== menuPos?.x || best.y !== menuPos?.y) setMenuPos(best);
  });

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        id="babylon-canvas"
        ref={canvasRef}
        style={{ width: '100%', height: '100%', outline: 'none', touchAction: 'none' }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      />

      {contextMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            ref={menuRef}
            style={{
              position: 'fixed', top: (menuPos ?? contextMenu).y, left: (menuPos ?? contextMenu).x, zIndex: 1000,
              visibility: menuPos ? 'visible' : 'hidden',
              minWidth: 220, padding: 6, borderRadius: 14,
              background: 'rgba(20,22,30,0.55)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
              boxShadow: '0 12px 40px 0 rgba(0,0,0,0.35), 0 4px 16px 0 rgba(0,0,0,0.25)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div style={menuItemStyle} onClick={() => runAction(() => window.dispatchEvent(new CustomEvent('apex-select-all-models')))}>Tout sélectionner</div>
            <div style={menuItemStyle} onClick={() => runAction(() => window.dispatchEvent(new CustomEvent('apex-delete-all-models')))}>Tout Supprimer</div>
            <div style={menuItemStyle} onClick={() => runAction(() => showSuccess('Bientôt disponible'))}>Organiser</div>
            <div style={menuItemStyle} onClick={() => runAction(() => showSuccess('Bientôt disponible'))}>Rotation automatique</div>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 4px' }} />
            <div style={menuItemStyle} onClick={() => runAction(() => showSuccess('Bientôt disponible'))}>
              <span>Ajouter une primitive</span><span style={{ opacity: 0.6 }}>›</span>
            </div>
            <div style={menuItemStyle} onClick={() => runAction(() => showSuccess('Bientôt disponible'))}>
              <span>Ajouter des modèles pratiques</span><span style={{ opacity: 0.6 }}>›</span>
            </div>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 4px' }} />
            <div style={{ padding: '8px 14px 4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>Niveau de flou sous le plateau</span>
                <span
                  onClick={() => {
                    setBlurLevel(DEFAULT_BLUR_LEVEL);
                    window.dispatchEvent(new CustomEvent('apex-set-blur-level', { detail: { level: DEFAULT_BLUR_LEVEL } }));
                  }}
                  style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', cursor: 'pointer', userSelect: 'none' }}
                >
                  reset
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={120}
                value={blurLevel}
                onChange={(e) => {
                  const level = Number(e.target.value);
                  setBlurLevel(level);
                  window.dispatchEvent(new CustomEvent('apex-set-blur-level', { detail: { level } }));
                }}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};