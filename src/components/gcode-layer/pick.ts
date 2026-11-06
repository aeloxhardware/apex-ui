import * as BABYLON from 'babylonjs';
import type { ParsedGCode } from '../gcodeParse';
import type { LayerState } from './state';
import type { PathSampler } from './sampler';
import { runSliced } from './sampler';
import { BEAD_WIDTH_MM, GCODE_MESH_PREFIX, PICK_TOLERANCE_PX, SLICE_MASK } from './constants';

// Sélection d'un point de trajectoire. Un lancer de rayon Babylon parcourrait tous les triangles
// de chaque maillage (des millions) à chaque survol : on indexe donc les segments extrudés dans
// une grille 3D régulière (format CSR : `cellStart`/`items`), puis on ne parcourt que les
// cellules traversées par le rayon. Construite par tranches, invalidée à chaque reconstruction.

interface PickGrid {
  min: BABYLON.Vector3;
  cell: number;
  nx: number; ny: number; nz: number;
  cellStart: Uint32Array;
  items: Uint32Array;
  /** Dernière requête ayant testé le mouvement k (évite de le tester une fois par cellule). */
  seen: Uint32Array;
}

export interface PickResult {
  t: number;
  local: BABYLON.Vector3;
}

export interface Picker {
  /** Active ou désactive l'index (construit par tranches). */
  setEnabled(enabled: boolean): void;
  isWanted(): boolean;
  /** L'index décrit une géométrie périmée : l'abandonne sans le reconstruire. */
  invalidate(): void;
  /** Reconstruit l'index (par tranches) pour la géométrie courante. */
  rebuild(): Promise<void>;
  hideHighlight(): void;
  pickAt(ray: BABYLON.Ray, pxPerUnit: number, fixedDistance?: number): PickResult | null;
  setHighlight(local: BABYLON.Vector3 | null): void;
}

const PICK_CELL_MM = 3;
const PICK_MAX_CELLS = 4_000_000;
const PICK_PAD_MM = 0.6; // un segment est aussi inscrit dans les cellules voisines à moins de ça

/** Boîte englobante des segments extrudés, élargie de PICK_PAD_MM ; null sans segment extrudé. */
function* extrudedBounds(p: ParsedGCode, sam: PathSampler): Generator<void, { min: BABYLON.Vector3; max: BABYLON.Vector3 } | null, void> {
  const { moves } = p;
  const a = new BABYLON.Vector3();
  const min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
  const max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
  for (let k = 1; k < moves.length; k++) {
    if ((k & SLICE_MASK) === 0) yield;
    if (!moves[k].extruding) continue;
    const n = sam.segments[k];
    for (let s = 0; s <= n; s++) {
      sam.tip(k, s / n, a);
      min.minimizeInPlace(a);
      max.maximizeInPlace(a);
    }
  }
  if (!Number.isFinite(min.x)) return null;
  min.x -= PICK_PAD_MM; min.y -= PICK_PAD_MM; min.z -= PICK_PAD_MM;
  max.x += PICK_PAD_MM; max.y += PICK_PAD_MM; max.z += PICK_PAD_MM;
  return { min, max };
}

/** Inscrit le segment [a, b] du mouvement k dans les cellules qu'il touche (comptage ou écriture). */
function stampSegment(
  g: { min: BABYLON.Vector3; cell: number; nx: number; ny: number; nz: number },
  a: BABYLON.Vector3, b: BABYLON.Vector3, k: number, stamp: Uint32Array,
  visit: (c: number) => void,
) {
  const { min, cell, nx, ny, nz } = g;
  const clampCell = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
  const steps = Math.max(1, Math.ceil(BABYLON.Vector3.Distance(a, b) / (cell * 0.5)));
  for (let j = 0; j <= steps; j++) {
    const f = j / steps;
    const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f;
    const x0 = clampCell(Math.floor((x - PICK_PAD_MM - min.x) / cell), nx);
    const x1 = clampCell(Math.floor((x + PICK_PAD_MM - min.x) / cell), nx);
    const y0 = clampCell(Math.floor((y - PICK_PAD_MM - min.y) / cell), ny);
    const y1 = clampCell(Math.floor((y + PICK_PAD_MM - min.y) / cell), ny);
    const z0 = clampCell(Math.floor((z - PICK_PAD_MM - min.z) / cell), nz);
    const z1 = clampCell(Math.floor((z + PICK_PAD_MM - min.z) / cell), nz);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const c = (cz * ny + cy) * nx + cx;
          if (stamp[c] === k) continue;
          stamp[c] = k;
          visit(c);
        }
      }
    }
  }
}

