import * as BABYLON from 'babylonjs';
import { readPanPerspective, PAN_PERSPECTIVE_EVENT } from '@/utils/panPerspectivePrefs';
import { previewZoomStepFactor } from '@/utils/previewZoomPrefs';
import type { GridStandardPlane } from './types';
import type { ViewportCtx } from './context';

/** Moteur, scène, caméra, projection (perspective/orthographique), déplacement latéral (lens shift) et zoom vers le curseur. */
export function setupCamera(c: ViewportCtx) {
  const { canvasRef, engineRef, sceneRef, HEIGHT, RADIUS } = c;

  const canvas = canvasRef.current;
  c.canvas = canvas;

  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true }, true);
  c.engine = engine;

  engineRef.current = engine;

  window.apexDesktop?.appStatus?.("Ouverture du portail d'accès à l'espace virtuel 3D...");

  const scene = new BABYLON.Scene(engine);
  c.scene = scene;

  sceneRef.current = scene;

  scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);


  const camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 4, Math.PI / 3, 300, new BABYLON.Vector3(0, HEIGHT / 2, 0), scene);
  c.camera = camera;

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
  c.lensShift = lensShift;

  const baseGetProjectionMatrix = camera.getProjectionMatrix.bind(camera);

  const shiftedProjection = new BABYLON.Matrix();

  const shiftedArray = new Float32Array(16);

  /**
   * Perspective désactivée (interrupteur d'AxisSidebar) = vue ORTHOGRAPHIQUE, comme l'option
   * « Orthographique » de Fusion 360 (demande de l'utilisateur, 2026-10-28) : plus de fuite, un
   * plan vu de côté est un trait, et la molette change l'échelle de l'image. Les dimensions de
   * la fenêtre sont celles que la perspective donnerait à la distance de la cible
   * (`radius · tan(fov/2)`), donc le basculement ne change pas l'échelle au point visé et toutes
   * les formules « monde par pixel » du fichier restent exactes. Le plan proche passe de l'autre
   * côté de la caméra : sans fuite, rien ne justifie de couper ce qui est derrière l'œil
   * (le rayon d'orbite, lui, peut devenir très petit au zoom).
   */
  c.orthoActive = false;

  const perspectiveMinZ = camera.minZ;

  const applyProjectionMode = () => {
    c.orthoActive = !panPerspective;
    camera.mode = c.orthoActive ? BABYLON.Camera.ORTHOGRAPHIC_CAMERA : BABYLON.Camera.PERSPECTIVE_CAMERA;
    if (!c.orthoActive) camera.minZ = perspectiveMinZ;
  };

  camera.getProjectionMatrix = (force?: boolean) => {
    if (c.orthoActive) {
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
  c.resetLensShift = resetLensShift;

  c.sketchOrbitLocked = false;
 // orbite verrouillée = dessin d'esquisse en cours
  let panPerspective = readPanPerspective();

  const applyPanMode = () => {
    applyProjectionMode();
    camera.movement.input.inputMap = [
      ...baseInputMap,
      ...(panPerspective ? [{ source: "pointer" as const, button: 1, interaction: "pan" as const }] : []),
      // Pas d'orbite pendant le dessin d'une esquisse (cf. setOrbitLocked).
      ...(c.sketchOrbitLocked ? [] : [{ source: "pointer" as const, button: 2, interaction: "rotate" as const }]),
    ];
  };
  c.applyPanMode = applyPanMode;

  applyPanMode();

  const onPanPerspective = (e: Event) => {
    panPerspective = !!(e as CustomEvent<{ enabled: boolean }>).detail?.enabled;
    applyPanMode();
  };
  c.onPanPerspective = onPanPerspective;

  window.addEventListener(PAN_PERSPECTIVE_EVENT, onPanPerspective);

  let panPointer: { id: number; x: number; y: number } | null = null;

  const onPanDown = (event: PointerEvent) => {
    if (event.button !== 1 || panPerspective) return;
    event.preventDefault(); // pas de défilement automatique du bouton du milieu
    panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  };
  c.onPanDown = onPanDown;

  const onPanMove = (event: PointerEvent) => {
    if (!panPointer || event.pointerId !== panPointer.id) return;
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    lensShift.x += (2 * (event.clientX - panPointer.x)) / w;
    lensShift.y -= (2 * (event.clientY - panPointer.y)) / h;
    panPointer.x = event.clientX;
    panPointer.y = event.clientY;
  };
  c.onPanMove = onPanMove;

  const onPanUp = (event: PointerEvent) => {
    if (!panPointer || event.pointerId !== panPointer.id) return;
    panPointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  c.onPanUp = onPanUp;

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

  const ZOOM_LOG_PER_WHEEL_UNIT = 0.15 / 100;
 // cran standard (deltaY 100) ≈ ×1,16 / ÷1,16
  // Hors Modélisation : mm par unité de molette (cran standard ≈ 30 mm, proche du pas en
  // pourcentage à la distance par défaut de 300 mm).
  const ZOOM_MM_PER_WHEEL_UNIT = 30 / 100;

  const ZOOM_SMOOTHING_PER_FRAME = 0.35;
 // part du zoom restant appliquée à chaque image (60 i/s)
  // Au-delà, le point visé est quasi à l'horizon : on zoome alors vers la cible, sans quoi un
  // cran projetterait la caméra à des kilomètres.
  const ZOOM_MAX_ANCHOR_DISTANCE_RADII = 20;

  const TARGET_LIMIT_XZ_MM = 8 * RADIUS;
// bornes de la cible (hors Modélisation)
  const TARGET_LIMIT_Y_MM = HEIGHT;

  let pendingZoomLog = 0;

  let pendingZoomMm = 0;

  const zoomAnchor = new BABYLON.Vector3();


  // Repère de la grille de Modélisation : par défaut le sol (plan XZ, normale Y). Il change au
  // clic sur un plan / une face (esquisse) ou sur une face du ViewCube hors esquisse (cf.
  // `setGridFrame` plus bas), et JAMAIS à l'orbite. Axes locaux : x -> étiquettes « x », z ->
  // étiquettes « z », y = normale du plan.
  const gridFrameOrigin = new BABYLON.Vector3(0, 0, 0);
  c.gridFrameOrigin = gridFrameOrigin;

  const gridFrameQuat = BABYLON.Quaternion.Identity();
  c.gridFrameQuat = gridFrameQuat;

  const gridFrameMatrix = BABYLON.Matrix.Identity();
  c.gridFrameMatrix = gridFrameMatrix;

  const gridFrameInverse = BABYLON.Matrix.Identity();
  c.gridFrameInverse = gridFrameInverse;

  const gridNormal = new BABYLON.Vector3(0, 1, 0);
  c.gridNormal = gridNormal;

  c.gridStandardPlane = 'XZ';

  // Vue qui fait correspondre les axes de la grille à ceux de l'écran : x de la grille à
  // droite, z (le « Y » de l'écran) en haut. Babylon est main gauche : caméra en -Z pour que +X
  // soit à droite (XY), en +X pour que +Z soit à droite (YZ), au-dessus avec alpha = -pi/2
  // pour que +X soit à droite et +Z en haut (XZ).
  const GRID_ALIGNED_VIEW: Record<'XZ' | 'XY' | 'YZ', { alpha: number; beta: number }> = {
    XZ: { alpha: -Math.PI / 2, beta: 0.01 },
    XY: { alpha: -Math.PI / 2, beta: Math.PI / 2 },
    YZ: { alpha: 0, beta: Math.PI / 2 },
  };
  c.GRID_ALIGNED_VIEW = GRID_ALIGNED_VIEW;

  const gridTmpLocal = new BABYLON.Vector3();
  c.gridTmpLocal = gridTmpLocal;

  const onCanvasWheel = (event: WheelEvent) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 100 : 1; // lignes / pages
    // Vue orthographique : l'échelle de l'image change d'un même pourcentage par cran, comme en
    // Modélisation (un pas en mm n'a pas de sens sans perspective : la distance ne change rien).
    if (c.modelingActive || c.orthoActive) pendingZoomLog += event.deltaY * unit * ZOOM_LOG_PER_WHEEL_UNIT;
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
  c.onCanvasWheel = onCanvasWheel;

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

    // Point visé : intersection du rayon souris avec le plan de travail passant par la cible
    // (horizontal hors Modélisation ; plan de la grille en Modélisation).
    zoomAnchor.copyFrom(camera.target);
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
    // Orthographique hors Modélisation : plan perpendiculaire à l'axe de vue, sans quoi une vue de
    // côté (plan horizontal rasant) ne pourrait plus viser le curseur.
    const planeN = c.modelingActive ? gridNormal : c.orthoActive ? ray.direction : BABYLON.Vector3.Up();
    const denom = BABYLON.Vector3.Dot(ray.direction, planeN);
    if (Math.abs(denom) > 1e-9) {
      const t = BABYLON.Vector3.Dot(camera.target.subtract(ray.origin), planeN) / denom;
      // Orthographique : l'origine du rayon est sur le plan proche (derrière la caméra) et il n'y
      // a pas d'horizon, donc ni borne de distance ni risque de projeter loin.
      if (t > 0 && (c.orthoActive || t <= camera.radius * ZOOM_MAX_ANCHOR_DISTANCE_RADII)) {
        ray.origin.addToRef(ray.direction.scale(t), zoomAnchor);
      }
    }
    // Homothétie de centre `zoomAnchor` : cible et caméra (via le rayon) se rapprochent de lui
    // du même facteur, orientation inchangée — le point visé reste donc fixe à l'écran.
    const newTarget = zoomAnchor.add(camera.target.subtract(zoomAnchor).scale(factor));
    // Hors Modélisation la cible reste près du volume d'impression : zoomer vers le curseur sur un point proche de l'horizon
    // l'emportait à des milliers de mm (orbite autour d'un point vide, vue déformée, orbite qui « ralentit »).
    if (!c.modelingActive) {
      newTarget.x = Math.min(Math.max(newTarget.x, -TARGET_LIMIT_XZ_MM), TARGET_LIMIT_XZ_MM);
      newTarget.z = Math.min(Math.max(newTarget.z, -TARGET_LIMIT_XZ_MM), TARGET_LIMIT_XZ_MM);
      newTarget.y = Math.min(Math.max(newTarget.y, -TARGET_LIMIT_Y_MM), TARGET_LIMIT_XZ_MM);
    }
    camera.target.copyFrom(newTarget);
    camera.radius = targetR;
  });
  c.zoomTowardCursorObserver = zoomTowardCursorObserver;
}
