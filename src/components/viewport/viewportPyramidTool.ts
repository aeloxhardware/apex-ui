// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';
import { dropInMesh } from './viewportDropIn';
import { nextPrimitiveName, registerCreatedModel } from './viewportHistory';
import { createScreenLines } from '../screenLine';
import type { ViewportState } from './viewportState';

import { emitApex } from '@/events/apexEvents';
function setupDisposePyramidPreview(st: ViewportState) {
  const { groundPickPlane } = st;
  st.pyramidPhase = 'idle';
  st.pyramidBaseStart = null;
  st.pyramidBaseCorner = null;
  st.pyramidPreviewRings = null;
  st.pyramidHeight = 0;

  const disposePyramidPreview = () => {
    st.pyramidPreviewRings?.dispose(false, true);
    st.pyramidPreviewRings = null;
  };

  const resetPyramidTool = () => {
    st.pyramidPhase = 'idle';
    st.pyramidBaseStart = null;
    st.pyramidBaseCorner = null;
    st.pyramidHeight = 0;
    groundPickPlane.isPickable = false;
    disposePyramidPreview();
  };
  st.resetPyramidTool = resetPyramidTool;

  st.disposePyramidPreview = disposePyramidPreview;
}

function setupBuildPyramidPreview(st: ViewportState) {
  const { LINE_WIDTH_PX, scene } = st;
  /** Arêtes de la pyramide finale : rectangle de base, plus les 4 arêtes qui montent au sommet
   * (au centre, à `height`). Tant que la hauteur est nulle, seule la base est tracée. Recréé à
   * chaque appel : un ruban écran n'a pas de mise à jour en place (cf. `buildBoxOutline`). */
  const buildPyramidPreview = (
    min: BABYLON.Vector3, max: BABYLON.Vector3, height: number, previous?: BABYLON.Mesh | null,
  ) => {
    const first = new BABYLON.Vector3(min.x, min.y, min.z);
    const corners = [
      first, new BABYLON.Vector3(max.x, min.y, min.z),
      new BABYLON.Vector3(max.x, min.y, max.z), new BABYLON.Vector3(min.x, min.y, max.z),
    ];
    const lines: BABYLON.Vector3[][] = [[...corners, first]];
    if (height > 0.01) {
      const apex = new BABYLON.Vector3((min.x + max.x) / 2, min.y + height, (min.z + max.z) / 2);
      corners.forEach((corner) => lines.push([corner, apex]));
    }
    previous?.dispose(false, true);
    const mesh = createScreenLines(scene, "pyramidDrawPreview", lines, new BABYLON.Color3(0.9608, 0.6196, 0.0431), LINE_WIDTH_PX);
    mesh.isPickable = false;
    return mesh;
  };
  st.buildPyramidPreview = buildPyramidPreview;
}

/** Pyramide à base carrée posée sur `min.y`, enregistrée comme modèle. */
function createPyramidMesh(st: ViewportState, min: BABYLON.Vector3, max: BABYLON.Vector3, height: number): BABYLON.Mesh {
  const { scene } = st;
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

  const finalPyramid = new BABYLON.Mesh(nextPrimitiveName(st, 'Pyramide'), scene);
  vertexData.applyToMesh(finalPyramid);
  const finalMat = new BABYLON.StandardMaterial("primitivePyramidMat", scene);
  finalMat.diffuseColor = new BABYLON.Color3(0.75, 0.78, 0.82);
  // Aucun reflet spéculaire : un rendu mat plutôt que le léger brillant par défaut.
  finalMat.specularColor = new BABYLON.Color3(0, 0, 0);
  finalMat.backFaceCulling = false;
  finalPyramid.material = finalMat;
  return finalPyramid;
}

