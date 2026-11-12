// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';
import { dropInMesh } from './viewportDropIn';
import { nextPrimitiveName, registerCreatedModel } from './viewportHistory';
import { createScreenLines } from '../screenLine';
import type { ViewportState } from './viewportState';

import { emitApex } from '@/events/apexEvents';
function setupBoxPhase(st: ViewportState) {
  const { HEIGHT, scene } = st;
  st.boxPhase = 'idle';
  st.boxBaseStart = null;
  st.boxBaseCorner = null;
  st.boxPreviewOutline = null;
  st.boxExtrudeHeight = 0;

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
  Object.assign(st, { groundPickPlane });
}

function setupPickPlatePoint(st: ViewportState) {
  const { PLATE_SURFACE_Y, RADIUS, groundPickPlane, scene } = st;
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
    st.boxPreviewOutline?.dispose(false, true);
    st.boxPreviewOutline = null;
  };

  const resetBoxTool = () => {
    st.boxPhase = 'idle';
    st.boxBaseStart = null;
    st.boxBaseCorner = null;
    st.boxExtrudeHeight = 0;
    groundPickPlane.isPickable = false;
    disposeBoxPreview();
  };
  Object.assign(st, { pickPlatePoint, disposeBoxPreview, resetBoxTool });
}


function setupBuildBoxOutline(st: ViewportState) {
  const { LINE_WIDTH_PX, scene } = st;
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
    const mesh = createScreenLines(scene, "boxDrawOutline", lines, new BABYLON.Color3(0.9608, 0.6196, 0.0431), LINE_WIDTH_PX);
    mesh.isPickable = false;
    return mesh;
  };
  Object.assign(st, { buildBoxOutline });
}

/** Crée le pavé plein et le fait tomber sur le plateau (apparition en fondu, chute, petits rebonds). */
function spawnBox(st: ViewportState, min: BABYLON.Vector3, max: BABYLON.Vector3) {
  const { scene } = st;
  const height = max.y - min.y;
  const box = BABYLON.MeshBuilder.CreateBox(nextPrimitiveName(st, 'Boîte'), {
    width: max.x - min.x, height, depth: max.z - min.z,
  }, scene);
  box.position.set((min.x + max.x) / 2, min.y + height / 2, (min.z + max.z) / 2);
  const mat = new BABYLON.StandardMaterial("primitiveBoxMat", scene);
  mat.diffuseColor = new BABYLON.Color3(0.75, 0.78, 0.82);
  mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
  box.material = mat;
  // Hors plateau (ni sélectionnable ni tranchable) tant que la chute n'est pas finie.
  box.isPickable = false;
  dropInMesh(scene, box, () => {
    box.isPickable = true;
    emitApex('apex-tool-changed', { tool: 'select' });
    registerCreatedModel(st, box);
  });
}

function setupOnBoxDrawStart(st: ViewportState) {
  const { groundPickPlane, resetBoxTool, scene } = st;
  const onBoxDrawStart = () => {
    if (scene.isDisposed) return;
    st.resetPyramidTool(); // un seul outil de dessin actif à la fois sur `groundPickPlane`
    resetBoxTool();
    st.boxPhase = 'drawing-base';
    groundPickPlane.isPickable = true;
  };
  window.addEventListener('apex-primitive-box-start', onBoxDrawStart);
  Object.assign(st, { onBoxDrawStart });
}

