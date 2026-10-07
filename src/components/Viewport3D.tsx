"use client";

import React, { useRef, useState, useLayoutEffect } from 'react';
import * as BABYLON from 'babylonjs';
import 'babylonjs-loaders';
import { renderToStaticMarkup } from 'react-dom/server';
import { Upload, BoxSelect, LayoutGrid, Trash2 } from 'lucide-react';
import { showSuccess, showWarning, showError } from '@/utils/toast';
import styles from './Viewport3D.module.scss';
import { createGCodeLayer, GCODE_MESH_PREFIX, type ParsedGCode, type ColorByMode } from './gcodeLayer';
import { createGCodeEditController, type GCodeEditController } from './edit-node/gcodeEditController';
import GCodeEditOverlay from './edit-node/GCodeEditOverlay';
import { createScreenLine, createScreenLines } from './screenLine';
import type { ColorByScope } from './gcodeColormap';
import type { LineTypeVisibility } from './gcodeLineTypes';
import { PAN_PERSPECTIVE_EVENT, readPanPerspective } from '@/utils/panPerspectivePrefs';
import { previewZoomStepFactor } from '@/utils/previewZoomPrefs';

const DEFAULT_BLUR_LEVEL = 40;

export const Viewport3D = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // Le clic droit qui ouvre le menu déclenche ensuite, sur ce même clic, l'événement DOM natif
  // `contextmenu` : au moment où celui-ci se déclenche, le rideau de fermeture (qui couvre tout
  // l'écran) est déjà monté sous le curseur et en reçoit la cible — sans ce garde-fou, son
  // propre `onContextMenu` referme le menu qui vient tout juste de s'ouvrir. On l'arme juste
  // avant d'ouvrir et on l'ignore une seule fois, côté rideau.
  const suppressNextBackdropContextMenuRef = useRef(false);
  const [blurLevel, setBlurLevel] = useState(DEFAULT_BLUR_LEVEL);
  // Info-bulle qui suit le curseur pendant la sélection du plan d'esquisse (façon Fusion 360).
  const [sketchPlaneHint, setSketchPlaneHint] = useState<{ x: number; y: number } | null>(null);
  const [plateActionHint, setPlateActionHint] = useState<{ title: string; x: number; y: number } | null>(null);
  // Rectangle de la fenêtre de sélection (clic gauche + drag), en coordonnées écran relatives
  // au conteneur — `null` quand aucun drag de sélection n'est en cours. `mode` dépend du sens du
  // drag, comme dans la plupart des logiciels de CAO : vers la droite = « window » (ne retient
  // que les objets entièrement englobés, contour plein) ; vers la gauche = « crossing » (retient
  // tout objet touché, contour pointillé animé + surlignage blanc).
  const [editController, setEditController] = useState<GCodeEditController | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number; mode: 'window' | 'crossing' } | null>(null);
  const plateImportInputRef = useRef<HTMLInputElement>(null);
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
  // Presse-papier interne pour Ctrl+C / Ctrl+V sur les modèles du plateau : noms des modèles
  // sélectionnés au moment du copier (pas les meshes eux-mêmes, qui peuvent être supprimés entre
  // temps) — résolus à nouveau contre `modelsRef` au moment du coller.
  const clipboardMeshNamesRef = useRef<string[]>([]);
  const currentToolRef = useRef<string>("select");
  const [, setSelectedMeshName] = useState<string | null>(null);
  // Dimensions : 250mm de diamètre (rayon 125) et 130mm de haut
  const RADIUS = 125;
  const HEIGHT = 130;
  const HOLE_RADIUS = 20;
  // Élévation MONDE de la surface réelle du plateau (le disque "verre dépoli", cf. glassDisc) :
  // volumeRoot (le socle du plateau) est à HEIGHT * 0.5, et glassDisc est posé 0.1mm au-dessus de
  // ce socle, dans son repère local. Les modèles importés/déplacés (posés directement à la racine
  // de la scène, jamais parentés à volumeRoot) doivent reposer sur cette élévation plutôt que sur
  // y = 0 (qui n'est que le niveau du fond quadrillé, cf. backdrop) — sans quoi ils tombent à
  // travers le plateau jusqu'à la grille de fond, ~65mm plus bas.
  const PLATE_SURFACE_Y = HEIGHT * 0.5 + 0.1;

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
    const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true }, true);
    engineRef.current = engine;
    const scene = new BABYLON.Scene(engine);
    sceneRef.current = scene;
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);

    const camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 4, Math.PI / 3, 300, new BABYLON.Vector3(0, HEIGHT / 2, 0), scene);
    camera.attachControl(canvas, true);

    // Le clic gauche est réservé à la sélection rectangulaire (fenêtre de sélection, cf. plus
    // bas). Cette version de Babylon ne route plus les boutons souris via les propriétés
    // `buttons`/`panningMouseButton` de `ArcRotateCameraPointersInput` (qui n'ont plus d'effet
    // sur le pointeur) mais via `camera.movement.input.inputMap`, une table ordonnée
    // { bouton → interaction } — cf. `resolveInteraction()` dans le moteur. Ses entrées pointeur
    // par défaut sont [bouton 0 + Ctrl → pan], [bouton 0 → rotate], [bouton 2 → pan] ; on les
    // retire et on les remplace par [bouton 1 → pan] et [bouton 2 → rotate], en gardant intactes
    // les entrées clavier/molette/tactile du même tableau.
    const baseInputMap = camera.movement.input.inputMap.filter((entry) => entry.source !== "pointer");
    camera.movement.input.inputMap = [...baseInputMap, { source: "pointer", button: 2, interaction: "rotate" }];

    /**
     * Panoramique (bouton du milieu) par DÉCALAGE DE L'IMAGE, pas de la caméra (demande de
     * l'utilisateur, 2026-10-06, tous les espaces) : les objets restent vus sous le même angle
     * quelle que soit la translation, comme une image qu'on fait glisser. Physiquement, c'est un
     * objectif décentré (axe optique décalé) : la perspective n'est plus celle d'un œil qui se
     * déplace, mais c'est plus simple à lire. Le décalage est ajouté à la projection (en
     * coordonnées normalisées) ; tout ce qui la lit (rendu, culling, picking, projections du nœud
     * d'édition) le voit. Il est remis à zéro par les vues prédéfinies et l'entrée en Modélisation.
     *
     * Sélecteur « perspective en translation » (AxisSidebar, `apex-pan-perspective`) : activé, le
     * bouton du milieu rend la main au panoramique de Babylon (la caméra se déplace, perspective
     * physique) ; le décalage d'image déjà posé est conservé (pas de saut).
     */
    const lensShift = { x: 0, y: 0 };
    const baseGetProjectionMatrix = camera.getProjectionMatrix.bind(camera);
    const shiftedProjection = new BABYLON.Matrix();
    const shiftedArray = new Float32Array(16);
    camera.getProjectionMatrix = (force?: boolean) => {
      const base = baseGetProjectionMatrix(force);
      if (lensShift.x === 0 && lensShift.y === 0) return base;
      const m = base.m;
      for (let i = 0; i < 16; i++) shiftedArray[i] = m[i];
      // Clip' = clip + décalage × w (vecteur ligne × matrice : colonnes x et y, w en colonne 3).
      for (let row = 0; row < 4; row++) {
        shiftedArray[row * 4] += lensShift.x * m[row * 4 + 3];
        shiftedArray[row * 4 + 1] += lensShift.y * m[row * 4 + 3];
      }
      BABYLON.Matrix.FromArrayToRef(shiftedArray, 0, shiftedProjection);
      return shiftedProjection;
    };
    const resetLensShift = () => { lensShift.x = 0; lensShift.y = 0; };
    let panPerspective = readPanPerspective();
    const applyPanMode = () => {
      camera.movement.input.inputMap = [
        ...baseInputMap,
        ...(panPerspective ? [{ source: "pointer" as const, button: 1, interaction: "pan" as const }] : []),
        { source: "pointer", button: 2, interaction: "rotate" },
      ];
    };
    applyPanMode();
    const onPanPerspective = (e: Event) => {
      panPerspective = !!(e as CustomEvent<{ enabled: boolean }>).detail?.enabled;
      applyPanMode();
    };
    window.addEventListener(PAN_PERSPECTIVE_EVENT, onPanPerspective);
    let panPointer: { id: number; x: number; y: number } | null = null;
    const onPanDown = (event: PointerEvent) => {
      if (event.button !== 1 || panPerspective) return;
      event.preventDefault(); // pas de défilement automatique du bouton du milieu
      panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const onPanMove = (event: PointerEvent) => {
      if (!panPointer || event.pointerId !== panPointer.id) return;
      const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
      lensShift.x += (2 * (event.clientX - panPointer.x)) / w;
      lensShift.y -= (2 * (event.clientY - panPointer.y)) / h;
      panPointer.x = event.clientX;
      panPointer.y = event.clientY;
    };
    const onPanUp = (event: PointerEvent) => {
      if (!panPointer || event.pointerId !== panPointer.id) return;
      panPointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerdown", onPanDown);
    canvas.addEventListener("pointermove", onPanMove);
    canvas.addEventListener("pointerup", onPanUp);
    canvas.addEventListener("pointercancel", onPanUp);

    /**
     * Zoom molette VERS LE CURSEUR, multiplicatif. Remplace l'entrée molette de Babylon :
     *  - multiplicatif : chaque cran change le rayon d'un même pourcentage, quelle que soit
     *    l'échelle (une distance fixe ne faisait rien de loin et envoyait en butée de près) ;
     *  - vers le curseur : le point du plan horizontal passant par la cible, sous la souris, reste
     *    fixe à l'écran — caméra ET cible sont rapprochées de ce point du même facteur. On avance
     *    donc vers ce qu'on vise sans devoir translater tous les trois crans. En modélisation ce
     *    plan est le sol, et la cible y reste.
     * `zoomToMouseLocation` de Babylon fait l'équivalent, mais son inertie s'arrête sur des seuils
     * ABSOLUS qui tronquent le mouvement aux petites échelles (même défaut que l'ancien pan).
     * L'adoucissement est donc refait ici, en échelle logarithmique, indépendant de l'échelle.
     *
     * Hors Modélisation (demande de l'utilisateur, 2026-10-06), le pas est LINÉAIRE : chaque cran
     * avance ou recule d'une même distance en mm, quel que soit l'éloignement (le pas en
     * pourcentage ralentissait le dézoom de près). L'adoucissement et le zoom vers le curseur
     * restent les mêmes. Le pas est ensuite modulé par `previewZoomStepFactor` (réglages du panneau
     * « Fonction » de Prévisualisation) : loi de puissance douce de la distance au point visé.
     */
    camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
    const ZOOM_LOG_PER_WHEEL_UNIT = 0.15 / 100; // cran standard (deltaY 100) ≈ ×1,16 / ÷1,16
    // Hors Modélisation : mm par unité de molette (cran standard ≈ 30 mm, proche du pas en
    // pourcentage à la distance par défaut de 300 mm).
    const ZOOM_MM_PER_WHEEL_UNIT = 30 / 100;
    const ZOOM_SMOOTHING_PER_FRAME = 0.35; // part du zoom restant appliquée à chaque image (60 i/s)
    // Au-delà, le point visé est quasi à l'horizon : on zoome alors vers la cible, sans quoi un
    // cran projetterait la caméra à des kilomètres.
    const ZOOM_MAX_ANCHOR_DISTANCE_RADII = 20;
    let pendingZoomLog = 0;
    let pendingZoomMm = 0;
    const zoomAnchor = new BABYLON.Vector3();
    const onCanvasWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 100 : 1; // lignes / pages
      if (modelingActive) pendingZoomLog += event.deltaY * unit * ZOOM_LOG_PER_WHEEL_UNIT;
      else {
        // Distance caméra → point visé sous le curseur (plan horizontal de la cible, comme l'ancre
        // du zoom) ; à défaut, le rayon de la caméra.
        let distance = camera.radius;
        const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
        if (Math.abs(ray.direction.y) > 1e-9) {
          const t = (camera.target.y - ray.origin.y) / ray.direction.y;
          if (t > 0 && t <= camera.radius * ZOOM_MAX_ANCHOR_DISTANCE_RADII) distance = t;
        }
        pendingZoomMm += event.deltaY * unit * ZOOM_MM_PER_WHEEL_UNIT * previewZoomStepFactor(distance);
      }
    };
    canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
    const zoomTowardCursorObserver = scene.onBeforeRenderObservable.add(() => {
      if (pendingZoomLog === 0 && pendingZoomMm === 0) return;
      const frames = engine.getDeltaTime() / (1000 / 60);
      const portion = 1 - Math.pow(1 - ZOOM_SMOOTHING_PER_FRAME, Math.max(frames, 0.01));
      const stepLog = Math.abs(pendingZoomLog) < 1e-4 ? pendingZoomLog : pendingZoomLog * portion;
      pendingZoomLog -= stepLog;
      const stepMm = Math.abs(pendingZoomMm) < 1e-3 ? pendingZoomMm : pendingZoomMm * portion;
      pendingZoomMm -= stepMm;

      // Respect des butées : on écrête le facteur plutôt que de laisser Babylon ramener le rayon
      // (ce qui décalerait le point visé).
      const minR = camera.lowerRadiusLimit ?? 0;
      const maxR = camera.upperRadiusLimit ?? Number.POSITIVE_INFINITY;
      const targetR = Math.min(Math.max(camera.radius * Math.exp(stepLog) + stepMm, minR), maxR);
      if (targetR === camera.radius) { pendingZoomLog = 0; pendingZoomMm = 0; return; }
      const factor = targetR / camera.radius;

      // Point visé : intersection du rayon souris avec le plan horizontal de la cible.
      zoomAnchor.copyFrom(camera.target);
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      if (Math.abs(ray.direction.y) > 1e-9) {
        const t = (camera.target.y - ray.origin.y) / ray.direction.y;
        if (t > 0 && t <= camera.radius * ZOOM_MAX_ANCHOR_DISTANCE_RADII) {
          ray.origin.addToRef(ray.direction.scale(t), zoomAnchor);
          zoomAnchor.y = camera.target.y;
        }
      }
      // Homothétie de centre `zoomAnchor` : cible et caméra (via le rayon) se rapprochent de lui
      // du même facteur, orientation inchangée — le point visé reste donc fixe à l'écran.
      const newTarget = zoomAnchor.add(camera.target.subtract(zoomAnchor).scale(factor));
      camera.target.copyFrom(newTarget);
      camera.radius = targetR;
    });

    // Le MSAA du contexte WebGL (2ᵉ argument `true` de BABYLON.Engine) ne couvre que le
    // rendu direct — les contours (LinesMesh, edgesRendering des voxels) et le compositing
    // via blurRT restent crénelés sans une passe FXAA sur la sortie finale du pipeline.
    const renderPipeline = new BABYLON.DefaultRenderingPipeline("apexRenderPipeline", false, scene, [camera]);
    renderPipeline.fxaaEnabled = true;
    renderPipeline.samples = 8;
    // Les verres DOM (GlassPanelBackdrop) se dessinent en fin d'image (post-traitements du pipeline inclus : plus tôt, le canevas n'a pas encore l'image finale).
    engine.onEndFrameObservable.add(() => window.dispatchEvent(new Event('apex-scene-rendered')));

    camera.angularSensibilityX = 3500;
    camera.angularSensibilityY = 3500;
    // Recalculée à chaque image (cf. observer plus bas) : le pan doit suivre l'échelle du zoom.
    camera.panningSensibility = 40;
    camera.maxZ = 10000;
    cameraRef.current = camera;

    // Pan sans inertie, comme en CAO : le sol colle au curseur. L'inertie de Babylon s'arrête sur
    // des seuils ABSOLUS (≈ 0,001 unité monde, et une vitesse plancher de 1e-6) : à petite échelle
    // tout le mouvement passe sous ces seuils et la glissade était tronquée, pas à grande échelle
    // — le même geste déplaçait alors la vue de 1× ou de 1,4× selon le zoom.
    camera.panningInertia = 0;
    camera.movement.panInertia = 0;
    // Pan proportionnel au zoom : Babylon déplace la cible de `pixels / panningSensibility` ; avec
    // cette valeur, un glisser de N px la déplace de N × (taille monde d'un pixel au niveau de la
    // cible), qu'on soit à 0,001 mm ou à 1 m.
    scene.onBeforeRenderObservable.add(() => {
      const worldPerPixel = (2 * camera.radius * Math.tan(camera.fov / 2)) / engine.getRenderHeight();
      if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0) return;
      camera.panningSensibility = 1 / worldPerPixel;
    });

    // Fond 3D : un sol infini (pas de murs ni de plafond), fixe dans le monde (pas parenté à la
    // caméra) pour que la grille affiche une vraie perspective en fonction de l'angle de vue.
    // Un shader procédural dessine la grille et l'estompe radialement vers la couleur de fond à
    // mesure qu'on s'éloigne du centre, pour donner l'impression d'une étendue sans limite
    // visible plutôt qu'une pièce fermée. Contrairement à l'ancien fond CSS derrière le canvas,
    // cette géométrie réelle peut être capturée et floutée par le disque "verre dépoli" du plateau.
    const backdropColor = "#2A2D33";
    const backdropSize = 20000;
    BABYLON.Effect.ShadersStore["backdropGridVertexShader"] = `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      uniform mat4 world;
      varying vec3 vWorldPos;
      void main(void) {
        vec4 worldPos = world * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = worldViewProjection * vec4(position, 1.0);
      }
    `;
    BABYLON.Effect.ShadersStore["backdropGridFragmentShader"] = `
      precision highp float;
      varying vec3 vWorldPos;
      uniform vec3 uBgColor;
      uniform vec3 uLineColor;
      uniform vec3 uCenter;
      uniform float uStep;
      uniform float uLineWidth;
      uniform float uFadeStart;
      uniform float uFadeEnd;
      void main(void) {
        vec2 p = vWorldPos.xz - uCenter.xz;
        vec2 g = abs(fract(p / uStep - 0.5) - 0.5) * uStep;
        vec2 derivative = fwidth(p);
        vec2 lineAA = smoothstep(uLineWidth - derivative, uLineWidth + derivative, g);
        float line = 1.0 - min(lineAA.x, lineAA.y);
        float dist = length(p);
        float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
        float alpha = line * fade;
        gl_FragColor = vec4(uLineColor, alpha);
      }
    `;
    const backdropMat = new BABYLON.ShaderMaterial("backdropMat", scene, { vertex: "backdropGrid", fragment: "backdropGrid" }, {
      attributes: ["position"],
      uniforms: ["worldViewProjection", "world", "uBgColor", "uLineColor", "uCenter", "uStep", "uLineWidth", "uFadeStart", "uFadeEnd"],
      needAlphaBlending: true,
    });
    backdropMat.setColor3("uBgColor", BABYLON.Color3.FromHexString(backdropColor));
    // Lignes discrètes : léger éclaircissement du gris de fond, pas un blanc pur.
    backdropMat.setColor3("uLineColor", BABYLON.Color3.FromHexString(backdropColor).add(new BABYLON.Color3(0.05, 0.05, 0.05)));
    backdropMat.setVector3("uCenter", BABYLON.Vector3.Zero());
    backdropMat.setFloat("uStep", 25);
    backdropMat.setFloat("uLineWidth", 0.5);
    // La grille s'estompe bien avant le bord réel du plan, pour qu'aucune limite ne soit visible.
    backdropMat.setFloat("uFadeStart", 600);
    backdropMat.setFloat("uFadeEnd", 3500);
    backdropMat.backFaceCulling = false;
    // Seules les lignes claires sont opaques : le reste du plan est transparent pour qu'on
    // voie au travers (plateau, grille de modélisation) plutôt qu'un fond plein superposé.
    backdropMat.alpha = 0.999;

    const backdrop = BABYLON.MeshBuilder.CreateGround("backdrop", { width: backdropSize, height: backdropSize }, scene);
    backdrop.position.y = -0.05;
    backdrop.isPickable = false;
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
      resetLensShift();
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
    // Plateau surélevé à mi-hauteur du volume d'impression (0.5 × HEIGHT) pour le détacher
    // visuellement du fond quadrillé. `plateActionRoot` (boutons d'action) suit la même élévation.
    volumeRoot.position.y = HEIGHT * 0.5;

    // Contours en rubans d'épaisseur constante à l'écran (cf. screenLine.ts) : une LinesMesh WebGL
    // fait toujours 1 px, trop fin pour que l'anticrénelage le lisse, et GreasedLine varie encore
    // avec la profondeur. `LINE_WIDTH_PX` : épaisseur en pixels de rendu.
    const LINE_WIDTH_PX = 2.5;
    const originAxisLength = HOLE_RADIUS * 1.4;
    // Sous la surface du plateau (glassDisc est à y = 0.1) : le disque, opaque, les occlut vus
    // du dessus (le depth-test les cache), mais ils entrent dans la capture `blurRT` et
    // apparaissent floutés dans le reflet vu du dessous — cf. capturedInBlur plus bas.
    const originAxisBase = new BABYLON.Vector3(0, 0.08, 0);
    const originAxes: [BABYLON.Vector3, BABYLON.Color3][] = [
      [new BABYLON.Vector3(originAxisLength, 0.08, 0), new BABYLON.Color3(1, 0.23, 0.23)],
      [new BABYLON.Vector3(0, originAxisLength, 0), new BABYLON.Color3(0.23, 1, 0.36)],
      [new BABYLON.Vector3(0, 0.08, originAxisLength), new BABYLON.Color3(0.23, 0.48, 1)],
    ];
    // Pivot commun des axes : en Prévisualisation, il suit la rotation C du plateau G-code
    // (cf. gcodeLayer plus bas) pour que les axes tournent avec la pièce ; ailleurs, fixe.
    const originAxesRoot = new BABYLON.TransformNode("originAxesRoot", scene);
    originAxesRoot.parent = volumeRoot;
    originAxes.forEach(([dir, color], i) => {
      // zOffset 0 : sous la surface du plateau, ces axes doivent rester occultés par le disque.
      const axisLine = createScreenLine(scene, `originAxis${i}`, [originAxisBase, dir], color, LINE_WIDTH_PX, 1, { zOffset: 0 });
      axisLine.parent = originAxesRoot;
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
    // Même teinte que le fond quadrillé (désormais transparent hors de ses lignes) : sans ça,
    // le disque reflète le noir de la clear color par défaut aux endroits où rien n'est dessiné.
    const blurRTClearColor = BABYLON.Color4.FromColor3(BABYLON.Color3.FromHexString(backdropColor), 1);
    blurRT.clearColor = blurRTClearColor;
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

    const glassDisc = BABYLON.MeshBuilder.CreateDisc("glassDisc", { radius: RADIUS, tessellation: 360 }, scene);
    glassDisc.rotation.x = Math.PI / 2;
    // Nettement au-dessus du fond quadrillé (backdrop, y = -0.05) : l'ancien écart de 0.03 mm
    // était trop fin pour se voir et frôlait le z-fighting à distance. Reste sous 1 mm pour ne
    // pas creuser d'écart visible avec les modèles, posés sur la surface du plateau — cf.
    // PLATE_SURFACE_Y, qui reprend ce même offset de 0.1 (voir handleDragEnd/onImportModel).
    glassDisc.position.y = 0.1;
    glassDisc.material = glassDiscMat;
    glassDisc.parent = volumeRoot;
    // Les maillages qui échantillonnent eux-mêmes `blurRT` (disque, boutons d'action du plateau)
    // n'y sont pas rendus : ils liraient la texture en cours d'écriture. La trajectoire G-code
    // non plus : entièrement au-dessus du disque, elle n'y ajouterait qu'un halo flou autour du
    // tracé, pour le prix d'un second rendu de lignes pouvant compter des millions de sommets.
    const capturedInBlur = (m: BABYLON.AbstractMesh) =>
      m !== glassDisc && !m.name.startsWith('plateAction') && !m.name.startsWith(GCODE_MESH_PREFIX);
    blurRT.renderList = scene.meshes.filter(capturedInBlur);
    scene.onNewMeshAddedObservable.add((m) => {
      if (capturedInBlur(m) && blurRT.renderList) blurRT.renderList.push(m);
    });

    const makeScreenLine = (name: string, points: BABYLON.Vector3[], color: BABYLON.Color3, alpha = 1, widthScale = 1) =>
      createScreenLine(scene, name, points, color, LINE_WIDTH_PX * widthScale, alpha);

    const outlinePoints = [];
    for (let i = 0; i <= 720; i++) {
      const angle = (i / 720) * Math.PI * 2;
      // Même hauteur que glassDisc : sans ça le contour cerclait le vide sous le disque surélevé.
      outlinePoints.push(new BABYLON.Vector3(Math.cos(angle) * RADIUS, glassDisc.position.y, Math.sin(angle) * RADIUS));
    }
    const outline = makeScreenLine("plateOutline", outlinePoints, new BABYLON.Color3(0, 0.94, 1));
    outline.parent = volumeRoot;

    const topOutlinePoints = [];
    for (let i = 0; i <= 720; i++) {
      const angle = (i / 720) * Math.PI * 2;
      topOutlinePoints.push(new BABYLON.Vector3(Math.cos(angle) * RADIUS, HEIGHT, Math.sin(angle) * RADIUS));
    }
    const topOutline = makeScreenLine("topOutline", topOutlinePoints, new BABYLON.Color3(0, 0.94, 1));
    topOutline.parent = volumeRoot;

    // Grille d'esquisse du mode modélisation : masquée tant qu'on est en mode slicer, elle
    // remplace le volume d'impression pour donner un repère de travail neutre au modéliseur.
    const GRID_WIDTH_AXIS = 6; // ~3 px — épaisseur des deux axes colorés (cf. plus bas)

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

    // Portée en unités monde des axes colorés et des graduations chiffrées (cf. plus bas) —
    // n'a plus besoin de borner un pavage de lignes : le quadrillage lui-même est maintenant un
    // shader procédural, sans étendue finie (cf. `modelingGridGround` ci-dessous).
    const GRID_TILE_EXTENT = 100;
    // Les deux axes du sol : les plus épais des traits de la grille, colorés comme le repère
    // d'origine (X rouge / Z bleu — mêmes teintes que `AXIS_COLORS` plus bas, l'axe vertical Y
    // vert étant porté par les plans d'esquisse). Légèrement surélevés (`y` non nul) pour ne pas
    // z-fighter avec le quadrillage procédural, coplanaire, juste en dessous.
    const modelingGridAxisX = makeGridLines(
      "modelingGridAxisX",
      [[new BABYLON.Vector3(-GRID_TILE_EXTENT, 0.02, 0), new BABYLON.Vector3(GRID_TILE_EXTENT, 0.02, 0)]],
      new BABYLON.Color3(0.85, 0.22, 0.22), GRID_WIDTH_AXIS, 0.9,
    );
    const modelingGridAxisZ = makeGridLines(
      "modelingGridAxisZ",
      [[new BABYLON.Vector3(0, 0.02, -GRID_TILE_EXTENT), new BABYLON.Vector3(0, 0.02, GRID_TILE_EXTENT)]],
      new BABYLON.Color3(0.25, 0.5, 0.95), GRID_WIDTH_AXIS, 0.9,
    );

    /**
     * Quadrillage procédural : un unique plan, dont le fragment shader dessine les traits
     * analytiquement à partir de la position monde de chaque pixel — plutôt que des maillages de
     * lignes à un pas UNIQUE choisi pour toute la scène (l'ancienne approche, cf. historique Git),
     * ce qui donnait un effet de « grosse grille au milieu de petites » : en perspective, la
     * distance caméra-sol varie fortement d'un bord à l'autre de l'écran, donc le pas idéal
     * (dérivé de `GRID_MIN_PX` pixels à l'écran) varie lui aussi — un seul pas global ne peut
     * convenir partout à la fois. Ici, `fwidth()` donne au shader la dérivée écran de la
     * position monde EN CHAQUE PIXEL, donc le même calcul que `updateGrid` (log10 + arrondi
     * décade) s'applique localement : chaque zone de l'écran affiche la subdivision qui LUI
     * convient, avec une transition en fondu continue plutôt qu'un saut global.
     *
     * Le plan suit la cible caméra (translation pure, cf. `gridZoomObserver`) pour rester sous
     * le point regardé : le motif étant recalculé analytiquement à chaque pixel (pas de tuile
     * finie à raccorder), cette translation n'a aucune contrainte d'alignement contrairement à
     * l'ancien pavage de lignes.
     */
    BABYLON.Effect.ShadersStore["modelingGridVertexShader"] = `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      uniform float uScale;
      uniform vec2 uOffset;
      // Position dans le plan du motif, relative à l'ancre de la grille (cf. recenterGridGround).
      // Le plan est un carré unité recentré sur la cible et mis à l'échelle du rayon caméra à
      // chaque frame : ses sommets restent donc à une distance de l'ordre du champ visible, et
      // l'interpolation float32 de cette varying garde une précision proportionnelle au zoom.
      // Avec un plan fixe géant (sommets à des dizaines de mètres), l'erreur d'interpolation
      // (~taille x 6e-8) dépassait la taille d'un pixel, puis du champ entier au zoom extrême :
      // fwidth() devenait bruité, d'où des bandes, puis une grille vide. uOffset (cible - ancre)
      // est calculé côté CPU en double précision et reste petit.
      varying vec2 vGridPos;
      varying vec2 vUnitPos;
      void main(void) {
        vGridPos = position.xz * uScale + uOffset;
        vUnitPos = position.xz;
        gl_Position = worldViewProjection * vec4(position, 1.0);
      }
    `;
    BABYLON.Effect.ShadersStore["modelingGridFragmentShader"] = `
      precision highp float;
      varying vec2 vGridPos;
      varying vec2 vUnitPos;
      uniform vec3 uMinorColor;
      uniform vec3 uMajorColor;
      uniform float uMinorAlpha;
      uniform float uMajorAlpha;
      uniform float uMinPx;
      uniform float uMinExponent;

      // Distance (en pixels) au trait le plus proche d'un quadrillage de pas spacing, à partir
      // d'une position ET d'une dérivée déjà calculées — jamais de fwidth() ici : spacing
      // varie de façon DISCONTINUE d'un pixel à l'autre (cf. plus bas), et rappeler fwidth() sur
      // une expression qui en dépend (position / spacing) ferait comparer par différence finie
      // deux pixels voisins avec des pas différents pile à la frontière — le GPU y calculerait
      // n'importe quoi, masquant les traits par bandes entières à cet endroit précis de l'écran
      // (fixe, puisque lié à la distance caméra-sol, pas à la position qu'on regarde).
      float gridMask(vec2 worldXZ, vec2 worldDeriv, float spacing, float halfWidthPx) {
        vec2 coord = worldXZ / spacing;
        vec2 coordDeriv = worldDeriv / spacing;
        vec2 dist = abs(fract(coord + 0.5) - 0.5) / max(coordDeriv, vec2(1e-6));
        float d = min(dist.x, dist.y);
        return 1.0 - clamp(d / halfWidthPx, 0.0, 1.0);
      }

      void main(void) {
        // Seul appel à fwidth() du shader, sur une grandeur continue (vGridPos) — tout le reste
        // s'en déduit par simple arithmétique (cf. gridMask ci-dessus).
        vec2 worldDeriv = fwidth(vGridPos);
        float worldPerPixel = max(max(worldDeriv.x, worldDeriv.y), 1e-12);

        // Seuils, en pixels d'écart à l'écran entre deux traits d'une même famille : un trait fin
        // apparaît en fondu entre FINE_IN et FINE_FULL, puis s'éclaircit et s'épaissit jusqu'au
        // rendu « principal » entre MAIN_IN et MAIN_FULL.
        float fineIn = 0.6 * uMinPx;
        float fineFull = 1.4 * uMinPx;
        float mainIn = 5.0 * uMinPx;
        float mainFull = 12.0 * uMinPx;

        // Familles de traits de pas 1·10^k et 2·10^k : 10^(k+1) ⊂ 2·10^k ⊂ 10^k, donc en zoomant un
        // carreau principal se divise d'abord en 5 (pas 2·10^k), puis en 10 (pas 10^k), et ces
        // traits fins deviennent à leur tour principaux — sans qu'aucun trait ne bouge. Chaque
        // famille a une intensité, une couleur et une épaisseur fonctions CONTINUES de son propre
        // écart à l'écran : aucune bascule brutale quand le pixel change d'échelle.
        // Plancher à uMinExponent : le plus fin des pas tracés ne descend jamais sous
        // 10^uMinExponent (limite de précision, cf. CPU).
        float baseExp = max(floor(log(fineIn * worldPerPixel) / log(10.0)), uMinExponent);
        vec3 color = uMinorColor;
        float alpha = 0.0;
        for (int e = 0; e <= 3; e++) {
          for (int m = 0; m < 2; m++) {
            float spacing = pow(10.0, baseExp + float(e)) * (m == 0 ? 1.0 : 2.0);
            float spacingPx = spacing / worldPerPixel;
            float visible = smoothstep(fineIn, fineFull, spacingPx);
            if (visible <= 0.0) continue;
            float major = smoothstep(mainIn, mainFull, spacingPx);
            float mask = gridMask(vGridPos, worldDeriv, spacing, mix(0.55, 0.95, major));
            float a = mask * visible * mix(uMinorAlpha, uMajorAlpha, major);
            if (a > alpha) {
              alpha = a;
              color = mix(uMinorColor, uMajorColor, major);
            }
          }
        }

        // Fondu vers le bord du plan : sa limite ne se voit jamais, même en vue rasante.
        alpha *= 1.0 - smoothstep(0.6, 1.0, length(vUnitPos));

        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `;
    const GRID_MIN_PX = 10;
    // En dessous de ce pas (mm), la géométrie flotte en simple précision : les coordonnées
    // locales divisées par un pas aussi microscopique perdent toute précision fractionnaire
    // (c'est la cause des artefacts constatés « sous 1 mm »). On plafonne donc l'affinement —
    // CPU (étiquettes/axes, cf. updateGrid) et shader (uMinExponent) — à cette décade, et on y
    // arrête aussi le zoom caméra (cf. camera.lowerRadiusLimit plus bas) plutôt que de laisser
    // l'utilisateur zoomer sur une grille devenue incohérente.
    const GRID_MIN_STEP_EXPONENT = -6; // 0,000001 mm
    // Demi-taille du plan en multiples du rayon caméra (cf. recenterGridGround). Surtout pas
    // démesurée : un plan de milliers de rayons produisait des triangles immenses que le GPU
    // redécoupe contre le cadre de la caméra, et l'interpolation par pixel se faussait le long de
    // la diagonale du carré — d'où un grand losange de traits clairs pile à l'azimut 45° (celui
    // du démarrage), qui disparaissait dès qu'on orbitait. 60 rayons couvrent largement le sol
    // visible en vue plongeante ; au-delà, le fondu de bord (cf. shader) masque la limite.
    const GRID_GROUND_RADIUS_FACTOR = 60;
    // Carré unité (±1), subdivisé pour garder des triangles de taille modeste ; sa taille réelle
    // est fixée à chaque frame par `scaling`.
    const modelingGridGround = BABYLON.MeshBuilder.CreateGround(
      "modelingGridGround", { width: 2, height: 2, subdivisions: 16 }, scene,
    );
    // Taille et position changent à chaque frame : on ne laisse pas Babylon l'écarter sur une
    // boîte englobante périmée.
    modelingGridGround.alwaysSelectAsActiveMesh = true;
    const modelingGridMat = new BABYLON.ShaderMaterial(
      "modelingGridMat", scene, { vertex: "modelingGrid", fragment: "modelingGrid" },
      {
        attributes: ["position"],
        uniforms: [
          "worldViewProjection", "uMinorColor", "uMajorColor", "uMinorAlpha", "uMajorAlpha", "uMinPx", "uMinExponent",
          "uScale", "uOffset",
        ],
      },
    );
    modelingGridMat.setColor3("uMinorColor", new BABYLON.Color3(0.6, 0.65, 0.72));
    modelingGridMat.setColor3("uMajorColor", new BABYLON.Color3(0.9, 0.94, 1.0));
    modelingGridMat.setFloat("uMinorAlpha", 0.2);
    modelingGridMat.setFloat("uMajorAlpha", 0.75);
    modelingGridMat.setFloat("uMinPx", GRID_MIN_PX);
    modelingGridMat.setFloat("uMinExponent", GRID_MIN_STEP_EXPONENT);
    modelingGridMat.alpha = 0.999; // active le blend alpha ; la valeur réelle vient du shader
    modelingGridMat.backFaceCulling = false;
    modelingGridMat.needDepthPrePass = false;
    modelingGridGround.material = modelingGridMat;
    modelingGridGround.isPickable = false;
    modelingGridGround.setEnabled(false);

    /**
     * Chiffres de mesure le long des axes X/Z, à chaque graduation majeure — de petits panneaux
     * texturés (`DynamicTexture`) plutôt qu'un module GUI, qui n'est pas une dépendance du
     * projet. Ils sont couchés DANS le plan du sol et orientés le long de leur axe (comme la
     * règle d'un plan CAO), pas en billboard : le chiffre reste ainsi visuellement attaché à sa
     * graduation quel que soit l'angle de caméra. Une même valeur apparaît 4 fois (±X, ±Z) :
     * texture et matériau sont mutualisés par texte pour ne pas en créer 4 copies.
     */
    const gridLabelMatCache = new Map<string, BABYLON.StandardMaterial>();
    // Oxanium est servie depuis /public/fonts, mais reste chargée de façon asynchrone : si elle
    // n'est pas prête au premier dessin, le canvas retombe silencieusement sur sans-serif. On
    // garde les textures pour les redessiner une fois la police disponible.
    const gridLabelTextures = new Map<string, BABYLON.DynamicTexture>();
    // Dessin par le contexte canvas plutôt que `drawText` : celui-ci gère mal un fond
    // transparent (il peint un rectangle au lieu d'effacer) et son dernier paramètre `update`
    // conditionne le réupload GPU. Ici on efface vraiment, et on force l'upload.
    const drawGridLabel = (texture: BABYLON.DynamicTexture, text: string) => {
      const ctx = texture.getContext() as CanvasRenderingContext2D;
      const { width, height } = texture.getSize();
      ctx.clearRect(0, 0, width, height);
      ctx.font = '600 40px Oxanium, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, width / 2, height / 2);
      texture.update(true); // `invertY` compense le retournement induit par le plan couché
    };
    // Largeur de texture adaptée au texte (hauteur fixe 64) : à 128 px fixes, les longs nombres
    // (« -0.0007 ») étaient tronqués. Le rapport largeur/hauteur est gardé pour que
    // `layoutGridLabels` donne au panneau les mêmes proportions que sa texture.
    const GRID_LABEL_TEX_HEIGHT = 64;
    const gridLabelAspect = new Map<string, number>();
    const measureGridLabel = (text: string) => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return 128;
      ctx.font = '600 40px Oxanium, sans-serif';
      // Marge pour la police définitive (Oxanium, chargée en différé) un peu plus large que le
      // repli sans-serif mesuré ici au premier affichage.
      return Math.ceil(ctx.measureText(text).width * 1.15 + 16);
    };
    const getGridLabelMaterial = (text: string): BABYLON.StandardMaterial => {
      const cached = gridLabelMatCache.get(text);
      if (cached) return cached;
      const texWidth = Math.max(64, measureGridLabel(text));
      gridLabelAspect.set(text, texWidth / GRID_LABEL_TEX_HEIGHT);
      const texture = new BABYLON.DynamicTexture(
        `gridTickTex_${text}`, { width: texWidth, height: GRID_LABEL_TEX_HEIGHT }, scene, true,
      );
      texture.hasAlpha = true;
      drawGridLabel(texture, text);
      gridLabelTextures.set(text, texture);
      const mat = new BABYLON.StandardMaterial(`gridTickMat_${text}`, scene);
      // `hasAlpha` sur la diffuse suffit à découper le texte. Réutiliser la même texture en
      // `opacityTexture` multiplierait l'alpha par lui-même et, ce canal n'étant pas configuré
      // via `getAlphaFromRGB`, rendait les étiquettes entièrement invisibles.
      mat.diffuseTexture = texture;
      mat.emissiveTexture = texture;
      mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
      mat.useAlphaFromDiffuseTexture = true;
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      gridLabelMatCache.set(text, mat);
      return mat;
    };

    // Une étiquette par graduation : on mémorise son rang `tileValue` (± 1…GRID_TILE_EXTENT) et
    // son axe ; sa position monde vaut rang × pas courant `S`. Taille et visibilité sont
    // recalculées à chaque frame par `layoutGridLabels`.
    interface GridLabel {
      mesh: BABYLON.Mesh; tileValue: number; axis: 'x' | 'z';
      aspect: number; // largeur / hauteur de la texture du texte affiché
    }
    const modelingGridLabels: GridLabel[] = [];
    const GRID_LABEL_WIDTH = 0.8;
    const GRID_LABEL_HEIGHT = 0.4;
    const makeGridTickLabel = (tileValue: number, axis: 'x' | 'z') => {
      const label = BABYLON.MeshBuilder.CreatePlane(
        // Proportions de la texture (128 × 64) ; la taille réelle est fixée par `layoutGridLabels`.
        `gridTick_${axis}_${tileValue}`, { width: GRID_LABEL_WIDTH, height: GRID_LABEL_HEIGHT }, scene,
      );
      // Face à la caméra : couché au sol, le chiffre était écrasé par l'angle de vue et devenait
      // illisible en vue rasante, même à taille constante. Il reste ancré à sa graduation.
      label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      label.isPickable = false;
      label.renderingGroupId = 1; // par-dessus les lignes de grille
      label.setEnabled(false);
      modelingGridLabels.push({
        mesh: label, tileValue, axis, aspect: GRID_LABEL_WIDTH / GRID_LABEL_HEIGHT,
      });
    };
    // Une étiquette par unité de tuile (et non toutes les 10) : avec un pas `S` de 10 mm, la
    // graduation tombe ainsi tous les 10 mm. Les matériaux étant mutualisés par texte, ces
    // quelques centaines de plans ne coûtent qu'une poignée de textures.
    for (let k = 1; k <= GRID_TILE_EXTENT; k += 1) {
      makeGridTickLabel(k, 'x');
      makeGridTickLabel(-k, 'x');
      makeGridTickLabel(k, 'z');
      makeGridTickLabel(-k, 'z');
    }

    void document.fonts?.load('600 40px Oxanium').then(() => {
      if (scene.isDisposed) return;
      gridLabelTextures.forEach((texture, text) => drawGridLabel(texture, text));
    }).catch(() => { /* police indisponible : le repli sans-serif déjà dessiné reste lisible */ });

    const modelingGridMeshes = [modelingGridGround, modelingGridAxisX, modelingGridAxisZ];
    const modelingGrid = [...modelingGridMeshes, ...modelingGridLabels.map((l) => l.mesh)];

    // Formate une graduation sans zéros parasites (250, 25, 2.5, 0.25 …).
    const formatGridValue = (v: number) => String(Number(v.toPrecision(6)));

    /**
     * Pas `S` des axes colorés et de leurs graduations chiffrées : on le veut compris entre
     * `GRID_MIN_PX` et 10×`GRID_MIN_PX` pixels à l'écran AU NIVEAU DE LA CIBLE — même seuil que
     * `uMinPx` dans le shader du quadrillage, pour que les nombres affichés restent cohérents
     * avec ce qu'on voit près du centre de l'écran (le quadrillage lui-même, lui, s'affine en
     * continu vers la caméra : cf. le commentaire sur `modelingGridGround` plus haut).
     */
    // Demi-étendue visée à l'entrée du mode modélisation, en mm : cadre une dizaine de
    // graduations de part et d'autre de l'origine, le pas restant à 10 mm.
    const GRID_DEFAULT_HALF_EXTENT_MM = 90;
    let gridStepScale = 0; // 0 = jamais appliqué, force le premier passage
    const updateGrid = (worldPerPixel: number) => {
      const l = Math.log10(GRID_MIN_PX * worldPerPixel);
      const exponent = Math.max(Math.ceil(l), GRID_MIN_STEP_EXPONENT);
      const step = Math.pow(10, exponent);
      if (step === gridStepScale) return;
      gridStepScale = step;

      modelingGridAxisX.scaling.setAll(step);
      modelingGridAxisZ.scaling.setAll(step);
      modelingGridLabels.forEach((label) => {
        const text = formatGridValue(label.tileValue * step);
        label.mesh.material = getGridLabelMaterial(text);
        label.aspect = gridLabelAspect.get(text) ?? GRID_LABEL_WIDTH / GRID_LABEL_HEIGHT;
      });
    };

    /**
     * Chiffres de taille CONSTANTE à l'écran. Dimensionnés en unités monde, ils rétrécissaient
     * avec la distance jusqu'à devenir du micro-texte au loin. On les met donc à l'échelle, à
     * chaque frame, de la taille monde d'un pixel à LEUR distance de la caméra. Des chiffres de
     * taille fixe se chevaucheraient là où les graduations se resserrent à l'écran (au loin, ou
     * sur un axe qui file vers l'horizon) : on n'y garde qu'une graduation sur 2, 10, 20… (valeurs
     * rondes), selon l'espacement réellement disponible à cet endroit.
     */
    const GRID_LABEL_PLANE_PX = 22; // hauteur du panneau à l'écran (glyphe ≈ 60 % de celle-ci)
    const GRID_LABEL_GAP_PX = 6; // marge entre deux chiffres, et entre un chiffre et son axe
    // Suite emboîtée (chaque pas divise le suivant) : une graduation affichée de loin le reste de
    // près, sans suites irrégulières (30, 35, 38, 40…) aux changements de pas. Même rythme que la
    // grille : division par 5 (×2) puis par 10.
    const GRID_LABEL_DECIMATIONS = [1, 2, 10, 20, 100];
    const labelAxisPoint = new BABYLON.Vector3();
    const labelNextPoint = new BABYLON.Vector3();
    const labelToCamera = new BABYLON.Vector3();
    const labelScreen = new BABYLON.Vector3();
    const labelNextScreen = new BABYLON.Vector3();
    const layoutGridLabels = () => {
      const step = gridStepScale;
      if (step <= 0) return;
      const renderW = engine.getRenderWidth();
      const renderH = engine.getRenderHeight();
      const pixelsPerWorldAtUnitDistance = renderH / (2 * Math.tan(camera.fov / 2));
      const camPos = camera.globalPosition;
      const transform = scene.getTransformMatrix();
      const viewport = camera.viewport.toGlobal(renderW, renderH);
      const identity = BABYLON.Matrix.IdentityReadOnly;
      const planeH = GRID_LABEL_PLANE_PX;
      // Écart à l'écran (px) entre les graduations de rang `rank` et `rank + 1` d'un axe, mis en
      // cache par frame : chaque bloc le demande pour ses deux bornes.
      const spacingCache = new Map<string, number>();
      const spacingPxAt = (axis: 'x' | 'z', rank: number) => {
        const key = `${axis}${rank}`;
        const cached = spacingCache.get(key);
        if (cached !== undefined) return cached;
        const a = rank * step;
        const b = (rank + 1) * step;
        labelAxisPoint.set(axis === 'x' ? a : 0, 0, axis === 'z' ? a : 0);
        labelNextPoint.set(axis === 'x' ? b : 0, 0, axis === 'z' ? b : 0);
        BABYLON.Vector3.ProjectToRef(labelAxisPoint, identity, transform, viewport, labelScreen);
        BABYLON.Vector3.ProjectToRef(labelNextPoint, identity, transform, viewport, labelNextScreen);
        const px = Math.hypot(labelNextScreen.x - labelScreen.x, labelNextScreen.y - labelScreen.y);
        spacingCache.set(key, px);
        return px;
      };
      modelingGridLabels.forEach(({ mesh, tileValue, axis, aspect }) => {
        const planeW = planeH * aspect;
        const along = tileValue * step;
        labelAxisPoint.set(axis === 'x' ? along : 0, 0, axis === 'z' ? along : 0);
        camPos.subtractToRef(labelAxisPoint, labelToCamera);
        const distance = labelToCamera.length();
        if (distance <= 0) { mesh.isVisible = false; return; }
        const worldPerPixel = distance / pixelsPerWorldAtUnitDistance;
        // Écart RÉEL à l'écran avec la graduation suivante (vers l'extérieur), perspective
        // comprise : un axe qui file vers l'horizon resserre ses graduations bien plus vite que
        // ne le dit la seule distance.
        const next = along + Math.sign(tileValue) * step;
        labelNextPoint.set(axis === 'x' ? next : 0, 0, axis === 'z' ? next : 0);
        BABYLON.Vector3.ProjectToRef(labelAxisPoint, identity, transform, viewport, labelScreen);
        BABYLON.Vector3.ProjectToRef(labelNextPoint, identity, transform, viewport, labelNextScreen);
        const dx = labelNextScreen.x - labelScreen.x;
        const dy = labelNextScreen.y - labelScreen.y;
        const spacingPx = Math.hypot(dx, dy);
        // Place qu'occupe un chiffre (boîte W × H face caméra) dans la direction de l'axe à
        // l'écran ; le glyphe n'occupe qu'une partie du panneau.
        const footprintPx = spacingPx > 1e-6
          ? (Math.abs(dx) * planeW + Math.abs(dy) * planeH) / spacingPx
          : planeW;
        const needed = footprintPx * 0.6 + GRID_LABEL_GAP_PX;
        // Pas choisi PAR BLOC, pas par étiquette : un bloc (de la taille du pas suivant) garde un
        // pas uniforme, décidé sur sa graduation la plus serrée (l'une de ses deux bornes, l'écart
        // variant de façon monotone le long de l'axe). Sinon un bloc se remplissait à moitié à la
        // transition, d'où des suites comme 30, 38, 40.
        let decimation: number | undefined;
        for (let i = 0; i < GRID_LABEL_DECIMATIONS.length; i++) {
          const d = GRID_LABEL_DECIMATIONS[i];
          const blockSize = GRID_LABEL_DECIMATIONS[i + 1] ?? d * 10;
          const lo = Math.floor(tileValue / blockSize) * blockSize;
          const tightest = Math.min(spacingPxAt(axis, lo), spacingPxAt(axis, lo + blockSize - 1));
          if (d * tightest >= needed) { decimation = d; break; }
        }
        const visible = decimation !== undefined && Math.abs(tileValue) % decimation === 0;
        mesh.isVisible = visible;
        if (!visible) return;
        const scaleY = (planeH * worldPerPixel) / GRID_LABEL_HEIGHT;
        // Le panneau de base a le rapport GRID_LABEL_WIDTH / GRID_LABEL_HEIGHT : on l'étire en X
        // pour épouser celui de la texture du texte, sans le déformer.
        mesh.scaling.set(scaleY * aspect / (GRID_LABEL_WIDTH / GRID_LABEL_HEIGHT), scaleY, scaleY);
        // Décalé perpendiculairement à l'axe (dans le sol), juste assez pour ne pas le recouvrir.
        const offset = (planeH * 0.9 + GRID_LABEL_GAP_PX) * worldPerPixel;
        mesh.position.set(axis === 'x' ? along : offset, 0, axis === 'z' ? along : offset);
      });
    };

    /**
     * Place le plan du quadrillage et fixe l'origine de son motif.
     *
     * Deux rôles, découplés :
     *  - le PLAN (géométrie) est recentré sur la cible et mis à l'échelle du rayon caméra à
     *    chaque frame, pour couvrir le sol visible avec des sommets toujours proches du champ
     *    (précision d'interpolation, cf. le vertex shader) ;
     *  - le MOTIF est calculé relativement à une ANCRE (`gridAnchorX/Z`), qui ne bouge que
     *    rarement, par sauts multiples exacts d'une puissance de dix bien plus grande que tout
     *    pas affiché : translater le motif d'un multiple exact de son pas ne déplace aucun
     *    trait. `uOffset` = cible − ancre, calculé ici en double précision, reste petit — c'est
     *    lui (et non une position monde absolue) qui entre dans le shader.
     */
    let gridAnchorX = 0;
    let gridAnchorZ = 0;
    // Nombre de pas centraux que la cible peut parcourir avant ré-ancrage : grand pour que ce
    // soit rare, borné pour que `uOffset / pas` reste bien dans la précision float32.
    const GRID_RECENTER_MARGIN_STEPS = 200;
    // Période d'ancrage : 5 décades au-dessus du pas central, pour couvrir les pixels lointains
    // qui, en perspective, affichent localement un pas bien plus grossier (cf. shader).
    const GRID_ANCHOR_PERIOD_STEPS = 100000;
    const recenterGridGround = () => {
      const step = Math.max(gridStepScale, Math.pow(10, GRID_MIN_STEP_EXPONENT));
      const margin = GRID_RECENTER_MARGIN_STEPS * step;
      if (Math.abs(camera.target.x - gridAnchorX) > margin || Math.abs(camera.target.z - gridAnchorZ) > margin) {
        const period = step * GRID_ANCHOR_PERIOD_STEPS;
        gridAnchorX = Math.round(camera.target.x / period) * period;
        gridAnchorZ = Math.round(camera.target.z / period) * period;
      }
      const scale = camera.radius * GRID_GROUND_RADIUS_FACTOR;
      modelingGridGround.position.set(camera.target.x, 0, camera.target.z);
      modelingGridGround.scaling.set(scale, 1, scale);
      modelingGridMat.setFloat("uScale", scale);
      modelingGridMat.setVector2(
        "uOffset", new BABYLON.Vector2(camera.target.x - gridAnchorX, camera.target.z - gridAnchorZ),
      );
    };

    // Empêche de « passer au travers » du plan de travail en zoomant : au lieu de traverser,
    // la grille se subdivise et la caméra reste à distance de sa cible — jusqu'à ce que le pas
    // touche `GRID_MIN_STEP_EXPONENT` (cf. plus haut), où la caméra s'arrête tout à fait plutôt
    // que de continuer sur une grille devenue incohérente en simple précision. Inverse exact de
    // `worldPerPixel = 2·radius·tan(fov/2) / hauteur` pour le `worldPerPixel` qui fait tout juste
    // atteindre ce pas plancher.
    const minWorldPerPixel = Math.pow(10, GRID_MIN_STEP_EXPONENT) / GRID_MIN_PX;
    camera.lowerRadiusLimit = (minWorldPerPixel * engine.getRenderHeight()) / (2 * Math.tan(camera.fov / 2));
    camera.upperRadiusLimit = 100000;
    // Plan de clipping proche d'origine (0,1 par défaut), restauré en quittant la modélisation.
    // En modélisation il suit le rayon (cf. gridZoomObserver) : fixe, il coupait toute la scène
    // une fois la caméra plus proche que lui ; fixé au plus petit rayon possible, il ruinait la
    // précision du tampon de profondeur au zoom normal (rapport far/near démesuré).
    const DEFAULT_CAMERA_MIN_Z = camera.minZ;
    let gridZoomLimitReached = false;

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
    let lastScaleBarPx = 0;
    const gridZoomObserver = scene.onBeforeRenderObservable.add(() => {
      if (!modelingActive) return;

      // Le panoramique par défaut de l'ArcRotateCamera déplace la cible le long des axes écran
      // de la caméra, pas dans le plan du sol : à chaque glisser elle dérive donc un peu hors du
      // plan y=0 où vit la grille. Une fois bien zoomé (rayon petit), cette dérive verticale
      // dépasse le rayon caméra et la grille sort du champ. On recloue la cible au sol à chaque
      // image, comme le ferait un vrai outil CAO — seuls x/z restent libres au panoramique.
      if (camera.target.y !== 0) camera.target.y = 0;
      // Plan proche proportionnel au rayon : jamais devant ce qu'on regarde, et un rapport
      // far/near qui reste raisonnable pour le tampon de profondeur (cf. DEFAULT_CAMERA_MIN_Z).
      camera.minZ = camera.radius / 1000;

      // Signale une seule fois l'arrivée au plancher de zoom (`camera.lowerRadiusLimit`, déjà
      // appliqué par Babylon) plutôt qu'à chaque frame passée collé dessus ; le drapeau se relève
      // dès qu'on redézoome un peu, pour pouvoir re-déclencher le message la prochaine fois.
      if (camera.radius <= camera.lowerRadiusLimit * 1.001) {
        if (!gridZoomLimitReached) {
          gridZoomLimitReached = true;
          showWarning(`Zoom maximal atteint (pas de grille : ${formatGridValue(Math.pow(10, GRID_MIN_STEP_EXPONENT))} mm)`);
        }
      } else if (camera.radius > camera.lowerRadiusLimit * 1.05) {
        gridZoomLimitReached = false;
      }

      const worldPerPixel = (2 * camera.radius * Math.tan(camera.fov / 2)) / engine.getRenderHeight();
      if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0) return;

      updateGrid(worldPerPixel);
      recenterGridGround();
      layoutGridLabels();

      const length = niceLength(SCALE_BAR_TARGET_PX * worldPerPixel);
      const label = formatDistance(length);
      const px = Math.round(length / worldPerPixel);
      // Suivre `px` et pas seulement le libellé : entre deux changements d'unité la largeur
      // varie continûment avec le zoom, et ne la réappliquer qu'au changement de libellé
      // laisserait la barre figée alors que la distance qu'elle représente a bougé.
      if (label !== lastScaleBarLabel || px !== lastScaleBarPx) {
        lastScaleBarLabel = label;
        lastScaleBarPx = px;
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
      // Sans ça, le quadrillage de fond (backdrop) restait visible sous la grille graduée
      // d'esquisse et les deux se superposaient (lignes doubles) en mode Modélisation.
      backdrop.setEnabled(!modeling);
      // Entrer en modélisation sur un cadrage fixe plutôt que d'hériter du zoom du slicer, qui
      // donnerait une graduation arbitraire et pouvait laisser les étiquettes hors champ.
      // `radius = demi-étendue / tan(fov/2)` est l'inverse exact de la demi-hauteur visible à
      // la distance de la cible ; le pas de 10 mm en découle via `updateGrid`.
      if (modeling) {
        // La cible héritée du slicer est à mi-hauteur du volume d'impression ; la grille, elle,
        // est au sol. Sans ce recentrage le cadrage viserait au-dessus du plan de travail.
        camera.setTarget(BABYLON.Vector3.Zero());
        resetLensShift();
        camera.radius = GRID_DEFAULT_HALF_EXTENT_MM / Math.tan(camera.fov / 2);
        // Vue de trois quarts plongeante : à beta rasant la grille est vue par la tranche et
        // les étiquettes, couchées dans son plan, deviennent illisibles.
        camera.beta = Math.min(camera.beta, 0.9);
        const worldPerPixel = (2 * camera.radius * Math.tan(camera.fov / 2)) / engine.getRenderHeight();
        // `gridStepScale` survit à la sortie du mode : sans cette remise à zéro, rentrer à
        // nouveau sur le même pas ferait sortir `updateGrid` par son court-circuit et les
        // étiquettes resteraient sans matériau ni position, donc invisibles.
        gridStepScale = 0;
        updateGrid(worldPerPixel);
        // Reforce le recalcul même si l'ancre précédente couvrait déjà l'origine (marge oblige) :
        // une session antérieure a pu la laisser loin du centre.
        gridAnchorX = Number.POSITIVE_INFINITY;
        gridAnchorZ = Number.POSITIVE_INFINITY;
        recenterGridGround();
      }
      modelingGrid.forEach((g) => g.setEnabled(modeling));

      if (!modeling) {
        lastScaleBarLabel = '';
        lastScaleBarPx = 0;
        setScaleBar(null);
        gridZoomLimitReached = false;
        camera.minZ = DEFAULT_CAMERA_MIN_Z;
      }

      if (modeling) {
        gizmoManager.positionGizmoEnabled = false;
        gizmoManager.rotationGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = false;
        gizmoManager.attachToMesh(null);
      }
    };
    window.addEventListener('apex-mode-changed', onModeChanged);

    // En Préparation, l'orbite tourne autour du centre du plateau et non de la cible, que le pan
    // et le zoom vers le curseur déplacent. Babylon tourne la caméra autour de la cible ; on
    // applique ensuite la même rotation à la cible autour du pivot, ce qui revient à tourner
    // tout le point de vue autour du pivot. Seuls les changements d'alpha/beta faits par les
    // entrées (souris, clavier, inertie) sont concernés : les vues programmées (ViewCube,
    // recadrage) posent leur propre cible.
    const SLICER_ORBIT_PIVOT = BABYLON.Vector3.Zero();
    const orbitBasis = (alpha: number, beta: number) => {
      const d = new BABYLON.Vector3(Math.cos(alpha) * Math.sin(beta), Math.cos(beta), Math.sin(alpha) * Math.sin(beta));
      const e = new BABYLON.Vector3(-Math.sin(alpha), 0, Math.cos(alpha));
      return [d, e, BABYLON.Vector3.Cross(d, e)] as const;
    };
    const originalCheckInputs = camera._checkInputs.bind(camera);
    camera._checkInputs = () => {
      const alpha0 = camera.alpha;
      const beta0 = camera.beta;
      originalCheckInputs();
      if (modelingActive || (camera.alpha === alpha0 && camera.beta === beta0)) return;
      const [d0, e0, u0] = orbitBasis(alpha0, beta0);
      const [d1, e1, u1] = orbitBasis(camera.alpha, camera.beta);
      const v = camera.target.subtract(SLICER_ORBIT_PIVOT);
      const rotated = d1.scale(BABYLON.Vector3.Dot(v, d0))
        .addInPlace(e1.scale(BABYLON.Vector3.Dot(v, e0)))
        .addInPlace(u1.scale(BABYLON.Vector3.Dot(v, u0)));
      camera.target.copyFrom(rotated.addInPlace(SLICER_ORBIT_PIVOT));
    };

    // Rangée de boutons d'action couchée à plat autour du bord du plateau (mode Préparation) :
    // de vrais maillages de la scène, qui suivent donc la perspective, l'orbite et le zoom comme
    // le plateau lui-même. Chaque bouton est un secteur d'anneau ; les extrémités de la rangée
    // sont arrondies. Survol et clic passent par le picking Babylon.
    const PLATE_ACTION_INNER_R = RADIUS + 6; // mm : léger jour entre le plateau et la rangée
    const PLATE_ACTION_WIDTH = 20; // mm, dans le sens radial
    const PLATE_ACTION_SPAN_DEG = 15; // étendue angulaire d'un bouton
    const PLATE_ACTION_SPACING_DEG = 1.2;
    // Milieu de la rangée, en angle monde (atan2(z, x)) : à l'avant gauche du plateau dans la
    // vue par défaut (caméra à alpha = π/4).
    const PLATE_ACTION_CENTER_DEG = -35;
    const PLATE_ACTION_Y = 0.3;
    const PLATE_ACTION_ICON_MM = 12;
    const plateActions = [
      { icon: Upload, title: 'Importer un modèle', description: 'Ajoutez un fichier STL, GLB ou GLTF sur le plateau.' },
      { icon: BoxSelect, title: 'Tout sélectionner', description: 'Sélectionnez tous les modèles présents sur le plateau.' },
      { icon: LayoutGrid, title: 'Disposer automatiquement', description: 'Réorganisez les modèles au plus près du centre du plateau, sans chevauchement.' },
      { icon: Trash2, title: 'Tout supprimer', description: 'Retirez tous les modèles du plateau.' },
    ];
    // Même verre dépoli que le plateau, sans teinte : le shader `glassDisc` échantillonne `blurRT`
    // en coordonnées écran, il s'applique donc tel quel à n'importe quelle forme. Au survol, le
    // verre s'éclaircit légèrement vers le blanc (toujours sans couleur) et le contour s'affirme.
    BABYLON.Effect.ShadersStore["plateActionGlassHoverFragmentShader"] = `
      precision highp float;
      varying vec4 vClip;
      uniform sampler2D blurTex;
      void main(void) {
        vec2 uv = (vClip.xy / vClip.w) * 0.5 + 0.5;
        vec3 color = mix(texture2D(blurTex, uv).rgb, vec3(1.0), 0.12);
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    const plateActionHoverMat = new BABYLON.ShaderMaterial("plateActionGlassHoverMat", scene, { vertex: "glassDisc", fragment: "plateActionGlassHover" }, {
      attributes: ["position"],
      uniforms: ["worldViewProjection"],
      samplers: ["blurTex"],
    });
    plateActionHoverMat.setTexture("blurTex", blurRT);
    plateActionHoverMat.backFaceCulling = false;

    const plateActionRoot = new BABYLON.TransformNode('plateActionRoot', scene);
    plateActionRoot.position.y = HEIGHT * 0.5;
    // Contours des boutons du plateau : presque blancs au repos, blanc franc au survol.
    // Un ruban GreasedLine n'a pas de jointure : à un angle vif (coins des boutons) les deux
    // tronçons se décalent en un cran visible. On arrondit donc chaque coin franc du contour
    // (courbe de Bézier quadratique de rayon `radius`, mm) ; les points d'arc dense ne bougent pas.
    const roundClosedCorners = (pts: BABYLON.Vector3[], radius: number): BABYLON.Vector3[] => {
      const n = pts.length;
      const out: BABYLON.Vector3[] = [];
      for (let i = 0; i < n; i++) {
        const prev = pts[(i + n - 1) % n], cur = pts[i], next = pts[(i + 1) % n];
        const a = prev.subtract(cur), b = next.subtract(cur);
        const la = a.length(), lb = b.length();
        const cos = BABYLON.Vector3.Dot(a, b) / Math.max(1e-9, la * lb);
        // Angle intérieur > ~150° (quasi droit/arc dense) : on laisse tel quel.
        if (cos < -0.866) { out.push(cur); continue; }
        const r = Math.min(radius, la * 0.45, lb * 0.45);
        const p0 = cur.add(a.scale(r / la)), p1 = cur.add(b.scale(r / lb));
        for (let j = 0; j <= 8; j++) {
          const t = j / 8, u = 1 - t;
          out.push(p0.scale(u * u).addInPlace(cur.scale(2 * u * t)).addInPlace(p1.scale(t * t)));
        }
      }
      out.push(out[0]);
      return out;
    };

    const PLATE_ACTION_OUTLINE_ALPHA = 0.85;
    const plateActionButtons: { mesh: BABYLON.Mesh; outline: BABYLON.Mesh; iconMat: BABYLON.StandardMaterial }[] = [];
    const rowSpan = plateActions.length * PLATE_ACTION_SPAN_DEG + (plateActions.length - 1) * PLATE_ACTION_SPACING_DEG;
    const midR = PLATE_ACTION_INNER_R + PLATE_ACTION_WIDTH / 2;
    const capR = PLATE_ACTION_WIDTH / 2;
    const polar = (r: number, theta: number) => new BABYLON.Vector3(r * Math.cos(theta), PLATE_ACTION_Y, r * Math.sin(theta));

    plateActions.forEach((action, k) => {
      const first = k === 0;
      const last = k === plateActions.length - 1;
      const startDeg = PLATE_ACTION_CENTER_DEG - rowSpan / 2 + k * (PLATE_ACTION_SPAN_DEG + PLATE_ACTION_SPACING_DEG);
      // Les demi-cercles d'extrémité prennent sur la longueur du bouton, pour que tous les
      // boutons gardent la même taille apparente.
      const capDeg = (capR / midR) * (180 / Math.PI);
      const t0 = ((startDeg + (first ? capDeg : 0)) * Math.PI) / 180;
      const t1 = ((startDeg + PLATE_ACTION_SPAN_DEG - (last ? capDeg : 0)) * Math.PI) / 180;

      // Contour fermé (bord intérieur → cap de fin → bord extérieur à rebours → cap de début),
      // triangulé en éventail depuis le centre du bouton : le secteur est assez peu courbé
      // pour rester étoilé par rapport à ce centre.
      const STEPS = 48;
      const CAP_STEPS = 24;
      const contour: BABYLON.Vector3[] = [];
      for (let j = 0; j <= STEPS; j++) contour.push(polar(PLATE_ACTION_INNER_R, t0 + ((t1 - t0) * j) / STEPS));
      const cap = (theta: number, dir: 1 | -1, fromInner: boolean) => {
        const c = polar(midR, theta);
        const radial = new BABYLON.Vector3(Math.cos(theta), 0, Math.sin(theta));
        const tangent = new BABYLON.Vector3(-Math.sin(theta), 0, Math.cos(theta)).scale(dir);
        for (let j = 1; j < CAP_STEPS; j++) {
          const psi = (Math.PI * j) / CAP_STEPS;
          const toward = radial.scale((fromInner ? -1 : 1) * Math.cos(psi) * capR).addInPlace(tangent.scale(Math.sin(psi) * capR));
          contour.push(c.add(toward));
        }
      };
      if (last) cap(t1, 1, true);
      for (let j = STEPS; j >= 0; j--) contour.push(polar(PLATE_ACTION_INNER_R + PLATE_ACTION_WIDTH, t0 + ((t1 - t0) * j) / STEPS));
      if (first) cap(t0, -1, false);

      const tMid = (t0 + t1) / 2 + (first ? -capDeg / 2 : last ? capDeg / 2 : 0) * (Math.PI / 180);
      const center = polar(midR, tMid);
      const positions: number[] = [center.x, center.y, center.z];
      contour.forEach((p) => positions.push(p.x, p.y, p.z));
      const indices: number[] = [];
      for (let j = 0; j < contour.length; j++) indices.push(0, 1 + j, 1 + ((j + 1) % contour.length));
      const normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
      const mesh = new BABYLON.Mesh(`plateAction${k}`, scene);
      const vd = new BABYLON.VertexData();
      vd.positions = positions;
      vd.indices = indices;
      vd.normals = normals;
      vd.applyToMesh(mesh);
      mesh.parent = plateActionRoot;

      mesh.material = glassDiscMat;

      const outline = makeScreenLine(
        `plateActionOutline${k}`,
        roundClosedCorners(contour, 1.2).map((p) => p.add(new BABYLON.Vector3(0, 0.05, 0))),
        new BABYLON.Color3(1, 1, 1),
        PLATE_ACTION_OUTLINE_ALPHA,
        1.4,
      );
      outline.parent = plateActionRoot;

      // Icône couchée sur le bouton, orientation fixe : son haut suit la tangente de l'arc (sens
      // des θ décroissants), ce qui la garde droite à l'écran dans la vue par défaut tout en
      // l'inclinant légèrement avec la courbure du plateau. Le haut de la texture d'un
      // `CreateGround` est du côté +Z local, d'où le +π.
      const icon = BABYLON.MeshBuilder.CreateGround(`plateActionIcon${k}`, { width: PLATE_ACTION_ICON_MM, height: PLATE_ACTION_ICON_MM }, scene);
      icon.position = center.add(new BABYLON.Vector3(0, 0.1, 0));
      icon.rotation.y = Math.PI - tMid;
      icon.isPickable = false;
      icon.parent = plateActionRoot;
      const iconTex = new BABYLON.DynamicTexture(`plateActionIconTex${k}`, { width: 128, height: 128 }, scene, true);
      iconTex.hasAlpha = true;
      const iconMat = new BABYLON.StandardMaterial(`plateActionIconMat${k}`, scene);
      iconMat.diffuseTexture = iconTex;
      iconMat.useAlphaFromDiffuseTexture = true;
      iconMat.disableLighting = true;
      iconMat.emissiveColor = new BABYLON.Color3(0.9, 0.93, 1);
      iconMat.backFaceCulling = false;
      iconMat.alpha = 0.8;
      icon.material = iconMat;
      const svg = renderToStaticMarkup(React.createElement(action.icon, { size: 128, color: '#ffffff', strokeWidth: 2.4 }));
      const img = new Image();
      img.onload = () => {
        if (scene.isDisposed) return;
        const ctx = iconTex.getContext();
        ctx.clearRect(0, 0, 128, 128);
        ctx.drawImage(img, 12, 12, 104, 104);
        iconTex.update();
      };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

      plateActionButtons.push({ mesh, outline, iconMat });
    });

    let plateActionPreviewActive = false;
    const updatePlateActionVisibility = () => {
      plateActionRoot.setEnabled(!modelingActive && !plateActionPreviewActive);
    };
    updatePlateActionVisibility();
    const onPlateActionModeChanged = () => updatePlateActionVisibility();
    const onPlateActionPreviewToggled = (e: Event) => {
      plateActionPreviewActive = !!(e as CustomEvent<{ active: boolean }>).detail?.active;
      updatePlateActionVisibility();
    };
    // Enregistré après `onModeChanged` : `modelingActive` est donc déjà à jour ici.
    window.addEventListener('apex-mode-changed', onPlateActionModeChanged);
    window.addEventListener('apex-preview-toggled', onPlateActionPreviewToggled);

    // Espace Prévisualisation : trajectoire G-code polaire (cf. gcodeLayer.ts) posée sur le
    // plateau de cette même scène, pour garder exactement le décor de Préparation. Les modèles
    // de préparation sont masqués le temps de l'espace, sans être touchés. Le chargement de
    // fichier, la lecture et les réglages vivent dans GCodePreview, qui pilote ce calque.
    const gcodeAnchor = new BABYLON.TransformNode("gcodeAnchor", scene);
    gcodeAnchor.parent = volumeRoot;
    gcodeAnchor.position.y = glassDisc.position.y + 0.05; // Z = 0 du G-code : juste sur le disque
    let gcodePreviewActive = false;
    const gcodeLayer = createGCodeLayer(scene, gcodeAnchor, (rotationY) => {
      if (gcodePreviewActive) originAxesRoot.rotation.y = rotationY;
    });
    // Onglet Édition : nœud d'édition du G-code (cf. edit-node/gcodeEditController.ts).
    const editController = createGCodeEditController({
      scene, engine, camera, canvas, layer: gcodeLayer, isPreviewActive: () => gcodePreviewActive,
    });
    setEditController(editController);
    if (import.meta.env.DEV) (window as unknown as { __apexEdit?: GCodeEditController }).__apexEdit = editController;
    const onGCodePreviewToggled = (e: Event) => {
      const active = !!(e as CustomEvent<{ active: boolean }>).detail?.active;
      gcodePreviewActive = active;
      originAxesRoot.rotation.y = active ? gcodeLayer.getPlateRotation() : 0;
      gcodeLayer.setEnabled(active);
      modelsRef.current.forEach((m) => { if (!m.isDisposed()) m.setEnabled(!active); });
      editController.refresh();
    };
    const onGCodeLoaded = (e: Event) => {
      const detail = (e as CustomEvent<{ parsed: ParsedGCode; handled?: boolean; onBuilt?: () => void }>).detail;
      if (!detail?.parsed) return;
      // Maillage construit par tranches (UI non gelée) : on prévient l'émetteur à la fin pour que
      // le rideau de chargement reste affiché jusque-là.
      detail.handled = true;
      void gcodeLayer.load(detail.parsed).finally(() => {
        detail.onBuilt?.();
        editController.refresh();
      });
    };
    const onGCodeTime = (e: Event) => {
      const t = (e as CustomEvent<{ t: number }>).detail?.t;
      if (typeof t === 'number') gcodeLayer.setTime(t);
    };
    const onGCodeLineVisibility = (e: Event) => {
      const visibility = (e as CustomEvent<{ visibility: LineTypeVisibility }>).detail?.visibility;
      if (visibility) gcodeLayer.setLineTypeVisibility(visibility);
    };
    const onGCodeHighlightOffPlate = (e: Event) => {
      const detail = (e as CustomEvent<{ show: boolean; blinking?: boolean }>).detail;
      gcodeLayer.setOffPlateHighlight(!!detail?.show);
      gcodeLayer.setOffPlateBlinking(!!detail?.blinking);
    };
    const onGCodeShowFullHead = (e: Event) => {
      gcodeLayer.setFullHead(!!(e as CustomEvent<{ show: boolean }>).detail?.show);
    };
    const onGCodeColorBy = (e: Event) => {
      const detail = (e as CustomEvent<{ mode: ColorByMode; scope?: ColorByScope }>).detail;
      if (detail?.mode) gcodeLayer.setColorBy(detail.mode, detail.scope);
    };
    const onGCodeRenderPrecision = (e: Event) => {
      const mm = (e as CustomEvent<{ mm: number | null }>).detail?.mm;
      gcodeLayer.setRenderPrecision(mm ?? null);
    };
    // Sélection d'un point de trajectoire (`apex-gcode-pick-mode { active }`, cf. use-gcode-preview.ts) :
    // survol = point surligné sous le curseur ; clic (sans glisser, pour ne pas voler l'orbite de la
    // caméra) = `apex-gcode-point-picked { t }`, l'index de mouvement où la tête dépose ce point.
    let gcodePickMode = false;
    let gcodePickDown: { x: number; y: number } | null = null;
    const pickGCodePoint = () => {
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      const pxPerUnit = (2 * Math.tan(camera.fov / 2)) / Math.max(1, engine.getRenderHeight());
      return gcodeLayer.pickAt(ray, pxPerUnit);
    };
    const setGCodePickMode = (active: boolean) => {
      gcodePickMode = active;
      gcodePickDown = null;
      gcodeLayer.setPickingEnabled(active);
      if (!active) gcodeLayer.setPickHighlight(null);
      canvas.style.cursor = active ? 'crosshair' : '';
    };
    const onGCodePickMode = (e: Event) => setGCodePickMode(!!(e as CustomEvent<{ active: boolean }>).detail?.active);
    const gcodePickObserver = scene.onPointerObservable.add((pointerInfo) => {
      if (!gcodePickMode || !gcodePreviewActive) return;
      const evt = pointerInfo.event as PointerEvent;
      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        if (evt.buttons !== 0) { gcodeLayer.setPickHighlight(null); return; }
        gcodeLayer.setPickHighlight(pickGCodePoint()?.local ?? null);
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN && evt.button === 0) {
        gcodePickDown = { x: evt.clientX, y: evt.clientY };
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP && evt.button === 0) {
        const down = gcodePickDown;
        gcodePickDown = null;
        if (!down || Math.hypot(evt.clientX - down.x, evt.clientY - down.y) > 5) return;
        const hit = pickGCodePoint();
        if (hit) window.dispatchEvent(new CustomEvent('apex-gcode-point-picked', { detail: { t: hit.t } }));
      }
    });
    window.addEventListener('apex-gcode-pick-mode', onGCodePickMode);
    window.addEventListener('apex-preview-toggled', onGCodePreviewToggled);
    window.addEventListener('apex-gcode-loaded', onGCodeLoaded);
    window.addEventListener('apex-gcode-time', onGCodeTime);
    window.addEventListener('apex-gcode-line-visibility', onGCodeLineVisibility);
    window.addEventListener('apex-gcode-highlight-offplate', onGCodeHighlightOffPlate);
    window.addEventListener('apex-gcode-show-full-head', onGCodeShowFullHead);
    window.addEventListener('apex-gcode-color-by', onGCodeColorBy);
    window.addEventListener('apex-gcode-render-precision', onGCodeRenderPrecision);

    let plateActionHovered: number | null = null;
    let plateActionHintShown = false;
    const setPlateActionHovered = (index: number | null, clientX = 0, clientY = 0) => {
      if (index !== plateActionHovered) {
        if (plateActionHovered !== null) {
          const prev = plateActionButtons[plateActionHovered];
          prev.mesh.material = glassDiscMat;
          prev.outline.material!.alpha = PLATE_ACTION_OUTLINE_ALPHA;
          prev.iconMat.alpha = 0.8;
        }
        if (index !== null) {
          const next = plateActionButtons[index];
          next.mesh.material = plateActionHoverMat;
          next.outline.material!.alpha = 1;
          next.iconMat.alpha = 1;
          const action = plateActions[index];
          window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: { title: action.title, desc: action.description } }));
        } else {
          window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));
        }
        plateActionHovered = index;
        canvas.style.cursor = index !== null ? 'pointer' : '';
      }
      // L'étiquette suit le curseur tant qu'un bouton est survolé ; hors survol, on ne touche
      // plus à l'état React pour ne pas re-rendre à chaque mouvement de souris.
      if (index !== null) setPlateActionHint({ title: plateActions[index].title, x: clientX, y: clientY });
      else if (plateActionHintShown) setPlateActionHint(null);
      plateActionHintShown = index !== null;
    };
    const pickPlateAction = () => {
      if (!plateActionRoot.isEnabled()) return null;
      const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m.name.startsWith('plateAction') && m.isPickable);
      if (!pick?.hit || !pick.pickedMesh) return null;
      const index = plateActionButtons.findIndex((b) => b.mesh === pick.pickedMesh);
      return index >= 0 ? index : null;
    };
    const runPlateAction = (index: number) => {
      switch (index) {
        case 0: plateImportInputRef.current?.click(); break;
        case 1: window.dispatchEvent(new CustomEvent('apex-select-all-models')); break;
        case 2: window.dispatchEvent(new CustomEvent('apex-arrange-models')); break;
        case 3: window.dispatchEvent(new CustomEvent('apex-delete-all-models')); break;
      }
    };
    const PLATE_ACTION_CLICK_THRESHOLD_PX = 5;
    let plateActionDown: { index: number; x: number; y: number } | null = null;
    const plateActionPointerObserver = scene.onPointerObservable.add((pointerInfo) => {
      const evt = pointerInfo.event as PointerEvent;
      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        const index = evt.buttons === 0 ? pickPlateAction() : null;
        setPlateActionHovered(index, evt.clientX, evt.clientY);
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN && evt.button === 0) {
        const index = pickPlateAction();
        plateActionDown = index !== null ? { index, x: evt.clientX, y: evt.clientY } : null;
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP && evt.button === 0) {
        const down = plateActionDown;
        plateActionDown = null;
        if (!down || Math.hypot(evt.clientX - down.x, evt.clientY - down.y) > PLATE_ACTION_CLICK_THRESHOLD_PX) return;
        if (pickPlateAction() === down.index) runPlateAction(down.index);
      }
    });
    const disposePlateActions = () => {
      window.removeEventListener('apex-mode-changed', onPlateActionModeChanged);
      window.removeEventListener('apex-preview-toggled', onPlateActionPreviewToggled);
      scene.onPointerObservable.remove(plateActionPointerObserver);
      window.removeEventListener('apex-preview-toggled', onGCodePreviewToggled);
      window.removeEventListener('apex-gcode-loaded', onGCodeLoaded);
      window.removeEventListener('apex-gcode-pick-mode', onGCodePickMode);
      scene.onPointerObservable.remove(gcodePickObserver);
      canvas.style.cursor = '';
      window.removeEventListener('apex-gcode-time', onGCodeTime);
      window.removeEventListener('apex-gcode-line-visibility', onGCodeLineVisibility);
      window.removeEventListener('apex-gcode-highlight-offplate', onGCodeHighlightOffPlate);
      window.removeEventListener('apex-gcode-show-full-head', onGCodeShowFullHead);
      window.removeEventListener('apex-gcode-color-by', onGCodeColorBy);
      window.removeEventListener('apex-gcode-render-precision', onGCodeRenderPrecision);
      editController.dispose();
      setEditController(null);
      gcodeLayer.dispose();
    };

    // ---------------------------------------------------------------------------------
    // Outil « Boîte » (primitive) : dessiner un rectangle au sol, l'extruder en hauteur,
    // puis remplir le pavé de voxels un par un avant un scan qui le résout en solide plein.
    // Trois états successifs, chacun piloté par le pointer observer déjà en place.
    // ---------------------------------------------------------------------------------
    type BoxDrawPhase = 'idle' | 'drawing-base' | 'extruding' | 'filling';
    let boxPhase: BoxDrawPhase = 'idle';
    let boxBaseStart: BABYLON.Vector3 | null = null;
    let boxBaseCorner: BABYLON.Vector3 | null = null;
    let boxPreviewOutline: BABYLON.Mesh | null = null;
    let boxExtrudeHeight = 0;

    // Plan invisible au niveau du plateau : seul mesh pickable en mode dessin, il donne un
    // point d'intersection stable même quand le curseur ne survole aucun autre mesh.
    const groundPickPlane = BABYLON.MeshBuilder.CreatePlane(
      "boxDrawGroundPlane",
      { size: 4000 }, // largement au-delà du plateau : sert seulement de plan d'intersection
      scene,
    );
    groundPickPlane.rotation.x = Math.PI / 2;
    groundPickPlane.position.y = HEIGHT * 0.5; // suit l'élévation du plateau (volumeRoot)
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
      boxPreviewOutline?.dispose(false, true);
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
    const buildBoxOutline = (min: BABYLON.Vector3, max: BABYLON.Vector3, previous?: BABYLON.Mesh | null) => {
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
      // Recréé à chaque appel (6 polylignes, coût négligeable) : un ruban écran n'a pas de mise à
      // jour en place par `instance` comme un LinesMesh.
      previous?.dispose(false, true);
      const mesh = createScreenLines(scene, "boxDrawOutline", lines, new BABYLON.Color3(0, 0.94, 1), LINE_WIDTH_PX);
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
    let pyramidPreviewRings: BABYLON.Mesh | null = null;
    let pyramidHeight = 0;

    const disposePyramidPreview = () => {
      pyramidPreviewRings?.dispose(false, true);
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
      min: BABYLON.Vector3, max: BABYLON.Vector3, height: number, previous?: BABYLON.Mesh | null,
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
      previous?.dispose(false, true);
      const mesh = createScreenLines(scene, "pyramidDrawPreview", lines, new BABYLON.Color3(0, 0.94, 1), LINE_WIDTH_PX);
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

    // Duplique un modèle du plateau (clone profond de sa hiérarchie) : nom unique à la Explorer
    // ("(copie)", puis "(copie 2)"...), matériaux partagés avec l'original (comme un vrai clone),
    // posé sur un emplacement libre du plateau plutôt que superposé à la source. Reprend les mêmes
    // briques que `onImportModel` (findFreeSpot, PLATE_SURFACE_Y, construction de subMeshesList)
    // pour qu'un modèle collé se comporte à l'identique d'un modèle importé.
    const cloneModelToPlate = (source: BABYLON.AbstractMesh): BABYLON.AbstractMesh | null => {
      const existingNames = new Set(Array.from(modelsRef.current).map((m) => m.name));
      const baseName = source.name.replace(/ \(copie(?: \d+)?\)$/, '');
      let uniqueName = `${baseName} (copie)`;
      let copyIndex = 2;
      while (existingNames.has(uniqueName)) {
        uniqueName = `${baseName} (copie ${copyIndex})`;
        copyIndex++;
      }

      const clone = source.clone(uniqueName, null, false);
      if (!clone) return null;
      clone.setEnabled(true);

      clone.computeWorldMatrix(true);
      const boundingInfo = clone.getHierarchyBoundingVectors(true);
      const center = boundingInfo.min.add(boundingInfo.max).scale(0.5);
      const footprintRadius = Math.max(boundingInfo.max.x - boundingInfo.min.x, boundingInfo.max.z - boundingInfo.min.z) / 2;
      const spot = findFreeSpot(footprintRadius);
      clone.position.addInPlace(new BABYLON.Vector3(spot.x - center.x, PLATE_SURFACE_Y - boundingInfo.min.y, spot.z - center.z));

      modelsRef.current.add(clone);
      return clone;
    };

    const pasteClipboard = () => {
      const names = clipboardMeshNamesRef.current;
      if (names.length === 0) return;
      const sources = names
        .map((name) => Array.from(modelsRef.current).find((m) => m.name === name))
        .filter((m): m is BABYLON.AbstractMesh => !!m && !m.isDisposed());
      if (sources.length === 0) return;

      const clones = sources
        .map((source) => cloneModelToPlate(source))
        .filter((m): m is BABYLON.AbstractMesh => !!m);
      if (clones.length === 0) return;

      selectedMeshesRef.current.clear();
      clones.forEach((m) => selectedMeshesRef.current.add(m));
      const last = clones[clones.length - 1];
      setSelectedMeshName(last.name || "Modèle 3D");
      updateHighlight();
      updateSelectedPosition();
      updateSelectedRotation();

      const subMeshesList: { id: string; name: string; color: string }[] = [];
      if (clones.length === 1) {
        const childMeshes = [last, ...last.getChildMeshes()];
        childMeshes.forEach((cm, idx) => {
          let hex = '#00f0ff';
          if (cm.material) {
            const mat = cm.material as InspectableMaterial;
            if (mat.albedoColor) hex = mat.albedoColor.toHexString();
            else if (mat.diffuseColor) hex = mat.diffuseColor.toHexString();
          }
          subMeshesList.push({ id: `${last.name}-${idx}`, name: cm.name || `Partie ${idx + 1}`, color: hex });
        });
      }

      window.dispatchEvent(
        new CustomEvent('apex-mesh-selected', {
          detail: {
            name: last.name || "Modèle 3D",
            names: clones.map((m) => m.name),
            subMeshes: subMeshesList,
          },
        })
      );

      // Le presse-papier retient la copie collée (pas la source d'origine) : coller plusieurs
      // fois de suite empile les copies l'une après l'autre plutôt que de reproduire toujours la
      // même sélection d'origine, comme dans un logiciel de CAO classique.
      clipboardMeshNamesRef.current = clones.map((m) => m.name);

      if (currentToolRef.current === 'move') {
        gizmoManager.rotationGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = false;
        gizmoManager.positionGizmoEnabled = true;
        applyCustomGizmoColors();
        gizmoManager.attachToMesh(last);
        setupGizmoDragEnd();
      } else if (currentToolRef.current === 'rotate') {
        gizmoManager.positionGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = false;
        gizmoManager.rotationGizmoEnabled = true;
        applyCustomGizmoColors();
        gizmoManager.attachToMesh(last);
      } else if (currentToolRef.current === 'scale') {
        gizmoManager.positionGizmoEnabled = false;
        gizmoManager.rotationGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = true;
        gizmoManager.attachToMesh(last);
      }
    };

    const deleteSelection = () => {
      const selection = selectedMeshesRef.current;
      if (selection.size === 0) return;
      let confirmed = true;
      if (selection.size > 1) {
        confirmed = window.confirm(`Voulez-vous vraiment supprimer les ${selection.size} modèles sélectionnés ?`);
      }
      if (!confirmed) return;
      const deletedCount = selection.size;
      selection.forEach(mesh => {
        if (mesh && !mesh.isDisposed()) {
          const meshName = mesh.name;
          modelsRef.current.delete(mesh);
          mesh.dispose();
          window.dispatchEvent(new CustomEvent('apex-mesh-deleted', { detail: { name: meshName } }));
        }
      });
      showSuccess(deletedCount > 1 ? `${deletedCount} modèles supprimés.` : 'Modèle supprimé.');
      selection.clear();
      setSelectedMeshName(null);
      updateHighlight();
      gizmoManager.positionGizmoEnabled = false;
      gizmoManager.rotationGizmoEnabled = false;
      gizmoManager.scaleGizmoEnabled = false;
      gizmoManager.attachToMesh(null);
      window.dispatchEvent(new CustomEvent('apex-mesh-selected', { detail: { name: null, names: [], subMeshes: [] } }));
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Raccourcis par défaut du système (copier/coller/tout sélectionner/couper, saisie de texte,
      // etc.) ne doivent jamais être volés ailleurs dans l'interface : dès que le focus est sur un
      // champ éditable (input, textarea, contentEditable), ce gestionnaire — attaché sur `window` et
      // donc traversé par toute frappe de l'appli — s'efface complètement, y compris pour
      // Suppr/Retour arrière (auparavant vérifié APRÈS, ce qui pouvait supprimer un modèle 3D
      // sélectionné pendant qu'on effaçait du texte ailleurs dans l'UI).
      const target = e.target as HTMLElement | null;
      const isTextField = !!target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);
      if (isTextField) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelection();
        return;
      }

      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      if (!ctrlOrCmd) return;

      // Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A (Cmd sur Mac) : copier/coller/couper/tout sélectionner les
      // modèles du plateau. Rien n'est intercepté hors du plateau (garde ci-dessus), donc les mêmes
      // raccourcis restent disponibles pour le texte normal ailleurs dans l'interface.
      const key = e.key.toLowerCase();
      if (key === 'c') {
        const selection = Array.from(selectedMeshesRef.current);
        if (selection.length === 0) return;
        clipboardMeshNamesRef.current = selection.map((m) => m.name);
      } else if (key === 'v') {
        e.preventDefault();
        pasteClipboard();
      } else if (key === 'x') {
        const selection = Array.from(selectedMeshesRef.current);
        if (selection.length === 0) return;
        e.preventDefault();
        clipboardMeshNamesRef.current = selection.map((m) => m.name);
        deleteSelection();
      } else if (key === 'a') {
        if (modelsRef.current.size === 0) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('apex-select-all-models'));
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
        || (!decor.includes(mesh) && !mesh.name.includes("Gizmo") && !mesh.name.startsWith("boxDraw") && !mesh.name.startsWith("pyramidDraw") && !mesh.name.startsWith(GCODE_MESH_PREFIX)),
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

    // ---------------------------------------------------------------------------------
    // Fenêtre de sélection (clic gauche + drag) : le clic gauche ne pilote plus la caméra
    // (cf. remap des boutons plus haut) et sert désormais exclusivement à ouvrir un
    // rectangle de sélection façon CAO, comme le clic droit dans la plupart des logiciels
    // 3D. En dessous du seuil de drag, on retombe sur la sélection simple par clic.
    // ---------------------------------------------------------------------------------
    const SELECTION_BOX_DRAG_THRESHOLD_PX = 5;
    let selectionDragStart: { x: number; y: number } | null = null;
    let selectionDragging = false;
    const canvasRectForSelection = () => canvas.getBoundingClientRect();

    // Description du rectangle de sélection affichée dans le bandeau du bas (TopRightMenu),
    // qui change selon le sens du drag (cf. règle « window »/« crossing » plus bas) — pour
    // ne pas redispatcher à chaque pointermove, on ne le fait qu'au changement de mode.
    const SELECTION_BOX_TOOLTIPS: Record<'window' | 'crossing', { title: string; desc: string }> = {
      window: {
        title: 'Sélection fenêtre',
        desc: 'Sélectionnez tous les objets compris en entier dans la fenêtre de sélection.',
      },
      crossing: {
        title: 'Sélection croisement',
        desc: 'Sélectionnez tous les objets touchés partiellement ou en entier par la fenêtre de sélection.',
      },
    };
    let lastTooltipMode: 'window' | 'crossing' | null = null;
    const clearSelectionTooltip = () => {
      if (lastTooltipMode !== null) {
        lastTooltipMode = null;
        window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));
      }
    };

    // Filet de sécurité : si le bouton est relâché hors du canvas, Babylon ne redéclenche pas
    // toujours POINTERUP dessus — on efface quand même le rectangle et l'état de drag pour ne
    // pas rester bloqué en sélection au prochain survol du canvas.
    const onWindowPointerUpSafety = () => {
      if (selectionDragStart) {
        selectionDragStart = null;
        selectionDragging = false;
        setSelectionBox(null);
        clearSelectionTooltip();
      }
    };
    window.addEventListener('pointerup', onWindowPointerUpSafety);
    window.addEventListener('pointercancel', onWindowPointerUpSafety);

    const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
      const excluded: BABYLON.AbstractMesh[] = [glassDisc, outline, topOutline, backdrop, groundPickPlane, ...modelingGrid];
      // Repères de mise en scène (axes d'origine, éléments du plan d'esquisse) : jamais
      // sélectionnables ni ce qui alimente l'infobulle au survol.
      const isPickableForUi = (mesh: BABYLON.AbstractMesh) =>
        !excluded.includes(mesh)
        && !mesh.name.includes("Gizmo")
        && !mesh.name.startsWith("boxDraw")
        && !mesh.name.startsWith("pyramidDraw")
        && !mesh.name.startsWith("sketchPlane")
        && !mesh.name.startsWith("originAxis")
        && !mesh.name.startsWith("plateAction")
        // Calque de prévisualisation G-code (tête, buse, trajets) : jamais un modèle du
        // plateau. Un prédicat passé à `scene.pick` court-circuite `isPickable`, d'où ce filtre.
        && !mesh.name.startsWith(GCODE_MESH_PREFIX);

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        const evt = pointerInfo.event as PointerEvent;

        if (selectionDragStart) {
          const dx = evt.clientX - selectionDragStart.x;
          const dy = evt.clientY - selectionDragStart.y;
          if (!selectionDragging && Math.hypot(dx, dy) > SELECTION_BOX_DRAG_THRESHOLD_PX) {
            selectionDragging = true;
          }
          if (selectionDragging) {
            const rect = canvasRectForSelection();
            const x0 = selectionDragStart.x - rect.left;
            const y0 = selectionDragStart.y - rect.top;
            const x1 = evt.clientX - rect.left;
            const y1 = evt.clientY - rect.top;
            // Sens du drag = direction depuis le point de départ, pas depuis le dernier move :
            // sinon un léger retour en arrière en cours de glisser ferait clignoter le mode.
            const dragMode: 'window' | 'crossing' = x1 >= x0 ? 'window' : 'crossing';
            setSelectionBox({
              x: Math.min(x0, x1),
              y: Math.min(y0, y1),
              width: Math.abs(x1 - x0),
              height: Math.abs(y1 - y0),
              mode: dragMode,
            });
            // Bandeau du bas : n'affiche/ne redispatche qu'au changement de mode, pas à
            // chaque pointermove.
            if (lastTooltipMode !== dragMode) {
              lastTooltipMode = dragMode;
              window.dispatchEvent(
                new CustomEvent('apex-set-tooltip', { detail: SELECTION_BOX_TOOLTIPS[dragMode] }),
              );
            }
            return; // Pendant le drag de sélection, on n'actualise pas le survol de modèle.
          }
        }

        const pick = scene.pick(scene.pointerX, scene.pointerY, isPickableForUi);
        const clientX = evt.clientX;
        const clientY = evt.clientY;

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

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
        const evt = pointerInfo.event as PointerEvent;
        // Un clic gauche sur une poignée de gizmo (déplacer/tourner/redimensionner) doit la
        // faire glisser normalement, pas ouvrir un rectangle de sélection par-dessus.
        const hitsGizmo = !!pointerInfo.pickInfo?.hit && !!pointerInfo.pickInfo.pickedMesh?.name.includes("Gizmo");
        if (evt.button === 0 && !hitsGizmo) {
          selectionDragStart = { x: evt.clientX, y: evt.clientY };
          selectionDragging = false;
        }
      }

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
        const evt = pointerInfo.event as PointerEvent;

        if (evt.button === 0 && selectionDragStart) {
          const wasDragging = selectionDragging;
          const dragStart = selectionDragStart;
          selectionDragStart = null;
          selectionDragging = false;

          if (wasDragging) {
            setSelectionBox(null);
            clearSelectionTooltip();
            const rect = canvasRectForSelection();
            const x0 = dragStart.x - rect.left;
            const y0 = dragStart.y - rect.top;
            const x1 = evt.clientX - rect.left;
            const y1 = evt.clientY - rect.top;
            const minX = Math.min(x0, x1);
            const maxX = Math.max(x0, x1);
            const minY = Math.min(y0, y1);
            const maxY = Math.max(y0, y1);
            // Même règle de sens que l'aperçu pendant le drag (cf. plus haut) : vers la droite =
            // fenêtre (ne retient que les objets ENTIÈREMENT englobés), vers la gauche =
            // croisement (retient tout objet TOUCHÉ, même partiellement).
            const mode: 'window' | 'crossing' = x1 >= x0 ? 'window' : 'crossing';

            const hits: BABYLON.AbstractMesh[] = [];
            modelsRef.current.forEach((mesh) => {
              if (mesh.isDisposed()) return;
              const meshes = [mesh, ...mesh.getChildMeshes()];
              const inside = meshes.some((m) => {
                if (!m.isEnabled() || !m.isVisible) return false;
                const bounding = m.getBoundingInfo();
                const min = bounding.boundingBox.minimumWorld;
                const max = bounding.boundingBox.maximumWorld;
                const corners = [
                  new BABYLON.Vector3(min.x, min.y, min.z), new BABYLON.Vector3(max.x, min.y, min.z),
                  new BABYLON.Vector3(min.x, max.y, min.z), new BABYLON.Vector3(max.x, max.y, min.z),
                  new BABYLON.Vector3(min.x, min.y, max.z), new BABYLON.Vector3(max.x, min.y, max.z),
                  new BABYLON.Vector3(min.x, max.y, max.z), new BABYLON.Vector3(max.x, max.y, max.z),
                ];
                const screenCorners = corners.map((corner) => BABYLON.Vector3.Project(
                  corner, BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
                  camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
                ));
                const inRect = (s: BABYLON.Vector3) =>
                  s.z > 0 && s.z < 1 && s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY;
                // « window » (drag vers la droite) : les 8 coins doivent tomber dans le rectangle
                // — l'objet doit être entièrement englobé. « crossing » (drag vers la gauche) :
                // un seul coin suffit — l'objet est retenu dès qu'il est simplement touché.
                return mode === 'window' ? screenCorners.every(inRect) : screenCorners.some(inRect);
              });
              if (inside) hits.push(mesh);
            });

            const additive = evt.ctrlKey || evt.metaKey;
            if (hits.length > 0) {
              const nextSelection = additive ? new Set(selectedMeshesRef.current) : new Set<BABYLON.AbstractMesh>();
              hits.forEach((m) => nextSelection.add(m));
              selectedMeshesRef.current = nextSelection;
              const all = Array.from(nextSelection);
              const last = all[all.length - 1];
              setSelectedMeshName(last.name || "Modèle 3D");
              updateHighlight();
              updateSelectedPosition();
              updateSelectedRotation();
              window.dispatchEvent(new CustomEvent('apex-mesh-selected', {
                detail: { name: last.name, names: all.map((m) => m.name), subMeshes: [] }
              }));
              const gizmoTarget = all.length === 1 ? all[0] : null;
              if (currentToolRef.current === 'move') {
                gizmoManager.rotationGizmoEnabled = false;
                gizmoManager.scaleGizmoEnabled = false;
                gizmoManager.positionGizmoEnabled = !!gizmoTarget;
                if (gizmoTarget) { applyCustomGizmoColors(); setupGizmoDragEnd(); }
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
            } else if (!additive) {
              selectedMeshesRef.current.clear();
              setSelectedMeshName(null);
              updateHighlight();
              gizmoManager.positionGizmoEnabled = false;
              gizmoManager.rotationGizmoEnabled = false;
              gizmoManager.scaleGizmoEnabled = false;
              gizmoManager.attachToMesh(null);
              window.dispatchEvent(new CustomEvent('apex-mesh-selected', { detail: { name: null, names: [], subMeshes: [] } }));
            }
            return; // Le rectangle a déjà tranché la sélection : pas de pick ponctuel en plus.
          }
        }

        const pick = scene.pick(scene.pointerX, scene.pointerY, isPickableForUi);
        if (pick?.hit && pick.pickedMesh) {
          let targetMesh = pick.pickedMesh;

          if (currentToolRef.current !== 'texture') {
            targetMesh = getRootModel(targetMesh);
          }

          const additive = evt.ctrlKey || evt.metaKey;
          selectMesh(targetMesh, additive);
        }
      }
    });

    // Menu contextuel : piloté depuis Babylon plutôt que depuis l'événement DOM `contextmenu`
    // du canvas (cf. le commentaire sur `onContextMenu` dans le JSX) — Babylon attache déjà ses
    // propres écouteurs natifs pointerdown/pointerup sur ce même canvas pour la caméra, donc
    // `scene.onPointerObservable` est le seul point d'écoute garanti de recevoir l'événement.
    // On ne l'ouvre que sur un clic droit franc, pas sur un clic-drag-relâche (orbite/pan).
    const RIGHT_CLICK_DRAG_THRESHOLD_PX = 5;
    let rightPointerDownPos: { x: number; y: number } | null = null;
    const contextMenuPointerObserver = scene.onPointerObservable.add((pointerInfo) => {
      const evt = pointerInfo.event as PointerEvent;
      if (evt.button !== 2) return;

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
        rightPointerDownPos = { x: evt.clientX, y: evt.clientY };
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
        const down = rightPointerDownPos;
        rightPointerDownPos = null;
        if (down) {
          const dx = evt.clientX - down.x;
          const dy = evt.clientY - down.y;
          if (Math.hypot(dx, dy) > RIGHT_CLICK_DRAG_THRESHOLD_PX) return;
        }
        suppressNextBackdropContextMenuRef.current = true;
        setContextMenu({ x: evt.clientX, y: evt.clientY });
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
    const findFreeSpot = (
      footprintRadius: number,
      obstacles: Iterable<BABYLON.AbstractMesh> = modelsRef.current,
    ): { x: number; z: number } => {
      const existing = Array.from(obstacles).map((m) => {
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
          // ce qui le superposerait aux modèles déjà présents) et pose sa base sur la surface du
          // plateau (PLATE_SURFACE_Y, pas y=0 qui n'est que le fond quadrillé — cf. son
          // commentaire), sans passer par bakeCurrentTransformIntoVertices : pour les GLB/GLTF,
          // meshes[0] est souvent le nœud racine __root__ sans géométrie propre, sur lequel le
          // bake échoue silencieusement et interrompt l'import avant que le modèle ne soit
          // positionné/rendu visible.
          r.position.addInPlace(new BABYLON.Vector3(spot.x - center.x, PLATE_SURFACE_Y - boundingInfo.min.y, spot.z - center.z));

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
          showSuccess(`Modèle importé : ${uniqueName}.`);

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
        showError(`Échec de l'import du modèle : ${file.name}.`);
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
      showSuccess(`${all.length} modèle(s) supprimé(s) du plateau.`);
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

    // Disposition automatique : on replace les modèles un par un, du plus encombrant au plus
    // petit, chacun à l'emplacement libre le plus proche du centre parmi ceux déjà replacés —
    // le même algorithme que pour un import.
    const onArrangeModels = () => {
      const footprints = Array.from(modelsRef.current).map((mesh) => {
        mesh.computeWorldMatrix(true);
        const b = mesh.getHierarchyBoundingVectors(true);
        return { mesh, radius: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2 };
      });
      if (footprints.length === 0) return;
      footprints.sort((p, q) => q.radius - p.radius);
      const placed: BABYLON.AbstractMesh[] = [];
      footprints.forEach(({ mesh, radius }) => {
        const spot = findFreeSpot(radius, placed);
        const b = mesh.getHierarchyBoundingVectors(true);
        mesh.position.x += spot.x - (b.min.x + b.max.x) / 2;
        mesh.position.z += spot.z - (b.min.z + b.max.z) / 2;
        mesh.computeWorldMatrix(true);
        placed.push(mesh);
      });
      updateSelectedPosition();
    };
    window.addEventListener('apex-arrange-models', onArrangeModels);

    const handleResize = () => {
      engine.resize();
    };
    window.addEventListener('resize', handleResize);
    // Le conteneur du canvas peut changer de taille sans événement `resize` de la fenêtre
    // (panneaux, changement d'espace, zoom/DPI) : sans cela le tampon de rendu garde l'ancienne
    // taille et l'image apparaît étirée, aplatie ou déformée.
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { if (!scene.isDisposed) engine.resize(); });
    });
    resizeObserver.observe(canvas);
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

    engine.runRenderLoop(() => {
      // Garde-fou : tampon de rendu différent de la taille affichée → on resynchronise.
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0 &&
          (Math.abs(engine.getRenderWidth() - Math.round(canvas.clientWidth * engine.getHardwareScalingLevel() ** -1)) > 2 ||
           Math.abs(engine.getRenderHeight() - Math.round(canvas.clientHeight * engine.getHardwareScalingLevel() ** -1)) > 2)) {
        engine.resize();
      }
      if (!scene.isDisposed) {
        scene.render();
      }
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
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
      window.removeEventListener('pointerup', onWindowPointerUpSafety);
      window.removeEventListener('pointercancel', onWindowPointerUpSafety);
      scene.onPointerObservable.remove(pointerObserver);
      scene.onPointerObservable.remove(contextMenuPointerObserver);
      scene.onBeforeRenderObservable.remove(gridZoomObserver);
      scene.onBeforeRenderObservable.remove(zoomTowardCursorObserver);
      window.removeEventListener('apex-arrange-models', onArrangeModels);
      disposePlateActions();
      canvas.removeEventListener("wheel", onCanvasWheel);
      window.removeEventListener(PAN_PERSPECTIVE_EVENT, onPanPerspective);
      canvas.removeEventListener("pointerdown", onPanDown);
      canvas.removeEventListener("pointermove", onPanMove);
      canvas.removeEventListener("pointerup", onPanUp);
      canvas.removeEventListener("pointercancel", onPanUp);
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
        // L'ouverture du menu est pilotée depuis `scene.onPointerObservable` (cf. plus bas dans
        // l'effet) plutôt que depuis ce `contextmenu` DOM : Babylon attache ses propres
        // écouteurs natifs `pointerdown`/`contextmenu` directement sur ce canvas pour la caméra,
        // et un `stopPropagation()` de sa part empêcherait un handler React (délégué à la
        // racine) de jamais recevoir l'événement. On ne garde ici que le blocage du menu natif
        // du navigateur.
        onContextMenu={(e) => e.preventDefault()}
      />
      {editController && canvasRef.current && (
        <GCodeEditOverlay controller={editController} sceneCanvas={canvasRef.current} />
      )}

      {/* Rectangle de la fenêtre de sélection (clic gauche + drag) : purement visuel, la
          logique de hit-test vit dans le pointer observer Babylon ci-dessus. « window » (drag
          vers la droite, ne retient que les objets entièrement englobés) reprend le style plein
          cyan d'origine ; « crossing » (drag vers la gauche, retient tout objet touché) a un
          contour pointillé animé et un surlignage interne blanc, comme dans les logiciels de CAO. */}
      {selectionBox && selectionBox.mode === 'window' && (
        <div
          style={{
            position: 'absolute',
            left: selectionBox.x, top: selectionBox.y,
            width: selectionBox.width, height: selectionBox.height,
            border: '1px solid rgba(0,240,255,0.9)',
            background: 'rgba(0,240,255,0.12)',
            pointerEvents: 'none', zIndex: 30,
          }}
        />
      )}
      {selectionBox && selectionBox.mode === 'crossing' && (
        <div
          style={{
            position: 'absolute',
            left: selectionBox.x, top: selectionBox.y,
            width: selectionBox.width, height: selectionBox.height,
            pointerEvents: 'none', zIndex: 30,
          }}
        >
          {/* Surlignage interne blanc. */}
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.18)' }} />
          {/* Contour en 4 bandes fines (une par bord) plutôt qu'un `border` CSS : chacune anime
              son propre dégradé tiled pour l'effet « rails de train » qui glisse en continu. */}
          <div className={`${styles.edgeX} ${styles.edgeTop}`} />
          <div className={`${styles.edgeX} ${styles.edgeBottom}`} />
          <div className={`${styles.edgeY} ${styles.edgeLeft}`} />
          <div className={`${styles.edgeY} ${styles.edgeRight}`} />
        </div>
      )}

      {plateActionHint && (
        <div
          style={{
            position: 'fixed', left: plateActionHint.x + 16, top: plateActionHint.y + 16, zIndex: 1000,
            pointerEvents: 'none', background: 'rgba(20,22,30,0.85)', color: 'rgba(255,255,255,0.92)',
            fontSize: 12, padding: '5px 10px', borderRadius: 6, whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          }}
        >
          {plateActionHint.title}
        </div>
      )}

      {/* Sélecteur de fichier du bouton « Importer » de la rangée d'actions du plateau. */}
      <input
        type="file"
        ref={plateImportInputRef}
        style={{ display: 'none' }}
        accept=".stl,.glb,.gltf"
        onChange={(e) => {
          if (e.target.files?.[0]) {
            window.dispatchEvent(new CustomEvent('apex-import-model', { detail: e.target.files[0] }));
          }
          e.target.value = '';
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
            onContextMenu={(e) => {
              e.preventDefault();
              if (suppressNextBackdropContextMenuRef.current) {
                // Écho du contextmenu natif du clic qui vient d'ouvrir ce menu : on l'avale une
                // fois plutôt que de refermer ce qu'on vient d'ouvrir.
                suppressNextBackdropContextMenuRef.current = false;
                return;
              }
              setContextMenu(null);
            }}
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