/** Crée la pyramide pleine et la fait tomber sur le plateau (apparition en fondu, chute, petits rebonds). */
function spawnPyramid(st: ViewportState, min: BABYLON.Vector3, max: BABYLON.Vector3, height: number) {
  const pyramid = createPyramidMesh(st, min, max, height);
  pyramid.isPickable = false; // ni sélectionnable ni tranchable tant que la chute n'est pas finie
  dropInMesh(st.scene, pyramid, () => {
    pyramid.isPickable = true;
    emitApex('apex-tool-changed', { tool: 'select' });
    registerCreatedModel(st, pyramid);
  });
}


function setupOnPyramidDrawStart(st: ViewportState) {
  const { groundPickPlane, resetBoxTool, resetPyramidTool, scene } = st;
  const onPyramidDrawStart = () => {
    if (scene.isDisposed) return;
    resetBoxTool(); // un seul outil de dessin actif à la fois sur `groundPickPlane`
    resetPyramidTool();
    st.pyramidPhase = 'drawing-base';
    groundPickPlane.isPickable = true;
  };
  window.addEventListener('apex-primitive-pyramid-start', onPyramidDrawStart);
  Object.assign(st, { onPyramidDrawStart });
}

function setupPyramidDrawObserver(st: ViewportState) {
  const { HEIGHT, PLATE_SURFACE_Y, buildPyramidPreview, camera, disposePyramidPreview, engine, groundPickPlane, pickPlatePoint, resetPyramidTool, scene } = st;
  const pyramidDrawObserver = scene.onPointerObservable.add((pointerInfo) => {
    if (st.pyramidPhase === 'idle') return;

    if (st.pyramidPhase === 'drawing-base') {
      const pick = pickPlatePoint(st.pyramidBaseStart);
      if (!pick?.hit || !pick.pickedPoint) return;

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        const corner = st.pyramidBaseStart ?? pick.pickedPoint;
        const min = new BABYLON.Vector3(Math.min(corner.x, pick.pickedPoint.x), PLATE_SURFACE_Y, Math.min(corner.z, pick.pickedPoint.z));
        const max = new BABYLON.Vector3(Math.max(corner.x, pick.pickedPoint.x), PLATE_SURFACE_Y, Math.max(corner.z, pick.pickedPoint.z));
        st.pyramidPreviewRings = buildPyramidPreview(min, max, 0, st.pyramidPreviewRings);
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
        if (!st.pyramidBaseStart) {
          st.pyramidBaseStart = pick.pickedPoint.clone();
          return;
        }
        const corner = pick.pickedPoint.clone();
        if (corner.subtract(st.pyramidBaseStart).length() < 2) {
          resetPyramidTool();
          return;
        }
        st.pyramidBaseCorner = corner;
        st.pyramidPhase = 'extruding';
      }
      return;
    }

    if (st.pyramidPhase === 'extruding' && st.pyramidBaseStart && st.pyramidBaseCorner) {
      const min = new BABYLON.Vector3(Math.min(st.pyramidBaseStart.x, st.pyramidBaseCorner.x), PLATE_SURFACE_Y, Math.min(st.pyramidBaseStart.z, st.pyramidBaseCorner.z));
      const max = new BABYLON.Vector3(Math.max(st.pyramidBaseStart.x, st.pyramidBaseCorner.x), PLATE_SURFACE_Y, Math.max(st.pyramidBaseStart.z, st.pyramidBaseCorner.z));

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
        st.pyramidHeight = Math.min(HEIGHT, rawHeight);
        st.pyramidPreviewRings = buildPyramidPreview(min, max, st.pyramidHeight, st.pyramidPreviewRings);
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
        if (st.pyramidHeight < 1) return;
        st.pyramidPhase = 'filling';
        groundPickPlane.isPickable = false;
        disposePyramidPreview();
        spawnPyramid(st, min, max, st.pyramidHeight);
      }
    }
  });
  Object.assign(st, { pyramidDrawObserver });
}

export function setupViewportPyramidTool(st: ViewportState) {
  setupDisposePyramidPreview(st);
  setupBuildPyramidPreview(st);
  setupOnPyramidDrawStart(st);
  setupPyramidDrawObserver(st);
}
