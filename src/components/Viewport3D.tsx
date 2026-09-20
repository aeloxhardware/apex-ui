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
  // Info-bulle qui suit le curseur pendant la sélection du plan d'esquisse (façon Fusion 360).
  const [sketchPlaneHint, setSketchPlaneHint] = useState<{ x: number; y: number } | null>(null);
  // Échelle dynamique du mode modélisation : largeur du repère en px + distance réelle qu'il
  // représente. `null` hors mode modélisation, où la barre n'est pas affichée.
  const [scaleBar, setScaleBar] = useState<{ px: number; label: string } | null>(null);
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

    // Le MSAA du contexte WebGL (2ᵉ argument `true` de BABYLON.Engine) ne couvre que le
    // rendu direct — les contours (LinesMesh, edgesRendering des voxels) et le compositing
    // via blurRT restent crénelés sans une passe FXAA sur la sortie finale du pipeline.
    const renderPipeline = new BABYLON.DefaultRenderingPipeline("apexRenderPipeline", false, scene, [camera]);
    renderPipeline.fxaaEnabled = true;
    renderPipeline.samples = 4;

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

    // Grille d'esquisse du mode modélisation : masquée tant qu'on est en mode slicer, elle
    // remplace le volume d'impression pour donner un repère de travail neutre au modéliseur.
    // Deux niveaux (mineur/majeur), en gris neutre plutôt qu'en cyan à faible opacité, pour
    // qu'elle reste lisible comme repère de fond même sans rien dessiner par-dessus.
    /**
     * Hiérarchie à trois niveaux (subdivisions / décades / axes), distingués par l'ÉPAISSEUR
     * autant que par la couleur. Un `LinesMesh` fait toujours 1 px : on passe donc par
     * `GreasedLine`, qui produit un vrai ruban d'épaisseur réglable — un seul mesh par niveau,
     * `points` acceptant un tableau de polylignes, donc un draw call chacun.
     *
     * `sizeAttenuation: true` = largeur CONSTANTE à l'écran (le shader divise l'offset par la
     * résolution au lieu de le laisser subir la division perspective) ; l'unité vaut alors
     * `width / 2` pixels. Indispensable ici : la grille change d'échelle avec le zoom, une
     * largeur en unités monde la réduirait à des cheveux.
     */
    const GRID_WIDTH_MINOR = 2;   // ~1 px
    const GRID_WIDTH_MAJOR = 3.5; // ~1.75 px
    const GRID_WIDTH_AXIS = 6;    // ~3 px
    const GRID_ALPHA_MINOR = 0.22;
    const GRID_ALPHA_MAJOR = 0.45;

    const makeGridLines = (
      name: string,
      lines: BABYLON.Vector3[][],
      color: BABYLON.Color3,
      width: number,
      alpha: number,
    ): BABYLON.Mesh => {
      const mesh = BABYLON.CreateGreasedLine(
        name,
        { points: lines },
        { color, width, sizeAttenuation: true },
        scene,
      ) as BABYLON.Mesh;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      if (mesh.material) mesh.material.alpha = alpha;
      return mesh;
    };

    /**
     * Grille infinie, façon Fusion 360 : les traits ne se DÉPLACENT jamais quand on zoome, on
     * ne fait qu'ajouter ou retirer un niveau de subdivision. C'est possible parce que la
     * tuile est décimale — un trait tous les 1, les décades tous les 10 — donc la mettre à
     * l'échelle ×10 replace exactement ses traits sur un sous-ensemble des précédents.
     *
     * Trois maillages construits sur cette même tuile, avec `S` = pas courant :
     *  - `gridSubFine` : pas S/10, en fondu (c'est LUI qui apparaît/disparaît au zoom) ;
     *  - `gridSubMain` : pas S, toujours opaque ;
     *  - `gridDecade`  : pas 10·S, plus épais.
     * Quand `S` descend d'une décade, l'ancien `gridSubFine` (opaque à ce moment-là) devient
     * le nouveau `gridSubMain` au même pas : la transition ne fait donc bouger aucun trait.
     */
    const GRID_TILE_EXTENT = 100; // en unités de tuile (→ ±100·S en monde)
    const gridTileSub: BABYLON.Vector3[][] = [];
    const gridTileDecade: BABYLON.Vector3[][] = [];
    for (let k = -GRID_TILE_EXTENT; k <= GRID_TILE_EXTENT; k++) {
      if (k === 0) continue; // les deux lignes centrales sont les axes colorés, tracés à part
      const target = k % 10 === 0 ? gridTileDecade : gridTileSub;
      const e = GRID_TILE_EXTENT;
      target.push([new BABYLON.Vector3(-e, 0, k), new BABYLON.Vector3(e, 0, k)]);
      target.push([new BABYLON.Vector3(k, 0, -e), new BABYLON.Vector3(k, 0, e)]);
    }

    const gridColorMinor = new BABYLON.Color3(0.6, 0.65, 0.72);
    const gridSubFine = makeGridLines("gridSubFine", gridTileSub, gridColorMinor, GRID_WIDTH_MINOR, 0);
    const gridSubMain = makeGridLines("gridSubMain", gridTileSub, gridColorMinor, GRID_WIDTH_MINOR, GRID_ALPHA_MINOR);
    const gridDecade = makeGridLines(
      "gridDecade", gridTileDecade, new BABYLON.Color3(0.78, 0.83, 0.89), GRID_WIDTH_MAJOR, GRID_ALPHA_MAJOR,
    );
    // Les deux axes du sol traversent toute la grille : les plus épais des trois niveaux, et
    // colorés comme le repère d'origine (X rouge / Z bleu — mêmes teintes que `AXIS_COLORS`
    // plus bas, l'axe vertical Y vert étant porté par les plans d'esquisse).
    const modelingGridAxisX = makeGridLines(
      "modelingGridAxisX",
      [[new BABYLON.Vector3(-GRID_TILE_EXTENT, 0, 0), new BABYLON.Vector3(GRID_TILE_EXTENT, 0, 0)]],
      new BABYLON.Color3(0.85, 0.22, 0.22), GRID_WIDTH_AXIS, 0.9,
    );
    const modelingGridAxisZ = makeGridLines(
      "modelingGridAxisZ",
      [[new BABYLON.Vector3(0, 0, -GRID_TILE_EXTENT), new BABYLON.Vector3(0, 0, GRID_TILE_EXTENT)]],
      new BABYLON.Color3(0.25, 0.5, 0.95), GRID_WIDTH_AXIS, 0.9,
    );

    /**
     * Chiffres de mesure le long des axes X/Z, à chaque graduation majeure — de petits panneaux
     * texturés (`DynamicTexture`) plutôt qu'un module GUI, qui n'est pas une dépendance du
     * projet. Ils sont couchés DANS le plan du sol et orientés le long de leur axe (comme la
     * règle d'un plan CAO), pas en billboard : le chiffre reste ainsi visuellement attaché à sa
     * graduation quel que soit l'angle de caméra. Une même valeur apparaît 4 fois (±X, ±Z) :
     * texture et matériau sont mutualisés par texte pour ne pas en créer 4 copies.
     */
    const gridLabelMatCache = new Map<string, BABYLON.StandardMaterial>();
    const getGridLabelMaterial = (text: string): BABYLON.StandardMaterial => {
      const cached = gridLabelMatCache.get(text);
      if (cached) return cached;
      const texture = new BABYLON.DynamicTexture(`gridTickTex_${text}`, { width: 128, height: 64 }, scene, false);
      texture.hasAlpha = true;
      texture.drawText(text, null, null, "bold 44px sans-serif", "rgba(255,255,255,0.75)", "transparent", true);
      const mat = new BABYLON.StandardMaterial(`gridTickMat_${text}`, scene);
      mat.diffuseTexture = texture;
      mat.opacityTexture = texture;
      mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      gridLabelMatCache.set(text, mat);
      return mat;
    };

    // Les étiquettes sont placées sur les lignes de décade (multiples de 10 unités de tuile) :
    // on mémorise leur valeur et leur position en unités de tuile, à multiplier par le pas
    // courant `S`. Comme les lignes, elles ne bougent donc pas d'une décade à l'autre.
    interface GridLabel { mesh: BABYLON.Mesh; tileValue: number; tilePosition: BABYLON.Vector3 }
    const modelingGridLabels: GridLabel[] = [];
    const makeGridTickLabel = (tileValue: number, tilePosition: BABYLON.Vector3, yaw: number) => {
      const label = BABYLON.MeshBuilder.CreatePlane(
        `gridTick_${tilePosition.x}_${tilePosition.z}`, { width: 9, height: 4.5 }, scene,
      );
      // Couché à plat (pitch π/2) puis pivoté pour se lire le long de son axe.
      label.rotation = new BABYLON.Vector3(Math.PI / 2, yaw, 0);
      label.isPickable = false;
      label.renderingGroupId = 1; // par-dessus les lignes de grille
      label.setEnabled(false);
      modelingGridLabels.push({ mesh: label, tileValue, tilePosition: tilePosition.clone() });
    };
    // Décalage perpendiculaire pour que le chiffre borde son axe sans le recouvrir.
    const gridLabelOffset = 3;
    for (let k = 10; k <= GRID_TILE_EXTENT; k += 10) {
      makeGridTickLabel(k, new BABYLON.Vector3(k, 0.01, gridLabelOffset), 0);
      makeGridTickLabel(-k, new BABYLON.Vector3(-k, 0.01, gridLabelOffset), 0);
      makeGridTickLabel(k, new BABYLON.Vector3(gridLabelOffset, 0.01, k), Math.PI / 2);
      makeGridTickLabel(-k, new BABYLON.Vector3(gridLabelOffset, 0.01, -k), Math.PI / 2);
    }

    const modelingGridMeshes = [gridSubFine, gridSubMain, gridDecade, modelingGridAxisX, modelingGridAxisZ];
    const modelingGrid = [...modelingGridMeshes, ...modelingGridLabels.map((l) => l.mesh)];

    // Formate une graduation sans zéros parasites (250, 25, 2.5, 0.25 …).
    const formatGridValue = (v: number) => String(Number(v.toPrecision(6)));

    /**
     * Choix du pas `S` : on le veut compris entre `GRID_MIN_PX` et 10×`GRID_MIN_PX` pixels à
     * l'écran, ce qui revient à subdiviser dès que la grille « prend toute la place ». Le
     * niveau fin (pas S/10) apparaît en fondu au fur et à mesure qu'il atteint lui aussi cette
     * taille lisible ; quand il y arrive tout à fait, `S` descend d'une décade et ce niveau
     * fin devient le niveau principal — au même pas, donc sans qu'aucun trait ne se déplace.
     */
    const GRID_MIN_PX = 10;
    let gridStepScale = 0; // 0 = jamais appliqué, force le premier passage
    const updateGrid = (worldPerPixel: number) => {
      const l = Math.log10(GRID_MIN_PX * worldPerPixel);
      const exponent = Math.ceil(l);
      const step = Math.pow(10, exponent);
      // `fade` ∈ [0,1) : 0 quand le niveau fin serait trop dense, 1 juste avant qu'il ne
      // devienne le niveau principal. Lissé pour que l'apparition ne soit pas linéaire.
      const t = exponent - l;
      const fade = t * t * (3 - 2 * t);

      if (gridSubFine.material) gridSubFine.material.alpha = fade * GRID_ALPHA_MINOR;
      gridSubFine.setEnabled(fade > 0.02);

      if (step === gridStepScale) return;
      gridStepScale = step;

      gridSubFine.scaling.setAll(step / 10);
      gridSubMain.scaling.setAll(step);
      gridDecade.scaling.setAll(step);
      modelingGridAxisX.scaling.setAll(step);
      modelingGridAxisZ.scaling.setAll(step);
      modelingGridLabels.forEach(({ mesh, tileValue, tilePosition }) => {
        mesh.scaling.setAll(step);
        mesh.position.copyFrom(tilePosition).scaleInPlace(step);
        mesh.material = getGridLabelMaterial(formatGridValue(tileValue * step));
      });
    };

    // Empêche de « passer au travers » du plan de travail en zoomant : au lieu de traverser,
    // la grille se subdivise et la caméra reste à distance de sa cible.
    camera.lowerRadiusLimit = 0.5;
    camera.upperRadiusLimit = 100000;

    /**
     * Barre d'échelle du mode modélisation. Pour une caméra en perspective, un pixel au niveau
     * de la cible vaut `2·radius·tan(fov/2) / hauteurRendu` unités monde. On choisit une
     * longueur « ronde » (1, 2 ou 5 × 10ⁿ) proche de `SCALE_BAR_TARGET_PX`, puis on en déduit
     * la largeur réelle de la barre — c'est la barre qui s'ajuste au chiffre, pas l'inverse.
     */
    const SCALE_BAR_TARGET_PX = 140;
    const formatDistance = (mm: number) => {
      if (mm >= 1000) return `${formatGridValue(mm / 1000)} m`;
      if (mm >= 10) return `${formatGridValue(mm / 10)} cm`;
      return `${formatGridValue(mm)} mm`;
    };
    const niceLength = (raw: number) => {
      const exp = Math.floor(Math.log10(raw));
      const pow = Math.pow(10, exp);
      const mantissa = raw / pow;
      const snapped = mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1;
      return snapped * pow;
    };

    let modelingActive = false;
    let lastScaleBarLabel = '';
    const gridZoomObserver = scene.onBeforeRenderObservable.add(() => {
      if (!modelingActive) return;

      const worldPerPixel = (2 * camera.radius * Math.tan(camera.fov / 2)) / engine.getRenderHeight();
      if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0) return;

      updateGrid(worldPerPixel);

      const length = niceLength(SCALE_BAR_TARGET_PX * worldPerPixel);
      const label = formatDistance(length);
      const px = Math.round(length / worldPerPixel);
      if (label !== lastScaleBarLabel) {
        lastScaleBarLabel = label;
        setScaleBar({ px, label });
      }
    });

    // Bascule slicer ↔ modélisation : on échange le volume d'impression contre la grille
    // d'esquisse et on relâche toute sélection/gizmo hérité de l'autre mode.
    const onModeChanged = (e: Event) => {
      const { mode } = (e as CustomEvent<{ mode: 'slicer' | 'modeling' }>).detail;
      if (scene.isDisposed) return;

      const modeling = mode === 'modeling';
      modelingActive = modeling;
      volumeRoot.setEnabled(!modeling);
      // Cadrer la grille AVANT de l'afficher, sinon elle apparaît une frame au pas par défaut.
      if (modeling) updateGrid((2 * camera.radius * Math.tan(camera.fov / 2)) / engine.getRenderHeight());
      modelingGrid.forEach((g) => g.setEnabled(modeling));
      if (!modeling) {
        lastScaleBarLabel = '';
        setScaleBar(null);
      } else if (gridSubFine.material && gridSubFine.material.alpha <= 0.02) {
        gridSubFine.setEnabled(false); // le niveau fin reste masqué tant qu'il est trop dense
      }

      if (modeling) {
        gizmoManager.positionGizmoEnabled = false;
        gizmoManager.rotationGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = false;
        gizmoManager.attachToMesh(null);
      }
    };
    window.addEventListener('apex-mode-changed', onModeChanged);

    // ---------------------------------------------------------------------------------
    // Outil « Boîte » (primitive) : dessiner un rectangle au sol, l'extruder en hauteur,
    // puis remplir le pavé de voxels un par un avant un scan qui le résout en solide plein.
    // Trois états successifs, chacun piloté par le pointer observer déjà en place.
    // ---------------------------------------------------------------------------------
    type BoxDrawPhase = 'idle' | 'drawing-base' | 'extruding' | 'filling';
    let boxPhase: BoxDrawPhase = 'idle';
    let boxBaseStart: BABYLON.Vector3 | null = null;
    let boxBaseCorner: BABYLON.Vector3 | null = null;
    let boxPreviewOutline: BABYLON.LinesMesh | null = null;
    let boxExtrudeHeight = 0;

    // Plan invisible au niveau du plateau : seul mesh pickable en mode dessin, il donne un
    // point d'intersection stable même quand le curseur ne survole aucun autre mesh.
    const groundPickPlane = BABYLON.MeshBuilder.CreatePlane(
      "boxDrawGroundPlane",
      { size: 4000 }, // largement au-delà du plateau : sert seulement de plan d'intersection
      scene,
    );
    groundPickPlane.rotation.x = Math.PI / 2;
    // `isVisible = false` exclurait ce mesh du picking en plus du rendu — on veut l'inverse
    // (invisible à l'écran mais pickable) : c'est `visibility = 0` qu'il faut utiliser, avec
    // `isPickable` comme seul verrou pour n'entrer en jeu que pendant le dessin.
    groundPickPlane.visibility = 0;
    groundPickPlane.isPickable = false;
    // Un plan sans matériau garde le backFaceCulling par défaut : selon le sens dans lequel
    // la rotation retourne sa normale, la caméra (qui regarde vers le bas) peut ne voir que
    // sa face arrière et manquer tout pick. On lui donne un matériau à double face pour
    // que l'intersection fonctionne quel que soit le sens de la normale.
    const groundPickPlaneMat = new BABYLON.StandardMaterial("boxDrawGroundPlaneMat", scene);
    groundPickPlaneMat.backFaceCulling = false;
    groundPickPlane.material = groundPickPlaneMat;

    const disposeBoxPreview = () => {
      boxPreviewOutline?.dispose();
      boxPreviewOutline = null;
    };

    const resetBoxTool = () => {
      boxPhase = 'idle';
      boxBaseStart = null;
      boxBaseCorner = null;
      boxExtrudeHeight = 0;
      groundPickPlane.isPickable = false;
      disposeBoxPreview();
    };

    /** Corps bleu sombre (non lumineux) pour chaque voxel — le contour, lui, reste vif. */
    const voxelBodyMaterial = () => {
      const mat = new BABYLON.StandardMaterial("boxDrawVoxelBodyMat", scene);
      mat.diffuseColor = new BABYLON.Color3(0.03, 0.09, 0.16);
      mat.emissiveColor = new BABYLON.Color3(0.02, 0.06, 0.11);
      mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
      return mat;
    };

    /** Contour bleu lumineux d'un voxel, construit en tubes 3D réels plutôt qu'avec
     * `enableEdgesRendering` : ce dernier a un plafond d'épaisseur interne au shader
     * (quelques dixièmes de pixel) qu'aucune valeur de `edgesWidth` ne dépasse — pour un
     * contour visiblement épais, il faut de la vraie géométrie. */
    const glowEdgesMaterial = () => {
      const mat = new BABYLON.StandardMaterial("boxDrawVoxelEdgeMat", scene);
      mat.emissiveColor = new BABYLON.Color3(0, 0.94, 1);
      mat.disableLighting = true;
      return mat;
    };

    const addGlowEdges = (mesh: BABYLON.Mesh, width: number, height: number, depth: number, mat: BABYLON.Material) => {
      const half = new BABYLON.Vector3(width / 2, height / 2, depth / 2);
      const corners = [
        new BABYLON.Vector3(-half.x, -half.y, -half.z), new BABYLON.Vector3(half.x, -half.y, -half.z),
        new BABYLON.Vector3(half.x, -half.y, half.z), new BABYLON.Vector3(-half.x, -half.y, half.z),
        new BABYLON.Vector3(-half.x, half.y, -half.z), new BABYLON.Vector3(half.x, half.y, -half.z),
        new BABYLON.Vector3(half.x, half.y, half.z), new BABYLON.Vector3(-half.x, half.y, half.z),
      ];
      const edgePairs: [number, number][] = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ];
      const tubeRadius = Math.min(width, height, depth) * 0.04;
      edgePairs.forEach(([a, b], i) => {
        const tube = BABYLON.MeshBuilder.CreateTube(
          `${mesh.name}_edge_${i}`,
          { path: [corners[a], corners[b]], radius: tubeRadius, tessellation: 6, cap: BABYLON.Mesh.CAP_ALL },
          scene,
        );
        tube.material = mat;
        tube.parent = mesh;
        tube.isPickable = false;
      });
    };

    /** Contour d'un pavé droit (8 sommets) en lignes bleu lumineux — pas de faces pleines. */
    const buildBoxOutline = (min: BABYLON.Vector3, max: BABYLON.Vector3, previous?: BABYLON.LinesMesh | null) => {
      const corners = [
        new BABYLON.Vector3(min.x, min.y, min.z), new BABYLON.Vector3(max.x, min.y, min.z),
        new BABYLON.Vector3(max.x, min.y, max.z), new BABYLON.Vector3(min.x, min.y, max.z),
        new BABYLON.Vector3(min.x, max.y, min.z), new BABYLON.Vector3(max.x, max.y, min.z),
        new BABYLON.Vector3(max.x, max.y, max.z), new BABYLON.Vector3(min.x, max.y, max.z),
      ];
      const lines = [
        [corners[0], corners[1], corners[2], corners[3], corners[0]],
        [corners[4], corners[5], corners[6], corners[7], corners[4]],
        [corners[0], corners[4]], [corners[1], corners[5]], [corners[2], corners[6]], [corners[3], corners[7]],
      ];
      // `instance` ne peut mettre à jour un LinesMesh que si celui-ci a été créé
      // `updatable: true` — sans ce flag, réutiliser l'instance échoue silencieusement
      // (aucune exception, mais aucune mise à jour visible non plus).
      const mesh = BABYLON.MeshBuilder.CreateLineSystem(
        "boxDrawOutline", { lines, updatable: true, instance: previous ?? undefined }, scene,
      ) as BABYLON.LinesMesh;
      mesh.color = new BABYLON.Color3(0, 0.94, 1);
      mesh.isPickable = false;
      return mesh;
    };

    /** Remplit le pavé de petits voxels apparaissant un par un, puis les fond en un scan. */
    const runVoxelFillAnimation = (min: BABYLON.Vector3, max: BABYLON.Vector3) => {
      const size = max.subtract(min);
      // Diviseur plus petit = voxels plus gros = grille moins dense (et animation de
      // remplissage plus lisible/rapide sur un gros pavé).
      const voxelSize = Math.max(3, Math.min(size.x, size.y, size.z) / 3);
      const counts = {
        x: Math.max(1, Math.round(size.x / voxelSize)),
        y: Math.max(1, Math.round(size.y / voxelSize)),
        z: Math.max(1, Math.round(size.z / voxelSize)),
      };

      const voxelRoot = new BABYLON.TransformNode("boxDrawVoxelRoot", scene);
      const voxelMat = voxelBodyMaterial();
      const voxelEdgeMat = glowEdgesMaterial();
      const cellX = size.x / counts.x;
      const cellY = size.y / counts.y;
      const cellZ = size.z / counts.z;

      const positions: BABYLON.Vector3[] = [];
      for (let ix = 0; ix < counts.x; ix++) {
        for (let iy = 0; iy < counts.y; iy++) {
          for (let iz = 0; iz < counts.z; iz++) {
            positions.push(new BABYLON.Vector3(
              min.x + cellX * (ix + 0.5),
              min.y + cellY * (iy + 0.5),
              min.z + cellZ * (iz + 0.5),
            ));
          }
        }
      }
      // Ordre de pose : couche par couche en hauteur, pour lire clairement le remplissage.
      positions.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);

      const voxelMeshes: BABYLON.Mesh[] = [];
      const spawnStagger = Math.min(28, Math.max(6, 900 / positions.length));

      positions.forEach((pos, i) => {
        setTimeout(() => {
          if (scene.isDisposed) return;
          const voxel = BABYLON.MeshBuilder.CreateBox(
            `boxDrawVoxel_${i}`,
            { width: cellX * 0.82, height: cellY * 0.82, depth: cellZ * 0.82 },
            scene,
          );
          voxel.position = pos;
          voxel.material = voxelMat;
          voxel.parent = voxelRoot;
          voxel.isPickable = false;
          addGlowEdges(voxel, cellX * 0.82, cellY * 0.82, cellZ * 0.82, voxelEdgeMat);
          voxel.scaling.setAll(0.001);
          BABYLON.Animation.CreateAndStartAnimation(
            "voxelPop", voxel, "scaling", 30, 6,
            new BABYLON.Vector3(0.001, 0.001, 0.001), new BABYLON.Vector3(1, 1, 1),
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
          );
          voxelMeshes.push(voxel);

          if (i === positions.length - 1) {
            // Dernier voxel posé : on laisse le remplissage se lire un instant, puis on
            // lance le scan qui résout le nuage de voxels en un unique pavé plein.
            setTimeout(() => runScanResolve(min, max, voxelRoot, voxelMeshes), 260);
          }
        }, i * spawnStagger);
      });
    };

    /** Animation de « scan » : un plan lumineux balaie le pavé, les voxels s'estompent
     * derrière lui à mesure qu'il passe, et le solide final apparaît à sa place. */
    const runScanResolve = (
      min: BABYLON.Vector3, max: BABYLON.Vector3, voxelRoot: BABYLON.TransformNode, voxelMeshes: BABYLON.Mesh[],
    ) => {
      const height = max.y - min.y;
      const finalBox = BABYLON.MeshBuilder.CreateBox("primitiveBox", {
        width: max.x - min.x, height, depth: max.z - min.z,
      }, scene);
      finalBox.position.set((min.x + max.x) / 2, min.y + height / 2, (min.z + max.z) / 2);
      const finalMat = new BABYLON.StandardMaterial("primitiveBoxMat", scene);
      finalMat.diffuseColor = new BABYLON.Color3(0.75, 0.78, 0.82);
      finalMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
      finalBox.material = finalMat;
      finalBox.visibility = 0;
      modelsRef.current.add(finalBox);

      const scanPlane = BABYLON.MeshBuilder.CreatePlane("boxDrawScanPlane", {
        width: (max.x - min.x) * 1.15, height: (max.z - min.z) * 1.15,
      }, scene);
      scanPlane.rotation.x = Math.PI / 2;
      const scanMat = new BABYLON.StandardMaterial("boxDrawScanMat", scene);
      scanMat.emissiveColor = new BABYLON.Color3(0, 0.94, 1);
      scanMat.alpha = 0.55;
      scanMat.disableLighting = true;
      scanMat.backFaceCulling = false;
      scanPlane.material = scanMat;
      scanPlane.isPickable = false;

      const duration = 550;
      const start = performance.now();
      const step = () => {
        if (scene.isDisposed) return;
        const t = Math.min(1, (performance.now() - start) / duration);
        const y = min.y + height * t;
        scanPlane.position.set((min.x + max.x) / 2, y, (min.z + max.z) / 2);

        voxelMeshes.forEach((v) => {
          if (v.position.y <= y) v.setEnabled(false);
        });
        finalBox.visibility = t;

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          scanPlane.dispose();
          voxelRoot.dispose();
          voxelMeshes.forEach((v) => v.dispose());
          finalBox.visibility = 1;
          window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
        }
      };
      requestAnimationFrame(step);
    };

    const onBoxDrawStart = () => {
      if (scene.isDisposed) return;
      resetPyramidTool(); // un seul outil de dessin actif à la fois sur `groundPickPlane`
      resetBoxTool();
      boxPhase = 'drawing-base';
      groundPickPlane.isPickable = true;
    };
    window.addEventListener('apex-primitive-box-start', onBoxDrawStart);

    const boxDrawObserver = scene.onPointerObservable.add((pointerInfo) => {
      if (boxPhase === 'idle') return;

      if (boxPhase === 'drawing-base') {
        // Cette phase a besoin du point d'intersection avec le plateau : elle reste donc
        // dépendante du pick sur `groundPickPlane`, qui a une étendue finie mais couvre
        // largement le volume d'impression — suffisant pour tracer la base au sol.
        const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh === groundPickPlane);
        if (!pick?.hit || !pick.pickedPoint) return;

        // Interaction en deux clics façon Fusion 360 (clic-relâche à un coin, clic-relâche
        // à l'autre), pas un cliquer-glisser continu : un clic bref donne un déplacement
        // souris quasi nul entre down et up, ce qui annulait systématiquement le rectangle
        // si on se basait sur la distance parcourue *pendant* le clic. On distingue plutôt
        // le premier clic (pose le coin de départ) du second (valide le coin opposé), et le
        // survol entre les deux prévisualise le rectangle.
        if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
          const corner = boxBaseStart ?? pick.pickedPoint;
          const min = new BABYLON.Vector3(Math.min(corner.x, pick.pickedPoint.x), 0, Math.min(corner.z, pick.pickedPoint.z));
          const max = new BABYLON.Vector3(Math.max(corner.x, pick.pickedPoint.x), 0.01, Math.max(corner.z, pick.pickedPoint.z));
          boxPreviewOutline = buildBoxOutline(min, max, boxPreviewOutline);
        } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
          if (!boxBaseStart) {
            // Premier clic : pose le coin de départ, le rectangle reste à dessiner.
            boxBaseStart = pick.pickedPoint.clone();
            return;
          }
          const corner = pick.pickedPoint.clone();
          if (corner.subtract(boxBaseStart).length() < 2) {
            // Second clic quasi au même endroit que le premier : rectangle dégénéré, on
            // annule plutôt que d'extruder un plat.
            resetBoxTool();
            return;
          }
          boxBaseCorner = corner;
          boxPhase = 'extruding';
        }
        return;
      }

      if (boxPhase === 'extruding' && boxBaseStart && boxBaseCorner) {
        // Cette phase ne dépend plus du pick au sol : `groundPickPlane` a une étendue finie
        // (300mm de côté), et viser au-delà de ses bords pour extruder plus haut ou selon un
        // angle de caméra rasant est un geste normal — un pick manqué gelait alors la
        // hauteur. La hauteur ne dépend donc que de la position écran du curseur, projetée
        // depuis un point de référence fixe au sol, sans jamais retester d'intersection.
        const min = new BABYLON.Vector3(Math.min(boxBaseStart.x, boxBaseCorner.x), 0, Math.min(boxBaseStart.z, boxBaseCorner.z));
        const max = new BABYLON.Vector3(Math.max(boxBaseStart.x, boxBaseCorner.x), 0, Math.max(boxBaseStart.z, boxBaseCorner.z));

        if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
          const originScreen = BABYLON.Vector3.Project(
            new BABYLON.Vector3((min.x + max.x) / 2, 0, (min.z + max.z) / 2),
            BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
            camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
          );
          const pixelsPerMm = 3;
          const rawHeight = Math.max(0, (originScreen.y - scene.pointerY) / pixelsPerMm);
          boxExtrudeHeight = Math.min(HEIGHT, rawHeight);
          const extrudedMax = new BABYLON.Vector3(max.x, boxExtrudeHeight, max.z);
          boxPreviewOutline = buildBoxOutline(min, extrudedMax, boxPreviewOutline);
        } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
          if (boxExtrudeHeight < 1) return; // évite un pavé nul sur double-clic accidentel
          boxPhase = 'filling';
          groundPickPlane.isPickable = false;
          disposeBoxPreview();
          runVoxelFillAnimation(min, new BABYLON.Vector3(max.x, boxExtrudeHeight, max.z));
        }
      }
    });

    // ---------------------------------------------------------------------------------
    // Outil « Pyramide 4 côtés » : même base à deux clics que Boîte, mais l'aperçu montre
    // des rectangles imbriqués qui rétrécissent vers le centre (les futurs étages), le
    // « ressort » d'extrusion les soulève à des hauteurs croissantes vers le sommet, le
    // remplissage transforme chaque étage en couche de cellules, et le scan les résout en
    // un vrai maillage pyramidal à faces planes (pas un empilement en escalier).
    // ---------------------------------------------------------------------------------
    type PyramidPhase = 'idle' | 'drawing-base' | 'extruding' | 'filling';
    let pyramidPhase: PyramidPhase = 'idle';
    let pyramidBaseStart: BABYLON.Vector3 | null = null;
    let pyramidBaseCorner: BABYLON.Vector3 | null = null;
    let pyramidPreviewRings: BABYLON.LinesMesh | null = null;
    let pyramidHeight = 0;

    const disposePyramidPreview = () => {
      pyramidPreviewRings?.dispose();
      pyramidPreviewRings = null;
    };

    const resetPyramidTool = () => {
      pyramidPhase = 'idle';
      pyramidBaseStart = null;
      pyramidBaseCorner = null;
      pyramidHeight = 0;
      groundPickPlane.isPickable = false;
      disposePyramidPreview();
    };

    /** Nombre d'étages/anneaux imbriqués : dérivé à la fois de la taille du rectangle (pour
     * la phase de dessin, où la hauteur est encore nulle) et de la hauteur choisie (pour la
     * phase d'extrusion), en visant la même épaisseur de couche cible dans les deux cas —
     * sans quoi une pyramide plus haute aurait des couches de plus en plus épaisses au lieu
     * de rester à densité constante. */
    const pyramidRingCount = (min: BABYLON.Vector3, max: BABYLON.Vector3, height: number) => {
      const targetLayerSize = 12;
      const base = Math.min(max.x - min.x, max.z - min.z);
      const fromBase = Math.round(base / targetLayerSize);
      const fromHeight = Math.round(height / targetLayerSize);
      return Math.min(14, Math.max(2, Math.max(fromBase, fromHeight)));
    };

    /** Rectangles imbriqués (l'aperçu « ressort ») : l'anneau 0 est la base pleine taille à
     * y=0, le dernier est réduit au centre à y=`height` (le sommet). Un seul LinesMesh pour
     * tous les anneaux, régénéré à chaque frame comme `buildBoxOutline`. */
    const buildPyramidPreview = (
      min: BABYLON.Vector3, max: BABYLON.Vector3, height: number, previous?: BABYLON.LinesMesh | null,
    ) => {
      const ringCount = pyramidRingCount(min, max, height);
      const cx = (min.x + max.x) / 2;
      const cz = (min.z + max.z) / 2;
      const lines: BABYLON.Vector3[][] = [];

      for (let i = 0; i < ringCount; i++) {
        const t = ringCount === 1 ? 0 : i / (ringCount - 1);
        const scale = 1 - t; // 1 = pleine base, 0 = point central (le sommet)
        const y = height * t;
        const x0 = cx + (min.x - cx) * scale;
        const x1 = cx + (max.x - cx) * scale;
        const z0 = cz + (min.z - cz) * scale;
        const z1 = cz + (max.z - cz) * scale;
        lines.push([
          new BABYLON.Vector3(x0, y, z0), new BABYLON.Vector3(x1, y, z0),
          new BABYLON.Vector3(x1, y, z1), new BABYLON.Vector3(x0, y, z1),
          new BABYLON.Vector3(x0, y, z0),
        ]);
      }
      // Pas d'arêtes reliant les coins d'un anneau au suivant : sur une pyramide à plusieurs
      // étages, ces 4 lignes diagonales se multiplient visuellement en un maillage triangulé
      // dense qui masque les couches — on ne garde que les rectangles empilés eux-mêmes.

      // Contrairement à `buildBoxOutline` (toujours 6 segments fixes), le nombre d'anneaux
      // ici dépend de la taille du rectangle et change donc à chaque frame pendant le
      // dessin — réutiliser `instance` suppose une topologie identique à l'original, et un
      // nombre de lignes différent corrompt le buffer au lieu d'échouer proprement (c'est
      // ce qui produisait le motif décalé/« en escalier » au lieu d'anneaux concentriques).
      // On recrée donc le mesh à chaque appel plutôt que de tenter une mise à jour en place.
      previous?.dispose();
      const mesh = BABYLON.MeshBuilder.CreateLineSystem("pyramidDrawPreview", { lines }, scene) as BABYLON.LinesMesh;
      mesh.color = new BABYLON.Color3(0, 0.94, 1);
      mesh.isPickable = false;
      return mesh;
    };

    /** Remplit chaque étage de la pyramide avec UNE SEULE cellule (mêmes matériaux que les
     * voxels de Boîte) — pas une grille subdivisée : un étage, une cellule, comme demandé.
     * Des étages larges/bas vers les étages étroits/hauts, puis lance le scan qui les
     * résout en un vrai maillage pyramidal. */
    const runPyramidFillAnimation = (min: BABYLON.Vector3, max: BABYLON.Vector3, height: number) => {
      const ringCount = pyramidRingCount(min, max, height);
      const cx = (min.x + max.x) / 2;
      const cz = (min.z + max.z) / 2;

      const layerRoot = new BABYLON.TransformNode("pyramidDrawLayerRoot", scene);
      const cellMat = voxelBodyMaterial();
      const cellEdgeMat = glowEdgesMaterial();
      const cellHeight = height / ringCount;

      const cellMeshes: BABYLON.Mesh[] = [];
      const spawnStagger = Math.min(90, Math.max(40, 700 / ringCount));

      Array.from({ length: ringCount }, (_, i) => {
        const t = ringCount === 1 ? 0 : i / (ringCount - 1);
        const scale = 1 - t;
        const w = (max.x - min.x) * scale;
        const d = (max.z - min.z) * scale;
        const y = height * t;
        return { w, d, y };
      }).forEach((ring, i) => {
        setTimeout(() => {
          if (scene.isDisposed) return;
          const cell = BABYLON.MeshBuilder.CreateBox(
            `pyramidDrawCell_${i}`,
            { width: Math.max(0.1, ring.w * 0.92), height: cellHeight * 0.92, depth: Math.max(0.1, ring.d * 0.92) },
            scene,
          );
          cell.position.set(cx, ring.y + cellHeight / 2, cz);
          cell.material = cellMat;
          cell.parent = layerRoot;
          cell.isPickable = false;
          addGlowEdges(cell, ring.w * 0.92, cellHeight * 0.92, ring.d * 0.92, cellEdgeMat);
          cell.scaling.setAll(0.001);
          BABYLON.Animation.CreateAndStartAnimation(
            "pyramidCellPop", cell, "scaling", 30, 6,
            new BABYLON.Vector3(0.001, 0.001, 0.001), new BABYLON.Vector3(1, 1, 1),
            BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
          );
          cellMeshes.push(cell);

          // Le compte doit être incrémenté DANS le callback asynchrone, pas avant : un
          // compteur incrémenté au moment de planifier les `setTimeout` atteindrait déjà
          // son total avant qu'aucun ne se déclenche, faisant répéter cette condition à
          // chaque cellule au lieu de la dernière seule — c'est ce qui multipliait le scan
          // (et donc le pavé final) par le nombre de cellules au lieu de le lancer une fois.
          if (cellMeshes.length === ringCount) {
            setTimeout(() => runPyramidScanResolve(min, max, height, layerRoot, cellMeshes), 260);
          }
        }, i * spawnStagger);
      });
    };

    /** Résout le nuage de cellules en un vrai maillage pyramidal (5 sommets, 4 faces
     * triangulaires + une base carrée) — contrairement à Boîte, pas un simple pavé : les
     * faces latérales sont planes et inclinées, sans escalier visible de près. */
    const runPyramidScanResolve = (
      min: BABYLON.Vector3, max: BABYLON.Vector3, height: number,
      layerRoot: BABYLON.TransformNode, cellMeshes: BABYLON.Mesh[],
    ) => {
      const cx = (min.x + max.x) / 2;
      const cz = (min.z + max.z) / 2;

      const apex = new BABYLON.Vector3(cx, min.y + height, cz);
      const base = [
        new BABYLON.Vector3(min.x, min.y, min.z), new BABYLON.Vector3(max.x, min.y, min.z),
        new BABYLON.Vector3(max.x, min.y, max.z), new BABYLON.Vector3(min.x, min.y, max.z),
      ];
      const positions = [...base.flatMap((v) => [v.x, v.y, v.z]), apex.x, apex.y, apex.z];
      // Base (2 triangles, face vers le bas) + 4 faces latérales vers le sommet (index 4).
      const indices = [
        0, 2, 1, 0, 3, 2,
        0, 1, 4,
        1, 2, 4,
        2, 3, 4,
        3, 0, 4,
      ];
      const vertexData = new BABYLON.VertexData();
      vertexData.positions = positions;
      vertexData.indices = indices;
      vertexData.normals = [];
      BABYLON.VertexData.ComputeNormals(positions, indices, vertexData.normals);

      const finalPyramid = new BABYLON.Mesh("primitivePyramid", scene);
      vertexData.applyToMesh(finalPyramid);
      const finalMat = new BABYLON.StandardMaterial("primitivePyramidMat", scene);
      finalMat.diffuseColor = new BABYLON.Color3(0.75, 0.78, 0.82);
      // Aucun reflet spéculaire : un rendu mat plutôt que le léger brillant par défaut.
      finalMat.specularColor = new BABYLON.Color3(0, 0, 0);
      finalMat.backFaceCulling = false;
      finalPyramid.material = finalMat;
      finalPyramid.visibility = 0;
      modelsRef.current.add(finalPyramid);

      const scanPlane = BABYLON.MeshBuilder.CreatePlane("pyramidDrawScanPlane", {
        width: (max.x - min.x) * 1.15, height: (max.z - min.z) * 1.15,
      }, scene);
      scanPlane.rotation.x = Math.PI / 2;
      const scanMat = new BABYLON.StandardMaterial("pyramidDrawScanMat", scene);
      scanMat.emissiveColor = new BABYLON.Color3(0, 0.94, 1);
      scanMat.alpha = 0.55;
      scanMat.disableLighting = true;
      scanMat.backFaceCulling = false;
      scanPlane.material = scanMat;
      scanPlane.isPickable = false;

      const duration = 550;
      const start = performance.now();
      const step = () => {
        if (scene.isDisposed) return;
        const t = Math.min(1, (performance.now() - start) / duration);
        const y = min.y + height * t;
        // L'anneau du scan rétrécit avec la hauteur, comme la silhouette de la pyramide,
        // pour que le plan lumineux épouse visuellement la forme qu'il révèle.
        const scale = 1 - t;
        scanPlane.scaling.set(Math.max(0.001, scale), 1, Math.max(0.001, scale));
        scanPlane.position.set(cx, y, cz);

        cellMeshes.forEach((c) => {
          if (c.position.y <= y) c.setEnabled(false);
        });
        finalPyramid.visibility = t;

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          scanPlane.dispose();
          layerRoot.dispose();
          cellMeshes.forEach((c) => c.dispose());
          finalPyramid.visibility = 1;
          window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
        }
      };
      requestAnimationFrame(step);
    };

    const onPyramidDrawStart = () => {
      if (scene.isDisposed) return;
      resetBoxTool(); // un seul outil de dessin actif à la fois sur `groundPickPlane`
      resetPyramidTool();
      pyramidPhase = 'drawing-base';
      groundPickPlane.isPickable = true;
    };
    window.addEventListener('apex-primitive-pyramid-start', onPyramidDrawStart);

    const pyramidDrawObserver = scene.onPointerObservable.add((pointerInfo) => {
      if (pyramidPhase === 'idle') return;

      if (pyramidPhase === 'drawing-base') {
        const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh === groundPickPlane);
        if (!pick?.hit || !pick.pickedPoint) return;

        if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
          const corner = pyramidBaseStart ?? pick.pickedPoint;
          const min = new BABYLON.Vector3(Math.min(corner.x, pick.pickedPoint.x), 0, Math.min(corner.z, pick.pickedPoint.z));
          const max = new BABYLON.Vector3(Math.max(corner.x, pick.pickedPoint.x), 0, Math.max(corner.z, pick.pickedPoint.z));
          pyramidPreviewRings = buildPyramidPreview(min, max, 0, pyramidPreviewRings);
        } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
          if (!pyramidBaseStart) {
            pyramidBaseStart = pick.pickedPoint.clone();
            return;
          }
          const corner = pick.pickedPoint.clone();
          if (corner.subtract(pyramidBaseStart).length() < 2) {
            resetPyramidTool();
            return;
          }
          pyramidBaseCorner = corner;
          pyramidPhase = 'extruding';
        }
        return;
      }

      if (pyramidPhase === 'extruding' && pyramidBaseStart && pyramidBaseCorner) {
        const min = new BABYLON.Vector3(Math.min(pyramidBaseStart.x, pyramidBaseCorner.x), 0, Math.min(pyramidBaseStart.z, pyramidBaseCorner.z));
        const max = new BABYLON.Vector3(Math.max(pyramidBaseStart.x, pyramidBaseCorner.x), 0, Math.max(pyramidBaseStart.z, pyramidBaseCorner.z));

        if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
          // Même dérivation écran→hauteur que Boîte, indépendante du pick au sol pour ne
          // pas geler quand le curseur sort de l'étendue finie du plan de pick.
          const originScreen = BABYLON.Vector3.Project(
            new BABYLON.Vector3((min.x + max.x) / 2, 0, (min.z + max.z) / 2),
            BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
            camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
          );
          const pixelsPerMm = 3;
          const rawHeight = Math.max(0, (originScreen.y - scene.pointerY) / pixelsPerMm);
          pyramidHeight = Math.min(HEIGHT, rawHeight);
          pyramidPreviewRings = buildPyramidPreview(min, max, pyramidHeight, pyramidPreviewRings);
        } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
          if (pyramidHeight < 1) return;
          pyramidPhase = 'filling';
          groundPickPlane.isPickable = false;
          disposePyramidPreview();
          runPyramidFillAnimation(min, max, pyramidHeight);
        }
      }
    });

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

    // ---------------------------------------------------------------------------------
    // Sélection du plan d'esquisse : au clic sur « Esquisse », 3 plaques carrées
    // représentent les plans principaux (parallèles aux axes X/Y/Z) ; cliquer une face
    // d'un corps existant fonctionne aussi, en dérivant le plan directement du point et
    // de la normale que Babylon calcule pour cette face — un vrai plan géométrique, sans
    // dépendre du kernel B-rep (qui n'existe pas encore) pour l'identifier.
    // ---------------------------------------------------------------------------------
    const SKETCH_PLANE_SIZE = 30;
    // Les 3 plaques ne se touchent pas : chacune démarre à `SKETCH_PLANE_GAP` de l'origine
    // le long de ses deux axes, ce qui laisse un vide au coin commun (comme les plans
    // d'origine de Fusion 360, jamais jointifs) et évite le z-fighting sur les arêtes.
    const SKETCH_PLANE_GAP = 4;

    // Même effet « verre dépoli » que le plateau (`glassDiscMat` défini plus haut) : le
    // fragment shader échantillonne `blurRT` en coordonnées ÉCRAN (pas UV du mesh), donc il
    // est réutilisable tel quel sur n'importe quelle géométrie/orientation — on y ajoute
    // simplement une teinte réglable en uniforme pour distinguer l'état survolé du défaut,
    // ce qu'un ShaderMaterial partagé ne permettrait pas sans ce paramètre.
    BABYLON.Effect.ShadersStore["sketchPlaneGlassVertexShader"] = `
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
    BABYLON.Effect.ShadersStore["sketchPlaneGlassFragmentShader"] = `
      precision highp float;
      varying vec4 vClip;
      uniform sampler2D blurTex;
      uniform vec4 tintColor;
      void main(void) {
        vec2 ndc = vClip.xy / vClip.w;
        vec2 uv = ndc * 0.5 + 0.5;
        vec3 blurred = texture2D(blurTex, uv).rgb;
        vec3 finalColor = mix(blurred, tintColor.rgb, tintColor.a);
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;
    const makeSketchPlaneGlassMat = (name: string, tint: BABYLON.Color4): BABYLON.ShaderMaterial => {
      const mat = new BABYLON.ShaderMaterial(name, scene, { vertex: "sketchPlaneGlass", fragment: "sketchPlaneGlass" }, {
        attributes: ["position"],
        uniforms: ["worldViewProjection", "tintColor"],
        samplers: ["blurTex"],
      });
      mat.setTexture("blurTex", blurRT);
      mat.setColor4("tintColor", tint);
      mat.backFaceCulling = false;
      return mat;
    };

    // Teinte neutre bleu-gris par défaut, cyan (l'accent déjà utilisé partout dans l'app) au
    // survol — la 4e composante est la force du mélange avec l'arrière-plan flouté.
    const sketchPlaneDefaultMat = makeSketchPlaneGlassMat("sketchPlaneDefaultMat", new BABYLON.Color4(0.55, 0.68, 0.78, 0.4));
    const sketchPlaneHoverMat = makeSketchPlaneGlassMat("sketchPlaneHoverMat", new BABYLON.Color4(0, 0.94, 1, 0.55));

    /**
     * Un plan d'origine Fusion 360 est un quadrant partant de l'origine, pas un carré centré
     * dessus : les 3 plaques regardent vers le même coin sans jamais s'y toucher. `CreatePlane`
     * centre son carré sur son origine locale ; on le redécale donc de (gap + moitié) sur ses
     * deux axes locaux AVANT rotation, puis on fait tourner ce décalage par la même rotation
     * pour obtenir la bonne position monde — cette approche matricielle évite de devoir déduire
     * à la main, pour chaque axe, dans quel sens la rotation renvoie le coin (erreurs de signe).
     * On garde la matrice de rotation : elle sert aussi à placer les arêtes pointillées.
     */
    const sketchPlateRotMatrix = new Map<BABYLON.Mesh, BABYLON.Matrix>();
    const makeSketchPlanePlate = (name: string, rotation: BABYLON.Vector3): BABYLON.Mesh => {
      const plate = BABYLON.MeshBuilder.CreatePlane(
        name, { size: SKETCH_PLANE_SIZE, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene,
      );
      plate.rotation = rotation;
      const rotMatrix = BABYLON.Matrix.RotationYawPitchRoll(rotation.y, rotation.x, rotation.z);
      const inset = SKETCH_PLANE_GAP + SKETCH_PLANE_SIZE / 2;
      plate.position = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(inset, inset, 0), rotMatrix);
      plate.material = sketchPlaneDefaultMat;
      plate.isPickable = false; // activée seulement pendant la sélection de plan
      plate.setEnabled(false);
      sketchPlateRotMatrix.set(plate, rotMatrix);
      return plate;
    };

    // Plan du sol (normale Y) : même rotation que `groundPickPlane`, qui joue déjà ce rôle.
    const sketchPlatePlateXZ = makeSketchPlanePlate("sketchPlanePlateXZ", new BABYLON.Vector3(Math.PI / 2, 0, 0));
    // Plan de face (normale Z) : orientation par défaut de `CreatePlane`.
    const sketchPlatePlateXY = makeSketchPlanePlate("sketchPlanePlateXY", new BABYLON.Vector3(0, 0, 0));
    // Plan de côté (normale X). Yaw -π/2 (et non +π/2) pour que l'axe local +x de la plaque
    // pointe vers +Z comme les deux autres : les 3 quadrants encadrent alors le MÊME octant
    // (+X/+Y/+Z), au lieu que celui-ci parte vers -Z et s'écarte des autres.
    const sketchPlatePlateYZ = makeSketchPlanePlate("sketchPlanePlateYZ", new BABYLON.Vector3(0, -Math.PI / 2, 0));

    const sketchPlanePlates: BABYLON.Mesh[] = [sketchPlatePlateXZ, sketchPlatePlateXY, sketchPlatePlateYZ];
    const sketchPlanePlateAxis = new Map<BABYLON.Mesh, 'XZ' | 'XY' | 'YZ'>([
      [sketchPlatePlateXZ, 'XZ'], [sketchPlatePlateXY, 'XY'], [sketchPlatePlateYZ, 'YZ'],
    ]);

    // Point d'origine (petite sphère blanche) au coin commun des 3 plaques, comme le repère
    // visible dans Fusion 360 à l'intersection des plans principaux.
    const sketchPlaneOrigin = BABYLON.MeshBuilder.CreateSphere("sketchPlaneOriginMarker", { diameter: 3 }, scene);
    const originMat = new BABYLON.StandardMaterial("sketchPlaneOriginMarkerMat", scene);
    originMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    originMat.disableLighting = true;
    sketchPlaneOrigin.material = originMat;
    sketchPlaneOrigin.isPickable = false;
    sketchPlaneOrigin.setEnabled(false);

    // Arêtes colorées et pointillées le long de CHAQUE plaque, comme dans Fusion 360 : les
    // deux bords de chaque plaque qui pointent vers le coin commun sont soulignés d'un trait
    // épais tireté, à la couleur de l'axe monde qu'ils suivent (X rouge / Y vert / Z bleu —
    // mêmes teintes que `originAxes`). On dérive les extrémités monde de chaque bord via la
    // matrice de rotation de la plaque, et la couleur de la composante dominante de sa
    // direction : aucun cas particulier par axe à maintenir à la main.
    const AXIS_COLORS: [BABYLON.Color3, BABYLON.Color3, BABYLON.Color3] = [
      new BABYLON.Color3(1, 0.23, 0.23),   // X
      new BABYLON.Color3(0.23, 1, 0.36),   // Y
      new BABYLON.Color3(0.23, 0.48, 1),   // Z
    ];
    // Même technique que la grille : un vrai ruban `GreasedLine` d'épaisseur écran constante,
    // avec le tireté géré par le matériau (`useDash`). Les 6 arêtes se regroupent par couleur
    // d'axe, soit un seul mesh par axe au lieu d'une ligne par segment.
    const SKETCH_EDGE_WIDTH = 5; // ≈ 2,5 px, constants à l'écran (cf. GRID_WIDTH_* plus haut)
    const sketchEdgesByAxis: BABYLON.Vector3[][][] = [[], [], []];
    sketchPlanePlates.forEach((plate) => {
      const rotMatrix = sketchPlateRotMatrix.get(plate)!;
      const g = SKETCH_PLANE_GAP;
      const far = SKETCH_PLANE_GAP + SKETCH_PLANE_SIZE;
      // Les deux bords de la plaque qui partent de son coin intérieur (g,g), en local.
      const localEdges: [BABYLON.Vector3, BABYLON.Vector3][] = [
        [new BABYLON.Vector3(g, g, 0), new BABYLON.Vector3(far, g, 0)],
        [new BABYLON.Vector3(g, g, 0), new BABYLON.Vector3(g, far, 0)],
      ];
      localEdges.forEach(([a, b]) => {
        const wa = BABYLON.Vector3.TransformCoordinates(a, rotMatrix);
        const wb = BABYLON.Vector3.TransformCoordinates(b, rotMatrix);
        const dir = wb.subtract(wa);
        const abs = [Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z)];
        sketchEdgesByAxis[abs.indexOf(Math.max(...abs))].push([wa, wb]); // dominante → X/Y/Z
      });
    });

    const sketchPlaneAxisLines: BABYLON.Mesh[] = [];
    sketchEdgesByAxis.forEach((lines, axis) => {
      if (lines.length === 0) return;
      const mesh = BABYLON.CreateGreasedLine(
        `sketchPlaneEdges${axis}`,
        { points: lines },
        {
          color: AXIS_COLORS[axis],
          width: SKETCH_EDGE_WIDTH,
          sizeAttenuation: true,
          useDash: true,
          dashCount: 14,
          dashRatio: 0.45,
        },
        scene,
      ) as BABYLON.Mesh;
      mesh.isPickable = false;
      mesh.renderingGroupId = 1; // par-dessus les plaques translucides
      mesh.setEnabled(false);
      sketchPlaneAxisLines.push(mesh);
    });

    // Trait plein par axe (X/Y/Z), dans la rainure entre deux plaques adjacentes : il part du
    // point d'origine blanc (0,0,0) et dépasse LÉGÈREMENT le bord extérieur des plaques.
    const SKETCH_AXIS_OVERSHOOT = 4;
    const sketchAxisEnd = SKETCH_PLANE_GAP + SKETCH_PLANE_SIZE + SKETCH_AXIS_OVERSHOOT;
    ([
      [new BABYLON.Vector3(sketchAxisEnd, 0, 0), AXIS_COLORS[0]],
      [new BABYLON.Vector3(0, sketchAxisEnd, 0), AXIS_COLORS[1]],
      [new BABYLON.Vector3(0, 0, sketchAxisEnd), AXIS_COLORS[2]],
    ] as [BABYLON.Vector3, BABYLON.Color3][]).forEach(([end, color], i) => {
      const line = BABYLON.CreateGreasedLine(
        `sketchPlaneSolidAxis${i}`,
        { points: [[BABYLON.Vector3.Zero(), end]] },
        { color, width: SKETCH_EDGE_WIDTH, sizeAttenuation: true },
        scene,
      ) as BABYLON.Mesh;
      line.isPickable = false;
      line.renderingGroupId = 1;
      line.setEnabled(false);
      sketchPlaneAxisLines.push(line);
    });

    // (Les graduations chiffrées ne sont plus recréées ici : la grille de modélisation les
    // porte en permanence — cf. `modelingGridLabels` — donc elles sont déjà à l'écran quand on
    // choisit un plan d'esquisse.)

    let sketchPlanePickActive = false;
    let sketchPlaneHoveredPlate: BABYLON.Mesh | null = null;

    const setSketchPlanePickActive = (active: boolean) => {
      sketchPlanePickActive = active;
      sketchPlanePlates.forEach((p) => { p.setEnabled(active); p.isPickable = active; p.material = sketchPlaneDefaultMat; });
      sketchPlaneOrigin.setEnabled(active);
      sketchPlaneAxisLines.forEach((l) => l.setEnabled(active));
      sketchPlaneHoveredPlate = null;
      if (!active) setSketchPlaneHint(null);
    };

    const onSketchPlanePickStart = () => {
      if (scene.isDisposed) return;
      setSketchPlanePickActive(true);
    };
    window.addEventListener('apex-sketch-plane-pick-start', onSketchPlanePickStart);

    const onSketchPlanePickCancel = () => setSketchPlanePickActive(false);
    window.addEventListener('apex-sketch-plane-pick-cancel', onSketchPlanePickCancel);

    // Oriente la caméra bien en face du plan choisi — même animation (20 frames sur les
    // canaux alpha/beta de l'ArcRotateCamera) que `handleCustomView` un peu plus haut.
    const orientCameraToPlane = (alpha: number, beta: number) => {
      const animAlpha = new BABYLON.Animation(
        "sketchPlaneCamAlpha", "alpha", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
      animAlpha.setKeys([{ frame: 0, value: camera.alpha }, { frame: 20, value: alpha }]);
      const animBeta = new BABYLON.Animation(
        "sketchPlaneCamBeta", "beta", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
      animBeta.setKeys([{ frame: 0, value: camera.beta }, { frame: 20, value: beta }]);
      scene.beginDirectAnimation(camera, [animAlpha, animBeta], 0, 20, false);
    };

    const sketchPlanePickObserver = scene.onPointerObservable.add((pointerInfo) => {
      if (!sketchPlanePickActive) return;

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        setSketchPlaneHint({ x: pointerInfo.event.clientX, y: pointerInfo.event.clientY });

        const hoverPick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => sketchPlanePlates.includes(mesh as BABYLON.Mesh));
        const hovered = hoverPick?.hit ? (hoverPick.pickedMesh as BABYLON.Mesh) : null;
        if (hovered !== sketchPlaneHoveredPlate) {
          if (sketchPlaneHoveredPlate) sketchPlaneHoveredPlate.material = sketchPlaneDefaultMat;
          if (hovered) hovered.material = sketchPlaneHoverMat;
          sketchPlaneHoveredPlate = hovered;
        }
        return;
      }

      if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERUP) return;

      const decor: BABYLON.AbstractMesh[] = [glassDisc, outline, topOutline, backdrop, groundPickPlane, ...modelingGrid];
      const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) =>
        sketchPlanePlates.includes(mesh as BABYLON.Mesh)
        || (!decor.includes(mesh) && !mesh.name.includes("Gizmo") && !mesh.name.startsWith("boxDraw") && !mesh.name.startsWith("pyramidDraw")),
      );
      if (!pick?.hit || !pick.pickedMesh || !pick.pickedPoint) return;

      const axis = sketchPlanePlateAxis.get(pick.pickedMesh as BABYLON.Mesh);
      setSketchPlanePickActive(false);

      if (axis) {
        // Mêmes couples alpha/beta que les vues « dessus/face/côté » de `handleSetView` —
        // logique, puisqu'un plan principal est justement défini par la vue qui lui fait face.
        // XZ (sol, normale Y) ne fixe que beta, comme la vue du dessus : l'alpha courant est
        // conservé pour ne pas faire pivoter la caméra sans raison autour de l'axe vertical.
        const angles: Record<'XZ' | 'XY' | 'YZ', { alpha: number; beta: number }> = {
          XZ: { alpha: camera.alpha, beta: 0.01 },
          XY: { alpha: Math.PI / 2, beta: Math.PI / 2 },
          YZ: { alpha: 0, beta: Math.PI / 2 },
        };
        orientCameraToPlane(angles[axis].alpha, angles[axis].beta);
        window.dispatchEvent(new CustomEvent('apex-sketch-plane-selected', { detail: { kind: 'axis', plane: axis } }));
        return;
      }

      // Une face d'un corps existant : `getNormal` calcule la normale du triangle touché en
      // coordonnées monde, ce qui donne un plan valide même sur un mesh importé quelconque.
      // `useVerticesNormals: false` pour obtenir la normale plate du triangle, pas une
      // normale de sommet lissée — sur un mesh à ombrage lisse, cette dernière dévierait
      // légèrement du plan réel de la face cliquée.
      const normal = pick.getNormal(true, false);
      if (!normal) return;

      // Fait face à la normale de la face cliquée : on inverse la projection utilisée pour
      // positionner une ArcRotateCamera (position = target + radius·(cosα sinβ, cosβ, sinα
      // sinβ)) pour retrouver l'alpha/beta qui placent la caméra dans la direction de cette
      // normale, donc bien en face de la face plutôt que de biais ou en son opposé.
      const n = normal.normalize();
      const beta = Math.acos(Math.max(-1, Math.min(1, n.y)));
      const alpha = Math.atan2(n.z, n.x);
      orientCameraToPlane(alpha, beta);

      window.dispatchEvent(new CustomEvent('apex-sketch-plane-selected', {
        detail: {
          kind: 'face',
          origin: { x: pick.pickedPoint.x, y: pick.pickedPoint.y, z: pick.pickedPoint.z },
          normal: { x: normal.x, y: normal.y, z: normal.z },
        },
      }));
    });

    const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
      const excluded: BABYLON.AbstractMesh[] = [glassDisc, outline, topOutline, backdrop, groundPickPlane, ...modelingGrid];

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => !excluded.includes(mesh) && !mesh.name.includes("Gizmo") && !mesh.name.startsWith("boxDraw") && !mesh.name.startsWith("pyramidDraw") && !mesh.name.startsWith("sketchPlanePlate"));
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
        const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => !excluded.includes(mesh) && !mesh.name.includes("Gizmo") && !mesh.name.startsWith("boxDraw") && !mesh.name.startsWith("pyramidDraw") && !mesh.name.startsWith("sketchPlanePlate"));
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
      window.removeEventListener('apex-mode-changed', onModeChanged);
      window.removeEventListener('apex-primitive-box-start', onBoxDrawStart);
      scene.onPointerObservable.remove(boxDrawObserver);
      window.removeEventListener('apex-primitive-pyramid-start', onPyramidDrawStart);
      scene.onPointerObservable.remove(pyramidDrawObserver);
      window.removeEventListener('apex-sketch-plane-pick-start', onSketchPlanePickStart);
      window.removeEventListener('apex-sketch-plane-pick-cancel', onSketchPlanePickCancel);
      scene.onPointerObservable.remove(sketchPlanePickObserver);
      sketchPlanePlates.forEach((p) => p.dispose());
      sketchPlaneOrigin.dispose();
      sketchPlaneAxisLines.forEach((l) => l.dispose());
      window.removeEventListener('apex-request-textures', onRequestTextures);
      window.removeEventListener('apex-set-camera-view', handleSetView);
      window.removeEventListener('apex-set-camera-custom', handleCustomView);
      window.removeEventListener('keydown', handleKeyDown);
      scene.onPointerObservable.remove(pointerObserver);
      scene.onBeforeRenderObservable.remove(gridZoomObserver);
      renderPipeline.dispose();
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

  // Sous-menu "Ajouter une primitive" : ouvert au survol de son entrée, fermé dès qu'on
  // quitte la zone (entrée + panneau), pas au clic — comme un menu contextuel classique.
  const [primitiveSubmenuOpen, setPrimitiveSubmenuOpen] = useState(false);
  const primitiveHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openPrimitiveSubmenu = () => {
    if (primitiveHoverTimeout.current) clearTimeout(primitiveHoverTimeout.current);
    setPrimitiveSubmenuOpen(true);
  };
  const closePrimitiveSubmenuDelayed = () => {
    if (primitiveHoverTimeout.current) clearTimeout(primitiveHoverTimeout.current);
    primitiveHoverTimeout.current = setTimeout(() => setPrimitiveSubmenuOpen(false), 120);
  };

  React.useLayoutEffect(() => {
    if (!contextMenu) {
      setMenuPos(null);
      setPrimitiveSubmenuOpen(false);
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

      {sketchPlaneHint && (
        <div
          style={{
            position: 'fixed', left: sketchPlaneHint.x + 18, top: sketchPlaneHint.y + 18, zIndex: 1000,
            pointerEvents: 'none', background: 'rgba(20,22,30,0.85)', color: 'rgba(255,255,255,0.9)',
            fontSize: 12, padding: '5px 10px', borderRadius: 6, whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          }}
        >
          Sélectionner un plan ou une face plane
        </div>
      )}

      {/* Échelle dynamique (mode modélisation) : la barre représente toujours une distance
          « ronde », c'est sa largeur en pixels qui s'ajuste au zoom courant. */}
      {scaleBar && (
        <div
          style={{
            position: 'absolute', right: 24, bottom: 24, zIndex: 20,
            pointerEvents: 'none', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 4,
          }}
        >
          <span
            style={{
              fontSize: 11, letterSpacing: '0.04em', color: 'rgba(255,255,255,0.75)',
              textShadow: '0 1px 3px rgba(0,0,0,0.6)',
            }}
          >
            {scaleBar.label}
          </span>
          <div
            style={{
              width: scaleBar.px, height: 7, borderLeft: '2px solid rgba(255,255,255,0.75)',
              borderRight: '2px solid rgba(255,255,255,0.75)', borderBottom: '2px solid rgba(255,255,255,0.75)',
            }}
          />
        </div>
      )}

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
            <div
              style={{ ...menuItemStyle, position: 'relative' }}
              onMouseEnter={openPrimitiveSubmenu}
              onMouseLeave={closePrimitiveSubmenuDelayed}
            >
              <span>Ajouter une primitive</span><span style={{ opacity: 0.6 }}>›</span>

              {primitiveSubmenuOpen && (
                <div
                  onMouseEnter={openPrimitiveSubmenu}
                  onMouseLeave={closePrimitiveSubmenuDelayed}
                  style={{
                    position: 'absolute', top: -6, left: '100%', zIndex: 1001,
                    // Marge d'écartement visuelle (8px) portée par un padding plutôt qu'un
                    // offset de `left`, pour que la zone de survol reste continue entre
                    // l'entrée du menu et le sous-menu — sinon le hover se perd dans l'écart.
                    paddingLeft: 8,
                  }}
                >
                  <div
                    style={{
                      minWidth: 160, padding: 6, borderRadius: 14,
                      background: 'rgba(20,22,30,0.55)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
                      boxShadow: '0 12px 40px 0 rgba(0,0,0,0.35), 0 4px 16px 0 rgba(0,0,0,0.25)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div
                      style={menuItemStyle}
                      onClick={() => runAction(() => window.dispatchEvent(new CustomEvent('apex-primitive-box-start')))}
                    >
                      Boîte
                    </div>
                    <div
                      style={menuItemStyle}
                      onClick={() => runAction(() => window.dispatchEvent(new CustomEvent('apex-primitive-pyramid-start')))}
                    >
                      Pyramide 4 côtés
                    </div>
                  </div>
                </div>
              )}
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