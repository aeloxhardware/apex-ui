// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import { extractFeatureChains as featureChainsOf } from '../meshFeatureEdges';
import * as BABYLON from 'babylonjs';
import { createScreenLines } from '../screenLine';
import type { EdgeCandidate, MeshEdgeCache, SketchFaceGroup } from './viewportTypes';
import type { ViewportState } from './viewportState';

function setupIsExtrudeFaceMode(st: ViewportState) {
  const { scene } = st;
  // ---------------------------------------------------------------------------------
  // Outil Extrusion : sélection d'une FACE (mode de sélection « Face ») puis flèche parallèle à sa
  // normale, cliquable et déplaçable pour régler la distance. Faces sélectionnables : les profils
  // rectangulaires tracés en esquisse (plan surfacique) et les faces planes des modèles (ensemble
  // des triangles coplanaires de la face cliquée). La distance est échangée avec le panneau par
  // `apex-extrude-distance` (flèche → panneau) et `apex-extrude-set-distance` (panneau → flèche).
  // ---------------------------------------------------------------------------------
  st.selectionModeNow = 'body';
  st.extrudeToolActive = false;
  const isExtrudeFaceMode = () => st.extrudeToolActive && st.selectionModeNow === 'face';
  // Sélection de face hors outil Extrusion (demande de l'utilisateur, 2026-10-20) : en Modélisation,
  // outil de sélection courant, le survol d'une face plane la surligne et le clic la choisit comme
  // avec l'outil Extrusion, mais sans flèche ni ouverture du panneau Extrusion.
  st.modelingNow = false;
  st.currentToolNow = 'select';
  const isFaceBrowseMode = () => st.modelingNow && st.currentToolNow === 'select' && !st.sketchRectActive;
  const isFacePickMode = () => isExtrudeFaceMode() || isFaceBrowseMode();
  st.extrudeFace = null;
  st.extrudeDistance = 0;
  st.extrudeOverlay = null;
  st.extrudeGhost = null;
  st.extrudeArrowRoot = null;
  st.extrudeArrowMeshes = [];
  st.extrudeDrag = null;
  const sketchFaceMeshes: BABYLON.Mesh[] = [];
  const EXTRUDE_COLOR = new BABYLON.Color3(0, 0.94, 1);

  const extrudeFaceMaterial = new BABYLON.StandardMaterial('extrudeFaceMat', scene);
  extrudeFaceMaterial.emissiveColor = EXTRUDE_COLOR;
  extrudeFaceMaterial.disableLighting = true;
  extrudeFaceMaterial.alpha = 0.38;
  extrudeFaceMaterial.backFaceCulling = false;
  Object.assign(st, { isExtrudeFaceMode, isFaceBrowseMode, isFacePickMode, sketchFaceMeshes, EXTRUDE_COLOR,
    extrudeFaceMaterial });
}

function setupMakeQuadMesh(st: ViewportState) {
  const { EXTRUDE_COLOR, extrudeFaceMaterial, scene } = st;
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
  const sketchFaceGroups: SketchFaceGroup[] = [];
  const sketchFaceMaterial = new BABYLON.StandardMaterial('sketchFaceMat', scene);
  sketchFaceMaterial.emissiveColor = BABYLON.Color3.White();
  sketchFaceMaterial.disableLighting = true;
  sketchFaceMaterial.alpha = 0.05;
  sketchFaceMaterial.backFaceCulling = false;

  const sameMatrix = (a: BABYLON.Matrix, b: BABYLON.Matrix) =>
    a.m.every((value, k) => Math.abs(value - b.m[k]) < 1e-6);
  Object.assign(st, { extrudeArrowMaterial, makeQuadMesh, sketchFaceGroups, sketchFaceMaterial, sameMatrix });
}

function setupRebuildSketchFaceGroup(st: ViewportState) {
  const { gridFrameMatrix, gridNormal, makeQuadMesh, sameMatrix, sketchDrawnMeshes, sketchFaceGroups, sketchFaceMaterial, sketchFaceMeshes } = st;
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
  st.registerSketchFace = registerSketchFace;
}

function setupSketchRegionOf(st: ViewportState) {
  const { modelsRef, sketchFaceGroups } = st;
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
  Object.assign(st, { sketchRegionOf, isUnderModel });
}

function setupCoplanarRegion(st: ViewportState) {
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
  Object.assign(st, { coplanarRegion });
}

function setupMakeTriangleSoup(st: ViewportState) {
  const { extrudeFaceMaterial, scene } = st;
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

  st.extrudeRegionPositions = null;
  st.extrudeSketchCorners = null;
  // Région de profil d'esquisse choisie (pour la désélection au second clic) et survolée.
  st.extrudeRegion = null;
  st.extrudeHover = null;
  st.extrudeHoverKey = '';
  const extrudeHoverMaterial = extrudeFaceMaterial.clone('extrudeHoverMat');
  extrudeHoverMaterial.alpha = 0.2;
  st.browseEdgeHover = null;
  st.browseEdgeHoverKey = '';
  st.browseEdge = null;
  const clearEdgeHover = () => {
    st.browseEdgeHover?.dispose();
    st.browseEdgeHover = null;
    st.browseEdgeHoverKey = '';
  };
  const clearBrowseEdge = () => {
    st.browseEdge?.mesh.dispose();
    st.browseEdge = null;
  };
  Object.assign(st, { makeTriangleSoup, extrudeHoverMaterial, clearEdgeHover, clearBrowseEdge });
}

