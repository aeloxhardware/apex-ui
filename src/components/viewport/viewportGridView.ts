// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';
import { showWarning } from '@/utils/toast';
import type { ViewportState } from './viewportState';

function setupFormatDistance(st: ViewportState) {
  const { GRID_MAJOR_MIN_PX, GRID_MIN_STEP_EXPONENT, camera, engine, formatGridValue } = st;
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
  st.gridZoomLimitReached = false;

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

  st.modelingActive = false;
  st.lastScaleBarLabel = '';
  st.lastScaleBarPx = 0;
  Object.assign(st, { DEFAULT_CAMERA_MIN_Z, DEFAULT_CAMERA_MAX_Z, SCALE_BAR_TARGET_PX, formatDistance,
    niceLength });
}

function setupGridZoomObserver(st: ViewportState) {
  const { DEFAULT_CAMERA_MAX_Z, GRID_MIN_STEP_EXPONENT, SCALE_BAR_TARGET_PX, camera, engine, formatDistance, formatGridValue, gridFrameInverse, gridFrameMatrix, gridTmpLocal, layoutGridLabels, niceLength, recenterGridGround, scene, setScaleBar, updateGrid } = st;
  const gridZoomObserver = scene.onBeforeRenderObservable.add(() => {
    if (!st.modelingActive) return;

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
    if (camera.radius <= (camera.lowerRadiusLimit ?? 0) * 1.001) {
      if (!st.gridZoomLimitReached) {
        st.gridZoomLimitReached = true;
        showWarning(`Zoom maximal atteint (pas de grille : ${formatGridValue(Math.pow(10, GRID_MIN_STEP_EXPONENT))} mm)`);
      }
    } else if (camera.radius > (camera.lowerRadiusLimit ?? 0) * 1.05) {
      st.gridZoomLimitReached = false;
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
    if (label !== st.lastScaleBarLabel || px !== st.lastScaleBarPx) {
      st.lastScaleBarLabel = label;
      st.lastScaleBarPx = px;
      setScaleBar({ px, label });
    }
  });
  Object.assign(st, { gridZoomObserver });
}

function setupOnModeChanged(st: ViewportState) {
  const { DEFAULT_CAMERA_MAX_Z, DEFAULT_CAMERA_MIN_Z, GRID_DEFAULT_HALF_EXTENT_MM, backdrop, camera, engine, gizmoManager, modelingGrid, recenterGridGround, resetLensShift, scene, setGridStandardPlane, setScaleBar, updateGrid, volumeRoot } = st;
  // Bascule slicer ↔ modélisation : on échange le volume d'impression contre la grille
  // d'esquisse et on relâche toute sélection/gizmo hérité de l'autre mode.
  const onModeChanged = (e: Event) => {
    const { mode } = (e as CustomEvent<{ mode: 'slicer' | 'modeling' }>).detail;
    if (scene.isDisposed) return;

    const modeling = mode === 'modeling';
    st.modelingActive = modeling;
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
      st.gridStepScale = 0;
      updateGrid(worldPerPixel);
      // Reforce le recalcul même si l'ancre précédente couvrait déjà l'origine (marge oblige) :
      // une session antérieure a pu la laisser loin du centre.
      st.gridAnchorX = Number.POSITIVE_INFINITY;
      st.gridAnchorZ = Number.POSITIVE_INFINITY;
      recenterGridGround();
    }
    modelingGrid.forEach((g) => g.setEnabled(modeling));
    // Entrée comme sortie : la grille repart sur le sol.
    setGridStandardPlane('XZ');
    st.sketchDrawnMeshes.forEach((m) => m.setEnabled(modeling));

    if (!modeling) {
      st.lastScaleBarLabel = '';
      st.lastScaleBarPx = 0;
      setScaleBar(null);
      st.gridZoomLimitReached = false;
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
  Object.assign(st, { onModeChanged });
}

function setupOrbitBasis(st: ViewportState) {
  const { camera, onModeChanged } = st;
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
    if (st.modelingActive || (camera.alpha === alpha0 && camera.beta === beta0)) return;
    const [d0, e0, u0] = orbitBasis(alpha0, beta0);
    const [d1, e1, u1] = orbitBasis(camera.alpha, camera.beta);
    const v = camera.target.subtract(SLICER_ORBIT_PIVOT);
    const rotated = d1.scale(BABYLON.Vector3.Dot(v, d0))
      .addInPlace(e1.scale(BABYLON.Vector3.Dot(v, e0)))
      .addInPlace(u1.scale(BABYLON.Vector3.Dot(v, u0)));
    camera.target.copyFrom(rotated.addInPlace(SLICER_ORBIT_PIVOT));
  };
}

export function setupViewportGridView(st: ViewportState) {
  setupFormatDistance(st);
  setupGridZoomObserver(st);
  setupOnModeChanged(st);
  setupOrbitBasis(st);
}
