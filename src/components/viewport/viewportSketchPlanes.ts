// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';
import { GCODE_MESH_PREFIX } from '../gcodeLayer';
import { cameraAnglesFacing } from './cameraAngles';
import type { ViewportState } from './viewportState';

import { emitApex } from '@/events/apexEvents';
function setupMakeSketchPlaneGlassMat(st: ViewportState) {
  const { scene } = st;
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
  // d'origine, jamais jointifs) et évite le z-fighting sur les arêtes.
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
  Object.assign(st, { SKETCH_PLANE_SIZE, SKETCH_PLANE_GAP, makeSketchPlaneGlassMat });
}

function setupMakeSketchPlanePlate(st: ViewportState) {
  const { SKETCH_PLANE_GAP, SKETCH_PLANE_SIZE, makeSketchPlaneGlassMat, scene } = st;
  // Teinte neutre bleu-gris par défaut, cyan (l'accent déjà utilisé partout dans l'app) au
  // survol — la 4e composante est la force du mélange avec l'arrière-plan flouté.
  const sketchPlaneDefaultMat = makeSketchPlaneGlassMat("sketchPlaneDefaultMat", new BABYLON.Color4(0.78, 0.8, 0.82, 1));
  const sketchPlaneHoverMat = makeSketchPlaneGlassMat("sketchPlaneHoverMat", new BABYLON.Color4(0.55, 0.9, 0.95, 1));

  /**
   * Un plan d'origine est un quadrant partant de l'origine, pas un carré centré
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
  Object.assign(st, { sketchPlaneDefaultMat, sketchPlaneHoverMat, sketchPlateRotMatrix, sketchPlatePlateXZ,
    sketchPlatePlateXY, sketchPlatePlateYZ, sketchPlanePlates });
}

function setupSketchPlanePlateAxis(st: ViewportState) {
  const { scene, sketchPlatePlateXY, sketchPlatePlateXZ, sketchPlatePlateYZ } = st;
  const sketchPlanePlateAxis = new Map<BABYLON.Mesh, 'XZ' | 'XY' | 'YZ'>([
    [sketchPlatePlateXZ, 'XZ'], [sketchPlatePlateXY, 'XY'], [sketchPlatePlateYZ, 'YZ'],
  ]);

  // Point d'origine (petite sphère blanche) au coin commun des 3 plaques, comme le repère
  // visible à l'intersection des plans principaux.
  const sketchPlaneOrigin = BABYLON.MeshBuilder.CreateSphere("sketchPlaneOriginMarker", { diameter: 3 }, scene);
  const originMat = new BABYLON.StandardMaterial("sketchPlaneOriginMarkerMat", scene);
  originMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
  originMat.disableLighting = true;
  sketchPlaneOrigin.material = originMat;
  sketchPlaneOrigin.isPickable = false;
  sketchPlaneOrigin.setEnabled(false);

  // Arêtes colorées et pointillées le long de CHAQUE plaque: les
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
  Object.assign(st, { sketchPlanePlateAxis, sketchPlaneOrigin, AXIS_COLORS, SKETCH_EDGE_WIDTH,
    sketchEdgesByAxis });
}

function setupSketchPlaneAxisLines(st: ViewportState) {
  const { AXIS_COLORS, SKETCH_EDGE_WIDTH, SKETCH_PLANE_GAP, SKETCH_PLANE_SIZE, scene, sketchEdgesByAxis, sketchPlanePlates, sketchPlateRotMatrix } = st;
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
  Object.assign(st, { sketchPlaneAxisLines, sketchAxisEnd });
}

function setupSetSketchPlanePickActive(st: ViewportState) {
  const { AXIS_COLORS, SKETCH_EDGE_WIDTH, scene, setSketchPlaneHint, sketchAxisEnd, sketchPlaneAxisLines, sketchPlaneDefaultMat, sketchPlaneOrigin, sketchPlanePlates } = st;
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

  st.sketchPlanePickActive = false;
  st.sketchPlaneHoveredPlate = null;

  const setSketchPlanePickActive = (active: boolean) => {
    st.sketchPlanePickActive = active;
    sketchPlanePlates.forEach((p) => { p.setEnabled(active); p.isPickable = active; p.material = sketchPlaneDefaultMat; });
    sketchPlaneOrigin.setEnabled(active);
    sketchPlaneAxisLines.forEach((l) => l.setEnabled(active));
    st.sketchPlaneHoveredPlate = null;
    if (!active) setSketchPlaneHint(null);
  };

  // Taille écran constante : tout le décor (plaques, repère, axes) est mis à l'échelle autour
  // de l'origine à chaque image, proportionnellement à la distance caméra-origine, pour que
  // l'ensemble occupe toujours la même fraction de la hauteur de l'écran quel que soit le zoom.
  const SKETCH_PLANE_SCREEN_FRACTION = 0.14;
  const sketchPlaneBasePositions = new Map<BABYLON.Mesh, BABYLON.Vector3>(
    sketchPlanePlates.map((p) => [p, p.position.clone()]),
  );
  Object.assign(st, { setSketchPlanePickActive, SKETCH_PLANE_SCREEN_FRACTION, sketchPlaneBasePositions });
}

function setupSetOrbitLocked(st: ViewportState) {
  const { SKETCH_PLANE_SCREEN_FRACTION, applyPanMode, camera, gridFrameOrigin, gridFrameQuat, lensShift, scene, sketchAxisEnd, sketchPlaneAxisLines, sketchPlaneBasePositions, sketchPlaneOrigin, sketchPlanePlates } = st;
  const sketchPlaneScaleObserver = scene.onBeforeRenderObservable.add(() => {
    if (!st.sketchPlanePickActive) return;
    const distance = st.orthoActive ? camera.radius : BABYLON.Vector3.Distance(camera.position, BABYLON.Vector3.Zero());
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
    st.sketchOrbitLocked = locked;
    applyPanMode(); // reconstruit la table des commandes (pan en perspective compris)
  };
  st.sketchViewSnapshot = null;
  const saveSketchView = () => {
    if (st.sketchViewSnapshot) return;
    st.sketchViewSnapshot = {
      alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone(),
      lens: { x: lensShift.x, y: lensShift.y },
      frameOrigin: gridFrameOrigin.clone(), frameQuat: gridFrameQuat.clone(), standard: st.gridStandardPlane,
    };
  };
  const clearSketchView = () => { st.sketchViewSnapshot = null; };
  Object.assign(st, { sketchPlaneScaleObserver, setOrbitLocked, saveSketchView, clearSketchView });
}

function setupRestoreSketchView(st: ViewportState) {
  const { camera, clearSketchView, lensShift, saveSketchView, scene, setGridFrame, setGridStandardPlane, setOrbitLocked } = st;
  const restoreSketchView = () => {
    const snap = st.sketchViewSnapshot;
    st.sketchViewSnapshot = null;
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
  Object.assign(st, { restoreSketchView, lockOrbit, unlockOrbit });
}

function setupOnSketchPlanePickStart(st: ViewportState) {
  const { camera, resetLensShift, scene, setSketchPlanePickActive, unlockOrbit } = st;
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
  Object.assign(st, { onSketchPlanePickStart, onSketchPlanePickCancel, orientCameraToPlane });
}

/** Clic sur une face d'un corps existant : la caméra lui fait face et la grille s'aligne dessus. */
function selectFacePlane(st: ViewportState, pick: BABYLON.PickingInfo, point: BABYLON.Vector3) {
  const { orientCameraToPlane, setGridFrame } = st;
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
  const { alpha, beta, horizontal } = cameraAnglesFacing(n);
  orientCameraToPlane(alpha, beta);

  // Grille alignée sur la face : origine au point cliqué, normale = normale de la face,
  // axe x horizontal (ou X du monde pour une face horizontale), z = x vectoriel normale.
  // Caméra du côté de la normale : x doit pointer vers la droite de l'écran, soit n x haut
  // (main gauche), et z = x x n pointe alors vers le haut de l'écran.
  const faceX = horizontal
    ? new BABYLON.Vector3(1, 0, 0)
    : BABYLON.Vector3.Cross(n, BABYLON.Vector3.Up()).normalize();
  const faceZ = BABYLON.Vector3.Cross(faceX, n).normalize();
  setGridFrame(point, faceX, n, faceZ, null);

  emitApex('apex-sketch-plane-selected', {
      kind: 'face',
      origin: { x: point.x, y: point.y, z: point.z },
      normal: { x: normal.x, y: normal.y, z: normal.z },
    });
}

function setupSketchPlanePickObserver(st: ViewportState) {
  const { GRID_ALIGNED_VIEW, backdrop, glassDisc, groundPickPlane, modelingGrid, orientCameraToPlane, outline, scene, setGridStandardPlane, setSketchPlaneHint, setSketchPlanePickActive, sketchPlaneDefaultMat, sketchPlaneHoverMat, sketchPlanePlateAxis, sketchPlanePlates, topOutline } = st;
  const sketchPlanePickObserver = scene.onPointerObservable.add((pointerInfo) => {
    if (!st.sketchPlanePickActive) return;

    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      setSketchPlaneHint({ x: pointerInfo.event.clientX, y: pointerInfo.event.clientY });

      const hoverPick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => sketchPlanePlates.includes(mesh as BABYLON.Mesh));
      const hovered = hoverPick?.hit ? (hoverPick.pickedMesh as BABYLON.Mesh) : null;
      if (hovered !== st.sketchPlaneHoveredPlate) {
        if (st.sketchPlaneHoveredPlate) st.sketchPlaneHoveredPlate.material = sketchPlaneDefaultMat;
        if (hovered) hovered.material = sketchPlaneHoverMat;
        st.sketchPlaneHoveredPlate = hovered;
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
      emitApex('apex-sketch-plane-selected', { kind: 'axis', plane: axis });
      return;
    }

    selectFacePlane(st, pick, pick.pickedPoint);
  });
  Object.assign(st, { sketchPlanePickObserver });
}

export function setupViewportSketchPlanes(st: ViewportState) {
  setupMakeSketchPlaneGlassMat(st);
  setupMakeSketchPlanePlate(st);
  setupSketchPlanePlateAxis(st);
  setupSketchPlaneAxisLines(st);
  setupSetSketchPlanePickActive(st);
  setupSetOrbitLocked(st);
  setupRestoreSketchView(st);
  setupOnSketchPlanePickStart(st);
  setupSketchPlanePickObserver(st);
}
