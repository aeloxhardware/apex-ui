// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';
import { createScreenLines } from '../screenLine';
import type { ExtrudeFace } from './viewportTypes';
import type { ViewportState } from './viewportState';

import { emitApex } from '@/events/apexEvents';
function setupIsSolid(st: ViewportState) {
  const { isUnderModel, scene } = st;
  // --- Corps extrudé, en temps réel : couvercle supérieur (la face déplacée), parois le long du bord de
  // la face et contours noirs (bords du haut et du bas + arêtes aux coins), tous recalculés à chaque
  // changement de distance. Les arêtes de triangulation ne sont jamais dessinées : seuls les contours
  // de la forme le sont, donc le rendu est le même pour tous les corps non triangulés.
  st.extrudeBoundary = [];
  st.extrudeCornerPoints = [];
  st.extrudeWalls = null;
  st.extrudeEdges = null;
  const extrudedBodies: BABYLON.Mesh[] = []; // corps validés (OK) : restent dans la scène
  /** Maillage plein dont on peut choisir faces et arêtes : modèle importé ou face d'un corps extrudé. */
  const isSolid = (m: BABYLON.AbstractMesh) =>
    !!isUnderModel(m) || (extrudedBodies.includes(m as BABYLON.Mesh) && m.name !== 'extrudeBodyEdges');
  st.isSolid = isSolid;
  const extrudeBodyMaterial = new BABYLON.StandardMaterial('extrudeBodyMat', scene);
  extrudeBodyMaterial.diffuseColor = new BABYLON.Color3(0.72, 0.75, 0.8);
  extrudeBodyMaterial.emissiveColor = new BABYLON.Color3(0.32, 0.34, 0.38);
  extrudeBodyMaterial.specularColor = BABYLON.Color3.Black();
  extrudeBodyMaterial.backFaceCulling = false;

  const vertexKey = (x: number, y: number, z: number) =>
    `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  Object.assign(st, { extrudedBodies, extrudeBodyMaterial, vertexKey });
}

function setupComputeExtrudeBoundary(st: ViewportState) {
  const { vertexKey } = st;
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
    st.extrudeBoundary = Array.from(edges.values()).filter((e) => e.count === 1);
    // Coins : sommets du bord dont les deux arêtes ne sont pas alignées (ou en nombre ≠ 2).
    const around = new Map<string, { point: BABYLON.Vector3; dirs: BABYLON.Vector3[] }>();
    const add = (from: BABYLON.Vector3, to: BABYLON.Vector3) => {
      const key = vertexKey(from.x, from.y, from.z);
      const entry = around.get(key) ?? { point: from, dirs: [] };
      entry.dirs.push(to.subtract(from).normalize());
      around.set(key, entry);
    };
    st.extrudeBoundary.forEach((e) => { add(e.a, e.b); add(e.b, e.a); });
    st.extrudeCornerPoints = [];
    around.forEach((entry) => {
      const straight = entry.dirs.length === 2 && Math.abs(BABYLON.Vector3.Dot(entry.dirs[0], entry.dirs[1])) > 0.9999;
      if (!straight) st.extrudeCornerPoints.push(entry.point);
    });
  };

  const disposeExtrudeBody = () => {
    st.extrudeWalls?.dispose();
    st.extrudeEdges?.dispose();
    st.extrudeWalls = null;
    st.extrudeEdges = null;
  };
  Object.assign(st, { computeExtrudeBoundary, disposeExtrudeBody });
}

function setupRebuildExtrudeBody(st: ViewportState) {
  const { disposeExtrudeBody, extrudeBodyMaterial, extrudedBodies, makeTriangleSoup, scene, sketchDrawnMeshes } = st;
  const rebuildExtrudeBody = () => {
    disposeExtrudeBody();
    const face = st.extrudeFace;
    const t = st.extrudeDistance;
    if (!face || t < 1e-6 || st.extrudeBoundary.length === 0) return;
    const shift = face.normal.scale(t);
    const positions: number[] = [];
    const lines: BABYLON.Vector3[][] = [];
    st.extrudeBoundary.forEach(({ a, b }) => {
      const a2 = a.add(shift);
      const b2 = b.add(shift);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, b2.x, b2.y, b2.z, a.x, a.y, a.z, b2.x, b2.y, b2.z, a2.x, a2.y, a2.z);
      lines.push([a, b], [a2, b2]);
    });
    st.extrudeCornerPoints.forEach((c) => lines.push([c, c.add(shift)]));
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
    st.extrudeWalls = walls;
    st.extrudeEdges = createScreenLines(scene, 'extrudeBodyEdges', lines, BABYLON.Color3.Black(), 1.8, 1);
    st.extrudeEdges.isPickable = false;
  };

  /** OK : le corps reste dans la scène (couvercle, parois, contours) ; l'aperçu ne l'efface plus. */
  const commitExtrudeBody = () => {
    const face = st.extrudeFace;
    if (!face || st.extrudeDistance < 1e-6 || !st.extrudeGhost || !st.extrudeWalls || !st.extrudeEdges) return;
    const bottom = makeTriangleSoup('extrudedBodyBottom', st.extrudeRegionPositions
      ?? (st.extrudeSketchCorners
        ? [0, 1, 2, 0, 2, 3].flatMap((i) => [st.extrudeSketchCorners![i].x, st.extrudeSketchCorners![i].y, st.extrudeSketchCorners![i].z])
        : []), BABYLON.Vector3.Zero(), extrudeBodyMaterial);
    const kept = [st.extrudeGhost, st.extrudeWalls, st.extrudeEdges, bottom];
    // Couvercle, parois et fond : faces et arêtes sélectionnables comme celles d'un modèle (isSolid).
    [st.extrudeGhost, st.extrudeWalls, bottom].forEach((m) => { m.isPickable = true; });
    st.extrudeGhost.setEnabled(true);
    extrudedBodies.push(...kept);
    sketchDrawnMeshes.push(...kept);
    st.extrudeGhost = null;
    st.extrudeWalls = null;
    st.extrudeEdges = null;
  };
  Object.assign(st, { rebuildExtrudeBody, commitExtrudeBody });
}

function setupPlaceExtrudeArrow(st: ViewportState) {
  const { clearBrowseEdge, clearExtrudeHover, disposeExtrudeBody, rebuildExtrudeBody } = st;
  const placeExtrudeArrow = () => {
    const face = st.extrudeFace;
    if (!face || !st.extrudeArrowRoot) return;
    st.extrudeArrowRoot.position.copyFrom(face.origin).addInPlace(face.normal.scale(st.extrudeDistance));
    if (st.extrudeGhost) st.extrudeGhost.position.copyFrom(face.normal.scale(st.extrudeDistance));
    rebuildExtrudeBody();
  };

  const clearExtrudeFace = () => {
    st.extrudeOverlay?.dispose();
    st.extrudeGhost?.dispose();
    st.extrudeArrowRoot?.dispose(false, true);
    st.extrudeOverlay = null;
    st.extrudeGhost = null;
    st.extrudeArrowRoot = null;
    st.extrudeArrowMeshes = [];
    st.extrudeFace = null;
    st.extrudeDrag = null;
    st.extrudeDistance = 0;
    st.extrudeRegionPositions = null;
    st.extrudeSketchCorners = null;
    st.extrudeRegion = null;
    clearExtrudeHover();
    clearBrowseEdge();
    disposeExtrudeBody();
    st.extrudeBoundary = [];
    st.extrudeCornerPoints = [];
  };
  Object.assign(st, { placeExtrudeArrow, clearExtrudeFace });
}

function setupSelectExtrudeFace(st: ViewportState) {
  const { clearExtrudeFace, computeExtrudeBoundary, extrudeArrowMaterial, extrudeBodyMaterial, extrudeFaceMaterial, isExtrudeFaceMode, makeTriangleSoup, placeExtrudeArrow, scene } = st;
  const selectExtrudeFace = (face: ExtrudeFace, region: number[] | null, corners: BABYLON.Vector3[] | null) => {
    clearExtrudeFace();
    st.extrudeFace = face;
    st.extrudeRegionPositions = region;
    st.extrudeSketchCorners = corners;
    const lift = face.normal.scale(0.02);
    const positions = region ?? (corners ? [0, 1, 2, 0, 2, 3].flatMap((i) => [corners[i].x, corners[i].y, corners[i].z]) : []);
    st.extrudeOverlay = makeTriangleSoup('extrudeFaceOverlay', positions, lift, extrudeFaceMaterial);
    st.extrudeGhost = makeTriangleSoup('extrudeFaceGhost', positions, lift, extrudeBodyMaterial);
    st.extrudeGhost.setEnabled(false);
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
    st.extrudeArrowMeshes = [shaft, head];
    const up = new BABYLON.Vector3(0, 1, 0);
    const axis = BABYLON.Vector3.Cross(up, face.normal);
    const dot = Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(up, face.normal)));
    root.rotationQuaternion = axis.length() < 1e-6
      ? (dot > 0 ? BABYLON.Quaternion.Identity() : BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1, 0, 0), Math.PI))
      : BABYLON.Quaternion.RotationAxis(axis.normalize(), Math.acos(dot));
    st.extrudeArrowRoot = root;
    st.extrudeDistance = 0;
    placeExtrudeArrow();
    emitApex('apex-extrude-face', { kind: face.kind, modelName: face.modelName ?? null,
        origin: { x: face.origin.x, y: face.origin.y, z: face.origin.z },
        normal: { x: face.normal.x, y: face.normal.y, z: face.normal.z } });
  };
  Object.assign(st, { selectExtrudeFace });
}

function setupExtrudePointerRay(st: ViewportState) {
  const { camera, canvas, engine, placeExtrudeArrow, scene } = st;
  // Taille écran constante de la flèche (≈ 18 % de la hauteur visible à sa distance).
  const extrudeArrowScaleObserver = scene.onBeforeRenderObservable.add(() => {
    if (!st.extrudeArrowRoot) return;
    const distance = st.orthoActive ? camera.radius : BABYLON.Vector3.Distance(camera.position, st.extrudeArrowRoot.position);
    const visibleHeight = 2 * distance * Math.tan(camera.fov / 2);
    st.extrudeArrowRoot.scaling.setAll(Math.max(1e-6, 0.18 * visibleHeight));
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
  st.extrudePointerRay = extrudePointerRay;

  /** Paramètre s du point de l'axe de la flèche le plus proche du rayon de la souris. */
  const axisParameterAt = (clientX: number, clientY: number) => {
    const face = st.extrudeFace;
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
    st.extrudeDistance = Math.max(0, t);
    placeExtrudeArrow();
    st.extrudeGhost?.setEnabled(st.extrudeDistance > 1e-6);
    if (emit) {
      emitApex('apex-extrude-distance', { distance: st.extrudeDistance });
    }
  };
  Object.assign(st, { extrudeArrowScaleObserver, axisParameterAt, setExtrudeDistance });
}

function selectPickedFace(st: ViewportState, pick: BABYLON.PickingInfo, mesh: BABYLON.AbstractMesh, px: number, py: number) {
  const { camera, clearExtrudeFace, coplanarRegion, isUnderModel, scene, selectExtrudeFace, sketchRegionOf } = st;
  const rayDir = scene.createPickingRay(px, py, BABYLON.Matrix.Identity(), camera).direction;
  const deselect = () => {
    clearExtrudeFace();
    emitApex('apex-extrude-face', null);
  };
  const cellInfo = (mesh.metadata as { sketchCell?: { group: number; key: string } } | null)?.sketchCell;
  if (cellInfo) {
    const region = sketchRegionOf(cellInfo.group, cellInfo.key);
    if (!region) return;
    // Second clic sur la région déjà choisie : désélection.
    if (st.extrudeRegion && st.extrudeRegion.group === cellInfo.group && st.extrudeRegion.keys.has(cellInfo.key)) {
      deselect();
      return;
    }
    const normal = region.normal.clone();
    if (BABYLON.Vector3.Dot(normal, rayDir) > 0) normal.scaleInPlace(-1);
    const origin = pick.pickedPoint?.clone() ?? BABYLON.Vector3.Zero();
    selectExtrudeFace({ kind: 'sketch', origin, normal }, region.positions, null);
    st.extrudeRegion = { group: cellInfo.group, keys: region.keys };
    return;
  }
  const normal = pick.getNormal(true, false);
  if (!normal || !pick.pickedPoint) return;
  normal.normalize();
  if (BABYLON.Vector3.Dot(normal, rayDir) > 0) normal.scaleInPlace(-1);
  // Second clic sur la face de modèle déjà choisie (même plan) : désélection.
  if (
    st.extrudeFace && st.extrudeFace.kind === 'mesh'
    && Math.abs(BABYLON.Vector3.Dot(st.extrudeFace.normal, normal)) > 0.9999
    && Math.abs(BABYLON.Vector3.Dot(pick.pickedPoint.subtract(st.extrudeFace.origin), st.extrudeFace.normal)) < 1e-2
    && st.extrudeFace.modelName === isUnderModel(mesh)?.name
  ) {
    deselect();
    return;
  }
  const region = coplanarRegion(mesh, normal, pick.pickedPoint);
  const owner = isUnderModel(mesh);
  selectExtrudeFace(
    { kind: 'mesh', origin: region?.centroid ?? pick.pickedPoint.clone(), normal, modelName: owner?.name },
    region?.positions ?? null,
    null,
  );
}

function setupOnExtrudeDown(st: ViewportState) {
  const { axisParameterAt, canvas, clearBrowseEdge, clearExtrudeFace, clearExtrudeHover, edgeAt, extrudePointerRay, isFaceBrowseMode, isFacePickMode, isSolid, makeEdgeLine, scene, sketchFaceMeshes } = st;
  const onExtrudeDown = (e: PointerEvent) => {
    if (!isFacePickMode() || e.button !== 0) return;
    const { px, py } = extrudePointerRay(e.clientX, e.clientY);
    // 1. La flèche ?
    if (st.extrudeFace && st.extrudeArrowMeshes.length > 0) {
      const arrowPick = scene.pick(px, py, (m) => st.extrudeArrowMeshes.includes(m as BABYLON.Mesh));
      if (arrowPick?.hit) {
        const s = axisParameterAt(e.clientX, e.clientY);
        if (s !== null) {
          st.extrudeDrag = { startS: s, startT: st.extrudeDistance, moved: false, startClientX: e.clientX, startClientY: e.clientY };
          canvas.setPointerCapture?.(e.pointerId);
        }
        return;
      }
    }
    // 1 bis. Hors Extrusion : une arête proche du pointeur l'emporte sur la face qu'elle borde.
    if (isFaceBrowseMode()) {
      const edge = edgeAt(e.clientX, e.clientY);
      if (edge) {
        if (st.browseEdge?.key === edge.key) { clearBrowseEdge(); return; }
        clearExtrudeFace();
        clearExtrudeHover();
        st.browseEdge = { key: edge.key, mesh: makeEdgeLine('browseEdgeSelected', edge, 3.2, 1) };
        return;
      }
    }
    // 2. Une face : profil d'esquisse (région), sinon face plane d'un modèle.
    const pick = scene.pick(px, py, (m) => (
      m.isPickable && m.isEnabled() && (sketchFaceMeshes.includes(m as BABYLON.Mesh) || isSolid(m))
    ));
    if (!pick?.hit || !pick.pickedMesh) {
      clearExtrudeFace();
      emitApex('apex-extrude-face', null);
      return;
    }
    selectPickedFace(st, pick, pick.pickedMesh, px, py);
  };
  Object.assign(st, { onExtrudeDown });
}

function setupExtrudeHoverPending(st: ViewportState) {
  st.extrudeHoverPending = false;
  st.extrudeHoverLast = null;
}

function setupUpdateExtrudeHover(st: ViewportState) {
  const { camera, canvas, clearEdgeHover, clearExtrudeHover, coplanarRegion, edgeAt, extrudeHoverMaterial, extrudePointerRay, isFaceBrowseMode, isFacePickMode, isSolid, makeEdgeLine, makeTriangleSoup, scene, sketchFaceMeshes, sketchRegionOf } = st;
  const updateExtrudeHover = () => {
    st.extrudeHoverPending = false;
    const e = st.extrudeHoverLast;
    if (!e || !isFacePickMode() || st.extrudeDrag) { clearExtrudeHover(); return; }
    const { px, py } = extrudePointerRay(e.clientX, e.clientY);
    // Sur la flèche : pas de surbrillance de face, curseur « main ».
    if (st.extrudeArrowMeshes.length > 0) {
      const hoverArrow = scene.pick(px, py, (m) => st.extrudeArrowMeshes.includes(m as BABYLON.Mesh));
      canvas.style.cursor = hoverArrow?.hit ? 'grab' : '';
      if (hoverArrow?.hit) { clearExtrudeHover(); return; }
    }
    if (isFaceBrowseMode()) {
      const edge = edgeAt(e.clientX, e.clientY);
      if (edge) {
        canvas.style.cursor = 'pointer';
        if (st.browseEdge?.key === edge.key) { clearExtrudeHover(); return; }
        if (edge.key !== st.browseEdgeHoverKey) {
          clearExtrudeHover();
          st.browseEdgeHoverKey = edge.key;
          st.browseEdgeHover = makeEdgeLine('browseEdgeHover', edge, 3, 0.55);
        }
        st.extrudeHover?.dispose();
        st.extrudeHover = null;
        st.extrudeHoverKey = '';
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
      if (key === st.extrudeHoverKey) return;
      if (st.extrudeRegion && st.extrudeRegion.group === cellInfo.group && st.extrudeRegion.keys.has(cellInfo.key)) {
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
      if (key === st.extrudeHoverKey) return;
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
    st.extrudeHover?.dispose();
    st.extrudeHoverKey = key;
    st.extrudeHover = makeTriangleSoup('extrudeFaceHover', positions, BABYLON.Vector3.Zero(), extrudeHoverMaterial);
  };
  Object.assign(st, { updateExtrudeHover });
}

function setupOnExtrudeMove(st: ViewportState) {
  const { axisParameterAt, canvas, clearExtrudeFace, clearExtrudeHover, isExtrudeFaceMode, isFacePickMode, onExtrudeDown, selectExtrudeFace, setExtrudeDistance, updateExtrudeHover } = st;
  const onExtrudeMove = (e: PointerEvent) => {
    if (st.extrudeDrag) {
      canvas.style.cursor = 'grabbing';
      clearExtrudeHover();
      const s = axisParameterAt(e.clientX, e.clientY);
      if (s === null) return;
      if (Math.hypot(e.clientX - st.extrudeDrag.startClientX, e.clientY - st.extrudeDrag.startClientY) > 3) st.extrudeDrag.moved = true;
      const raw = st.extrudeDrag.startT + (s - st.extrudeDrag.startS);
      setExtrudeDistance(Math.round(raw * 100) / 100, true);
      return;
    }
    if (!isFacePickMode()) return;
    // Survol : un seul calcul par image.
    st.extrudeHoverLast = e;
    if (!st.extrudeHoverPending) {
      st.extrudeHoverPending = true;
      requestAnimationFrame(updateExtrudeHover);
    }
  };
  const onExtrudeUp = () => {
    if (!st.extrudeDrag) return;
    const drag = st.extrudeDrag;
    st.extrudeDrag = null;
    canvas.style.cursor = '';
    // Simple clic sur la flèche : on donne la main au champ Distance du panneau.
    if (!drag.moved) emitApex('apex-extrude-focus-distance');
  };
  canvas.addEventListener('pointerdown', onExtrudeDown);
  canvas.addEventListener('pointermove', onExtrudeMove);
  canvas.addEventListener('pointerup', onExtrudeUp);
  canvas.addEventListener('pointercancel', onExtrudeUp);

  const onSelectionModeEvent = (e: Event) => {
    st.selectionModeNow = (e as CustomEvent<{ mode: string }>).detail?.mode ?? 'body';
    if (st.selectionModeNow !== 'face') clearExtrudeFace();
    const carried = st.carriedFace;
    if (carried && st.selectionModeNow === 'face' && st.extrudeToolActive) {
      st.carriedFace = null;
      // Laisse au panneau Extrusion le temps de s'abonner à `apex-extrude-face` avant de lui annoncer la face.
      window.setTimeout(() => {
        if (!isExtrudeFaceMode() || st.extrudeFace) return;
        selectExtrudeFace(carried.face, carried.region, carried.corners);
        st.extrudeRegion = carried.regionInfo;
      }, 150);
    }
  };
  Object.assign(st, { onExtrudeMove, onExtrudeUp, onSelectionModeEvent });
}

function setupOnExtrudeToolEvent(st: ViewportState) {
  const { canvas, clearExtrudeFace, commitExtrudeBody, isFaceBrowseMode, isFacePickMode, onSelectionModeEvent, setExtrudeDistance } = st;
  const onExtrudeToolEvent = (e: Event) => {
    st.extrudeToolActive = (e as CustomEvent<{ tool: string }>).detail?.tool === 'extrude';
    if (!st.extrudeToolActive) { clearExtrudeFace(); canvas.style.cursor = ''; }
  };
  const onExtrudeSetDistance = (e: Event) => {
    const value = (e as CustomEvent<{ distance: number }>).detail?.distance;
    if (st.extrudeFace && Number.isFinite(value)) setExtrudeDistance(value, false);
  };
  // Suivi de l'espace et de l'outil pour la sélection de face hors Extrusion ; quitter ce mode
  // (autre outil, autre espace) efface la face choisie et son survol.
  const onFaceBrowseContext = (e: Event) => {
    const detail = (e as CustomEvent<{ mode?: string; tool?: string }>).detail;
    if (e.type === 'apex-mode-changed') st.modelingNow = detail?.mode === 'modeling';
    else {
      const wasBrowsing = isFaceBrowseMode();
      st.currentToolNow = detail?.tool ?? 'select';
      // Touche E (ou clic sur l'outil) avec une face choisie : l'Extrusion la reprend (cf. onSelectionModeEvent).
      st.carriedFace = wasBrowsing && st.currentToolNow === 'extrude' && st.extrudeFace
        ? { face: st.extrudeFace, region: st.extrudeRegionPositions, corners: st.extrudeSketchCorners, regionInfo: st.extrudeRegion }
        : null;
    }
    if (!isFacePickMode()) { clearExtrudeFace(); canvas.style.cursor = ''; }
  };
  st.carriedFace = null;
  window.addEventListener('apex-mode-changed', onFaceBrowseContext);
  window.addEventListener('apex-tool-changed', onFaceBrowseContext);
  window.addEventListener('apex-selection-mode-changed', onSelectionModeEvent);
  window.addEventListener('apex-tool-changed', onExtrudeToolEvent);
  window.addEventListener('apex-extrude-set-distance', onExtrudeSetDistance);
  window.addEventListener('apex-extrude-commit', commitExtrudeBody);
  Object.assign(st, { onExtrudeToolEvent, onExtrudeSetDistance, onFaceBrowseContext });
}

export function setupViewportExtrude(st: ViewportState) {
  setupIsSolid(st);
  setupComputeExtrudeBoundary(st);
  setupRebuildExtrudeBody(st);
  setupPlaceExtrudeArrow(st);
  setupSelectExtrudeFace(st);
  setupExtrudePointerRay(st);
  setupOnExtrudeDown(st);
  setupExtrudeHoverPending(st);
  setupUpdateExtrudeHover(st);
  setupOnExtrudeMove(st);
  setupOnExtrudeToolEvent(st);
}
