"use client";

import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import * as BABYLON from 'babylonjs';
import { installFlatBabylon } from '@/utils/flatBabylon';
import { FLAT_MAX_FPS, isFlatUi } from '@/utils/interfaceMode';
import { isPlateShaded, subscribePlateShaded } from '@/utils/plateShadingPrefs';

// Interface classique : aucune animation Babylon (cf. utils/flatBabylon.ts).
installFlatBabylon(BABYLON);
import 'babylonjs-loaders';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPortal } from 'react-dom';
import { Upload, BoxSelect, LayoutGrid, Trash2 } from 'lucide-react';
import { showSuccess, showWarning, showError } from '@/utils/toast';
import styles from './Viewport3D.module.scss';
import { ApexSlider } from './ApexSlider';
import { createAirContourCallout } from './airContourCallout';
import { createGCodeLayer, GCODE_MESH_PREFIX, type ParsedGCode, type ColorByMode } from './gcodeLayer';
import { createGCodeEditController, type GCodeEditController } from './edit-node/gcodeEditController';
import GCodeEditOverlay from './edit-node/GCodeEditOverlay';
import { createScreenLine, createScreenLines } from './screenLine';
import type { ColorByScope } from './gcodeColormap';
import type { LineTypeVisibility } from './gcodeLineTypes';
import { PAN_PERSPECTIVE_EVENT, readPanPerspective } from '@/utils/panPerspectivePrefs';
import { previewZoomStepFactor } from '@/utils/previewZoomPrefs';

const DEFAULT_BLUR_LEVEL = 40;
// Info-bulles de bas d'écran des éléments du menu contextuel (cf. CLAUDE.md : chaque élément porte
// son texte). Un élément dont la commande n'existe pas encore le dit dans sa description.
const showTooltip = (tip: { title: string; desc: string }) =>
  window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: tip }));
const hideTooltip = () => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));
const menuTooltip = (tip: { title: string; desc: string }) => ({
  onMouseEnter: () => showTooltip(tip),
  onMouseLeave: hideTooltip,
});
const SELECT_ALL_TOOLTIP = { title: 'Tout sélectionner', desc: 'Sélectionne tous les modèles du plateau.' };
const DELETE_ALL_TOOLTIP = { title: 'Tout supprimer', desc: 'Supprime tous les modèles du plateau.' };
// Outils pas encore disponibles : grisés et inactifs, seule l'info-bulle « Bientôt disponible ».
const SOON_TOOLTIP = { title: 'Bientôt disponible', desc: 'Bientôt disponible' };
const ORGANIZE_TOOLTIP = SOON_TOOLTIP;

// Menu contextuel par espace. Préparation a son propre menu (JSX dédié, dans le rendu) ; les autres
// espaces listent ici des idées de fonctions, non raccordées : elles sont grisées et renvoient
// « Bientôt disponible ». `plateBlur` : le réglage de flou sous le plateau y a sa place.
export type ContextMenuSpace = 'home' | 'preparation' | 'preview' | 'modeling' | 'dev';
const SPACE_MENU_ITEMS: Record<Exclude<ContextMenuSpace, 'preparation'>, { labels: string[]; plateBlur: boolean }> = {
  home: {
    plateBlur: false,
    labels: [
      'Nouveau projet', 'Ouvrir un projet récent', 'Ouvrir un G-code', 'Modèles d\'exemple',
      'Tutoriels de démarrage', 'Épingler un projet', 'Historique des projets', 'Ouvrir le dossier de travail',
      'Vérifier les mises à jour', 'Signaler un problème',
    ],
  },
  preview: {
    plateBlur: true,
    labels: [
      'Lecture / pause', 'Pas à pas précédent', 'Pas à pas suivant', 'Isoler la couche courante',
      'Masquer les déplacements à vide', 'Mesurer une distance', 'Coloration par vitesse',
      'Exporter une capture d\'écran', 'Afficher les temps d\'impression', 'Revenir au début du tracé',
    ],
  },
  modeling: {
    plateBlur: true,
    labels: [
      'Ajouter une sphère', 'Ajouter un cylindre', 'Ajouter un cône', 'Ajouter un tore',
      'Esquisse sur le plateau', 'Extruder la sélection', 'Symétrie', 'Union booléenne',
      'Soustraction booléenne', 'Congé / chanfrein',
    ],
  },
  dev: {
    plateBlur: false,
    labels: [
      'Afficher les logs de la console', 'Afficher les FPS', 'Inspecter la scène Babylon', 'Vider le cache des modèles',
      'Exporter l\'état de la scène', 'Afficher les normales', 'Afficher les collisions', 'Mesurer le rendu',
      'Simuler une erreur', 'Réinitialiser les préférences',
    ],
  },
};
const PRIMITIVE_TOOLTIP = { title: 'Ajouter une primitive', desc: 'Ajoute une forme simple, à dessiner directement sur le plateau.' };
const BOX_TOOLTIP = { title: 'Boîte', desc: 'Dessinez un pavé sur le plateau, puis donnez-lui sa hauteur.' };
const PYRAMID_TOOLTIP = { title: 'Pyramide 4 côtés', desc: 'Dessinez une base sur le plateau, puis donnez-lui sa hauteur : la pyramide se pose sur le plateau.' };
const MODELS_TOOLTIP = SOON_TOOLTIP;

const BLUR_TOOLTIP = {
  title: 'Niveau de flou sous le plateau',
  desc: "Intensité du flou de la capture sous le plateau. Double-cliquez sur le curseur pour revenir à la valeur par défaut.",
};