function* buildPickGrid(p: ParsedGCode, sam: PathSampler): Generator<void, PickGrid | null, void> {
  const { moves } = p;
  const bounds = yield* extrudedBounds(p, sam);
  if (!bounds) return null;
  const { min, max } = bounds;
  let cell = PICK_CELL_MM;
  let nx = 1, ny = 1, nz = 1;
  for (;;) {
    nx = Math.max(1, Math.ceil((max.x - min.x) / cell));
    ny = Math.max(1, Math.ceil((max.y - min.y) / cell));
    nz = Math.max(1, Math.ceil((max.z - min.z) / cell));
    if (nx * ny * nz <= PICK_MAX_CELLS) break;
    cell *= 1.5;
  }
  const cells = nx * ny * nz;
  const cellStart = new Uint32Array(cells + 1);
  const stamp = new Uint32Array(cells);
  const geometry = { min, cell, nx, ny, nz };
  const a = new BABYLON.Vector3();
  const b = new BABYLON.Vector3();

  // Deux passes identiques : la première compte les entrées de chaque cellule, la seconde les écrit.
  let items = new Uint32Array(0);
  let fill: Uint32Array | null = null;
  for (let pass = 0; pass < 2; pass++) {
    stamp.fill(0);
    for (let k = 1; k < moves.length; k++) {
      if ((k & SLICE_MASK) === 0) yield;
      if (!moves[k].extruding) continue;
      const n = sam.segments[k];
      sam.tip(k, 0, a);
      const visit = pass === 0 ? (c: number) => { cellStart[c + 1]++; } : (c: number) => { items[fill![c]++] = k; };
      for (let s = 1; s <= n; s++) {
        sam.tip(k, s / n, b);
        stampSegment(geometry, a, b, k, stamp, visit);
        a.copyFrom(b);
      }
    }
    if (pass === 0) {
      for (let c = 0; c < cells; c++) cellStart[c + 1] += cellStart[c];
      items = new Uint32Array(cellStart[cells]);
      fill = cellStart.slice(0, cells);
    }
  }
  return { min, cell, nx, ny, nz, cellStart, items, seen: new Uint32Array(moves.length) };
}

/** Plage [tEnter, tExit] du rayon dans la boîte de la grille (méthode des dalles) ; null s'il la manque. */
function clipRayToGrid(grid: PickGrid, o: BABYLON.Vector3, d: BABYLON.Vector3) {
  let tEnter = 0, tExit = Infinity;
  const lo = [grid.min.x, grid.min.y, grid.min.z];
  const hi = [lo[0] + grid.nx * grid.cell, lo[1] + grid.ny * grid.cell, lo[2] + grid.nz * grid.cell];
  const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) {
      if (oo[i] < lo[i] || oo[i] > hi[i]) return null;
    } else {
      const t1 = (lo[i] - oo[i]) / dd[i], t2 = (hi[i] - oo[i]) / dd[i];
      tEnter = Math.max(tEnter, Math.min(t1, t2));
      tExit = Math.min(tExit, Math.max(t1, t2));
    }
  }
  return tEnter > tExit ? null : { tEnter, tExit };
}

interface Approach { v: number; uu: number; cx: number; cy: number; cz: number; dist: number }
const approach: Approach = { v: 0, uu: 0, cx: 0, cy: 0, cz: 0, dist: 0 };

/** Plus proche approche rayon (o + u·d, u ≥ 0) / segment [A, B] (A + v·(B − A), v ∈ [0, 1]). */
function closestApproach(o: BABYLON.Vector3, d: BABYLON.Vector3, A: BABYLON.Vector3, B: BABYLON.Vector3): Approach {
  const ex = B.x - A.x, ey = B.y - A.y, ez = B.z - A.z;
  const wx = o.x - A.x, wy = o.y - A.y, wz = o.z - A.z;
  const e2 = ex * ex + ey * ey + ez * ez;
  const de = d.x * ex + d.y * ey + d.z * ez;
  const dw = d.x * wx + d.y * wy + d.z * wz;
  const ew = ex * wx + ey * wy + ez * wz;
  const denom = e2 - de * de; // d est unitaire
  let v = denom > 1e-12 ? (ew - de * dw) / denom : 0;
  v = Math.max(0, Math.min(1, v));
  let uu = de * v - dw;
  if (uu < 0) { uu = 0; v = e2 > 1e-12 ? Math.max(0, Math.min(1, ew / e2)) : 0; }
  const cx = A.x + ex * v, cy = A.y + ey * v, cz = A.z + ez * v;
  const dx = o.x + d.x * uu - cx, dy = o.y + d.y * uu - cy, dz = o.z + d.z * uu - cz;
  approach.v = v; approach.uu = uu; approach.cx = cx; approach.cy = cy; approach.cz = cz;
  approach.dist = Math.hypot(dx, dy, dz);
  return approach;
}

