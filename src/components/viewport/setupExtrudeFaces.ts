import * as BABYLON from 'babylonjs';
import { createScreenLines } from '../screenLine';
import type { ExtrudeFace, SketchFaceGroup, MeshEdgeCache, EdgeCandidate } from './types';
import type { ViewportCtx } from './context';

/** Extrusion : faces d'esquisse, régions coplanaires et arêtes. */
export function setupExtrudeFaces(c: ViewportCtx) {
  const { scene, sketchDrawnMeshes, gridFrameMatrix, gridNormal, canvas, engine, camera, modelsRef } = c;


  // ---------------------------------------------------------------------------------
  // Outil Extrusion : sélection d'une FACE (mode de sélection « Face ») puis flèche parallèle à sa
  // normale, cliquable et déplaçable pour régler la distance. Faces sélectionnables : les profils
  // rectangulaires tracés en esquisse (plan surfacique) et les faces planes des modèles (ensemble
  // des triangles coplanaires de la face cliquée). La distance est échangée avec le panneau par
  // `apex-extrude-distance` (flèche → panneau) et `apex-extrude-set-distance` (panneau → flèche).
  // ---------------------------------------------------------------------------------
  c.selectionModeNow = 'body';

  c.extrudeToolActive = false;

  const isExtrudeFaceMode = () => c.extrudeToolActive && c.selectionModeNow === 'face';
  c.isExtrudeFaceMode = isExtrudeFaceMode;

  // Sélection de face hors outil Extrusion (demande de l'utilisateur, 2026-10-20) : en Modélisation,
  // outil de sélection courant, le survol d'une face plane la surligne et le clic la choisit comme
  // avec l'outil Extrusion, mais sans flèche ni ouverture du panneau Extrusion.
  c.modelingNow = false;

  c.currentToolNow = 'select';

  const isFaceBrowseMode = () => c.modelingNow && c.currentToolNow === 'select' && !c.sketchRectActive;
  c.isFaceBrowseMode = isFaceBrowseMode;

  const isFacePickMode = () => isExtrudeFaceMode() || isFaceBrowseMode();
  c.isFacePickMode = isFacePickMode;

  c.extrudeFace = null;

  c.extrudeDistance = 0;

  c.extrudeOverlay = null;

  c.extrudeGhost = null;

  c.extrudeArrowRoot = null;

  c.extrudeArrowMeshes = [];

  c.extrudeDrag = null;

  const sketchFaceMeshes: BABYLON.Mesh[] = [];
  c.sketchFaceMeshes = sketchFaceMeshes;

  const EXTRUDE_COLOR = new BABYLON.Color3(0, 0.94, 1);


  const extrudeFaceMaterial = new BABYLON.StandardMaterial('extrudeFaceMat', scene);
  c.extrudeFaceMaterial = extrudeFaceMaterial;

  extrudeFaceMaterial.emissiveColor = EXTRUDE_COLOR;

  extrudeFaceMaterial.disableLighting = true;

  extrudeFaceMaterial.alpha = 0.38;

  extrudeFaceMaterial.backFaceCulling = false;

  extrudeFaceMaterial.zOffset = -4;

  const extrudeGhostMaterial = extrudeFaceMaterial.clone('extrudeGhostMat');

  extrudeGhostMaterial.alpha = 0.18;

  const extrudeArrowMaterial = new BABYLON.StandardMaterial('extrudeArrowMat', scene);
  c.extrudeArrowMaterial = extrudeArrowMaterial;

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
  c.registerSketchFace = registerSketchFace;


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
  c.sketchRegionOf = sketchRegionOf;


  const isUnderModel = (mesh: BABYLON.Node | null): BABYLON.Node | null => {
    let node: BABYLON.Node | null = mesh;
    while (node) {
      if (modelsRef.current.has(node as BABYLON.Mesh)) return node;
      node = node.parent;
    }
    return null;
  };
  c.isUnderModel = isUnderModel;


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
  c.coplanarRegion = coplanarRegion;


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
  c.makeTriangleSoup = makeTriangleSoup;


  c.extrudeRegionPositions = null;

  c.extrudeSketchCorners = null;

  // Région de profil d'esquisse choisie (pour la désélection au second clic) et survolée.
  c.extrudeRegion = null;

  c.extrudeHover = null;

  c.extrudeHoverKey = '';

  const extrudeHoverMaterial = extrudeFaceMaterial.clone('extrudeHoverMat');
  c.extrudeHoverMaterial = extrudeHoverMaterial;

  extrudeHoverMaterial.alpha = 0.2;

  c.browseEdgeHover = null;

  c.browseEdgeHoverKey = '';

  c.browseEdge = null;

  const clearEdgeHover = () => {
    c.browseEdgeHover?.dispose();
    c.browseEdgeHover = null;
    c.browseEdgeHoverKey = '';
  };
  c.clearEdgeHover = clearEdgeHover;

  const clearBrowseEdge = () => {
    c.browseEdge?.mesh.dispose();
    c.browseEdge = null;
  };
  c.clearBrowseEdge = clearBrowseEdge;

  const clearExtrudeHover = () => {
    c.extrudeHover?.dispose();
    c.extrudeHover = null;
    c.extrudeHoverKey = '';
    clearEdgeHover();
  };
  c.clearExtrudeHover = clearExtrudeHover;


  // --- Arêtes (sélection hors outil Extrusion, 2026-10-20) -------------------------------------
  // Arête = chaîne d'arêtes de triangles « vives » (angle entre faces voisines > 25°, bord libre ou
  // jonction non variété), prolongée tant que la chaîne ne tourne pas de plus de 35° et qu'aucun
  // autre trait n'y aboutit : un côté droit ou un cercle tessellé est UNE arête. Pour les profils
  // d'esquisse : les côtés des rectangles. Le choix se fait dans l'espace écran (tolérance
  // EDGE_PICK_PX) sur les arêtes visibles (rien ne les masque entre la caméra et elles).
  const EDGE_PICK_PX = 7;

  const EDGE_FEATURE_COS = Math.cos((25 * Math.PI) / 180);

  const EDGE_CHAIN_COS = Math.cos((35 * Math.PI) / 180);

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
      if (!m.isEnabled() || !m.isVisible || m.getTotalVertices() === 0 || !c.isSolid(m)) return;
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
    const { px, py } = c.extrudePointerRay(clientX, clientY);
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
      if (c.orthoActive) {
        const viewDir = camera.getTarget().subtract(camera.position).normalize();
        rayOrigin = hit.point.subtract(viewDir.scale(camera.maxZ));
        toPoint = viewDir.scale(camera.maxZ);
      }
      const dist = toPoint.length();
      const ray = new BABYLON.Ray(rayOrigin.clone(), toPoint.scale(1 / Math.max(dist, 1e-9)), 1e6);
      const blocker = scene.pickWithRay(ray, (m) => (
        m.isPickable && m.isEnabled() && (sketchFaceMeshes.includes(m as BABYLON.Mesh) || c.isSolid(m))
      ));
      const slack = c.orthoActive ? Math.max(0.05, camera.radius * 0.003) : Math.max(0.05, dist * 0.01);
      if (blocker?.hit && blocker.distance < dist - slack) continue;
      return hit.cand;
    }
    return null;
  };
  c.edgeAt = edgeAt;


  const makeEdgeLine = (name: string, cand: EdgeCandidate, width: number, alpha: number) => {
    const line = createScreenLines(scene, name, [cand.points], EXTRUDE_COLOR, width, alpha);
    line.isPickable = false;
    return line;
  };
  c.makeEdgeLine = makeEdgeLine;
}
