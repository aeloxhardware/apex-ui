// Outil Couper (C) de Préparation, sur le modèle de celui d'Orca Slicer : un plan réglable (hauteur, inclinaison) traverse
// le modèle sélectionné ; « Couper » le remplace par ses deux morceaux, sections bouchées, chacun gardé ou non et mis en
// place (tel quel, posé sur la coupe ou retourné). Un seul Ctrl+Z rend le modèle d'origine.
//
// Le panneau (CutBox.tsx) règle le plan par `apex-cut-plane` et lance la coupe par `apex-cut-perform` ; le viewport lui
// annonce le modèle visé par `apex-cut-target`, et le plan bougé au gizmo (viewportCutGizmo.ts) par `apex-cut-plane-dragged`. La géométrie est pure : utils/meshCut.ts, meshCutCap.ts, cutPlane.ts.
import * as BABYLON from 'babylonjs';
import { emitApex, onApex, type ApexEventMap } from '@/events/apexEvents';
import { cutTriangles } from '@/utils/meshCut';
import {
  bounds,
  cutPlaneAt,
  faceCross,
  flatNormals,
  paramsFromPlane,
  placePart,
  planeCenter,
  planeNormal,
  type CutPlaneParams,
} from '@/utils/cutPlane';
import type { Vec3 } from '@/utils/meshCut';
import { createCutGizmo, type CutGizmo } from './viewportCutGizmo';
import { showSuccess, showWarning } from '@/utils/toast';
import { createOrcaModelMaterial } from '../orcaModelMaterial';
import { cutPartName } from './modelNaming';
import { replaceModels } from './viewportHistory';
import type { ViewportState } from './viewportState';

const PLANE_COLOR = new BABYLON.Color3(0.82, 0.88, 1);
const PLANE_ALPHA = 0.3;
/** Le plan déborde du modèle de ce facteur (diagonale de sa boîte englobante). */
const PLANE_MARGIN = 1.25;
const DEFAULT_MODEL_COLOR = new BABYLON.Color3(0.6, 0.65, 0.7);
/** Normale locale du plan créé par `CreatePlane`. */
const PLANE_LOCAL_NORMAL = new BABYLON.Vector3(0, 0, -1);

interface CutTool {
  active: boolean;
  params: CutPlaneParams;
  plane: BABYLON.Mesh;
  gizmo: CutGizmo;
}

/** Modèle visé : le seul modèle sélectionné (comme dans Orca, la coupe porte sur un objet à la fois). */
function cutTarget(st: ViewportState): BABYLON.AbstractMesh | null {
  const selected = Array.from(st.selectedMeshesRef.current).filter((m) => st.modelsRef.current.has(m) && !m.isDisposed());
  return selected.length === 1 ? (selected[0] ?? null) : null;
}