export function createPicker(st: LayerState): Picker {
  let grid: PickGrid | null = null;
  let wanted = false;
  let buildSeq = 0;
  let query = 0;
  let highlight: BABYLON.Mesh | null = null;
  const pickA = new BABYLON.Vector3();
  const pickB = new BABYLON.Vector3();

  const invalidate = () => { buildSeq++; grid = null; };

  const rebuild = async () => {
    const seq = ++buildSeq;
    grid = null;
    if (!st.parsed || !st.sampler) return;
    const built = await runSliced(buildPickGrid(st.parsed, st.sampler), () => seq !== buildSeq || st.disposed);
    if (seq === buildSeq && !st.disposed) grid = built;
  };

  const pickAt = (ray: BABYLON.Ray, pxPerUnit: number, fixedDistance?: number): PickResult | null => {
    const { parsed, sampler } = st;
    if (!grid || !parsed || !sampler) return null;
    const g = grid;
    const { moves } = parsed;
    const inv = st.plateNode.getWorldMatrix().clone().invert();
    const o = BABYLON.Vector3.TransformCoordinates(ray.origin, inv);
    const d = BABYLON.Vector3.TransformNormal(ray.direction, inv).normalize();
    const range = clipRayToGrid(g, o, d);
    if (!range) return null;

    const queryId = ++query;
    const tLimit = st.time;
    let best: { t: number; u: number; x: number; y: number; z: number } | null = null;
    let lastCell = -1;
    const step = g.cell * 0.5;
    const radius = BEAD_WIDTH_MM / 2;
    for (let u = range.tEnter; u <= range.tExit + step; u += step) {
      const x = Math.floor((o.x + d.x * u - g.min.x) / g.cell);
      const y = Math.floor((o.y + d.y * u - g.min.y) / g.cell);
      const z = Math.floor((o.z + d.z * u - g.min.z) / g.cell);
      if (x < 0 || y < 0 || z < 0 || x >= g.nx || y >= g.ny || z >= g.nz) continue;
      const c = (z * g.ny + y) * g.nx + x;
      if (c === lastCell) continue;
      lastCell = c;
      for (let i = g.cellStart[c]; i < g.cellStart[c + 1]; i++) {
        const k = g.items[i];
        if (g.seen[k] === queryId) continue;
        g.seen[k] = queryId;
        if (k - 1 > tLimit || !st.visibility[moves[k].type]) continue;
        const n = sampler.segments[k];
        sampler.tip(k, 0, pickA);
        for (let s = 1; s <= n; s++) {
          sampler.tip(k, s / n, pickB);
          const ap = closestApproach(o, d, pickA, pickB);
          const tol = radius + PICK_TOLERANCE_PX * pxPerUnit * (fixedDistance ?? ap.uu);
          const tAt = k - 1 + (s - 1 + ap.v) / n;
          if (ap.dist <= tol && tAt <= tLimit && (!best || ap.uu < best.u)) {
            best = { t: tAt, u: ap.uu, x: ap.cx, y: ap.cy, z: ap.cz };
          }
          pickA.copyFrom(pickB);
        }
      }
      if (best) break; // parcours de l'avant vers l'arrière : la première cellule touchée suffit
    }
    return best ? { t: best.t, local: new BABYLON.Vector3(best.x, best.y, best.z) } : null;
  };

  const createHighlight = () => {
    const mesh = BABYLON.MeshBuilder.CreateSphere(`${GCODE_MESH_PREFIX}PickHighlight`, { diameter: 1.8, segments: 12 }, st.scene);
    const mat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}PickHighlightMat`, st.scene);
    mat.disableLighting = true;
    mat.emissiveColor = new BABYLON.Color3(0.0, 0.94, 1.0);
    mat.alpha = 0.9;
    mat.disableDepthWrite = true;
    mesh.material = mat;
    mesh.parent = st.plateNode;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1; // par-dessus le tracé, même caché derrière une paroi
    return mesh;
  };

  return {
    setEnabled(enabled) {
      wanted = enabled;
      if (enabled) { if (!grid) void rebuild(); } else invalidate();
    },
    isWanted: () => wanted,
    invalidate,
    rebuild,
    hideHighlight: () => highlight?.setEnabled(false),
    pickAt,
    setHighlight(local) {
      if (!local) { highlight?.setEnabled(false); return; }
      highlight ??= createHighlight();
      highlight.position.copyFrom(local);
      highlight.setEnabled(true);
    },
  };
}