function setupClearExtrudeHover(st: ViewportState) {
  const { clearEdgeHover } = st;
  const clearExtrudeHover = () => {
    st.extrudeHover?.dispose();
    st.extrudeHover = null;
    st.extrudeHoverKey = '';
    clearEdgeHover();
  };

  // --- Arêtes (sélection hors outil Extrusion, 2026-10-20) -------------------------------------
  // Arête = chaîne d'arêtes de triangles « vives » (angle entre faces voisines > 25°, bord libre ou
  // jonction non variété), prolongée tant que la chaîne ne tourne pas de plus de 35° et qu'aucun
  // autre trait n'y aboutit : un côté droit ou un cercle tessellé est UNE arête. Pour les profils
  // d'esquisse : les côtés des rectangles. Le choix se fait dans l'espace écran (tolérance
  // EDGE_PICK_PX) sur les arêtes visibles (rien ne les masque entre la caméra et elles).
  const EDGE_PICK_PX = 7;
  const meshEdgeCache = new WeakMap<BABYLON.AbstractMesh, MeshEdgeCache>();

  const extractFeatureChains = (mesh: BABYLON.AbstractMesh): number[][] => featureChainsOf(
    mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind), mesh.getIndices(), mesh.getBoundingInfo().boundingSphere.radius);

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
  Object.assign(st, { clearExtrudeHover, EDGE_PICK_PX, meshEdgesInWorld });
}

function setupCollectEdgeCandidates(st: ViewportState) {
  const { meshEdgesInWorld, scene, sketchFaceGroups } = st;
  const collectEdgeCandidates = (): EdgeCandidate[] => {
    const out: EdgeCandidate[] = [];
    scene.meshes.forEach((m) => {
      if (!m.isEnabled() || !m.isVisible || m.getTotalVertices() === 0 || !st.isSolid(m)) return;
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
  Object.assign(st, { collectEdgeCandidates });
}

function setupEdgeAt(st: ViewportState) {
  const { EDGE_PICK_PX, camera, canvas, collectEdgeCandidates, engine, scene, sketchFaceMeshes } = st;
  /** Arête visible la plus proche du pointeur, à moins de EDGE_PICK_PX pixels (sinon null). */
  const edgeAt = (clientX: number, clientY: number): EdgeCandidate | null => {
    const { px, py } = st.extrudePointerRay(clientX, clientY);
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
      // Orthographique : rayons parallèles à l'axe de vue, partant d'un point en amont de l'arête.
      let rayOrigin = camera.position;
      let toPoint = hit.point.subtract(camera.position);
      if (st.orthoActive) {
        const viewDir = camera.getTarget().subtract(camera.position).normalize();
        rayOrigin = hit.point.subtract(viewDir.scale(camera.maxZ));
        toPoint = viewDir.scale(camera.maxZ);
      }
      const dist = toPoint.length();
      const ray = new BABYLON.Ray(rayOrigin.clone(), toPoint.scale(1 / Math.max(dist, 1e-9)), 1e6);
      const blocker = scene.pickWithRay(ray, (m) => (
        m.isPickable && m.isEnabled() && (sketchFaceMeshes.includes(m as BABYLON.Mesh) || st.isSolid(m))
      ));
      const slack = st.orthoActive ? Math.max(0.05, camera.radius * 0.003) : Math.max(0.05, dist * 0.01);
      if (blocker?.hit && blocker.distance < dist - slack) continue;
      return hit.cand;
    }
    return null;
  };
  Object.assign(st, { edgeAt });
}

function setupMakeEdgeLine(st: ViewportState) {
  const { EXTRUDE_COLOR, scene } = st;
  const makeEdgeLine = (name: string, cand: EdgeCandidate, width: number, alpha: number) => {
    const line = createScreenLines(scene, name, [cand.points], EXTRUDE_COLOR, width, alpha);
    line.isPickable = false;
    return line;
  };
  Object.assign(st, { makeEdgeLine });
}

export function setupViewportFaces(st: ViewportState) {
  setupIsExtrudeFaceMode(st);
  setupMakeQuadMesh(st);
  setupRebuildSketchFaceGroup(st);
  setupSketchRegionOf(st);
  setupCoplanarRegion(st);
  setupMakeTriangleSoup(st);
  setupClearExtrudeHover(st);
  setupCollectEdgeCandidates(st);
  setupEdgeAt(st);
  setupMakeEdgeLine(st);
}