function createPlaneMesh(scene: BABYLON.Scene): BABYLON.Mesh {
  const plane = BABYLON.MeshBuilder.CreatePlane('apexCutPlane', { size: 1, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
  const mat = new BABYLON.StandardMaterial('apexCutPlaneMat', scene);
  mat.disableLighting = true;
  mat.emissiveColor = PLANE_COLOR;
  mat.alpha = PLANE_ALPHA;
  mat.backFaceCulling = false;
  plane.material = mat;
  plane.isPickable = false;
  plane.rotationQuaternion = new BABYLON.Quaternion();
  plane.enableEdgesRendering();
  plane.edgesWidth = 3;
  plane.edgesColor = new BABYLON.Color4(PLANE_COLOR.r, PLANE_COLOR.g, PLANE_COLOR.b, 0.9);
  plane.setEnabled(false);
  return plane;
}

const toVec = (v: Vec3) => new BABYLON.Vector3(v[0], v[1], v[2]);

/** Centre de la boîte englobante du modèle (repère de la scène). */
function modelCenter(target: BABYLON.AbstractMesh): Vec3 {
  const b = target.getHierarchyBoundingVectors(true);
  return [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
}

/** Pose l'aperçu du plan : centre, normale, et une taille qui déborde du modèle. */
function showPlaneAt(tool: CutTool, target: BABYLON.AbstractMesh, point: BABYLON.Vector3, normal: BABYLON.Vector3) {
  const b = target.getHierarchyBoundingVectors(true);
  const rotation = tool.plane.rotationQuaternion ?? new BABYLON.Quaternion();
  BABYLON.Quaternion.FromUnitVectorsToRef(PLANE_LOCAL_NORMAL, normal, rotation);
  tool.plane.rotationQuaternion = rotation;
  tool.plane.position.copyFrom(point);
  const size = b.max.subtract(b.min).length() * PLANE_MARGIN;
  tool.plane.scaling.set(size, size, 1);
}

/** Place l'aperçu du plan et son gizmo d'après les réglages, sur le modèle visé, ou les masque. */
function updatePlane(st: ViewportState, tool: CutTool) {
  const target = tool.active ? cutTarget(st) : null;
  tool.plane.setEnabled(target !== null);
  if (!target) {
    tool.gizmo.place(null);
    return;
  }
  const point = toVec(planeCenter(tool.params, modelCenter(target), st.PLATE_SURFACE_Y));
  const normal = toVec(planeNormal(tool.params));
  if (!tool.gizmo.dragging) showPlaneAt(tool, target, point, normal);
  tool.gizmo.place({ point, normal });
}

/** Plan bougé au gizmo : l'aperçu suit tout de suite, le panneau reçoit les réglages correspondants. */
function onGizmoMove(st: ViewportState, tool: CutTool, point: BABYLON.Vector3, normal: BABYLON.Vector3) {
  const target = cutTarget(st);
  if (!target) return;
  showPlaneAt(tool, target, point, normal);
  const params = paramsFromPlane(
    [point.x, point.y, point.z],
    [normal.x, normal.y, normal.z],
    tool.params.c,
    modelCenter(target),
    st.PLATE_SURFACE_Y,
  );
  tool.params = params;
  emitApex('apex-cut-plane-dragged', params);
}

function announceTarget(st: ViewportState) {
  const target = cutTarget(st);
  if (!target) {
    emitApex('apex-cut-target', { name: null, bottom: 0, top: 0 });
    return;
  }
  const b = target.getHierarchyBoundingVectors(true);
  emitApex('apex-cut-target', { name: target.name, bottom: b.min.y - st.PLATE_SURFACE_Y, top: b.max.y - st.PLATE_SURFACE_Y });
}

// --- Géométrie Babylon ↔ triangles à plat ----------------------------------------------------------

/** Ajoute les triangles d'un maillage, en coordonnées du monde (sens rétabli si la matrice est un miroir). */
function appendWorldTriangles(mesh: BABYLON.AbstractMesh, out: number[]) {
  const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  if (!pos) return;
  const world = mesh.computeWorldMatrix(true);
  const indices = mesh.getIndices();
  const count = indices ? indices.length : pos.length / 3;
  const order = world.determinant() < 0 ? [0, 2, 1] : [0, 1, 2];
  const v = new BABYLON.Vector3();
  const corner = indices ? (c: number) => indices[c] ?? 0 : (c: number) => c;
  for (let t = 0; t + 2 < count; t += 3) {
    for (const k of order) {
      const i = 3 * corner(t + k);
      BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(pos[i] as number, pos[i + 1] as number, pos[i + 2] as number, world, v);
      out.push(v.x, v.y, v.z);
    }
  }
}

function worldTriangles(model: BABYLON.AbstractMesh): number[] {
  model.computeWorldMatrix(true);
  const out: number[] = [];
  for (const mesh of [model, ...model.getChildMeshes(false)]) appendWorldTriangles(mesh, out);
  return out;
}

/** Les trois sommets du triangle `t` (positions locales). */
function localTriangle(pos: ArrayLike<number>, indices: ArrayLike<number> | null, t: number): number[] {
  return [0, 1, 2].flatMap((k) => {
    const i = 3 * (indices ? (indices[t + k] as number) : t + k);
    return [pos[i] as number, pos[i + 1] as number, pos[i + 2] as number];
  });
}

/**
 * Convention des normales du modèle : +1 si elles suivent (b − a) × (c − a), −1 sinon (selon le chargeur, un STL peut
 * arriver dans l'un ou l'autre sens). Lue sur le premier triangle non dégénéré qui porte des normales.
 */
function normalSign(model: BABYLON.AbstractMesh): 1 | -1 {
  for (const mesh of [model, ...model.getChildMeshes(false)]) {
    const sign = meshNormalSign(mesh);
    if (sign !== 0) return sign;
  }
  return 1;
}

/** Convention d'un maillage, ou 0 s'il n'a pas de normales (ou seulement des triangles dégénérés). */
function meshNormalSign(mesh: BABYLON.AbstractMesh): 1 | -1 | 0 {
  const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const nor = mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
  if (!pos || !nor) return 0;
  const indices = mesh.getIndices();
  const count = Math.min(indices ? indices.length : pos.length / 3, 3000);
  for (let t = 0; t + 2 < count; t += 3) {
    const [x, y, z] = faceCross(localTriangle(pos, indices, t), 0);
    const i = 3 * (indices ? (indices[t] as number) : t);
    const d = x * (nor[i] as number) + y * (nor[i + 1] as number) + z * (nor[i + 2] as number);
    if (Math.abs(d) > 1e-12) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Matière du morceau : celle du modèle s'il la porte lui-même (STL), sinon la teinte par défaut (les textures d'un glTF ne suivent pas la coupe). */
function partMaterial(st: ViewportState, source: BABYLON.AbstractMesh): BABYLON.Material {
  const own = source.getVerticesData(BABYLON.VertexBuffer.PositionKind) ? source.material : null;
  return own ?? createOrcaModelMaterial('stlDefaultMat', st.scene, DEFAULT_MODEL_COLOR);
}

/** Maillage d'un morceau, pivot au centre de sa boîte englobante (comme un modèle importé). Désactivé jusqu'à sa pose. */
function buildPart(st: ViewportState, source: BABYLON.AbstractMesh, tris: number[], name: string): BABYLON.Mesh {
  const { min, max } = bounds(tris);
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const positions = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i++) positions[i] = (tris[i] ?? 0) - (center[i % 3] ?? 0);
  const indices = new Uint32Array(tris.length / 3).map((_, i) => i);
  const normals = flatNormals(tris, normalSign(source));
  const data = new BABYLON.VertexData();
  Object.assign(data, { positions, indices, normals });
  const mesh = new BABYLON.Mesh(name, st.scene);
  data.applyToMesh(mesh);
  mesh.position.set(center[0] ?? 0, center[1] ?? 0, center[2] ?? 0);
  mesh.material = partMaterial(st, source);
  mesh.setEnabled(false);
  return mesh;
}

// --- Coupe -----------------------------------------------------------------------------------------

type PerformRequest = ApexEventMap['apex-cut-perform'];

/** Morceaux mis en place (triangles à plat), ou un message qui dit pourquoi la coupe n'a pas lieu. */
function cutParts(st: ViewportState, target: BABYLON.AbstractMesh, req: PerformRequest) {
  const plane = cutPlaneAt(req.plane, modelCenter(target), st.PLATE_SURFACE_Y);
  const res = cutTriangles(worldTriangles(target), plane);
  if (res.upper.length === 0 || res.lower.length === 0) return { error: 'Le plan de coupe ne traverse pas le modèle.' } as const;
  const n = plane.normal;
  const parts: { tris: number[]; label: string }[] = [];
  if (req.upper.keep)
    parts.push({ tris: placePart(res.upper, req.upper.placement, [-n[0], -n[1], -n[2]], st.PLATE_SURFACE_Y), label: 'haut' });
  if (req.lower.keep) parts.push({ tris: placePart(res.lower, req.lower.placement, n, st.PLATE_SURFACE_Y), label: 'bas' });
  return { parts, openLoops: res.openLoops } as const;
}

/** Deux morceaux : le second est posé à côté du premier (sur un emplacement libre), pas dessus. */
function spreadParts(st: ViewportState, target: BABYLON.AbstractMesh, meshes: BABYLON.Mesh[]) {
  const [first, second] = meshes;
  if (!first || !second) return;
  const others = Array.from(st.modelsRef.current).filter((m) => m !== target);
  second.computeWorldMatrix(true);
  const b = second.getBoundingInfo().boundingBox;
  const radius = Math.max(b.maximumWorld.x - b.minimumWorld.x, b.maximumWorld.z - b.minimumWorld.z) / 2;
  const spot = st.findFreeSpot(radius, [...others, first]);
  second.position.x = spot.x;
  second.position.z = spot.z;
}

function performCut(st: ViewportState, req: PerformRequest) {
  const target = cutTarget(st);
  if (!target) return showWarning('Sélectionnez un seul modèle à couper.');
  if (!req.upper.keep && !req.lower.keep) return showWarning('Gardez au moins une des deux parties.');
  const result = cutParts(st, target, req);
  if ('error' in result) return showWarning(result.error);
  const existing = new Set(Array.from(st.modelsRef.current).map((m) => m.name));
  const meshes = result.parts.map(({ tris, label }) => {
    const name = cutPartName(target.name, label, existing);
    existing.add(name);
    return buildPart(st, target, tris, name);
  });
  spreadParts(st, target, meshes);
  replaceModels(st, [target], meshes);
  st.applyModelShading();
  if (result.openLoops > 0) showWarning('Maillage non étanche : une partie de la section n’a pas pu être refermée.');
  else showSuccess(`${target.name} coupé.`);
}

export function setupViewportCut(st: ViewportState) {
  const tool: CutTool = {
    active: false,
    params: { height: 0, x: 0, y: 0, a: 0, b: 0, c: 0 },
    plane: createPlaneMesh(st.scene),
    gizmo: createCutGizmo(
      st.scene,
      (point, normal) => onGizmoMove(st, tool, point, normal),
      () => updatePlane(st, tool),
    ),
  };
  const refresh = () => {
    if (tool.active) announceTarget(st);
    updatePlane(st, tool);
  };
  const offs = [
    onApex('apex-tool-changed', ({ tool: name }) => {
      tool.active = name === 'cut';
      refresh();
    }),
    onApex('apex-mesh-selected', refresh),
    onApex('apex-cut-target-request', () => announceTarget(st)),
    onApex('apex-cut-plane', (params) => {
      tool.params = params;
      updatePlane(st, tool);
    }),
    onApex('apex-cut-perform', (req) => performCut(st, req)),
  ];
  Object.assign(st, {
    offCut: () => {
      offs.forEach((off) => off());
      tool.plane.dispose(false, true);
      tool.gizmo.dispose();
    },
  });
}