export const Viewport3D = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // Espace courant, pour choisir le menu contextuel (événement `apex-space-changed`, émis par Index).
  const [contextSpace, setContextSpace] = useState<ContextMenuSpace>('preparation');
  useEffect(() => {
    const onSpaceChanged = (e: Event) => setContextSpace((e as CustomEvent<{ space: ContextMenuSpace }>).detail.space);
    window.addEventListener('apex-space-changed', onSpaceChanged);
    return () => window.removeEventListener('apex-space-changed', onSpaceChanged);
  }, []);
  // Le clic droit qui ouvre le menu déclenche ensuite, sur ce même clic, l'événement DOM natif
  // `contextmenu` : au moment où celui-ci se déclenche, le rideau de fermeture (qui couvre tout
  // l'écran) est déjà monté sous le curseur et en reçoit la cible — sans ce garde-fou, son
  // propre `onContextMenu` referme le menu qui vient tout juste de s'ouvrir. On l'arme juste
  // avant d'ouvrir et on l'ignore une seule fois, côté rideau.
  const suppressNextBackdropContextMenuRef = useRef(false);
  const [blurLevel, setBlurLevel] = useState(DEFAULT_BLUR_LEVEL);
  // Info-bulle qui suit le curseur pendant la sélection du plan d'esquisse (façon Fusion 360).
  const [sketchPlaneHint, setSketchPlaneHint] = useState<{ x: number; y: number } | null>(null);
  // Curseur « + » de l'outil Rectangle (position écran, aimanté ou non à la grille).
  const [sketchCursor, setSketchCursor] = useState<{ x: number; y: number; snapped: boolean } | null>(null);
  // Champs « longueur » / « largeur » de l'outil Rectangle (affichés après le premier clic).
  const [sketchDimsShown, setSketchDimsShown] = useState(false);
  const sketchDimInputs = useRef<(HTMLInputElement | null)[]>([null, null]);
  const sketchDimsApi = useRef<{
    onKey: (index: number, event: React.KeyboardEvent<HTMLInputElement>) => void;
    onInput: (index: number) => void;
  }>({ onKey: () => {}, onInput: () => {} });
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
    window.apexDesktop?.appStatus?.("Ouverture du portail d'accès à l'espace virtuel 3D...");
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
    let sketchOrbitLocked = false; // orbite verrouillée = dessin d'esquisse en cours
    let panPerspective = readPanPerspective();
    const applyPanMode = () => {
      camera.movement.input.inputMap = [
        ...baseInputMap,
        ...(panPerspective ? [{ source: "pointer" as const, button: 1, interaction: "pan" as const }] : []),
        // Pas d'orbite pendant le dessin d'une esquisse (cf. setOrbitLocked).
        ...(sketchOrbitLocked ? [] : [{ source: "pointer" as const, button: 2, interaction: "rotate" as const }]),
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
    const TARGET_LIMIT_XZ_MM = 8 * RADIUS;  // bornes de la cible (hors Modélisation)
    const TARGET_LIMIT_Y_MM = HEIGHT;
    let pendingZoomLog = 0;
    let pendingZoomMm = 0;
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
    type GridStandardPlane = 'XZ' | 'XY' | 'YZ';
    let gridStandardPlane: GridStandardPlane | null = 'XZ';
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

      // Point visé : intersection du rayon souris avec le plan de travail passant par la cible
      // (horizontal hors Modélisation ; plan de la grille en Modélisation).
      zoomAnchor.copyFrom(camera.target);
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      const planeN = modelingActive ? gridNormal : BABYLON.Vector3.Up();
      const denom = BABYLON.Vector3.Dot(ray.direction, planeN);
      if (Math.abs(denom) > 1e-9) {
        const t = BABYLON.Vector3.Dot(camera.target.subtract(ray.origin), planeN) / denom;
        if (t > 0 && t <= camera.radius * ZOOM_MAX_ANCHOR_DISTANCE_RADII) {
          ray.origin.addToRef(ray.direction.scale(t), zoomAnchor);
        }
      }
      // Homothétie de centre `zoomAnchor` : cible et caméra (via le rayon) se rapprochent de lui
      // du même facteur, orientation inchangée — le point visé reste donc fixe à l'écran.
      const newTarget = zoomAnchor.add(camera.target.subtract(zoomAnchor).scale(factor));
      // Hors Modélisation la cible reste près du volume d'impression : zoomer vers le curseur sur un point proche de l'horizon
      // l'emportait à des milliers de mm (orbite autour d'un point vide, vue déformée, orbite qui « ralentit »).
      if (!modelingActive) {
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
    // Interface classique : ni grille ni sol (le fond de la page est noir).
    if (flat) backdrop.setEnabled(false);

    // Broadcast camera position on move
    scene.onBeforeRenderObservable.add(() => {
      if (camera && !flat) { // interface classique : pas de ViewCube, personne n'écoute
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

      // Hors esquisse, en Modélisation : cliquer une face du ViewCube aligne la grille sur le plan
      // regardé (face/arrière -> XY, gauche/droite -> YZ, dessus/dessous -> XZ).
      let alignedPlane: 'XZ' | 'XY' | 'YZ' | null = null;
      if (modelingActive && !sketchOrbitLocked) {
        if (view === 'front' || view === 'back') alignedPlane = 'XY';
        else if (view === 'left' || view === 'right') alignedPlane = 'YZ';
        else if (view === 'top' || view === 'bottom') alignedPlane = 'XZ';
        if (alignedPlane) setGridStandardPlane(alignedPlane);
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

    const handleCustomView = (e: Event) => {
      const customEvent = e as CustomEvent<{ alpha: number; beta: number }>;
      let { alpha, beta } = customEvent.detail;
      if (!camera) return;
      // Comme les autres vues prédéfinies : le décalage de lentille du panoramique est remis à zéro, sinon la vue « de face »
      // reste oblique (perspective déformée, angle incohérent avec le gizmo).
      resetLensShift();

      // Hors esquisse, en Modélisation : cliquer une FACE du ViewCube (pas une arête ni un coin)
      // aligne la grille sur ce plan et oriente la vue pour que ses axes suivent ceux de l'écran.
      if (modelingActive && !sketchOrbitLocked) {
        const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.03;
        let plane: 'XZ' | 'XY' | 'YZ' | null = null;
        if (beta < 0.05 || beta > Math.PI - 0.05) plane = 'XZ';
        else if (near(beta, Math.PI / 2)) {
          if (near(alpha, Math.PI / 2) || near(alpha, -Math.PI / 2)) plane = 'XY';
          else if (near(alpha, 0) || near(alpha, Math.PI)) plane = 'YZ';
        }
        if (plane) {
          setGridStandardPlane(plane);
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

    const gizmoManager = new BABYLON.GizmoManager(scene); 
    gizmoManagerRef.current = gizmoManager; 
    gizmoManager.usePointerToAttachGizmos = false;
    gizmoManager.positionGizmoEnabled = false;
    gizmoManager.rotationGizmoEnabled = false;
    gizmoManager.scaleGizmoEnabled = false;

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

    // Les gizmos Babylon exposent leur matériau via des champs internes non documentés dans les
    // types publics (_coloredMaterial/_hoverMaterial/gizmoMesh) — on décrit juste la forme utilisée
    // plutôt que de recourir à `any`.
    interface GizmoAxisInternal {
      _coloredMaterial?: BABYLON.StandardMaterial;
      _hoverMaterial?: BABYLON.StandardMaterial;
      gizmoMesh?: BABYLON.Mesh;
    }

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
      const axisLine = createScreenLine(scene, `originAxis${i}`, [originAxisBase, dir], flat ? BABYLON.Color3.White() : color, LINE_WIDTH_PX, 1, { zOffset: 0 });
      axisLine.parent = originAxesRoot;
      if (!flat) return;
      // Interface classique : pas de couleur d'axe, une lettre au bout (Z imprimante = Y Babylon, Y imprimante = Z Babylon).
      const letter = ['X', 'Z', 'Y'][i];
      const tex = new BABYLON.DynamicTexture(`originAxisLetter${i}`, { width: 64, height: 64 }, scene, false);
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, 64, 64);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px Arial, Helvetica, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, 32, 34);
      tex.update();
      tex.hasAlpha = true;
      const plane = BABYLON.MeshBuilder.CreatePlane(`originAxisLetterPlane${i}`, { size: originAxisLength * 0.22 }, scene);
      const letterMat = new BABYLON.StandardMaterial(`originAxisLetterMat${i}`, scene);
      letterMat.emissiveTexture = tex;
      letterMat.opacityTexture = tex;
      letterMat.disableLighting = true;
      letterMat.backFaceCulling = false;
      plane.material = letterMat;
      plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      plane.isPickable = false;
      plane.parent = originAxesRoot;
      // Au-dessus de la surface du plateau (y = 0.1) : sinon le disque opaque coupe la lettre des axes posés à plat.
      plane.position.copyFrom(dir.scale(1.12));
      plane.position.y = Math.max(plane.position.y, originAxisLength * 0.2);
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
    // Interface classique : plateau « à plat » par défaut. La capture floutée du plateau (rendu plein cadre + 2 flous
    // gaussiens à chaque image) n'est alors pas rendue : le plateau et ses boutons restent noirs. Coché
    // (« Rendre le plateau avec ombres »), elle redevient vive. Même bascule pour le matériau des modèles (cf. applyPlateShading).
    if (flat) blurRT.clearColor = new BABYLON.Color4(0, 0, 0, 1);

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
      if (capturedInBlur(m) && blurRT.renderList && !(flat && !isPlateShaded())) blurRT.renderList.push(m);
    });

    // --- Interface classique : plateau et modèles à plat, ou rendu complet (« avec ombres »). ---
    const flatModelMat = new BABYLON.StandardMaterial("flatModelMat", scene);
    flatModelMat.disableLighting = true;
    flatModelMat.emissiveColor = new BABYLON.Color3(0.85, 0.85, 0.85);
    flatModelMat.backFaceCulling = false;
    const originalMaterials = new Map<BABYLON.AbstractMesh, BABYLON.Material | null>();
    const applyModelShading = () => {
      if (!flat) return;
      const shaded = isPlateShaded();
      modelsRef.current.forEach((root) => {
        if (root.isDisposed()) return;
        [root, ...root.getChildMeshes(false)].forEach((m) => {
          if (shaded) {
            if (originalMaterials.has(m)) { m.material = originalMaterials.get(m) ?? null; originalMaterials.delete(m); }
          } else if (m.getTotalVertices() > 0 && m.material !== flatModelMat) {
            if (!originalMaterials.has(m)) originalMaterials.set(m, m.material);
            m.material = flatModelMat;
          }
        });
      });
    };
    const applyPlateShading = () => {
      if (!flat) return;
      const shaded = isPlateShaded();
      // Capture floutée : rendue à chaque image (verre) ou une dernière fois à vide (plateau noir), puis plus jamais.
      blurRT.renderList = shaded ? scene.meshes.filter(capturedInBlur) : [];
      blurRT.refreshRate = shaded ? 1 : 0;
      applyModelShading();
    };
    applyPlateShading();
    const unsubscribeShading = subscribePlateShaded(applyPlateShading);

    const makeScreenLine = (name: string, points: BABYLON.Vector3[], color: BABYLON.Color3, alpha = 1, widthScale = 1) =>
      createScreenLine(scene, name, points, color, LINE_WIDTH_PX * widthScale, alpha);

    const outlinePoints = [];
    for (let i = 0; i <= 720; i++) {
      const angle = (i / 720) * Math.PI * 2;
      // Même hauteur que glassDisc : sans ça le contour cerclait le vide sous le disque surélevé.
      outlinePoints.push(new BABYLON.Vector3(Math.cos(angle) * RADIUS, glassDisc.position.y, Math.sin(angle) * RADIUS));
    }
    const outline = makeScreenLine("plateOutline", outlinePoints, flat ? BABYLON.Color3.White() : new BABYLON.Color3(0, 0.94, 1));
    outline.parent = volumeRoot;

    const topOutlinePoints = [];
    for (let i = 0; i <= 720; i++) {
      const angle = (i / 720) * Math.PI * 2;
      topOutlinePoints.push(new BABYLON.Vector3(Math.cos(angle) * RADIUS, HEIGHT, Math.sin(angle) * RADIUS));
    }
    const topOutline = makeScreenLine("topOutline", topOutlinePoints, flat ? BABYLON.Color3.White() : new BABYLON.Color3(0, 0.94, 1));
    topOutline.parent = volumeRoot;

    // Grille d'esquisse du mode modélisation : masquée tant qu'on est en mode slicer, elle
    // remplace le volume d'impression pour donner un repère de travail neutre au modéliseur.
    const GRID_WIDTH_AXIS = 2; // px écran — épaisseur des axes colorés, proche des traits de la grille

    const makeGridLines = (
      name: string,
      lines: BABYLON.Vector3[][],
      color: BABYLON.Color3,
      width: number,
      alpha: number,
    ): BABYLON.Mesh => {
      // Trait plat d'épaisseur constante en pixels (comme les autres lignes de la grille), et non
      // un ruban 3D à atténuation de taille, qui paraissait énorme et volumétrique de près.
      // Le shader écarte un sommet situé derrière la caméra : un segment de 2 points (long de
      // milliers de mm une fois mis à l'échelle) disparaîtrait en entier. On le découpe donc en
      // tronçons courts, dont seuls ceux qui franchissent le plan de la caméra sont perdus.
      const SEGMENTS = 400;
      const subdivided = lines.map((pts) => {
        const out: BABYLON.Vector3[] = [];
        for (let i = 0; i < pts.length - 1; i++) {
          for (let k = 0; k < SEGMENTS; k++) out.push(BABYLON.Vector3.Lerp(pts[i], pts[i + 1], k / SEGMENTS));
        }
        out.push(pts[pts.length - 1].clone());
        return out;
      });
      const mesh = createScreenLines(scene, name, subdivided, color, width, alpha, { zOffset: -4 });
      mesh.setEnabled(false);
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

    const modelingGridAxisY = makeGridLines(
      "modelingGridAxisY",
      [[new BABYLON.Vector3(0, -GRID_TILE_EXTENT, 0), new BABYLON.Vector3(0, GRID_TILE_EXTENT, 0)]],
      new BABYLON.Color3(0.23, 0.85, 0.36), GRID_WIDTH_AXIS, 0.9,
    );
    // Axes locaux gris, pour un plan quelconque (face d'un corps) : aucun axe du monde n'y repose.
    const modelingGridAxisU = makeGridLines(
      "modelingGridAxisU",
      [[new BABYLON.Vector3(-GRID_TILE_EXTENT, 0.02, 0), new BABYLON.Vector3(GRID_TILE_EXTENT, 0.02, 0)]],
      new BABYLON.Color3(0.8, 0.82, 0.85), GRID_WIDTH_AXIS, 0.9,
    );
    const modelingGridAxisV = makeGridLines(
      "modelingGridAxisV",
      [[new BABYLON.Vector3(0, 0.02, -GRID_TILE_EXTENT), new BABYLON.Vector3(0, 0.02, GRID_TILE_EXTENT)]],
      new BABYLON.Color3(0.8, 0.82, 0.85), GRID_WIDTH_AXIS, 0.9,
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
      // Pas des traits principaux (mm, valeur « ronde » 1 / 2,5 / 5 / 10 x 10^k choisie côté CPU)
      // et taille monde d'un pixel au niveau de la cible : fixent la grille de TOUT l'écran.
      uniform float uStep;
      uniform float uTargetWpp;
      // Origine du repère de la grille, dans les coordonnées (relatives à l'ancre) de vGridPos.
      uniform vec2 uAxisOrigin;

      // Distance (en pixels) au trait le plus proche d'un quadrillage de pas spacing, à partir
      // d'une position ET d'une dérivée déjà calculées (un seul fwidth(), sur une grandeur
      // continue : cf. historique Git pour les artefacts par bandes).
      float gridMask(vec2 worldXZ, vec2 worldDeriv, float spacing, float halfWidthPx) {
        vec2 coord = worldXZ / spacing;
        vec2 coordDeriv = worldDeriv / spacing;
        vec2 dist = abs(fract(coord + 0.5) - 0.5) / max(coordDeriv, vec2(1e-6));
        float d = min(dist.x, dist.y);
        return 1.0 - clamp(d / halfWidthPx, 0.0, 1.0);
      }

      void main(void) {
        vec2 worldDeriv = fwidth(vGridPos);
        float localWpp = max(max(worldDeriv.x, worldDeriv.y), 1e-12);

        // Deux familles seulement, comme Fusion : traits principaux tous les uStep, traits fins
        // tous les uStep / 5. Rendu identique partout (écarts jugés au niveau de la cible) ; seul
        // un garde-fou anti-moiré omet une famille quand son écart LOCAL tombe sous ~1 px (horizon).
        float majorStep = uStep;
        float minorStep = uStep / 5.0;
        float minorPx = minorStep / uTargetWpp;
        float majorMask = gridMask(vGridPos, worldDeriv, majorStep, 0.9);
        float minorMask = gridMask(vGridPos, worldDeriv, minorStep, 0.55);
        float majorVis = smoothstep(0.7, 1.4, majorStep / localWpp);
        float minorVis = smoothstep(7.0, 16.0, minorPx) * smoothstep(0.7, 1.4, minorStep / localWpp);

        float aMajor = majorMask * majorVis * uMajorAlpha;
        float aMinor = minorMask * minorVis * uMinorAlpha;
        float alpha = max(aMajor, aMinor);
        vec3 color = aMajor >= aMinor ? uMajorColor : uMinorColor;

        // Pixels sous les deux axes colorés (origine du repère de la grille) : les axes les
        // recouvrent, inutile d'y dessiner les traits gris.
        vec2 axisPx = abs(vGridPos - uAxisOrigin) / max(worldDeriv, vec2(1e-12));
        if (min(axisPx.x, axisPx.y) < 2.0) discard;

        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `;
    // Écart écran minimal (px) entre deux traits PRINCIPAUX au niveau de la cible : la grille ne
    // se subdivise qu'au-delà, ce qui donne par défaut ~25 mm / ~150 px comme Fusion. Les traits
    // fins (pas / 5) sont alors à 18 px au moins.
    const GRID_MAJOR_MIN_PX = 90;
    // Pas « ronds » d'une décade (x 10^k), dans l'ordre : le pas principal en est le plus petit
    // dont l'écart écran atteint GRID_MAJOR_MIN_PX.
    const GRID_NICE_STEPS = [1, 2.5, 5, 10];
    // En dessous de ce pas (mm), la géométrie flotte en simple précision : les coordonnées
    // locales divisées par un pas aussi microscopique perdent toute précision fractionnaire
    // (c'est la cause des artefacts constatés « sous 1 mm »). On plafonne donc l'affinement —
    // CPU (étiquettes/axes, cf. updateGrid) et shader (uMinExponent) — à cette décade, et on y
    // arrête aussi le zoom caméra (cf. camera.lowerRadiusLimit plus bas) plutôt que de laisser
    // l'utilisateur zoomer sur une grille devenue incohérente.
    const GRID_MIN_STEP_EXPONENT = -6; // 0,000001 mm
    // Demi-taille du plan : GRID_TILE_EXTENT pas de grille (cf. recenterGridGround).
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
          "worldViewProjection", "uMinorColor", "uMajorColor", "uMinorAlpha", "uMajorAlpha", "uStep", "uTargetWpp",
          "uScale", "uOffset", "uAxisOrigin",
        ],
      },
    );
    modelingGridMat.setColor3("uMinorColor", new BABYLON.Color3(0.6, 0.65, 0.72));
    modelingGridMat.setColor3("uMajorColor", new BABYLON.Color3(0.9, 0.94, 1.0));
    modelingGridMat.setFloat("uMinorAlpha", 0.2);
    modelingGridMat.setFloat("uMajorAlpha", 0.75);
    modelingGridMat.setFloat("uStep", 10);
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

    const modelingGridMeshes = [
      modelingGridGround, modelingGridAxisX, modelingGridAxisY, modelingGridAxisZ, modelingGridAxisU, modelingGridAxisV,
    ];
    const modelingGrid = [...modelingGridMeshes, ...modelingGridLabels.map((l) => l.mesh)];

    // Formate une graduation sans zéros parasites (250, 25, 2.5, 0.25 …).
    const formatGridValue = (v: number) => String(Number(v.toPrecision(6)));

    /**
     * Pas `S` des axes colorés et de leurs graduations chiffrées : on le veut compris entre
     * `GRID_MAJOR_MIN_PX` et 2,5×`GRID_MAJOR_MIN_PX` pixels à l'écran AU NIVEAU DE LA CIBLE — même seuil que
     * `uMinPx` dans le shader du quadrillage, pour que les nombres affichés restent cohérents
     * avec ce qu'on voit près du centre de l'écran (le quadrillage lui-même, lui, s'affine en
     * continu vers la caméra : cf. le commentaire sur `modelingGridGround` plus haut).
     */
    // Demi-étendue visée à l'entrée du mode modélisation, en mm : cadre une dizaine de
    // graduations de part et d'autre de l'origine, le pas restant à 10 mm.
    const GRID_DEFAULT_HALF_EXTENT_MM = 90;
    let gridStepScale = 0; // 0 = jamais appliqué, force le premier passage
    const updateGrid = (worldPerPixel: number) => {
      const wanted = GRID_MAJOR_MIN_PX * worldPerPixel;
      const decade = Math.pow(10, Math.floor(Math.log10(wanted)));
      let step = decade * 10;
      for (const k of GRID_NICE_STEPS) {
        if (decade * k >= wanted) { step = decade * k; break; }
      }
      step = Math.max(step, Math.pow(10, GRID_MIN_STEP_EXPONENT));
      if (step === gridStepScale) return;
      gridStepScale = step;
      modelingGridMat.setFloat("uStep", step);

      [modelingGridAxisX, modelingGridAxisY, modelingGridAxisZ, modelingGridAxisU, modelingGridAxisV]
        .forEach((axisLine) => axisLine.scaling.setAll(step));
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
      // Tout le calcul se fait dans le repère local de la grille (positions des graduations) ;
      // la caméra y est ramenée, et la projection écran applique la matrice du repère.
      const camPos = BABYLON.Vector3.TransformCoordinates(camera.globalPosition, gridFrameInverse);
      const transform = scene.getTransformMatrix();
      const viewport = camera.viewport.toGlobal(renderW, renderH);
      const identity = gridFrameMatrix;
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
        gridTmpLocal.set(axis === 'x' ? along : offset, 0, axis === 'z' ? along : offset);
        BABYLON.Vector3.TransformCoordinatesToRef(gridTmpLocal, gridFrameMatrix, mesh.position);
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
      // Cible dans le repère local de la grille.
      const targetLocal = BABYLON.Vector3.TransformCoordinates(camera.target, gridFrameInverse);
      if (Math.abs(targetLocal.x - gridAnchorX) > margin || Math.abs(targetLocal.z - gridAnchorZ) > margin) {
        const period = step * GRID_ANCHOR_PERIOD_STEPS;
        gridAnchorX = Math.round(targetLocal.x / period) * period;
        gridAnchorZ = Math.round(targetLocal.z / period) * period;
      }
      // Carré fini, comme dans Fusion : demi-côté = GRID_TILE_EXTENT pas (soit la portée des axes
      // et des chiffres), donc il change de taille (×10) à chaque changement d'échelle de grille.
      // Son centre est calé sur un multiple de 10 pas proche de la cible : il ne glisse pas
      // en continu avec le panoramique et reste centré sur l'origine tant qu'on y regarde.
      const scale = GRID_TILE_EXTENT * step;
      const snap = 10 * step;
      const centerX = Math.round(targetLocal.x / snap) * snap;
      const centerZ = Math.round(targetLocal.z / snap) * snap;
      gridTmpLocal.set(centerX, 0, centerZ);
      BABYLON.Vector3.TransformCoordinatesToRef(gridTmpLocal, gridFrameMatrix, modelingGridGround.position);
      modelingGridGround.rotationQuaternion = gridFrameQuat;
      modelingGridGround.scaling.set(scale, 1, scale);
      modelingGridMat.setFloat("uScale", scale);
      modelingGridMat.setFloat(
        "uTargetWpp", (2 * camera.radius * Math.tan(camera.fov / 2)) / engine.getRenderHeight(),
      );
      modelingGridMat.setVector2(
        "uOffset", new BABYLON.Vector2(centerX - gridAnchorX, centerZ - gridAnchorZ),
      );
      modelingGridMat.setVector2("uAxisOrigin", new BABYLON.Vector2(-gridAnchorX, -gridAnchorZ));
    };

    const applyGridAxisVisibility = () => {
      if (!modelingActive) return;
      const p = gridStandardPlane;
      modelingGridAxisX.setEnabled(p === 'XZ' || p === 'XY');
      modelingGridAxisY.setEnabled(p === 'XY' || p === 'YZ');
      modelingGridAxisZ.setEnabled(p === 'XZ' || p === 'YZ');
      modelingGridAxisU.setEnabled(p === null);
      modelingGridAxisV.setEnabled(p === null);
    };

    /**
     * Aligne la grille sur un plan : `ex` / `ez` = axes locaux x / z, `ey` = normale (repère
     * direct : ex x ey = ez). Les axes colorés du monde ne sont affichés que s'ils reposent dans
     * le plan (plans principaux) ; sinon des axes locaux gris. L'ancre du motif est recalculée.
     */
    const setGridFrame = (
      origin: BABYLON.Vector3, ex: BABYLON.Vector3, ey: BABYLON.Vector3, ez: BABYLON.Vector3,
      standard: GridStandardPlane | null,
    ) => {
      const m = new BABYLON.Matrix();
      BABYLON.Matrix.FromXYZAxesToRef(ex, ey, ez, m);
      BABYLON.Quaternion.FromRotationMatrixToRef(m, gridFrameQuat);
      gridFrameOrigin.copyFrom(origin);
      BABYLON.Matrix.ComposeToRef(BABYLON.Vector3.One(), gridFrameQuat, gridFrameOrigin, gridFrameMatrix);
      gridFrameMatrix.invertToRef(gridFrameInverse);
      gridNormal.copyFrom(ey).normalize();
      gridStandardPlane = standard;
      gridAnchorX = Number.POSITIVE_INFINITY;
      gridAnchorZ = Number.POSITIVE_INFINITY;
      modelingGridGround.rotationQuaternion = gridFrameQuat;
      [modelingGridAxisU, modelingGridAxisV].forEach((axisLine) => {
        axisLine.rotationQuaternion = gridFrameQuat;
        axisLine.position.copyFrom(gridFrameOrigin);
      });
      applyGridAxisVisibility();
    };
    const setGridStandardPlane = (plane: GridStandardPlane) => {
      const X = new BABYLON.Vector3(1, 0, 0);
      const Y = new BABYLON.Vector3(0, 1, 0);
      const Z = new BABYLON.Vector3(0, 0, 1);
      const zero = BABYLON.Vector3.Zero();
      if (plane === 'XZ') setGridFrame(zero, X, Y, Z, 'XZ');
      else if (plane === 'XY') setGridFrame(zero, X, Z.scale(-1), Y, 'XY'); // x = X, z = Y
      else setGridFrame(zero, Z, X, Y, 'YZ'); // x = Z, z = Y
    };

    // Empêche de « passer au travers » du plan de travail en zoomant : au lieu de traverser,
    // la grille se subdivise et la caméra reste à distance de sa cible — jusqu'à ce que le pas
    // touche `GRID_MIN_STEP_EXPONENT` (cf. plus haut), où la caméra s'arrête tout à fait plutôt
    // que de continuer sur une grille devenue incohérente en simple précision. Inverse exact de
    // `worldPerPixel = 2·radius·tan(fov/2) / hauteur` pour le `worldPerPixel` qui fait tout juste
    // atteindre ce pas plancher.
    const minWorldPerPixel = Math.pow(10, GRID_MIN_STEP_EXPONENT) / GRID_MAJOR_MIN_PX;
    camera.lowerRadiusLimit = (minWorldPerPixel * engine.getRenderHeight()) / (2 * Math.tan(camera.fov / 2));
    camera.upperRadiusLimit = 100000;
    // Plan de clipping proche d'origine (0,1 par défaut), restauré en quittant la modélisation.
    // En modélisation il suit le rayon (cf. gridZoomObserver) : fixe, il coupait toute la scène
    // une fois la caméra plus proche que lui ; fixé au plus petit rayon possible, il ruinait la
    // précision du tampon de profondeur au zoom normal (rapport far/near démesuré).
    const DEFAULT_CAMERA_MIN_Z = camera.minZ;
    const DEFAULT_CAMERA_MAX_Z = camera.maxZ;
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
      // (en Modélisation : la cible est clouée au plan de la grille, pas forcément horizontal).
      BABYLON.Vector3.TransformCoordinatesToRef(camera.target, gridFrameInverse, gridTmpLocal);
      if (Math.abs(gridTmpLocal.y) > 1e-9) {
        gridTmpLocal.y = 0;
        BABYLON.Vector3.TransformCoordinatesToRef(gridTmpLocal, gridFrameMatrix, camera.target);
      }
      // Plan proche proportionnel au rayon : jamais devant ce qu'on regarde, et un rapport
      // far/near qui reste raisonnable pour le tampon de profondeur (cf. DEFAULT_CAMERA_MIN_Z).
      camera.minZ = camera.radius / 1000;
      // Plan lointain proportionnel lui aussi : à grande échelle (> 10 m de rayon) le plan fixe
      // à 10 000 coupait le sol et la grille, qui semblaient s'effacer au loin.
      camera.maxZ = Math.max(DEFAULT_CAMERA_MAX_Z, camera.radius * 40);

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
      // Entrée comme sortie : la grille repart sur le sol.
      setGridStandardPlane('XZ');
      sketchDrawnMeshes.forEach((m) => m.setEnabled(modeling));

      if (!modeling) {
        lastScaleBarLabel = '';
        lastScaleBarPx = 0;
        setScaleBar(null);
        gridZoomLimitReached = false;
        camera.minZ = DEFAULT_CAMERA_MIN_Z;
        camera.maxZ = DEFAULT_CAMERA_MAX_Z;
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
      // Interface classique : ces boutons sont dans le panneau de gauche (ClassicApp), pas autour du plateau.
      plateActionRoot.setEnabled(!flat && !modelingActive && !plateActionPreviewActive);
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
    const airCallout = createAirContourCallout({
      scene, engine, camera, canvas, layer: gcodeLayer, isPreviewActive: () => gcodePreviewActive,
    });
    if (import.meta.env.DEV) (window as unknown as { __apexEdit?: GCodeEditController }).__apexEdit = editController;
    const onGCodePreviewToggled = (e: Event) => {
      const active = !!(e as CustomEvent<{ active: boolean }>).detail?.active;
      gcodePreviewActive = active;
      originAxesRoot.rotation.y = active ? gcodeLayer.getPlateRotation() : 0;
      gcodeLayer.setEnabled(active);
      modelsRef.current.forEach((m) => { if (!m.isDisposed()) m.setEnabled(!active); });
      editController.refresh();
      airCallout.setPreviewActive();
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
        airCallout.setParsed(detail.parsed);
      });
    };
    const onGCodeTime = (e: Event) => {
      const t = (e as CustomEvent<{ t: number }>).detail?.t;
      if (typeof t === 'number') gcodeLayer.setTime(t);
    };
    const onGCodeLineVisibility = (e: Event) => {
      const visibility = (e as CustomEvent<{ visibility: LineTypeVisibility }>).detail?.visibility;
      if (visibility) { gcodeLayer.setLineTypeVisibility(visibility); airCallout.setLineVisibility(visibility); }
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
      airCallout.dispose();
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

    // Les primitives ne se tracent que sur le plateau : le point visé est ramené à la surface du
    // plateau (PLATE_SURFACE_Y, jamais le niveau du sol) et contenu dans le disque. Avec un coin
    // d'ancrage, le coin mobile est rapproché de l'ancrage jusqu'à ce que le rectangle entier
    // (ses quatre coins) tienne sur le plateau.
    const pickPlatePoint = (anchor: BABYLON.Vector3 | null): { hit: boolean; pickedPoint: BABYLON.Vector3 | null } => {
      const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh === groundPickPlane);
      if (!pick?.hit || !pick.pickedPoint) return { hit: false, pickedPoint: null };
      const target = new BABYLON.Vector3(pick.pickedPoint.x, PLATE_SURFACE_Y, pick.pickedPoint.z);
      const fits = (corner: BABYLON.Vector3) =>
        [
          corner,
          new BABYLON.Vector3(anchor!.x, PLATE_SURFACE_Y, corner.z),
          new BABYLON.Vector3(corner.x, PLATE_SURFACE_Y, anchor!.z),
        ].every((c) => Math.hypot(c.x, c.z) <= RADIUS);

      let point = target;
      if (!anchor) {
        const r = Math.hypot(target.x, target.z);
        if (r > RADIUS) point = new BABYLON.Vector3(target.x * RADIUS / r, PLATE_SURFACE_Y, target.z * RADIUS / r);
      } else if (!fits(target)) {
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if (fits(BABYLON.Vector3.Lerp(anchor, target, mid))) lo = mid;
          else hi = mid;
        }
        point = BABYLON.Vector3.Lerp(anchor, target, lo);
      }
      return { hit: true, pickedPoint: point };
    };

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
      const spawnStagger = isFlatUi() ? 0 : Math.min(28, Math.max(6, 900 / positions.length));

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

      const duration = isFlatUi() ? 1 : 550; // interface classique : aucune animation
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
        // Point visé ramené sur le plateau (cf. pickPlatePoint).
        const pick = pickPlatePoint(boxBaseStart);
        if (!pick?.hit || !pick.pickedPoint) return;

        // Interaction en deux clics façon Fusion 360 (clic-relâche à un coin, clic-relâche
        // à l'autre), pas un cliquer-glisser continu : un clic bref donne un déplacement
        // souris quasi nul entre down et up, ce qui annulait systématiquement le rectangle
        // si on se basait sur la distance parcourue *pendant* le clic. On distingue plutôt
        // le premier clic (pose le coin de départ) du second (valide le coin opposé), et le
        // survol entre les deux prévisualise le rectangle.
        if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
          const corner = boxBaseStart ?? pick.pickedPoint;
          const min = new BABYLON.Vector3(Math.min(corner.x, pick.pickedPoint.x), PLATE_SURFACE_Y, Math.min(corner.z, pick.pickedPoint.z));
          const max = new BABYLON.Vector3(Math.max(corner.x, pick.pickedPoint.x), PLATE_SURFACE_Y + 0.01, Math.max(corner.z, pick.pickedPoint.z));
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
        const min = new BABYLON.Vector3(Math.min(boxBaseStart.x, boxBaseCorner.x), PLATE_SURFACE_Y, Math.min(boxBaseStart.z, boxBaseCorner.z));
        const max = new BABYLON.Vector3(Math.max(boxBaseStart.x, boxBaseCorner.x), PLATE_SURFACE_Y, Math.max(boxBaseStart.z, boxBaseCorner.z));

        if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
          const originScreen = BABYLON.Vector3.Project(
            new BABYLON.Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2),
            BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
            camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
          );
          const pixelsPerMm = 3;
          const rawHeight = Math.max(0, (originScreen.y - scene.pointerY) / pixelsPerMm);
          boxExtrudeHeight = Math.min(HEIGHT, rawHeight);
          const extrudedMax = new BABYLON.Vector3(max.x, PLATE_SURFACE_Y + boxExtrudeHeight, max.z);
          boxPreviewOutline = buildBoxOutline(min, extrudedMax, boxPreviewOutline);
        } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
          if (boxExtrudeHeight < 1) return; // évite un pavé nul sur double-clic accidentel
          boxPhase = 'filling';
          groundPickPlane.isPickable = false;
          disposeBoxPreview();
          runVoxelFillAnimation(min, new BABYLON.Vector3(max.x, PLATE_SURFACE_Y + boxExtrudeHeight, max.z));
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
        const y = min.y + height * t;
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
      const spawnStagger = isFlatUi() ? 0 : Math.min(90, Math.max(40, 700 / ringCount));

      Array.from({ length: ringCount }, (_, i) => {
        const t = ringCount === 1 ? 0 : i / (ringCount - 1);
        const scale = 1 - t;
        const w = (max.x - min.x) * scale;
        const d = (max.z - min.z) * scale;
        const y = min.y + height * t;
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

      const duration = isFlatUi() ? 1 : 550; // interface classique : aucune animation
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
        const pick = pickPlatePoint(pyramidBaseStart);
        if (!pick?.hit || !pick.pickedPoint) return;

        if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
          const corner = pyramidBaseStart ?? pick.pickedPoint;
          const min = new BABYLON.Vector3(Math.min(corner.x, pick.pickedPoint.x), PLATE_SURFACE_Y, Math.min(corner.z, pick.pickedPoint.z));
          const max = new BABYLON.Vector3(Math.max(corner.x, pick.pickedPoint.x), PLATE_SURFACE_Y, Math.max(corner.z, pick.pickedPoint.z));
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
        const min = new BABYLON.Vector3(Math.min(pyramidBaseStart.x, pyramidBaseCorner.x), PLATE_SURFACE_Y, Math.min(pyramidBaseStart.z, pyramidBaseCorner.z));
        const max = new BABYLON.Vector3(Math.max(pyramidBaseStart.x, pyramidBaseCorner.x), PLATE_SURFACE_Y, Math.max(pyramidBaseStart.z, pyramidBaseCorner.z));

        if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
          // Même dérivation écran→hauteur que Boîte, indépendante du pick au sol pour ne
          // pas geler quand le curseur sort de l'étendue finie du plan de pick.
          const originScreen = BABYLON.Vector3.Project(
            new BABYLON.Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2),
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
      applyModelShading();
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
      uniform vec4 tintColor;
      void main(void) {
        // Couleur unie (plus de verre dépoli teinté) : gris clair par défaut, cyan clair au survol.
        gl_FragColor = vec4(tintColor.rgb, 1.0);
      }
    `;
    const makeSketchPlaneGlassMat = (name: string, tint: BABYLON.Color4): BABYLON.ShaderMaterial => {
      const mat = new BABYLON.ShaderMaterial(name, scene, { vertex: "sketchPlaneGlass", fragment: "sketchPlaneGlass" }, {
        attributes: ["position"],
        uniforms: ["worldViewProjection", "tintColor"],
      });
      mat.setColor4("tintColor", tint);
      mat.backFaceCulling = false;
      return mat;
    };

    // Teinte neutre bleu-gris par défaut, cyan (l'accent déjà utilisé partout dans l'app) au
    // survol — la 4e composante est la force du mélange avec l'arrière-plan flouté.
    const sketchPlaneDefaultMat = makeSketchPlaneGlassMat("sketchPlaneDefaultMat", new BABYLON.Color4(0.78, 0.8, 0.82, 1));
    const sketchPlaneHoverMat = makeSketchPlaneGlassMat("sketchPlaneHoverMat", new BABYLON.Color4(0.55, 0.9, 0.95, 1));

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
      // Groupe 2 SANS effacement du tampon de profondeur : les plaques, opaques, passent par-dessus
      // la grille (groupe 0, coplanaire pour XZ) et les chiffres (groupe 1, ancrés derrière elles
      // comme devant elles), tout en restant triées entre elles par la profondeur.
      plate.renderingGroupId = 2;
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

    scene.setRenderingAutoClearDepthStencil(2, false);
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
      mesh.renderingGroupId = 3; // par-dessus les plaques (groupe 2)
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
      line.renderingGroupId = 3;
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

    // Taille écran constante : tout le décor (plaques, repère, axes) est mis à l'échelle autour
    // de l'origine à chaque image, proportionnellement à la distance caméra-origine, pour que
    // l'ensemble occupe toujours la même fraction de la hauteur de l'écran quel que soit le zoom.
    const SKETCH_PLANE_SCREEN_FRACTION = 0.14;
    const sketchPlaneBasePositions = new Map<BABYLON.Mesh, BABYLON.Vector3>(
      sketchPlanePlates.map((p) => [p, p.position.clone()]),
    );
    const sketchPlaneScaleObserver = scene.onBeforeRenderObservable.add(() => {
      if (!sketchPlanePickActive) return;
      const distance = BABYLON.Vector3.Distance(camera.position, BABYLON.Vector3.Zero());
      const visibleHeight = 2 * distance * Math.tan(camera.fov / 2);
      const k = Math.max(1e-9, (SKETCH_PLANE_SCREEN_FRACTION * visibleHeight) / sketchAxisEnd);
      sketchPlanePlates.forEach((p) => {
        p.position.copyFrom(sketchPlaneBasePositions.get(p)!).scaleInPlace(k);
        p.scaling.setAll(k);
      });
      sketchPlaneOrigin.scaling.setAll(k);
      sketchPlaneAxisLines.forEach((l) => l.scaling.setAll(k));
    });

    // Orbite (bouton droit, clavier, tactile) interdite pendant le dessin d'une esquisse :
    // elle commence au choix du plan et s'arrête quand l'outil change, qu'on relance le choix du
    // plan, qu'on l'annule ou qu'on quitte l'espace. Le panoramique et le zoom restent libres.
    const setOrbitLocked = (locked: boolean) => {
      sketchOrbitLocked = locked;
      applyPanMode(); // reconstruit la table des commandes (pan en perspective compris)
    };
    // Vue d'avant l'outil Esquisse : prise au clic sur le bouton Esquisse (choix du plan), rendue par
    // « Terminer l'esquisse » (`apex-sketch-finished`) — caméra, décalage d'image et repère de la grille.
    interface SketchViewSnapshot {
      alpha: number; beta: number; radius: number; target: BABYLON.Vector3;
      lens: { x: number; y: number };
      frameOrigin: BABYLON.Vector3; frameQuat: BABYLON.Quaternion; standard: GridStandardPlane | null;
    }
    let sketchViewSnapshot: SketchViewSnapshot | null = null;
    const saveSketchView = () => {
      if (sketchViewSnapshot) return;
      sketchViewSnapshot = {
        alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone(),
        lens: { x: lensShift.x, y: lensShift.y },
        frameOrigin: gridFrameOrigin.clone(), frameQuat: gridFrameQuat.clone(), standard: gridStandardPlane,
      };
    };
    const clearSketchView = () => { sketchViewSnapshot = null; };
    const restoreSketchView = () => {
      const snap = sketchViewSnapshot;
      sketchViewSnapshot = null;
      if (!snap) return;
      // Repère de la grille : retrouvé à l'identique (plan principal ou face quelconque).
      if (snap.standard) setGridStandardPlane(snap.standard);
      else {
        setGridFrame(
          snap.frameOrigin,
          new BABYLON.Vector3(1, 0, 0).applyRotationQuaternion(snap.frameQuat),
          new BABYLON.Vector3(0, 1, 0).applyRotationQuaternion(snap.frameQuat),
          new BABYLON.Vector3(0, 0, 1).applyRotationQuaternion(snap.frameQuat),
          null,
        );
      }
      lensShift.x = snap.lens.x;
      lensShift.y = snap.lens.y;
      const FRAMES = 20;
      const floatAnim = (name: string, prop: string, from: number, to: number) => {
        const a = new BABYLON.Animation(name, prop, 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
        a.setKeys([{ frame: 0, value: from }, { frame: FRAMES, value: to }]);
        return a;
      };
      const targetAnim = new BABYLON.Animation(
        'sketchRestoreTarget', 'target', 60, BABYLON.Animation.ANIMATIONTYPE_VECTOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
      targetAnim.setKeys([{ frame: 0, value: camera.target.clone() }, { frame: FRAMES, value: snap.target }]);
      scene.beginDirectAnimation(camera, [
        floatAnim('sketchRestoreAlpha', 'alpha', camera.alpha, snap.alpha),
        floatAnim('sketchRestoreBeta', 'beta', camera.beta, snap.beta),
        floatAnim('sketchRestoreRadius', 'radius', camera.radius, snap.radius),
        targetAnim,
      ], 0, FRAMES, false);
    };
    window.addEventListener('apex-sketch-plane-pick-start', saveSketchView);
    window.addEventListener('apex-sketch-finished', restoreSketchView);
    window.addEventListener('apex-sketch-plane-pick-cancel', clearSketchView);
    window.addEventListener('apex-mode-changed', clearSketchView);

    const lockOrbit = () => setOrbitLocked(true);
    const unlockOrbit = () => setOrbitLocked(false);
    window.addEventListener('apex-sketch-plane-selected', lockOrbit);
    window.addEventListener('apex-tool-changed', unlockOrbit);
    window.addEventListener('apex-sketch-plane-pick-start', unlockOrbit);
    window.addEventListener('apex-sketch-plane-pick-cancel', unlockOrbit);
    window.addEventListener('apex-mode-changed', unlockOrbit);

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
      // Comme les vues prédéfinies du ViewCube : sans remise à zéro du décalage d'image (pan), la
      // vue reste oblique après le clic. L'azimut prend le chemin le plus court.
      resetLensShift();
      alpha = camera.alpha + Math.atan2(Math.sin(alpha - camera.alpha), Math.cos(alpha - camera.alpha));
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
      // Clic gauche seulement : le clic droit et le clic molette servent à orbiter / se déplacer.
      if ((pointerInfo.event as PointerEvent).button !== 0) return;

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
        // Vue alignée sur l'écran (x de la grille à droite, z en haut), cf. GRID_ALIGNED_VIEW.
        orientCameraToPlane(GRID_ALIGNED_VIEW[axis].alpha, GRID_ALIGNED_VIEW[axis].beta);
        setGridStandardPlane(axis);
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
      // Face horizontale : l'azimut n'est pas défini par la normale, on prend celui de la vue
      // alignée du plan XZ (x à droite, z en haut).
      const horizontal = Math.abs(n.y) > 0.99;
      const beta = horizontal ? (n.y > 0 ? 0.01 : Math.PI - 0.01) : Math.acos(Math.max(-1, Math.min(1, n.y)));
      const alpha = horizontal ? -Math.PI / 2 : Math.atan2(n.z, n.x);
      orientCameraToPlane(alpha, beta);

      // Grille alignée sur la face : origine au point cliqué, normale = normale de la face,
      // axe x horizontal (ou X du monde pour une face horizontale), z = x vectoriel normale.
      // Caméra du côté de la normale : x doit pointer vers la droite de l'écran, soit n x haut
      // (main gauche), et z = x x n pointe alors vers le haut de l'écran.
      const faceX = horizontal
        ? new BABYLON.Vector3(1, 0, 0)
        : BABYLON.Vector3.Cross(n, BABYLON.Vector3.Up()).normalize();
      const faceZ = BABYLON.Vector3.Cross(faceX, n).normalize();
      setGridFrame(pick.pickedPoint, faceX, n, faceZ, null);

      window.dispatchEvent(new CustomEvent('apex-sketch-plane-selected', {
        detail: {
          kind: 'face',
          origin: { x: pick.pickedPoint.x, y: pick.pickedPoint.y, z: pick.pickedPoint.z },
          normal: { x: normal.x, y: normal.y, z: normal.z },
        },
      }));
    });

    // ---------------------------------------------------------------------------------
    // Outil Rectangle de l'esquisse : curseur « + » blanc aimanté aux traits fins de la grille
    // (carré bleu autour quand il l'est), tracé au clic-clic ou au glisser. Le rectangle vit dans
    // le repère de la grille (aligné sur le plan d'esquisse) ; ses points sont envoyés à l'arbre
    // des features (`apex-sketch-entity-added`) en coordonnées locales du plan (x, z de la grille).
    // ---------------------------------------------------------------------------------
    const SKETCH_SNAP_RADIUS_PX = 7;
    const SKETCH_DRAG_FINISH_PX = 6;
    let sketchRectActive = false;
    let sketchRectStart: { x: number; z: number } | null = null;
    let sketchRectDownClient: { x: number; y: number } | null = null;
    let sketchRectPreview: BABYLON.Mesh | null = null;
    let sketchRectCounter = 0;
    const sketchDrawnMeshes: BABYLON.Mesh[] = [];

    const sketchLocalToWorld = (x: number, z: number) =>
      BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(x, 0, z), gridFrameMatrix);
    const makeSketchRectMesh = (
      name: string, a: { x: number; z: number }, b: { x: number; z: number }, color: BABYLON.Color3,
    ) => {
      const loop = [
        sketchLocalToWorld(a.x, a.z), sketchLocalToWorld(b.x, a.z),
        sketchLocalToWorld(b.x, b.z), sketchLocalToWorld(a.x, b.z), sketchLocalToWorld(a.x, a.z),
      ];
      const mesh = createScreenLine(scene, name, loop, color, 2.5, 1);
      mesh.isPickable = false;
      mesh.renderingGroupId = 3;
      return mesh;
    };

    /** Point de la grille sous la souris : coordonnées locales, aimanté ou non, et position écran. */
    const sketchPointUnderPointer = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const sx = engine.getRenderWidth() / rect.width;
      const sy = engine.getRenderHeight() / rect.height;
      const ray = scene.createPickingRay(
        (clientX - rect.left) * sx, (clientY - rect.top) * sy, BABYLON.Matrix.Identity(), camera,
      );
      const denom = BABYLON.Vector3.Dot(ray.direction, gridNormal);
      if (Math.abs(denom) < 1e-6) return null;
      const t = BABYLON.Vector3.Dot(gridFrameOrigin.subtract(ray.origin), gridNormal) / denom;
      if (t <= 0) return null;
      const local = BABYLON.Vector3.TransformCoordinates(ray.origin.add(ray.direction.scale(t)), gridFrameInverse);
      // Aimantation sur les traits fins (pas principal / 5), si le sommet le plus proche est
      // à moins de SKETCH_SNAP_RADIUS_PX de la souris.
      const minor = Math.max(gridStepScale, 1e-9) / 5;
      const snapX = Math.round(local.x / minor) * minor;
      const snapZ = Math.round(local.z / minor) * minor;
      const projected = BABYLON.Vector3.Project(
        sketchLocalToWorld(snapX, snapZ), BABYLON.Matrix.IdentityReadOnly, scene.getTransformMatrix(),
        camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
      );
      const snapClientX = rect.left + projected.x / sx;
      const snapClientY = rect.top + projected.y / sy;
      const snapped = Math.hypot(snapClientX - clientX, snapClientY - clientY) <= SKETCH_SNAP_RADIUS_PX;
      return snapped
        ? { x: snapX, z: snapZ, snapped, clientX: snapClientX, clientY: snapClientY }
        : { x: local.x, z: local.z, snapped, clientX, clientY };
    };

    // --- Champs de saisie longueur / largeur (après le premier clic, outil Rectangle seulement) ---
    // Champ 0 = longueur (axe x de la grille), champ 1 = largeur (axe z). Un champ « modifié » porte
    // le texte de l'utilisateur, qui prime sur la souris ; « verrouillé » (Tab sur une valeur
    // valide) garde sa valeur quoi que fasse la souris. Valeur invalide (négative, non numérique,
    // vide ou 0) : contour rouge, et Tab remet l'ancienne valeur au lieu de verrouiller.
    interface SketchDimField { locked: boolean; value: number; modified: boolean; lastGood: number }
    const newDimFields = (): SketchDimField[] =>
      [0, 1].map(() => ({ locked: false, value: 0, modified: false, lastGood: 0 }));
    let sketchDims = newDimFields();
    let sketchDimActive = 0;
    let sketchMouse: { x: number; z: number } | null = null;
    let sketchRectEnd: { x: number; z: number } | null = null;
    const sketchSign = { x: 1, z: 1 };
    const SKETCH_DIM_OFFSET_PX = 26;
    // Ombre portée des champs ; le contour rouge d'une valeur invalide s'y ajoute.
    const SKETCH_DIM_SHADOW = '0 4px 14px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.35)';
    const SKETCH_DIM_SHADOW_INVALID = `0 0 0 2px #ff453a, ${SKETCH_DIM_SHADOW}`;

    const parseDim = (text: string) => {
      const trimmed = text.trim();
      return trimmed === '' ? NaN : Number(trimmed.replace(',', '.'));
    };
    const isValidDim = (v: number) => Number.isFinite(v) && v > 0;
    const formatDim = (v: number) => String(Number(v.toFixed(3)));
    const dimInput = (i: number) => sketchDimInputs.current[i];

    const sketchClientOf = (x: number, z: number) => {
      const rect = canvas.getBoundingClientRect();
      const sx = engine.getRenderWidth() / Math.max(rect.width, 1);
      const sy = engine.getRenderHeight() / Math.max(rect.height, 1);
      const p = BABYLON.Vector3.Project(
        sketchLocalToWorld(x, z), BABYLON.Matrix.IdentityReadOnly, scene.getTransformMatrix(),
        camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
      );
      return { x: rect.left + p.x / sx, y: rect.top + p.y / sy };
    };

    const effectiveDim = (i: number, mouseDim: number) => {
      const f = sketchDims[i];
      if (f.modified) {
        const v = parseDim(dimInput(i)?.value ?? '');
        if (isValidDim(v)) return v;
      }
      return f.locked ? f.value : mouseDim;
    };

    const clearSketchRectPreview = () => {
      sketchRectPreview?.dispose();
      sketchRectPreview = null;
    };

    /** Recalcule le rectangle (souris + champs), son aperçu, les champs et leur position. */
    const updateSketchRect = () => {
      const start = sketchRectStart;
      if (!start || !sketchMouse) return;
      const dx = sketchMouse.x - start.x;
      const dz = sketchMouse.z - start.z;
      if (Math.abs(dx) > 1e-9) sketchSign.x = Math.sign(dx);
      if (Math.abs(dz) > 1e-9) sketchSign.z = Math.sign(dz);
      const lengthDim = effectiveDim(0, Math.abs(dx));
      const widthDim = effectiveDim(1, Math.abs(dz));
      const end = { x: start.x + sketchSign.x * lengthDim, z: start.z + sketchSign.z * widthDim };
      sketchRectEnd = end;

      clearSketchRectPreview();
      sketchRectPreview = makeSketchRectMesh('sketchRectPreview', start, end, new BABYLON.Color3(0.45, 0.8, 1));

      const shown = [lengthDim, widthDim];
      for (let i = 0; i < 2; i += 1) {
        const input = dimInput(i);
        const f = sketchDims[i];
        if (!f.modified && shown[i] > 0) f.lastGood = shown[i];
        if (!input) continue;
        if (!f.modified) input.value = formatDim(shown[i]);
        input.style.boxShadow = isValidDim(parseDim(input.value)) ? SKETCH_DIM_SHADOW : SKETCH_DIM_SHADOW_INVALID;
      }

      // Champs à côté des deux côtés « d'arrivée » (opposés au premier point), côté extérieur.
      const centre = sketchClientOf((start.x + end.x) / 2, (start.z + end.z) / 2);
      const place = (i: number, ex: number, ez: number, fallback: { x: number; y: number }) => {
        const input = dimInput(i);
        if (!input) return;
        const edge = sketchClientOf(ex, ez);
        let vx = edge.x - centre.x;
        let vy = edge.y - centre.y;
        const len = Math.hypot(vx, vy);
        if (len < 1e-3) { vx = fallback.x; vy = fallback.y; } else { vx /= len; vy /= len; }
        input.style.left = `${edge.x + vx * SKETCH_DIM_OFFSET_PX}px`;
        input.style.top = `${edge.y + vy * SKETCH_DIM_OFFSET_PX}px`;
      };
      place(0, (start.x + end.x) / 2, end.z, { x: 0, y: 1 });
      place(1, end.x, (start.z + end.z) / 2, { x: 1, y: 0 });
    };

    const focusDim = (i: number, selectAll = true) => {
      sketchDimActive = i;
      const el = dimInput(i);
      if (!el) return;
      el.focus({ preventScroll: true });
      if (selectAll) el.select();
    };
    const hideSketchDims = () => {
      setSketchDimsShown(false);
      sketchDims = newDimFields();
      sketchDimActive = 0;
      sketchMouse = null;
      sketchRectEnd = null;
    };

    const setSketchRectActive = (active: boolean) => {
      sketchRectActive = active;
      sketchRectStart = null;
      sketchRectDownClient = null;
      clearSketchRectPreview();
      hideSketchDims();
      if (!active) setSketchCursor(null);
      canvas.style.cursor = active ? 'none' : '';
    };
    const cancelSketchRect = () => {
      sketchRectStart = null;
      sketchRectDownClient = null;
      clearSketchRectPreview();
      hideSketchDims();
    };
    const finishSketchRect = (end: { x: number; z: number }) => {
      const start = sketchRectStart;
      cancelSketchRect();
      if (!start) return;
      if (Math.abs(end.x - start.x) < 1e-9 || Math.abs(end.z - start.z) < 1e-9) return;
      sketchRectCounter += 1;
      const id = `sketchRect${sketchRectCounter}`;
      sketchDrawnMeshes.push(makeSketchRectMesh(id, start, end, BABYLON.Color3.White()));
      registerSketchFace(id, start, end); // profil sélectionnable par l'outil Extrusion
      window.dispatchEvent(new CustomEvent('apex-sketch-entity-added', {
        detail: {
          entity: {
            id, kind: 'rectangle',
            points: [{ x: start.x, y: start.z }, { x: end.x, y: end.z }],
          },
        },
      }));
    };

    const onSketchRectMove = (e: PointerEvent) => {
      if (!sketchRectActive) return;
      canvas.style.cursor = 'none';
      const pt = sketchPointUnderPointer(e.clientX, e.clientY);
      if (!pt) { setSketchCursor(null); return; }
      setSketchCursor({ x: pt.clientX, y: pt.clientY, snapped: pt.snapped });
      if (sketchRectStart) {
        sketchMouse = { x: pt.x, z: pt.z };
        updateSketchRect();
      }
    };
    const finishFromPoint = (pt: { x: number; z: number }) => {
      sketchMouse = { x: pt.x, z: pt.z };
      updateSketchRect();
      if (sketchRectEnd) finishSketchRect(sketchRectEnd);
    };
    const refocusDim = () => {
      if (!sketchRectStart) return;
      requestAnimationFrame(() => focusDim(sketchDimActive, !sketchDims[sketchDimActive].modified));
    };
    const onSketchRectDown = (e: PointerEvent) => {
      if (!sketchRectActive || e.button !== 0) return;
      const pt = sketchPointUnderPointer(e.clientX, e.clientY);
      if (!pt) return;
      if (!sketchRectStart) {
        sketchRectStart = { x: pt.x, z: pt.z };
        sketchRectDownClient = { x: e.clientX, y: e.clientY };
        sketchMouse = { x: pt.x, z: pt.z };
        sketchDims = newDimFields();
        sketchDimActive = 0;
        setSketchDimsShown(true);
        // Les champs sont montés au prochain rendu : on les positionne et focalise ensuite.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!sketchRectStart) return;
          updateSketchRect();
          focusDim(0);
        }));
      } else {
        finishFromPoint(pt); // second clic
      }
    };
    const onSketchRectUp = (e: PointerEvent) => {
      if (!sketchRectActive || e.button !== 0 || !sketchRectStart || !sketchRectDownClient) return;
      // Glisser : le relâchement loin du point de départ termine le rectangle.
      if (Math.hypot(e.clientX - sketchRectDownClient.x, e.clientY - sketchRectDownClient.y) > SKETCH_DRAG_FINISH_PX) {
        const pt = sketchPointUnderPointer(e.clientX, e.clientY);
        if (pt) { finishFromPoint(pt); return; }
      }
      refocusDim();
    };
    const onSketchRectLeave = () => { if (sketchRectActive) setSketchCursor(null); };
    const onSketchRectKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sketchRectActive && sketchRectStart) cancelSketchRect();
    };

    const onDimInput = (i: number) => {
      sketchDims[i].modified = true;
      updateSketchRect();
    };
    const onDimKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      // Aucune touche saisie ici ne doit atteindre les raccourcis globaux (Suppr, Ctrl+Z…).
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); cancelSketchRect(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        updateSketchRect();
        if (sketchRectEnd) finishSketchRect(sketchRectEnd);
        return;
      }
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const f = sketchDims[i];
      const el = dimInput(i);
      if (el && f.modified) {
        const v = parseDim(el.value);
        if (isValidDim(v)) {
          f.locked = true; // valeur modifiée et valide : verrouillée
          f.value = v;
          f.modified = false;
          el.value = formatDim(v);
        } else {
          f.modified = false; // invalide : on remet simplement l'ancienne valeur
          el.value = formatDim(f.locked ? f.value : f.lastGood);
        }
      }
      updateSketchRect();
      focusDim((i + 1) % 2);
    };
    sketchDimsApi.current = { onKey: onDimKey, onInput: onDimInput };

    canvas.addEventListener('pointermove', onSketchRectMove);
    canvas.addEventListener('pointerdown', onSketchRectDown);
    canvas.addEventListener('pointerup', onSketchRectUp);
    canvas.addEventListener('pointerleave', onSketchRectLeave);
    window.addEventListener('keydown', onSketchRectKey);

    const onSketchToolEvent = (e: Event) => {
      const entity = (e as CustomEvent<{ entity: string | null }>).detail?.entity ?? null;
      setSketchRectActive(entity === 'rectangle');
    };
    const onSketchRectDeactivate = () => setSketchRectActive(false);
    window.addEventListener('apex-sketch-tool', onSketchToolEvent);
    [
      'apex-tool-changed', 'apex-sketch-plane-pick-start', 'apex-sketch-plane-pick-cancel',
      'apex-mode-changed', 'apex-sketch-plane-selected',
    ].forEach((name) => window.addEventListener(name, onSketchRectDeactivate));

    // ---------------------------------------------------------------------------------
    // Outil Extrusion : sélection d'une FACE (mode de sélection « Face ») puis flèche parallèle à sa
    // normale, cliquable et déplaçable pour régler la distance. Faces sélectionnables : les profils
    // rectangulaires tracés en esquisse (plan surfacique) et les faces planes des modèles (ensemble
    // des triangles coplanaires de la face cliquée). La distance est échangée avec le panneau par
    // `apex-extrude-distance` (flèche → panneau) et `apex-extrude-set-distance` (panneau → flèche).
    // ---------------------------------------------------------------------------------
    let selectionModeNow = 'body';
    let extrudeToolActive = false;
    const isExtrudeFaceMode = () => extrudeToolActive && selectionModeNow === 'face';
    // Sélection de face hors outil Extrusion (demande de l'utilisateur, 2026-10-20) : en Modélisation,
    // outil de sélection courant, le survol d'une face plane la surligne et le clic la choisit comme
    // avec l'outil Extrusion, mais sans flèche ni ouverture du panneau Extrusion.
    let modelingNow = false;
    let currentToolNow = 'select';
    const isFaceBrowseMode = () => modelingNow && currentToolNow === 'select' && !sketchRectActive;
    const isFacePickMode = () => isExtrudeFaceMode() || isFaceBrowseMode();
    interface ExtrudeFace {
      kind: 'sketch' | 'mesh';
      origin: BABYLON.Vector3;
      normal: BABYLON.Vector3;
      modelName?: string;
    }
    let extrudeFace: ExtrudeFace | null = null;
    let extrudeDistance = 0;
    let extrudeOverlay: BABYLON.Mesh | null = null;
    let extrudeGhost: BABYLON.Mesh | null = null;
    let extrudeArrowRoot: BABYLON.TransformNode | null = null;
    let extrudeArrowMeshes: BABYLON.Mesh[] = [];
    let extrudeDrag: { startS: number; startT: number; moved: boolean; startClientX: number; startClientY: number } | null = null;
    const sketchFaceMeshes: BABYLON.Mesh[] = [];
    const EXTRUDE_COLOR = new BABYLON.Color3(0, 0.94, 1);

    const extrudeFaceMaterial = new BABYLON.StandardMaterial('extrudeFaceMat', scene);
    extrudeFaceMaterial.emissiveColor = EXTRUDE_COLOR;
    extrudeFaceMaterial.disableLighting = true;
    extrudeFaceMaterial.alpha = 0.38;
    extrudeFaceMaterial.backFaceCulling = false;
    extrudeFaceMaterial.zOffset = -4;
    const extrudeGhostMaterial = extrudeFaceMaterial.clone('extrudeGhostMat');
    extrudeGhostMaterial.alpha = 0.18;
    const extrudeArrowMaterial = new BABYLON.StandardMaterial('extrudeArrowMat', scene);
    extrudeArrowMaterial.emissiveColor = EXTRUDE_COLOR;
    extrudeArrowMaterial.disableLighting = true;

    /** Quadrilatère plein, en coordonnées monde (pour un profil rectangulaire d'esquisse). */
    const makeQuadMesh = (name: string, corners: BABYLON.Vector3[]) => {
      const mesh = new BABYLON.Mesh(name, scene);
      const vd = new BABYLON.VertexData();
      vd.positions = corners.flatMap((c) => [c.x, c.y, c.z]);
      vd.indices = [0, 1, 2, 0, 2, 3];
      vd.applyToMesh(mesh);
      return mesh;
    };

    /**
     * Profils tracés = plans surfaciques sélectionnables pour l'outil Extrusion. Les rectangles d'un
     * même plan sont découpés selon leurs recouvrements : toutes leurs arêtes forment un quadrillage
     * compressé dont chaque cellule connaît les rectangles qui la couvrent ; une RÉGION est un ensemble
     * connexe de cellules couvertes par les mêmes rectangles. Un rectangle contenu dans un autre donne
     * donc deux régions (l'anneau et l'intérieur), deux rectangles qui se croisent trois, et chaque
     * région se sélectionne indépendamment.
     */
    interface SketchRect { id: string; x1: number; x2: number; z1: number; z2: number }
    interface SketchCell { mesh: BABYLON.Mesh; i: number; j: number; sig: string; corners: BABYLON.Vector3[] }
    interface SketchFaceGroup {
      matrix: BABYLON.Matrix;
      normal: BABYLON.Vector3;
      rects: SketchRect[];
      cells: Map<string, SketchCell>;
    }
    const sketchFaceGroups: SketchFaceGroup[] = [];
    const sketchFaceMaterial = new BABYLON.StandardMaterial('sketchFaceMat', scene);
    sketchFaceMaterial.emissiveColor = BABYLON.Color3.White();
    sketchFaceMaterial.disableLighting = true;
    sketchFaceMaterial.alpha = 0.05;
    sketchFaceMaterial.backFaceCulling = false;

    const sameMatrix = (a: BABYLON.Matrix, b: BABYLON.Matrix) =>
      a.m.every((value, k) => Math.abs(value - b.m[k]) < 1e-6);

    const rebuildSketchFaceGroup = (group: SketchFaceGroup, groupIndex: number) => {
      group.cells.forEach((cell) => {
        const at = sketchFaceMeshes.indexOf(cell.mesh);
        if (at >= 0) sketchFaceMeshes.splice(at, 1);
        const drawn = sketchDrawnMeshes.indexOf(cell.mesh);
        if (drawn >= 0) sketchDrawnMeshes.splice(drawn, 1);
        cell.mesh.dispose();
      });
      group.cells.clear();
      const xs = Array.from(new Set(group.rects.flatMap((r) => [r.x1, r.x2]))).sort((a, b) => a - b);
      const zs = Array.from(new Set(group.rects.flatMap((r) => [r.z1, r.z2]))).sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 1) {
        for (let j = 0; j + 1 < zs.length; j += 1) {
          const cx = (xs[i] + xs[i + 1]) / 2;
          const cz = (zs[j] + zs[j + 1]) / 2;
          const sig = group.rects
            .filter((r) => cx > r.x1 && cx < r.x2 && cz > r.z1 && cz < r.z2)
            .map((r) => r.id).sort().join('+');
          if (!sig) continue;
          const corners = [[xs[i], zs[j]], [xs[i + 1], zs[j]], [xs[i + 1], zs[j + 1]], [xs[i], zs[j + 1]]]
            .map(([x, z]) => BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(x, 0, z), group.matrix));
          const mesh = makeQuadMesh(`sketchFace_${groupIndex}_${i}_${j}`, corners);
          mesh.material = sketchFaceMaterial;
          mesh.isPickable = true;
          mesh.metadata = { sketchCell: { group: groupIndex, key: `${i},${j}` } };
          sketchFaceMeshes.push(mesh);
          sketchDrawnMeshes.push(mesh);
          group.cells.set(`${i},${j}`, { mesh, i, j, sig, corners });
        }
      }
    };

    const registerSketchFace = (id: string, a: { x: number; z: number }, b: { x: number; z: number }) => {
      let index = sketchFaceGroups.findIndex((g) => sameMatrix(g.matrix, gridFrameMatrix));
      if (index < 0) {
        sketchFaceGroups.push({
          matrix: gridFrameMatrix.clone(), normal: gridNormal.clone(), rects: [], cells: new Map(),
        });
        index = sketchFaceGroups.length - 1;
      }
      const group = sketchFaceGroups[index];
      group.rects.push({
        id, x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), z1: Math.min(a.z, b.z), z2: Math.max(a.z, b.z),
      });
      rebuildSketchFaceGroup(group, index);
    };

    /** Région (cellules connexes de même recouvrement) à laquelle appartient une cellule. */
    const sketchRegionOf = (groupIndex: number, key: string) => {
      const group = sketchFaceGroups[groupIndex];
      const start = group?.cells.get(key);
      if (!group || !start) return null;
      const keys = new Set<string>([key]);
      const queue = [start];
      while (queue.length > 0) {
        const cell = queue.pop()!;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([di, dj]) => {
          const nk = `${cell.i + di},${cell.j + dj}`;
          const next = group.cells.get(nk);
          if (next && next.sig === start.sig && !keys.has(nk)) { keys.add(nk); queue.push(next); }
        });
      }
      const positions: number[] = [];
      keys.forEach((k) => {
        const c = group.cells.get(k)!.corners;
        [0, 1, 2, 0, 2, 3].forEach((n) => positions.push(c[n].x, c[n].y, c[n].z));
      });
      return { keys, positions, normal: group.normal };
    };

    const isUnderModel = (mesh: BABYLON.Node | null): BABYLON.Node | null => {
      let node: BABYLON.Node | null = mesh;
      while (node) {
        if (modelsRef.current.has(node as BABYLON.Mesh)) return node;
        node = node.parent;
      }
      return null;
    };

    /** Triangles coplanaires (même plan) à la face cliquée, en coordonnées monde, décalés de `lift`. */
    const coplanarRegion = (mesh: BABYLON.AbstractMesh, normal: BABYLON.Vector3, point: BABYLON.Vector3) => {
      const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      const indices = mesh.getIndices();
      if (!positions || !indices) return null;
      const world = mesh.getWorldMatrix();
      const v = [new BABYLON.Vector3(), new BABYLON.Vector3(), new BABYLON.Vector3()];
      const e1 = new BABYLON.Vector3();
      const e2 = new BABYLON.Vector3();
      const n = new BABYLON.Vector3();
      const out: number[] = [];
      const centroid = new BABYLON.Vector3();
      const extent = mesh.getBoundingInfo().boundingSphere.radiusWorld || 1;
      const planeTol = Math.max(1e-4, extent * 1e-4);
      for (let i = 0; i + 2 < indices.length; i += 3) {
        for (let k = 0; k < 3; k += 1) {
          const o = indices[i + k] * 3;
          BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(positions[o], positions[o + 1], positions[o + 2], world, v[k]);
        }
        v[1].subtractToRef(v[0], e1);
        v[2].subtractToRef(v[0], e2);
        BABYLON.Vector3.CrossToRef(e1, e2, n);
        const len = n.length();
        if (len < 1e-12) continue;
        n.scaleInPlace(1 / len);
        if (Math.abs(BABYLON.Vector3.Dot(n, normal)) < 0.9999) continue;
        if (Math.abs(BABYLON.Vector3.Dot(v[0].subtract(point), normal)) > planeTol) continue;
        for (let k = 0; k < 3; k += 1) {
          out.push(v[k].x, v[k].y, v[k].z);
          centroid.addInPlace(v[k]);
        }
      }
      if (out.length === 0) return null;
      centroid.scaleInPlace(1 / (out.length / 3));
      return { positions: out, centroid };
    };

    const makeTriangleSoup = (name: string, positions: number[], offset: BABYLON.Vector3, material: BABYLON.Material) => {
      const mesh = new BABYLON.Mesh(name, scene);
      const vd = new BABYLON.VertexData();
      const shifted = positions.slice();
      for (let i = 0; i < shifted.length; i += 3) {
        shifted[i] += offset.x; shifted[i + 1] += offset.y; shifted[i + 2] += offset.z;
      }
      vd.positions = shifted;
      vd.indices = Array.from({ length: shifted.length / 3 }, (_, i) => i);
      // Normales : `PickingInfo.getNormal` en a besoin pour choisir une face des corps extrudés.
      const normals: number[] = [];
      BABYLON.VertexData.ComputeNormals(shifted, vd.indices, normals);
      vd.normals = normals;
      vd.applyToMesh(mesh);
      mesh.material = material;
      mesh.isPickable = false;
      return mesh;
    };

    let extrudeRegionPositions: number[] | null = null;
    let extrudeSketchCorners: BABYLON.Vector3[] | null = null;
    // Région de profil d'esquisse choisie (pour la désélection au second clic) et survolée.
    let extrudeRegion: { group: number; keys: Set<string> } | null = null;
    let extrudeHover: BABYLON.Mesh | null = null;
    let extrudeHoverKey = '';
    const extrudeHoverMaterial = extrudeFaceMaterial.clone('extrudeHoverMat');
    extrudeHoverMaterial.alpha = 0.2;
    let browseEdgeHover: BABYLON.Mesh | null = null;
    let browseEdgeHoverKey = '';
    let browseEdge: { key: string; mesh: BABYLON.Mesh } | null = null;
    const clearEdgeHover = () => {
      browseEdgeHover?.dispose();
      browseEdgeHover = null;
      browseEdgeHoverKey = '';
    };
    const clearBrowseEdge = () => {
      browseEdge?.mesh.dispose();
      browseEdge = null;
    };
    const clearExtrudeHover = () => {
      extrudeHover?.dispose();
      extrudeHover = null;
      extrudeHoverKey = '';
      clearEdgeHover();
    };

    // --- Arêtes (sélection hors outil Extrusion, 2026-10-20) -------------------------------------
    // Arête = chaîne d'arêtes de triangles « vives » (angle entre faces voisines > 25°, bord libre ou
    // jonction non variété), prolongée tant que la chaîne ne tourne pas de plus de 35° et qu'aucun
    // autre trait n'y aboutit : un côté droit ou un cercle tessellé est UNE arête. Pour les profils
    // d'esquisse : les côtés des rectangles. Le choix se fait dans l'espace écran (tolérance
    // EDGE_PICK_PX) sur les arêtes visibles (rien ne les masque entre la caméra et elles).
    const EDGE_PICK_PX = 7;
    const EDGE_FEATURE_COS = Math.cos((25 * Math.PI) / 180);
    const EDGE_CHAIN_COS = Math.cos((35 * Math.PI) / 180);
    interface EdgeCandidate { key: string; points: BABYLON.Vector3[] }
    interface MeshEdgeCache { matrix: number[]; local: number[][]; world: BABYLON.Vector3[][] }
    const meshEdgeCache = new WeakMap<BABYLON.AbstractMesh, MeshEdgeCache>();

    const extractFeatureChains = (mesh: BABYLON.AbstractMesh): number[][] => {
      const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      const indices = mesh.getIndices();
      if (!positions || !indices || indices.length === 0 || indices.length > 450000) return [];
      const q = Math.max(1e-6, (mesh.getBoundingInfo().boundingSphere.radius || 1) * 1e-5);
      // Soudure des sommets confondus (les maillages à faces indépendantes dupliquent leurs sommets).
      const welded = new Map<string, number>();
      const remap = new Int32Array(positions.length / 3);
      const coords: number[] = [];
      for (let i = 0; i < remap.length; i += 1) {
        const x = positions[i * 3]; const y = positions[i * 3 + 1]; const z = positions[i * 3 + 2];
        const k = `${Math.round(x / q)},${Math.round(y / q)},${Math.round(z / q)}`;
        let id = welded.get(k);
        if (id === undefined) { id = coords.length / 3; welded.set(k, id); coords.push(x, y, z); }
        remap[i] = id;
      }
      const count = coords.length / 3;
      interface TriEdge { a: number; b: number; n: [number, number, number]; n2: [number, number, number] | null; faces: number }
      const edges = new Map<number, TriEdge>();
      const addEdge = (u: number, v: number, n: [number, number, number]) => {
        const a = Math.min(u, v); const b = Math.max(u, v);
        const key = a * count + b;
        const e = edges.get(key);
        if (!e) edges.set(key, { a, b, n, n2: null, faces: 1 });
        else { e.faces += 1; if (!e.n2) e.n2 = n; }
      };
      for (let t = 0; t + 2 < indices.length; t += 3) {
        const i0 = remap[indices[t]]; const i1 = remap[indices[t + 1]]; const i2 = remap[indices[t + 2]];
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;
        const ux = coords[i1 * 3] - coords[i0 * 3]; const uy = coords[i1 * 3 + 1] - coords[i0 * 3 + 1]; const uz = coords[i1 * 3 + 2] - coords[i0 * 3 + 2];
        const vx = coords[i2 * 3] - coords[i0 * 3]; const vy = coords[i2 * 3 + 1] - coords[i0 * 3 + 1]; const vz = coords[i2 * 3 + 2] - coords[i0 * 3 + 2];
        let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-18) continue;
        nx /= len; ny /= len; nz /= len;
        const n: [number, number, number] = [nx, ny, nz];
        addEdge(i0, i1, n); addEdge(i1, i2, n); addEdge(i2, i0, n);
      }
      const feature: TriEdge[] = [];
      edges.forEach((e) => {
        const sharp = e.faces !== 2 || !e.n2
          || Math.abs(e.n[0] * e.n2[0] + e.n[1] * e.n2[1] + e.n[2] * e.n2[2]) < EDGE_FEATURE_COS;
        if (sharp) feature.push(e);
      });
      const adjacency = new Map<number, number[]>();
      feature.forEach((e, i) => {
        [e.a, e.b].forEach((v) => { const l = adjacency.get(v); if (l) l.push(i); else adjacency.set(v, [i]); });
      });
      const dirOf = (u: number, v: number): [number, number, number] => {
        const dx = coords[v * 3] - coords[u * 3]; const dy = coords[v * 3 + 1] - coords[u * 3 + 1]; const dz = coords[v * 3 + 2] - coords[u * 3 + 2];
        const l = Math.hypot(dx, dy, dz) || 1;
        return [dx / l, dy / l, dz / l];
      };
      const used = new Uint8Array(feature.length);
      const chains: number[][] = [];
      for (let s = 0; s < feature.length; s += 1) {
        if (used[s]) continue;
        used[s] = 1;
        const pts = [feature[s].a, feature[s].b];
        const extend = (forward: boolean) => {
          for (;;) {
            const tip = forward ? pts[pts.length - 1] : pts[0];
            const prev = forward ? pts[pts.length - 2] : pts[1];
            const start = forward ? pts[0] : pts[pts.length - 1];
            const list = adjacency.get(tip);
            if (!list || list.length !== 2) return;
            const next = list.find((i) => !used[i]);
            if (next === undefined) return;
            const e = feature[next];
            const other = e.a === tip ? e.b : e.a;
            const d1 = dirOf(prev, tip); const d2 = dirOf(tip, other);
            if (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2] < EDGE_CHAIN_COS) return;
            used[next] = 1;
            if (forward) pts.push(other); else pts.unshift(other);
            if (other === start) return;
          }
        };
        extend(true);
        extend(false);
        chains.push(pts.flatMap((v) => [coords[v * 3], coords[v * 3 + 1], coords[v * 3 + 2]]));
      }
      return chains;
    };

    const meshEdgesInWorld = (mesh: BABYLON.AbstractMesh): BABYLON.Vector3[][] => {
      const matrix = mesh.getWorldMatrix();
      let cache = meshEdgeCache.get(mesh);
      if (!cache) {
        cache = { matrix: [], local: extractFeatureChains(mesh), world: [] };
        meshEdgeCache.set(mesh, cache);
      }
      const m = matrix.m;
      if (cache.matrix.length !== 16 || cache.matrix.some((v, i) => v !== m[i])) {
        cache.matrix = Array.from(m);
        cache.world = cache.local.map((flat) => {
          const out: BABYLON.Vector3[] = [];
          for (let i = 0; i < flat.length; i += 3) {
            out.push(BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(flat[i], flat[i + 1], flat[i + 2]), matrix));
          }
          return out;
        });
      }
      return cache.world;
    };

    const collectEdgeCandidates = (): EdgeCandidate[] => {
      const out: EdgeCandidate[] = [];
      scene.meshes.forEach((m) => {
        if (!m.isEnabled() || !m.isVisible || m.getTotalVertices() === 0 || !isSolid(m)) return;
        meshEdgesInWorld(m).forEach((points, i) => out.push({ key: `m:${m.uniqueId}:${i}`, points }));
      });
      sketchFaceGroups.forEach((group, gi) => {
        group.rects.forEach((r) => {
          const c = [[r.x1, r.z1], [r.x2, r.z1], [r.x2, r.z2], [r.x1, r.z2]]
            .map(([x, z]) => BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(x, 0, z), group.matrix));
          for (let s = 0; s < 4; s += 1) out.push({ key: `s:${gi}:${r.id}:${s}`, points: [c[s], c[(s + 1) % 4]] });
        });
      });
      return out;
    };

    /** Arête visible la plus proche du pointeur, à moins de EDGE_PICK_PX pixels (sinon null). */
    const edgeAt = (clientX: number, clientY: number): EdgeCandidate | null => {
      const { px, py } = extrudePointerRay(clientX, clientY);
      const rect = canvas.getBoundingClientRect();
      const tol = EDGE_PICK_PX * (engine.getRenderWidth() / Math.max(rect.width, 1));
      const view = camera.getViewMatrix();
      const viewProjection = view.multiply(camera.getProjectionMatrix());
      const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
      const hits: { cand: EdgeCandidate; d: number; point: BABYLON.Vector3 }[] = [];
      collectEdgeCandidates().forEach((cand) => {
        const screen = cand.points.map((p) => (
          BABYLON.Vector3.TransformCoordinates(p, view).z > camera.minZ
            ? BABYLON.Vector3.Project(p, BABYLON.Matrix.IdentityReadOnly, viewProjection, viewport)
            : null
        ));
        let best = tol; let bestAt = -1; let bestT = 0;
        for (let i = 0; i + 1 < screen.length; i += 1) {
          const a = screen[i]; const b = screen[i + 1];
          if (!a || !b) continue;
          const dx = b.x - a.x; const dy = b.y - a.y;
          const l2 = dx * dx + dy * dy;
          const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
          const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
          if (d < best) { best = d; bestAt = i; bestT = t; }
        }
        if (bestAt >= 0) {
          hits.push({ cand, d: best, point: BABYLON.Vector3.Lerp(cand.points[bestAt], cand.points[bestAt + 1], bestT) });
        }
      });
      hits.sort((h1, h2) => h1.d - h2.d);
      for (const hit of hits.slice(0, 6)) {
        // Visible : aucune surface plus proche de la caméra sur le rayon qui mène au point de l'arête.
        const toPoint = hit.point.subtract(camera.position);
        const dist = toPoint.length();
        const ray = new BABYLON.Ray(camera.position.clone(), toPoint.scale(1 / Math.max(dist, 1e-9)), 1e6);
        const blocker = scene.pickWithRay(ray, (m) => (
          m.isPickable && m.isEnabled() && (sketchFaceMeshes.includes(m as BABYLON.Mesh) || isSolid(m))
        ));
        if (blocker?.hit && blocker.distance < dist - Math.max(0.05, dist * 0.01)) continue;
        return hit.cand;
      }
      return null;
    };

    const makeEdgeLine = (name: string, cand: EdgeCandidate, width: number, alpha: number) => {
      const line = createScreenLines(scene, name, [cand.points], EXTRUDE_COLOR, width, alpha);
      line.isPickable = false;
      return line;
    };

    // --- Corps extrudé, en temps réel : couvercle supérieur (la face déplacée), parois le long du bord de
    // la face et contours noirs (bords du haut et du bas + arêtes aux coins), tous recalculés à chaque
    // changement de distance. Les arêtes de triangulation ne sont jamais dessinées : seuls les contours
    // de la forme le sont, donc le rendu est le même pour tous les corps non triangulés.
    let extrudeBoundary: { a: BABYLON.Vector3; b: BABYLON.Vector3 }[] = [];
    let extrudeCornerPoints: BABYLON.Vector3[] = [];
    let extrudeWalls: BABYLON.Mesh | null = null;
    let extrudeEdges: BABYLON.Mesh | null = null;
    const extrudedBodies: BABYLON.Mesh[] = []; // corps validés (OK) : restent dans la scène
    /** Maillage plein dont on peut choisir faces et arêtes : modèle importé ou face d'un corps extrudé. */
    const isSolid = (m: BABYLON.AbstractMesh) =>
      !!isUnderModel(m) || (extrudedBodies.includes(m as BABYLON.Mesh) && m.name !== 'extrudeBodyEdges');
    const extrudeBodyMaterial = new BABYLON.StandardMaterial('extrudeBodyMat', scene);
    extrudeBodyMaterial.diffuseColor = new BABYLON.Color3(0.72, 0.75, 0.8);
    extrudeBodyMaterial.emissiveColor = new BABYLON.Color3(0.32, 0.34, 0.38);
    extrudeBodyMaterial.specularColor = BABYLON.Color3.Black();
    extrudeBodyMaterial.backFaceCulling = false;

    const vertexKey = (x: number, y: number, z: number) =>
      `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;

    /** Bord d'une région (arêtes de triangle utilisées une seule fois) et ses coins. */
    const computeExtrudeBoundary = (positions: number[]) => {
      const edges = new Map<string, { a: BABYLON.Vector3; b: BABYLON.Vector3; count: number }>();
      const vertex = (i: number) => new BABYLON.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      for (let t = 0; t + 2 < positions.length / 3; t += 3) {
        for (let k = 0; k < 3; k += 1) {
          const a = vertex(t + k);
          const b = vertex(t + ((k + 1) % 3));
          const ka = vertexKey(a.x, a.y, a.z);
          const kb = vertexKey(b.x, b.y, b.z);
          if (ka === kb) continue;
          const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          const known = edges.get(key);
          if (known) known.count += 1;
          else edges.set(key, { a, b, count: 1 });
        }
      }
      extrudeBoundary = Array.from(edges.values()).filter((e) => e.count === 1);
      // Coins : sommets du bord dont les deux arêtes ne sont pas alignées (ou en nombre ≠ 2).
      const around = new Map<string, { point: BABYLON.Vector3; dirs: BABYLON.Vector3[] }>();
      const add = (from: BABYLON.Vector3, to: BABYLON.Vector3) => {
        const key = vertexKey(from.x, from.y, from.z);
        const entry = around.get(key) ?? { point: from, dirs: [] };
        entry.dirs.push(to.subtract(from).normalize());
        around.set(key, entry);
      };
      extrudeBoundary.forEach((e) => { add(e.a, e.b); add(e.b, e.a); });
      extrudeCornerPoints = [];
      around.forEach((entry) => {
        const straight = entry.dirs.length === 2 && Math.abs(BABYLON.Vector3.Dot(entry.dirs[0], entry.dirs[1])) > 0.9999;
        if (!straight) extrudeCornerPoints.push(entry.point);
      });
    };

    const disposeExtrudeBody = () => {
      extrudeWalls?.dispose();
      extrudeEdges?.dispose();
      extrudeWalls = null;
      extrudeEdges = null;
    };

    const rebuildExtrudeBody = () => {
      disposeExtrudeBody();
      const face = extrudeFace;
      const t = extrudeDistance;
      if (!face || t < 1e-6 || extrudeBoundary.length === 0) return;
      const shift = face.normal.scale(t);
      const positions: number[] = [];
      const lines: BABYLON.Vector3[][] = [];
      extrudeBoundary.forEach(({ a, b }) => {
        const a2 = a.add(shift);
        const b2 = b.add(shift);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, b2.x, b2.y, b2.z, a.x, a.y, a.z, b2.x, b2.y, b2.z, a2.x, a2.y, a2.z);
        lines.push([a, b], [a2, b2]);
      });
      extrudeCornerPoints.forEach((c) => lines.push([c, c.add(shift)]));
      const walls = new BABYLON.Mesh('extrudeBodyWalls', scene);
      const vd = new BABYLON.VertexData();
      vd.positions = positions;
      vd.indices = Array.from({ length: positions.length / 3 }, (_, i) => i);
      const normals: number[] = [];
      BABYLON.VertexData.ComputeNormals(positions, vd.indices, normals);
      vd.normals = normals;
      vd.applyToMesh(walls);
      walls.material = extrudeBodyMaterial;
      walls.isPickable = false;
      extrudeWalls = walls;
      extrudeEdges = createScreenLines(scene, 'extrudeBodyEdges', lines, BABYLON.Color3.Black(), 1.8, 1);
      extrudeEdges.isPickable = false;
    };

    /** OK : le corps reste dans la scène (couvercle, parois, contours) ; l'aperçu ne l'efface plus. */
    const commitExtrudeBody = () => {
      const face = extrudeFace;
      if (!face || extrudeDistance < 1e-6 || !extrudeGhost || !extrudeWalls || !extrudeEdges) return;
      const bottom = makeTriangleSoup('extrudedBodyBottom', extrudeRegionPositions
        ?? (extrudeSketchCorners
          ? [0, 1, 2, 0, 2, 3].flatMap((i) => [extrudeSketchCorners![i].x, extrudeSketchCorners![i].y, extrudeSketchCorners![i].z])
          : []), BABYLON.Vector3.Zero(), extrudeBodyMaterial);
      const kept = [extrudeGhost, extrudeWalls, extrudeEdges, bottom];
      // Couvercle, parois et fond : faces et arêtes sélectionnables comme celles d'un modèle (isSolid).
      [extrudeGhost, extrudeWalls, bottom].forEach((m) => { m.isPickable = true; });
      extrudeGhost.setEnabled(true);
      extrudedBodies.push(...kept);
      sketchDrawnMeshes.push(...kept);
      extrudeGhost = null;
      extrudeWalls = null;
      extrudeEdges = null;
    };

    const placeExtrudeArrow = () => {
      const face = extrudeFace;
      if (!face || !extrudeArrowRoot) return;
      extrudeArrowRoot.position.copyFrom(face.origin).addInPlace(face.normal.scale(extrudeDistance));
      if (extrudeGhost) extrudeGhost.position.copyFrom(face.normal.scale(extrudeDistance));
      rebuildExtrudeBody();
    };

    const clearExtrudeFace = () => {
      extrudeOverlay?.dispose();
      extrudeGhost?.dispose();
      extrudeArrowRoot?.dispose(false, true);
      extrudeOverlay = null;
      extrudeGhost = null;
      extrudeArrowRoot = null;
      extrudeArrowMeshes = [];
      extrudeFace = null;
      extrudeDrag = null;
      extrudeDistance = 0;
      extrudeRegionPositions = null;
      extrudeSketchCorners = null;
      extrudeRegion = null;
      clearExtrudeHover();
      clearBrowseEdge();
      disposeExtrudeBody();
      extrudeBoundary = [];
      extrudeCornerPoints = [];
    };

    const selectExtrudeFace = (face: ExtrudeFace, region: number[] | null, corners: BABYLON.Vector3[] | null) => {
      clearExtrudeFace();
      extrudeFace = face;
      extrudeRegionPositions = region;
      extrudeSketchCorners = corners;
      const lift = face.normal.scale(0.02);
      const positions = region ?? (corners ? [0, 1, 2, 0, 2, 3].flatMap((i) => [corners[i].x, corners[i].y, corners[i].z]) : []);
      extrudeOverlay = makeTriangleSoup('extrudeFaceOverlay', positions, lift, extrudeFaceMaterial);
      extrudeGhost = makeTriangleSoup('extrudeFaceGhost', positions, lift, extrudeBodyMaterial);
      extrudeGhost.setEnabled(false);
      // Hors outil Extrusion : la face est seulement surlignée (ni flèche, ni panneau).
      if (!isExtrudeFaceMode()) return;
      computeExtrudeBoundary(positions);

      // Flèche : tige + pointe le long de +Y local, puis alignée sur la normale. Taille écran constante
      // (cf. observer ci-dessous) : la géométrie est unitaire (hauteur 1).
      const root = new BABYLON.TransformNode('extrudeArrowRoot', scene);
      const shaft = BABYLON.MeshBuilder.CreateCylinder('extrudeArrowShaft', { height: 0.62, diameter: 0.07 }, scene);
      shaft.position.y = 0.31;
      const head = BABYLON.MeshBuilder.CreateCylinder(
        'extrudeArrowHead', { height: 0.38, diameterTop: 0, diameterBottom: 0.22 }, scene,
      );
      head.position.y = 0.81;
      [shaft, head].forEach((m) => {
        m.material = extrudeArrowMaterial;
        m.parent = root;
        m.isPickable = true;
        m.renderingGroupId = 3;
      });
      extrudeArrowMeshes = [shaft, head];
      const up = new BABYLON.Vector3(0, 1, 0);
      const axis = BABYLON.Vector3.Cross(up, face.normal);
      const dot = Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(up, face.normal)));
      root.rotationQuaternion = axis.length() < 1e-6
        ? (dot > 0 ? BABYLON.Quaternion.Identity() : BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1, 0, 0), Math.PI))
        : BABYLON.Quaternion.RotationAxis(axis.normalize(), Math.acos(dot));
      extrudeArrowRoot = root;
      extrudeDistance = 0;
      placeExtrudeArrow();
      window.dispatchEvent(new CustomEvent('apex-extrude-face', {
        detail: { kind: face.kind, modelName: face.modelName ?? null,
          origin: { x: face.origin.x, y: face.origin.y, z: face.origin.z },
          normal: { x: face.normal.x, y: face.normal.y, z: face.normal.z } },
      }));
    };

    // Taille écran constante de la flèche (≈ 18 % de la hauteur visible à sa distance).
    const extrudeArrowScaleObserver = scene.onBeforeRenderObservable.add(() => {
      if (!extrudeArrowRoot) return;
      const distance = BABYLON.Vector3.Distance(camera.position, extrudeArrowRoot.position);
      const visibleHeight = 2 * distance * Math.tan(camera.fov / 2);
      extrudeArrowRoot.scaling.setAll(Math.max(1e-6, 0.18 * visibleHeight));
    });

    const extrudePointerRay = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const sx = engine.getRenderWidth() / Math.max(rect.width, 1);
      const sy = engine.getRenderHeight() / Math.max(rect.height, 1);
      return {
        px: (clientX - rect.left) * sx,
        py: (clientY - rect.top) * sy,
        ray: scene.createPickingRay((clientX - rect.left) * sx, (clientY - rect.top) * sy, BABYLON.Matrix.Identity(), camera),
      };
    };

    /** Paramètre s du point de l'axe de la flèche le plus proche du rayon de la souris. */
    const axisParameterAt = (clientX: number, clientY: number) => {
      const face = extrudeFace;
      if (!face) return null;
      const { ray } = extrudePointerRay(clientX, clientY);
      const n = face.normal;
      const d = ray.direction;
      const w0 = face.origin.subtract(ray.origin);
      const b = BABYLON.Vector3.Dot(n, d);
      const denom = 1 - b * b;
      if (Math.abs(denom) < 1e-6) return null;
      return (b * BABYLON.Vector3.Dot(d, w0) - BABYLON.Vector3.Dot(n, w0)) / denom;
    };

    const setExtrudeDistance = (t: number, emit: boolean) => {
      extrudeDistance = Math.max(0, t);
      placeExtrudeArrow();
      extrudeGhost?.setEnabled(extrudeDistance > 1e-6);
      if (emit) {
        window.dispatchEvent(new CustomEvent('apex-extrude-distance', { detail: { distance: extrudeDistance } }));
      }
    };

    const onExtrudeDown = (e: PointerEvent) => {
      if (!isFacePickMode() || e.button !== 0) return;
      const { px, py } = extrudePointerRay(e.clientX, e.clientY);
      // 1. La flèche ?
      if (extrudeFace && extrudeArrowMeshes.length > 0) {
        const arrowPick = scene.pick(px, py, (m) => extrudeArrowMeshes.includes(m as BABYLON.Mesh));
        if (arrowPick?.hit) {
          const s = axisParameterAt(e.clientX, e.clientY);
          if (s !== null) {
            extrudeDrag = { startS: s, startT: extrudeDistance, moved: false, startClientX: e.clientX, startClientY: e.clientY };
            canvas.setPointerCapture?.(e.pointerId);
          }
          return;
        }
      }
      // 1 bis. Hors Extrusion : une arête proche du pointeur l'emporte sur la face qu'elle borde.
      if (isFaceBrowseMode()) {
        const edge = edgeAt(e.clientX, e.clientY);
        if (edge) {
          if (browseEdge?.key === edge.key) { clearBrowseEdge(); return; }
          clearExtrudeFace();
          clearExtrudeHover();
          browseEdge = { key: edge.key, mesh: makeEdgeLine('browseEdgeSelected', edge, 3.2, 1) };
          return;
        }
      }
      // 2. Une face : profil d'esquisse (région), sinon face plane d'un modèle.
      const pick = scene.pick(px, py, (m) => (
        m.isPickable && m.isEnabled() && (sketchFaceMeshes.includes(m as BABYLON.Mesh) || isSolid(m))
      ));
      if (!pick?.hit || !pick.pickedMesh) {
        clearExtrudeFace();
        window.dispatchEvent(new CustomEvent('apex-extrude-face', { detail: null }));
        return;
      }
      const rayDir = scene.createPickingRay(px, py, BABYLON.Matrix.Identity(), camera).direction;
      const deselect = () => {
        clearExtrudeFace();
        window.dispatchEvent(new CustomEvent('apex-extrude-face', { detail: null }));
      };
      const cellInfo = (pick.pickedMesh.metadata as { sketchCell?: { group: number; key: string } } | null)?.sketchCell;
      if (cellInfo) {
        const region = sketchRegionOf(cellInfo.group, cellInfo.key);
        if (!region) return;
        // Second clic sur la région déjà choisie : désélection.
        if (extrudeRegion && extrudeRegion.group === cellInfo.group && extrudeRegion.keys.has(cellInfo.key)) {
          deselect();
          return;
        }
        const normal = region.normal.clone();
        if (BABYLON.Vector3.Dot(normal, rayDir) > 0) normal.scaleInPlace(-1);
        const origin = pick.pickedPoint?.clone() ?? BABYLON.Vector3.Zero();
        selectExtrudeFace({ kind: 'sketch', origin, normal }, region.positions, null);
        extrudeRegion = { group: cellInfo.group, keys: region.keys };
        return;
      }
      const normal = pick.getNormal(true, false);
      if (!normal || !pick.pickedPoint) return;
      normal.normalize();
      if (BABYLON.Vector3.Dot(normal, rayDir) > 0) normal.scaleInPlace(-1);
      // Second clic sur la face de modèle déjà choisie (même plan) : désélection.
      if (
        extrudeFace && extrudeFace.kind === 'mesh'
        && Math.abs(BABYLON.Vector3.Dot(extrudeFace.normal, normal)) > 0.9999
        && Math.abs(BABYLON.Vector3.Dot(pick.pickedPoint.subtract(extrudeFace.origin), extrudeFace.normal)) < 1e-2
        && extrudeFace.modelName === isUnderModel(pick.pickedMesh)?.name
      ) {
        deselect();
        return;
      }
      const region = coplanarRegion(pick.pickedMesh, normal, pick.pickedPoint);
      const owner = isUnderModel(pick.pickedMesh);
      selectExtrudeFace(
        { kind: 'mesh', origin: region?.centroid ?? pick.pickedPoint.clone(), normal, modelName: owner?.name },
        region?.positions ?? null,
        null,
      );
    };
    let extrudeHoverPending = false;
    let extrudeHoverLast: PointerEvent | null = null;
    const updateExtrudeHover = () => {
      extrudeHoverPending = false;
      const e = extrudeHoverLast;
      if (!e || !isFacePickMode() || extrudeDrag) { clearExtrudeHover(); return; }
      const { px, py } = extrudePointerRay(e.clientX, e.clientY);
      // Sur la flèche : pas de surbrillance de face, curseur « main ».
      if (extrudeArrowMeshes.length > 0) {
        const hoverArrow = scene.pick(px, py, (m) => extrudeArrowMeshes.includes(m as BABYLON.Mesh));
        canvas.style.cursor = hoverArrow?.hit ? 'grab' : '';
        if (hoverArrow?.hit) { clearExtrudeHover(); return; }
      }
      if (isFaceBrowseMode()) {
        const edge = edgeAt(e.clientX, e.clientY);
        if (edge) {
          canvas.style.cursor = 'pointer';
          if (browseEdge?.key === edge.key) { clearExtrudeHover(); return; }
          if (edge.key !== browseEdgeHoverKey) {
            clearExtrudeHover();
            browseEdgeHoverKey = edge.key;
            browseEdgeHover = makeEdgeLine('browseEdgeHover', edge, 3, 0.55);
          }
          extrudeHover?.dispose();
          extrudeHover = null;
          extrudeHoverKey = '';
          return;
        }
        canvas.style.cursor = '';
        clearEdgeHover();
      }
      const pick = scene.pick(px, py, (m) => (
        m.isPickable && m.isEnabled() && (sketchFaceMeshes.includes(m as BABYLON.Mesh) || isSolid(m))
      ));
      if (!pick?.hit || !pick.pickedMesh) { clearExtrudeHover(); return; }
      const cellInfo = (pick.pickedMesh.metadata as { sketchCell?: { group: number; key: string } } | null)?.sketchCell;
      let key = '';
      let positions: number[] | null = null;
      if (cellInfo) {
        const region = sketchRegionOf(cellInfo.group, cellInfo.key);
        if (!region) { clearExtrudeHover(); return; }
        key = `s:${cellInfo.group}:${Array.from(region.keys).sort()[0]}`;
        if (key === extrudeHoverKey) return;
        if (extrudeRegion && extrudeRegion.group === cellInfo.group && extrudeRegion.keys.has(cellInfo.key)) {
          clearExtrudeHover();
          return;
        }
        positions = region.positions;
      } else {
        // Face de modèle : surlignage réservé aux maillages de taille raisonnable (le calcul des
        // triangles coplanaires parcourt tout le maillage).
        const indices = pick.pickedMesh.getIndices();
        if (!indices || indices.length > 450000) { clearExtrudeHover(); return; }
        key = `m:${pick.pickedMesh.uniqueId}:${pick.faceId}`;
        if (key === extrudeHoverKey) return;
        const normal = pick.getNormal(true, false);
        if (!normal || !pick.pickedPoint) { clearExtrudeHover(); return; }
        normal.normalize();
        const region = coplanarRegion(pick.pickedMesh, normal, pick.pickedPoint);
        if (!region) { clearExtrudeHover(); return; }
        const offset = normal.scale(BABYLON.Vector3.Dot(normal, camera.position.subtract(pick.pickedPoint)) > 0 ? 0.02 : -0.02);
        positions = region.positions.slice();
        for (let i = 0; i < positions.length; i += 3) {
          positions[i] += offset.x; positions[i + 1] += offset.y; positions[i + 2] += offset.z;
        }
      }
      extrudeHover?.dispose();
      extrudeHoverKey = key;
      extrudeHover = makeTriangleSoup('extrudeFaceHover', positions, BABYLON.Vector3.Zero(), extrudeHoverMaterial);
    };
    const onExtrudeMove = (e: PointerEvent) => {
      if (extrudeDrag) {
        canvas.style.cursor = 'grabbing';
        clearExtrudeHover();
        const s = axisParameterAt(e.clientX, e.clientY);
        if (s === null) return;
        if (Math.hypot(e.clientX - extrudeDrag.startClientX, e.clientY - extrudeDrag.startClientY) > 3) extrudeDrag.moved = true;
        const raw = extrudeDrag.startT + (s - extrudeDrag.startS);
        setExtrudeDistance(Math.round(raw * 100) / 100, true);
        return;
      }
      if (!isFacePickMode()) return;
      // Survol : un seul calcul par image.
      extrudeHoverLast = e;
      if (!extrudeHoverPending) {
        extrudeHoverPending = true;
        requestAnimationFrame(updateExtrudeHover);
      }
    };
    const onExtrudeUp = () => {
      if (!extrudeDrag) return;
      const drag = extrudeDrag;
      extrudeDrag = null;
      canvas.style.cursor = '';
      // Simple clic sur la flèche : on donne la main au champ Distance du panneau.
      if (!drag.moved) window.dispatchEvent(new CustomEvent('apex-extrude-focus-distance'));
    };
    canvas.addEventListener('pointerdown', onExtrudeDown);
    canvas.addEventListener('pointermove', onExtrudeMove);
    canvas.addEventListener('pointerup', onExtrudeUp);
    canvas.addEventListener('pointercancel', onExtrudeUp);

    const onSelectionModeEvent = (e: Event) => {
      selectionModeNow = (e as CustomEvent<{ mode: string }>).detail?.mode ?? 'body';
      if (selectionModeNow !== 'face') clearExtrudeFace();
      const carried = carriedFace;
      if (carried && selectionModeNow === 'face' && extrudeToolActive) {
        carriedFace = null;
        // Laisse au panneau Extrusion le temps de s'abonner à `apex-extrude-face` avant de lui annoncer la face.
        window.setTimeout(() => {
          if (!isExtrudeFaceMode() || extrudeFace) return;
          selectExtrudeFace(carried.face, carried.region, carried.corners);
          extrudeRegion = carried.regionInfo;
        }, 150);
      }
    };
    const onExtrudeToolEvent = (e: Event) => {
      extrudeToolActive = (e as CustomEvent<{ tool: string }>).detail?.tool === 'extrude';
      if (!extrudeToolActive) { clearExtrudeFace(); canvas.style.cursor = ''; }
    };
    const onExtrudeSetDistance = (e: Event) => {
      const value = (e as CustomEvent<{ distance: number }>).detail?.distance;
      if (extrudeFace && Number.isFinite(value)) setExtrudeDistance(value, false);
    };
    // Suivi de l'espace et de l'outil pour la sélection de face hors Extrusion ; quitter ce mode
    // (autre outil, autre espace) efface la face choisie et son survol.
    const onFaceBrowseContext = (e: Event) => {
      const detail = (e as CustomEvent<{ mode?: string; tool?: string }>).detail;
      if (e.type === 'apex-mode-changed') modelingNow = detail?.mode === 'modeling';
      else {
        const wasBrowsing = isFaceBrowseMode();
        currentToolNow = detail?.tool ?? 'select';
        // Touche E (ou clic sur l'outil) avec une face choisie : l'Extrusion la reprend (cf. onSelectionModeEvent).
        carriedFace = wasBrowsing && currentToolNow === 'extrude' && extrudeFace
          ? { face: extrudeFace, region: extrudeRegionPositions, corners: extrudeSketchCorners, regionInfo: extrudeRegion }
          : null;
      }
      if (!isFacePickMode()) { clearExtrudeFace(); canvas.style.cursor = ''; }
    };
    let carriedFace: {
      face: ExtrudeFace; region: number[] | null; corners: BABYLON.Vector3[] | null;
      regionInfo: { group: number; keys: Set<string> } | null;
    } | null = null;
    window.addEventListener('apex-mode-changed', onFaceBrowseContext);
    window.addEventListener('apex-tool-changed', onFaceBrowseContext);
    window.addEventListener('apex-selection-mode-changed', onSelectionModeEvent);
    window.addEventListener('apex-tool-changed', onExtrudeToolEvent);
    window.addEventListener('apex-extrude-set-distance', onExtrudeSetDistance);
    window.addEventListener('apex-extrude-commit', commitExtrudeBody);

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
      if (sketchRectActive) return; // outil Rectangle : le clic trace, il ne sélectionne pas
      if (isExtrudeFaceMode()) return; // outil Extrusion en mode Face : le clic choisit une face
      // Modélisation (sélection de face hors Extrusion) : un clic sur une face plane la choisit
      // (onExtrudeDown) et ne sélectionne pas en plus le corps ; ailleurs, la sélection habituelle.
      if (
        isFaceBrowseMode()
        && (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN
          || pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP
          || pointerInfo.type === BABYLON.PointerEventTypes.POINTERTAP)
      ) {
        const downEvent = pointerInfo.event as PointerEvent;
        const { px, py } = extrudePointerRay(downEvent.clientX, downEvent.clientY);
        const facePick = scene.pick(px, py, (m) => (
          m.isPickable && m.isEnabled() && (sketchFaceMeshes.includes(m as BABYLON.Mesh) || isSolid(m))
        ));
        if (facePick?.hit) return;
        const clientEvent = pointerInfo.event as PointerEvent;
        if (edgeAt(clientEvent.clientX, clientEvent.clientY)) return;
      }
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
          applyModelShading();
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

    let renderPaused = false;
    const onRenderPause = (e: Event) => {
      renderPaused = !!(e as CustomEvent<{ paused: boolean }>).detail?.paused;
    };
    window.addEventListener('apex-render-pause', onRenderPause);

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

    // Interface classique : rendu plafonné à FLAT_MAX_FPS images/s (consommation, cf. utils/interfaceMode.ts). Cadence tenue
    // en moyenne par une échéance (pas par un écart minimal, qui tomberait à 20 images/s sur un écran 60 Hz).
    const FLAT_FRAME_MS = 1000 / FLAT_MAX_FPS;
    let nextFrameAt = 0;
    engine.runRenderLoop(() => {
      if (flat) {
        const now = performance.now();
        if (now < nextFrameAt - 8) return;
        nextFrameAt = Math.max(nextFrameAt + FLAT_FRAME_MS, now - FLAT_FRAME_MS);
      }
      // Garde-fou : tampon de rendu différent de la taille affichée → on resynchronise.
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0 &&
          (Math.abs(engine.getRenderWidth() - Math.round(canvas.clientWidth * engine.getHardwareScalingLevel() ** -1)) > 2 ||
           Math.abs(engine.getRenderHeight() - Math.round(canvas.clientHeight * engine.getHardwareScalingLevel() ** -1)) > 2)) {
        engine.resize();
      }
      // Rideau opaque (changement d'espace, chargement lourd) : la scène est cachée, son rendu ne ferait
      // que concurrencer sur le thread principal le montage de l'interface et la construction du
      // maillage. Les images du moteur continuent (verre, observateurs de fin d'image).
      if (!scene.isDisposed && !renderPaused) {
        scene.render();
      }
    });

    // Premier rendu complet (shaders compilés) : l'application peut sortir de son écran de démarrage.
    scene.executeWhenReady(() => window.dispatchEvent(new Event('apex-viewport-ready')));

    // Fermeture de l'application (src/utils/shutdownSequence.ts) : « close » ferme l'accès au viewport (plus de rendu,
    // plus de gizmo, canevas masqué) ; « purge » libère la scène, le pipeline et le moteur (RAM et vRAM). Le nettoyage
    // du démontage ci-dessous reste valable : il ne repasse pas sur ce qui est déjà libéré (`disposed`).
    let disposed = false;
    const onShutdown3d = (e: Event) => {
      const phase = (e as CustomEvent<{ phase?: string }>).detail?.phase;
      if (phase === 'close') {
        engine.stopRenderLoop();
        gizmoManager.attachToMesh(null);
        canvas.style.display = 'none';
      } else if (phase === 'purge' && !disposed) {
        disposed = true;
        engine.stopRenderLoop();
        resizeObserver.disconnect();
        window.removeEventListener('resize', handleResize);
        cancelAnimationFrame(resizeFrame);
        renderPipeline?.dispose();
        gizmoManager.dispose();
        scene.dispose();
        engine.dispose();
        engineRef.current = null;
        sceneRef.current = null;
        gizmoManagerRef.current = null;
        hlRef.current = null;
      }
    };
    window.addEventListener('apex-shutdown-3d', onShutdown3d);

    return () => {
      window.removeEventListener('apex-shutdown-3d', onShutdown3d);
      window.removeEventListener('apex-render-pause', onRenderPause);
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
      window.removeEventListener('apex-sketch-plane-selected', lockOrbit);
      window.removeEventListener('apex-sketch-plane-pick-start', saveSketchView);
      window.removeEventListener('apex-sketch-finished', restoreSketchView);
      window.removeEventListener('apex-sketch-plane-pick-cancel', clearSketchView);
      window.removeEventListener('apex-mode-changed', clearSketchView);
      window.removeEventListener('apex-tool-changed', unlockOrbit);
      window.removeEventListener('apex-sketch-plane-pick-start', unlockOrbit);
      window.removeEventListener('apex-sketch-plane-pick-cancel', unlockOrbit);
      window.removeEventListener('apex-mode-changed', unlockOrbit);
      canvas.removeEventListener('pointermove', onSketchRectMove);
      canvas.removeEventListener('pointerdown', onSketchRectDown);
      canvas.removeEventListener('pointerup', onSketchRectUp);
      canvas.removeEventListener('pointerleave', onSketchRectLeave);
      window.removeEventListener('keydown', onSketchRectKey);
      window.removeEventListener('apex-sketch-tool', onSketchToolEvent);
      [
        'apex-tool-changed', 'apex-sketch-plane-pick-start', 'apex-sketch-plane-pick-cancel',
        'apex-mode-changed', 'apex-sketch-plane-selected',
      ].forEach((name) => window.removeEventListener(name, onSketchRectDeactivate));
      window.removeEventListener('apex-sketch-plane-pick-cancel', onSketchPlanePickCancel);
      scene.onPointerObservable.remove(sketchPlanePickObserver);
      scene.onBeforeRenderObservable.remove(sketchPlaneScaleObserver);
      scene.onBeforeRenderObservable.remove(extrudeArrowScaleObserver);
      canvas.removeEventListener('pointerdown', onExtrudeDown);
      canvas.removeEventListener('pointermove', onExtrudeMove);
      canvas.removeEventListener('pointerup', onExtrudeUp);
      canvas.removeEventListener('pointercancel', onExtrudeUp);
      window.removeEventListener('apex-mode-changed', onFaceBrowseContext);
      window.removeEventListener('apex-tool-changed', onFaceBrowseContext);
      window.removeEventListener('apex-selection-mode-changed', onSelectionModeEvent);
      window.removeEventListener('apex-tool-changed', onExtrudeToolEvent);
      window.removeEventListener('apex-extrude-set-distance', onExtrudeSetDistance);
      window.removeEventListener('apex-extrude-commit', commitExtrudeBody);
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
      unsubscribeShading();
      if (disposed) return;
      renderPipeline?.dispose();
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
  // Entrée « Ajouter une primitive » : le sous-menu est porté dans le body (portail) pour être hors
  // du backdrop-filter du menu, qui l'empêcherait de flouter son fond ; sa position suit cette entrée.
  const primitiveItemRef = useRef<HTMLDivElement>(null);
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

      {sketchDimsShown && [0, 1].map((i) => (
        <input
          key={i}
          ref={(el) => { sketchDimInputs.current[i] = el; }}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-label={i === 0 ? 'Longueur' : 'Largeur'}
          onInput={() => sketchDimsApi.current.onInput(i)}
          onKeyDown={(e) => sketchDimsApi.current.onKey(i, e)}
          style={{
            position: 'fixed', left: -9999, top: -9999, zIndex: 1001, transform: 'translate(-50%, -50%)',
            width: 78, height: 26, padding: '0 10px', boxSizing: 'border-box', textAlign: 'center',
            fontSize: 12, color: '#fff', background: 'rgba(24,27,36,0.55)',
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            border: 'none', outline: 'none', borderRadius: 13,
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.35)',
          }}
        />
      ))}

      {sketchCursor && (
        <div
          style={{
            position: 'fixed', left: sketchCursor.x, top: sketchCursor.y, zIndex: 1000,
            width: 0, height: 0, pointerEvents: 'none',
          }}
        >
          {/* « + » tout simple : deux traits blancs de 2 px, sans arrondi ni contour ; carré cyan Apex autour. */}
          <div style={{ position: 'absolute', left: -12, top: -1, width: 25, height: 2, background: '#fff' }} />
          <div style={{ position: 'absolute', left: -1, top: -12, width: 2, height: 25, background: '#fff' }} />
          {sketchCursor.snapped && (
            <div
              style={{
                position: 'absolute', left: -9, top: -9, width: 19, height: 19,
                border: '2px solid #00f0ff', borderRadius: 2, boxSizing: 'border-box',
              }}
            />
          )}
        </div>
      )}

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
          data-apex-tooltip="Échelle de la vue : la barre représente la longueur indiquée à la distance de la cible de la caméra, et s'ajuste au zoom."
          style={{
            position: 'absolute', right: 24, bottom: 24, zIndex: 20,
            pointerEvents: 'auto', display: 'flex', flexDirection: 'column',
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

      {/* Menu porté dans le body : au-dessus de tous les panneaux (liquid glass compris), hors de
          leurs contextes d'empilement et de leurs backdrop-filter. */}
      {contextMenu && createPortal(
        <>
          {/* Apparition du menu : fondu + léger glissement, puis les entrées en cascade. */}
          <style>{`
            @keyframes apex-ctx-menu-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
            @keyframes apex-ctx-item-in { from { opacity: 0; transform: translateX(-3px); } to { opacity: 1; transform: none; } }
            .apex-ctx-menu { animation: apex-ctx-menu-in 100ms ease-out both; }
            .apex-ctx-menu > * { animation: apex-ctx-item-in 120ms ease-out both; }
            .apex-ctx-menu > *:nth-child(1) { animation-delay: 30ms; }
            .apex-ctx-menu > *:nth-child(2) { animation-delay: 50ms; }
            .apex-ctx-menu > *:nth-child(3) { animation-delay: 70ms; }
            .apex-ctx-menu > *:nth-child(4) { animation-delay: 90ms; }
            .apex-ctx-menu > *:nth-child(5) { animation-delay: 110ms; }
            .apex-ctx-menu > *:nth-child(6) { animation-delay: 130ms; }
            .apex-ctx-menu > *:nth-child(7) { animation-delay: 150ms; }
            .apex-ctx-menu > *:nth-child(8) { animation-delay: 170ms; }
            .apex-ctx-menu > *:nth-child(9) { animation-delay: 190ms; }
            @media (prefers-reduced-motion: reduce) {
              .apex-ctx-menu, .apex-ctx-menu > * { animation: none; }
            }
          `}</style>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (suppressNextBackdropContextMenuRef.current) {
                // Écho du contextmenu natif du clic qui vient d'ouvrir ce menu : on l'avale une
                // fois plutôt que de refermer ce qu'on vient d'ouvrir.
                suppressNextBackdropContextMenuRef.current = false;
                return;
              }
              // Nouveau clic droit pendant que le menu est ouvert : il se referme et se rouvre
              // directement au nouveau point (le rideau capte ce clic, Babylon ne le voit pas).
              setContextMenu({ x: e.clientX, y: e.clientY });
            }}
          />
          <div
            key={`${contextMenu.x}_${contextMenu.y}`}
            ref={menuRef}
            className="apex-ctx-menu"
            style={{
              position: 'fixed', top: (menuPos ?? contextMenu).y, left: (menuPos ?? contextMenu).x, zIndex: 10000,
              visibility: menuPos ? 'visible' : 'hidden',
              minWidth: 220, padding: 6, borderRadius: 14,
              background: 'rgba(20,22,30,0.55)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
              boxShadow: '0 12px 40px 0 rgba(0,0,0,0.45), 0 4px 16px 0 rgba(0,0,0,0.35)',
              border: 'none',
            }}
          >
            {contextSpace === 'preparation' && (<>
            <div style={menuItemStyle} onClick={() => runAction(() => window.dispatchEvent(new CustomEvent('apex-select-all-models')))} {...menuTooltip(SELECT_ALL_TOOLTIP)}>Tout sélectionner</div>
            <div style={menuItemStyle} onClick={() => runAction(() => window.dispatchEvent(new CustomEvent('apex-delete-all-models')))} {...menuTooltip(DELETE_ALL_TOOLTIP)}>Tout Supprimer</div>
            <div style={{ ...menuItemStyle, color: 'rgba(255,255,255,0.35)', cursor: 'default' }} {...menuTooltip(ORGANIZE_TOOLTIP)}>Organiser</div>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 4px' }} />
            <div
              ref={primitiveItemRef}
              style={{ ...menuItemStyle, position: 'relative' }}
              onMouseEnter={() => { openPrimitiveSubmenu(); showTooltip(PRIMITIVE_TOOLTIP); }}
              onMouseLeave={() => { closePrimitiveSubmenuDelayed(); hideTooltip(); }}
            >
              <span>Ajouter une primitive</span><span style={{ opacity: 0.6 }}>›</span>

              {primitiveSubmenuOpen && primitiveItemRef.current && createPortal(
                <div
                  onMouseEnter={openPrimitiveSubmenu}
                  onMouseLeave={closePrimitiveSubmenuDelayed}
                  style={{
                    position: 'fixed',
                    top: primitiveItemRef.current.getBoundingClientRect().top - 6,
                    left: primitiveItemRef.current.getBoundingClientRect().right,
                    zIndex: 10001,
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
                      boxShadow: '0 12px 40px 0 rgba(0,0,0,0.45), 0 4px 16px 0 rgba(0,0,0,0.35)',
                      border: 'none',
                    }}
                  >
                    <div
                      style={menuItemStyle}
                      onClick={() => runAction(() => window.dispatchEvent(new CustomEvent('apex-primitive-box-start')))} {...menuTooltip(BOX_TOOLTIP)}
                    >
                      Boîte
                    </div>
                    <div
                      style={menuItemStyle}
                      onClick={() => runAction(() => window.dispatchEvent(new CustomEvent('apex-primitive-pyramid-start')))} {...menuTooltip(PYRAMID_TOOLTIP)}
                    >
                      Pyramide 4 côtés
                    </div>
                  </div>
                </div>,
                document.body,
              )}
            </div>
            <div style={{ ...menuItemStyle, color: 'rgba(255,255,255,0.35)', cursor: 'default' }} {...menuTooltip(MODELS_TOOLTIP)}>
              <span>Ajouter des modèles pratiques</span><span style={{ opacity: 0.6 }}>›</span>
            </div>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 4px' }} />
            </>)}
            {contextSpace !== 'preparation' && (<>
              {SPACE_MENU_ITEMS[contextSpace].labels.map((label) => (
                <div key={label} style={{ ...menuItemStyle, color: 'rgba(255,255,255,0.35)', cursor: 'default' }} {...menuTooltip(SOON_TOOLTIP)}>
                  {label}
                </div>
              ))}
              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 4px' }} />
            </>)}
            {(contextSpace === 'preparation' || SPACE_MENU_ITEMS[contextSpace].plateBlur) && (
            <div style={{ padding: '8px 14px 4px' }}>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)', marginBottom: 6 }}>Niveau de flou sous le plateau</div>
              <ApexSlider
                tooltip={BLUR_TOOLTIP}
                value={blurLevel}
                onChange={(level) => {
                  setBlurLevel(level);
                  window.dispatchEvent(new CustomEvent('apex-set-blur-level', { detail: { level } }));
                }}
                min={0}
                max={120}
                step={1}
                defaultValue={DEFAULT_BLUR_LEVEL}
                format={(v) => `${Math.round(v)}`}
                ariaLabel="Niveau de flou sous le plateau"
              />
            </div>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
};