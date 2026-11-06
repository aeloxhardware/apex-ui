// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';
import { isFlatUi } from '@/utils/interfaceMode';
import { PAN_PERSPECTIVE_EVENT, readPanPerspective } from '@/utils/panPerspectivePrefs';
import { previewZoomStepFactor } from '@/utils/previewZoomPrefs';
import type { ViewportState } from './viewportState';

import { emitApex } from '@/events/apexEvents';
function setupEngine(st: ViewportState) {
  const { HEIGHT, VIEW_RADIUS, canvas, engineRef, sceneRef } = st;
  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true }, true);
  engineRef.current = engine;
  window.apexDesktop?.appStatus?.("Ouverture du portail d'accès à l'espace virtuel 3D...");
  const scene = new BABYLON.Scene(engine);
  sceneRef.current = scene;
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);

  const camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 4, Math.PI / 3, VIEW_RADIUS, new BABYLON.Vector3(0, HEIGHT / 2, 0), scene);
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
  Object.assign(st, { engine, scene, camera, baseInputMap, lensShift, baseGetProjectionMatrix,
    shiftedProjection, shiftedArray });
}

function setupApplyProjectionMode(st: ViewportState) {
  const { baseGetProjectionMatrix, camera, engine, lensShift, shiftedArray, shiftedProjection } = st;
  /**
   * Perspective désactivée (interrupteur d'AxisSidebar) = vue ORTHOGRAPHIQUE
   * (demande de l'utilisateur, 2026-10-28) : plus de fuite, un
   * plan vu de côté est un trait, et la molette change l'échelle de l'image. Les dimensions de
   * la fenêtre sont celles que la perspective donnerait à la distance de la cible
   * (`radius · tan(fov/2)`), donc le basculement ne change pas l'échelle au point visé et toutes
   * les formules « monde par pixel » du fichier restent exactes. Le plan proche passe de l'autre
   * côté de la caméra : sans fuite, rien ne justifie de couper ce qui est derrière l'œil
   * (le rayon d'orbite, lui, peut devenir très petit au zoom).
   */
  st.orthoActive = false;
  const perspectiveMinZ = camera.minZ;
  const applyProjectionMode = () => {
    st.orthoActive = !st.panPerspective;
    camera.mode = st.orthoActive ? BABYLON.Camera.ORTHOGRAPHIC_CAMERA : BABYLON.Camera.PERSPECTIVE_CAMERA;
    if (!st.orthoActive) camera.minZ = perspectiveMinZ;
  };
  camera.getProjectionMatrix = (force?: boolean) => {
    if (st.orthoActive) {
      const halfHeight = camera.radius * Math.tan(camera.fov / 2);
      const halfWidth = halfHeight * engine.getAspectRatio(camera);
      camera.orthoLeft = -halfWidth;
      camera.orthoRight = halfWidth;
      camera.orthoBottom = -halfHeight;
      camera.orthoTop = halfHeight;
      camera.minZ = -camera.maxZ;
    }
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
  st.sketchOrbitLocked = false; // orbite verrouillée = dessin d'esquisse en cours
  st.panPerspective = readPanPerspective();
  Object.assign(st, { applyProjectionMode, resetLensShift });
}

function setupApplyPanMode(st: ViewportState) {
  const { applyProjectionMode, baseInputMap, camera, canvas, lensShift } = st;
  const applyPanMode = () => {
    applyProjectionMode();
    camera.movement.input.inputMap = [
      ...baseInputMap,
      ...(st.panPerspective ? [{ source: "pointer" as const, button: 1, interaction: "pan" as const }] : []),
      // Pas d'orbite pendant le dessin d'une esquisse (cf. setOrbitLocked).
      ...(st.sketchOrbitLocked ? [] : [{ source: "pointer" as const, button: 2, interaction: "rotate" as const }]),
    ];
  };
  applyPanMode();
  const onPanPerspective = (e: Event) => {
    st.panPerspective = !!(e as CustomEvent<{ enabled: boolean }>).detail?.enabled;
    applyPanMode();
  };
  window.addEventListener(PAN_PERSPECTIVE_EVENT, onPanPerspective);
  let panPointer: { id: number; x: number; y: number } | null = null;
  const onPanDown = (event: PointerEvent) => {
    if (event.button !== 1 || st.panPerspective) return;
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
  Object.assign(st, { applyPanMode, onPanPerspective, onPanDown, onPanMove, onPanUp });
}

function setupPendingZoomLog(st: ViewportState) {
  const { HEIGHT, RADIUS, camera } = st;
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
  const TARGET_LIMIT_XZ_MM = 8 * RADIUS;  // bornes de la cible (hors Modélisation)
  const TARGET_LIMIT_Y_MM = HEIGHT;
  st.pendingZoomLog = 0;
  st.pendingZoomMm = 0;
  const zoomAnchor = new BABYLON.Vector3();

  // Repère de la grille de Modélisation : par défaut le sol (plan XZ, normale Y). Il change au
  // clic sur un plan / une face (esquisse) ou sur une face du ViewCube hors esquisse (cf.
  // `setGridFrame` plus bas), et JAMAIS à l'orbite. Axes locaux : x -> étiquettes « x », z ->
  // étiquettes « z », y = normale du plan.
  const gridFrameOrigin = new BABYLON.Vector3(0, 0, 0);
  const gridFrameQuat = BABYLON.Quaternion.Identity();
  const gridFrameMatrix = BABYLON.Matrix.Identity();
  const gridFrameInverse = BABYLON.Matrix.Identity();
  const gridNormal = new BABYLON.Vector3(0, 1, 0);
  Object.assign(st, { ZOOM_LOG_PER_WHEEL_UNIT, ZOOM_MM_PER_WHEEL_UNIT, ZOOM_SMOOTHING_PER_FRAME,
    ZOOM_MAX_ANCHOR_DISTANCE_RADII, TARGET_LIMIT_XZ_MM, TARGET_LIMIT_Y_MM, zoomAnchor, gridFrameOrigin,
    gridFrameQuat, gridFrameMatrix, gridFrameInverse, gridNormal });
}

function setupOnCanvasWheel(st: ViewportState) {
  const { ZOOM_LOG_PER_WHEEL_UNIT, ZOOM_MAX_ANCHOR_DISTANCE_RADII, ZOOM_MM_PER_WHEEL_UNIT, camera, canvas, scene } = st;
  st.gridStandardPlane = 'XZ';
  // Vue qui fait correspondre les axes de la grille à ceux de l'écran : x de la grille à
  // droite, z (le « Y » de l'écran) en haut. Babylon est main gauche : caméra en -Z pour que +X
  // soit à droite (XY), en +X pour que +Z soit à droite (YZ), au-dessus avec alpha = -pi/2
  // pour que +X soit à droite et +Z en haut (XZ).
  const GRID_ALIGNED_VIEW: Record<'XZ' | 'XY' | 'YZ', { alpha: number; beta: number }> = {
    XZ: { alpha: -Math.PI / 2, beta: 0.01 },
    XY: { alpha: -Math.PI / 2, beta: Math.PI / 2 },
    YZ: { alpha: 0, beta: Math.PI / 2 },
  };
  const gridTmpLocal = new BABYLON.Vector3();
  const onCanvasWheel = (event: WheelEvent) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 100 : 1; // lignes / pages
    // Vue orthographique : l'échelle de l'image change d'un même pourcentage par cran, comme en
    // Modélisation (un pas en mm n'a pas de sens sans perspective : la distance ne change rien).
    if (st.modelingActive || st.orthoActive) st.pendingZoomLog += event.deltaY * unit * ZOOM_LOG_PER_WHEEL_UNIT;
    else {
      // Distance caméra → point visé sous le curseur (plan horizontal de la cible, comme l'ancre
      // du zoom) ; à défaut, le rayon de la caméra.
      let distance = camera.radius;
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      if (Math.abs(ray.direction.y) > 1e-9) {
        const t = (camera.target.y - ray.origin.y) / ray.direction.y;
        if (t > 0 && t <= camera.radius * ZOOM_MAX_ANCHOR_DISTANCE_RADII) distance = t;
      }
      st.pendingZoomMm += event.deltaY * unit * ZOOM_MM_PER_WHEEL_UNIT * previewZoomStepFactor(distance);
    }
  };
  canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
  Object.assign(st, { GRID_ALIGNED_VIEW, gridTmpLocal, onCanvasWheel });
}

function setupZoomTowardCursorObserver(st: ViewportState) {
  const { TARGET_LIMIT_XZ_MM, TARGET_LIMIT_Y_MM, ZOOM_MAX_ANCHOR_DISTANCE_RADII, ZOOM_SMOOTHING_PER_FRAME, camera, engine, gridNormal, scene, zoomAnchor } = st;
  const zoomTowardCursorObserver = scene.onBeforeRenderObservable.add(() => {
    if (st.pendingZoomLog === 0 && st.pendingZoomMm === 0) return;
    const frames = engine.getDeltaTime() / (1000 / 60);
    const portion = 1 - Math.pow(1 - ZOOM_SMOOTHING_PER_FRAME, Math.max(frames, 0.01));
    const stepLog = Math.abs(st.pendingZoomLog) < 1e-4 ? st.pendingZoomLog : st.pendingZoomLog * portion;
    st.pendingZoomLog -= stepLog;
    const stepMm = Math.abs(st.pendingZoomMm) < 1e-3 ? st.pendingZoomMm : st.pendingZoomMm * portion;
    st.pendingZoomMm -= stepMm;

    // Respect des butées : on écrête le facteur plutôt que de laisser Babylon ramener le rayon
    // (ce qui décalerait le point visé).
    const minR = camera.lowerRadiusLimit ?? 0;
    const maxR = camera.upperRadiusLimit ?? Number.POSITIVE_INFINITY;
    const targetR = Math.min(Math.max(camera.radius * Math.exp(stepLog) + stepMm, minR), maxR);
    if (targetR === camera.radius) { st.pendingZoomLog = 0; st.pendingZoomMm = 0; return; }
    const factor = targetR / camera.radius;

    // Point visé : intersection du rayon souris avec le plan de travail passant par la cible
    // (horizontal hors Modélisation ; plan de la grille en Modélisation).
    zoomAnchor.copyFrom(camera.target);
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
    // Orthographique hors Modélisation : plan perpendiculaire à l'axe de vue, sans quoi une vue de
    // côté (plan horizontal rasant) ne pourrait plus viser le curseur.
    const planeN = st.modelingActive ? gridNormal : st.orthoActive ? ray.direction : BABYLON.Vector3.Up();
    const denom = BABYLON.Vector3.Dot(ray.direction, planeN);
    if (Math.abs(denom) > 1e-9) {
      const t = BABYLON.Vector3.Dot(camera.target.subtract(ray.origin), planeN) / denom;
      // Orthographique : l'origine du rayon est sur le plan proche (derrière la caméra) et il n'y
      // a pas d'horizon, donc ni borne de distance ni risque de projeter loin.
      if (t > 0 && (st.orthoActive || t <= camera.radius * ZOOM_MAX_ANCHOR_DISTANCE_RADII)) {
        ray.origin.addToRef(ray.direction.scale(t), zoomAnchor);
      }
    }
    // Homothétie de centre `zoomAnchor` : cible et caméra (via le rayon) se rapprochent de lui
    // du même facteur, orientation inchangée — le point visé reste donc fixe à l'écran.
    const newTarget = zoomAnchor.add(camera.target.subtract(zoomAnchor).scale(factor));
    // Hors Modélisation la cible reste près du volume d'impression : zoomer vers le curseur sur un point proche de l'horizon
    // l'emportait à des milliers de mm (orbite autour d'un point vide, vue déformée, orbite qui « ralentit »).
    if (!st.modelingActive) {
      newTarget.x = Math.min(Math.max(newTarget.x, -TARGET_LIMIT_XZ_MM), TARGET_LIMIT_XZ_MM);
      newTarget.z = Math.min(Math.max(newTarget.z, -TARGET_LIMIT_XZ_MM), TARGET_LIMIT_XZ_MM);
      newTarget.y = Math.min(Math.max(newTarget.y, -TARGET_LIMIT_Y_MM), TARGET_LIMIT_XZ_MM);
    }
    camera.target.copyFrom(newTarget);
    camera.radius = targetR;
  });

  // Le MSAA du contexte WebGL (2ᵉ argument `true` de BABYLON.Engine) ne couvre que le
  // rendu direct — les contours (LinesMesh, edgesRendering des voxels) et le compositing
  // via blurRT restent crénelés sans une passe FXAA sur la sortie finale du pipeline.
  // Interface classique : pas de pipeline (MSAA ×8 + FXAA), le MSAA du contexte suffit (cf. utils/interfaceMode.ts).
  const flat = isFlatUi();
  Object.assign(st, { zoomTowardCursorObserver, flat });
}

function setupRenderPipeline(st: ViewportState) {
  const { camera, cameraRef, engine, flat, scene } = st;
  const renderPipeline = flat ? null : new BABYLON.DefaultRenderingPipeline("apexRenderPipeline", false, scene, [camera]);
  if (renderPipeline) {
    renderPipeline.fxaaEnabled = true;
    renderPipeline.samples = 8;
  }
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
  Object.assign(st, { renderPipeline, backdropColor, backdropSize });
}

function setupBackdropMat(st: ViewportState) {
  const { backdropColor, scene } = st;
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
  Object.assign(st, { backdropMat });
}

function setupBackdrop(st: ViewportState) {
  const { backdropMat, backdropSize, camera, flat, scene } = st;
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
  // Interface classique : ni grille ni sol (le fond de la page est noir).
  if (flat) backdrop.setEnabled(false);

  // Broadcast camera position on move
  scene.onBeforeRenderObservable.add(() => {
    if (camera && !flat) { // interface classique : pas de ViewCube, personne n'écoute
      emitApex('apex-camera-updated', { alpha: camera.alpha, beta: camera.beta });
    }
  });
  Object.assign(st, { backdrop });
}

function setupHandleSetView(st: ViewportState) {
  const { GRID_ALIGNED_VIEW, HEIGHT, VIEW_RADIUS, camera, resetLensShift, scene } = st;
  const handleSetView = (e: Event) => {
    const customEvent = e as CustomEvent<{ view: string }>;
    const view = customEvent.detail?.view;
    if (!camera) return;

    const targetRadius = VIEW_RADIUS;
    const targetLookAt = new BABYLON.Vector3(0, HEIGHT / 2, 0);
    resetLensShift();
    camera.target = targetLookAt;
    camera.radius = targetRadius;

    let targetAlpha = camera.alpha;
    let targetBeta = camera.beta;

    // Hors esquisse, en Modélisation : cliquer une face du ViewCube aligne la grille sur le plan
    // regardé (face/arrière -> XY, gauche/droite -> YZ, dessus/dessous -> XZ).
    let alignedPlane: 'XZ' | 'XY' | 'YZ' | null = null;
    if (st.modelingActive && !st.sketchOrbitLocked) {
      if (view === 'front' || view === 'back') alignedPlane = 'XY';
      else if (view === 'left' || view === 'right') alignedPlane = 'YZ';
      else if (view === 'top' || view === 'bottom') alignedPlane = 'XZ';
      if (alignedPlane) st.setGridStandardPlane(alignedPlane);
    }

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

    if (alignedPlane) {
      targetAlpha = GRID_ALIGNED_VIEW[alignedPlane].alpha;
      targetBeta = view === 'bottom' ? Math.PI - 0.01 : GRID_ALIGNED_VIEW[alignedPlane].beta;
    }

    const animAlpha = new BABYLON.Animation("animAlpha", "alpha", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    animAlpha.setKeys([{ frame: 0, value: camera.alpha }, { frame: 20, value: targetAlpha }]);

    const animBeta = new BABYLON.Animation("animBeta", "beta", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    animBeta.setKeys([{ frame: 0, value: camera.beta }, { frame: 20, value: targetBeta }]);

    scene.beginDirectAnimation(camera, [animAlpha, animBeta], 0, 20, false);
  };
  Object.assign(st, { handleSetView });
}

function setupHandleCustomView(st: ViewportState) {
  const { GRID_ALIGNED_VIEW, camera, flat, handleSetView, hlRef, resetLensShift, scene } = st;
  const handleCustomView = (e: Event) => {
    const customEvent = e as CustomEvent<{ alpha: number; beta: number }>;
    let { alpha, beta } = customEvent.detail;
    if (!camera) return;
    // Comme les autres vues prédéfinies : le décalage de lentille du panoramique est remis à zéro, sinon la vue « de face »
    // reste oblique (perspective déformée, angle incohérent avec le gizmo).
    resetLensShift();

    // Hors esquisse, en Modélisation : cliquer une FACE du ViewCube (pas une arête ni un coin)
    // aligne la grille sur ce plan et oriente la vue pour que ses axes suivent ceux de l'écran.
    if (st.modelingActive && !st.sketchOrbitLocked) {
      const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.03;
      let plane: 'XZ' | 'XY' | 'YZ' | null = null;
      if (beta < 0.05 || beta > Math.PI - 0.05) plane = 'XZ';
      else if (near(beta, Math.PI / 2)) {
        if (near(alpha, Math.PI / 2) || near(alpha, -Math.PI / 2)) plane = 'XY';
        else if (near(alpha, 0) || near(alpha, Math.PI)) plane = 'YZ';
      }
      if (plane) {
        st.setGridStandardPlane(plane);
        alpha = GRID_ALIGNED_VIEW[plane].alpha;
        beta = plane === 'XZ' && customEvent.detail.beta > Math.PI / 2
          ? Math.PI - 0.01
          : GRID_ALIGNED_VIEW[plane].beta;
      }
    }

    const animAlpha = new BABYLON.Animation("animAlpha", "alpha", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    animAlpha.setKeys([{ frame: 0, value: camera.alpha }, { frame: 20, value: alpha }]);

    const animBeta = new BABYLON.Animation("animBeta", "beta", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    animBeta.setKeys([{ frame: 0, value: camera.beta }, { frame: 20, value: beta }]);

    scene.beginDirectAnimation(camera, [animAlpha, animBeta], 0, 20, false);
  };

  window.addEventListener('apex-set-camera-view', handleSetView);
  window.addEventListener('apex-set-camera-custom', handleCustomView);

  new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
  // Interface classique : sélection par contour (cf. updateFlatOutline), donc pas de HighlightLayer (cible de rendu + flou).
  if (!flat) {
    const hl = new BABYLON.HighlightLayer("hl1", scene);
    hl.blurHorizontalSize = 0.5;
    hl.blurVerticalSize = 0.5;
    hlRef.current = hl;
  }
  Object.assign(st, { handleCustomView });
}

export function setupViewportScene(st: ViewportState) {
  setupEngine(st);
  setupApplyProjectionMode(st);
  setupApplyPanMode(st);
  setupPendingZoomLog(st);
  setupOnCanvasWheel(st);
  setupZoomTowardCursorObserver(st);
  setupRenderPipeline(st);
  setupBackdropMat(st);
  setupBackdrop(st);
  setupHandleSetView(st);
  setupHandleCustomView(st);
}