function setupBoxDrawObserver(st: ViewportState) {
  const { HEIGHT, PLATE_SURFACE_Y, buildBoxOutline, camera, disposeBoxPreview, engine, groundPickPlane, pickPlatePoint, resetBoxTool, scene } = st;
  const boxDrawObserver = scene.onPointerObservable.add((pointerInfo) => {
    if (st.boxPhase === 'idle') return;

    if (st.boxPhase === 'drawing-base') {
      // Cette phase a besoin du point d'intersection avec le plateau : elle reste donc
      // dépendante du pick sur `groundPickPlane`, qui a une étendue finie mais couvre
      // Point visé ramené sur le plateau (cf. pickPlatePoint).
      const pick = pickPlatePoint(st.boxBaseStart);
      if (!pick?.hit || !pick.pickedPoint) return;

      // Interaction en deux clics (clic-relâche à un coin, clic-relâche
      // à l'autre), pas un cliquer-glisser continu : un clic bref donne un déplacement
      // souris quasi nul entre down et up, ce qui annulait systématiquement le rectangle
      // si on se basait sur la distance parcourue *pendant* le clic. On distingue plutôt
      // le premier clic (pose le coin de départ) du second (valide le coin opposé), et le
      // survol entre les deux prévisualise le rectangle.
      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        const corner = st.boxBaseStart ?? pick.pickedPoint;
        const min = new BABYLON.Vector3(Math.min(corner.x, pick.pickedPoint.x), PLATE_SURFACE_Y, Math.min(corner.z, pick.pickedPoint.z));
        const max = new BABYLON.Vector3(Math.max(corner.x, pick.pickedPoint.x), PLATE_SURFACE_Y + 0.01, Math.max(corner.z, pick.pickedPoint.z));
        st.boxPreviewOutline = buildBoxOutline(min, max, st.boxPreviewOutline);
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
        if (!st.boxBaseStart) {
          // Premier clic : pose le coin de départ, le rectangle reste à dessiner.
          st.boxBaseStart = pick.pickedPoint.clone();
          return;
        }
        const corner = pick.pickedPoint.clone();
        if (corner.subtract(st.boxBaseStart).length() < 2) {
          // Second clic quasi au même endroit que le premier : rectangle dégénéré, on
          // annule plutôt que d'extruder un plat.
          resetBoxTool();
          return;
        }
        st.boxBaseCorner = corner;
        st.boxPhase = 'extruding';
      }
      return;
    }

    if (st.boxPhase === 'extruding' && st.boxBaseStart && st.boxBaseCorner) {
      // Cette phase ne dépend plus du pick au sol : `groundPickPlane` a une étendue finie
      // (300mm de côté), et viser au-delà de ses bords pour extruder plus haut ou selon un
      // angle de caméra rasant est un geste normal — un pick manqué gelait alors la
      // hauteur. La hauteur ne dépend donc que de la position écran du curseur, projetée
      // depuis un point de référence fixe au sol, sans jamais retester d'intersection.
      const min = new BABYLON.Vector3(Math.min(st.boxBaseStart.x, st.boxBaseCorner.x), PLATE_SURFACE_Y, Math.min(st.boxBaseStart.z, st.boxBaseCorner.z));
      const max = new BABYLON.Vector3(Math.max(st.boxBaseStart.x, st.boxBaseCorner.x), PLATE_SURFACE_Y, Math.max(st.boxBaseStart.z, st.boxBaseCorner.z));

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        const originScreen = BABYLON.Vector3.Project(
          new BABYLON.Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2),
          BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
          camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
        );
        const pixelsPerMm = 3;
        const rawHeight = Math.max(0, (originScreen.y - scene.pointerY) / pixelsPerMm);
        st.boxExtrudeHeight = Math.min(HEIGHT, rawHeight);
        const extrudedMax = new BABYLON.Vector3(max.x, PLATE_SURFACE_Y + st.boxExtrudeHeight, max.z);
        st.boxPreviewOutline = buildBoxOutline(min, extrudedMax, st.boxPreviewOutline);
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
        if (st.boxExtrudeHeight < 1) return; // évite un pavé nul sur double-clic accidentel
        st.boxPhase = 'filling';
        groundPickPlane.isPickable = false;
        disposeBoxPreview();
        spawnBox(st, min, new BABYLON.Vector3(max.x, PLATE_SURFACE_Y + st.boxExtrudeHeight, max.z));
      }
    }
  });
  Object.assign(st, { boxDrawObserver });
}

export function setupViewportBoxTool(st: ViewportState) {
  setupBoxPhase(st);
  setupPickPlatePoint(st);
  setupBuildBoxOutline(st);
  setupOnBoxDrawStart(st);
  setupBoxDrawObserver(st);
}
