// Issu de la découpe de createGCodeLayer (gcodeLayer.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (gcodeLayerState.ts).
import * as BABYLON from 'babylonjs';
import { type ParsedGCode } from '../gcodeParse';
import { BEAD_WIDTH_MM, SLICE_MASK, type PathSampler, runSliced } from '../gcodeLayerGeometry';
import type { PickGrid } from './gcodeLayerTypes';
import { PICK_TOLERANCE_PX } from './gcodeLayerShared';
import { pickGridDimensions } from './pickGridMath';
import type { GCodeLayerState } from './gcodeLayerState';

function setupPickGrid(st: GCodeLayerState) {
  const PICK_CELL_MM = 3;
  const PICK_MAX_CELLS = 4_000_000;
  const PICK_PAD_MM = 0.6; // un segment est aussi inscrit dans les cellules voisines à moins de ça
  st.pickGrid = null;
  st.pickWanted = false;
  st.pickBuildSeq = 0;
  st.pickQuery = 0;
  const pickA = new BABYLON.Vector3();
  const pickB = new BABYLON.Vector3();
  Object.assign(st, { PICK_CELL_MM, PICK_MAX_CELLS, PICK_PAD_MM, pickA, pickB });
}

function setupBuildPickGrid(st: GCodeLayerState) {
  const { PICK_CELL_MM, PICK_MAX_CELLS, PICK_PAD_MM, pickB } = st;
  function* buildPickGrid(p: ParsedGCode, sam: PathSampler): Generator<void, PickGrid | null, void> {
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
    const { cell, nx, ny, nz } = pickGridDimensions(max.x - min.x, max.y - min.y, max.z - min.z, PICK_CELL_MM, PICK_MAX_CELLS);
    const cells = nx * ny * nz;
    const cellStart = new Uint32Array(cells + 1);
    const stamp = new Uint32Array(cells);
    const clampCell = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));

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
        for (let s = 1; s <= n; s++) {
          sam.tip(k, s / n, pickB);
          const steps = Math.max(1, Math.ceil(BABYLON.Vector3.Distance(a, pickB) / (cell * 0.5)));
          for (let j = 0; j <= steps; j++) {
            const f = j / steps;
            const x = a.x + (pickB.x - a.x) * f, y = a.y + (pickB.y - a.y) * f, z = a.z + (pickB.z - a.z) * f;
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
                  if (pass === 0) cellStart[c + 1]++;
                  else items[fill![c]++] = k;
                }
              }
            }
          }
          a.copyFrom(pickB);
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
  Object.assign(st, { buildPickGrid });
}

function setupBuildPickIndex(st: GCodeLayerState) {
  const { buildPickGrid } = st;
  const buildPickIndex = async () => {
    const seq = ++st.pickBuildSeq;
    st.pickGrid = null;
    if (!st.parsed || !st.sampler) return;
    const grid = await runSliced(buildPickGrid(st.parsed, st.sampler), () => seq !== st.pickBuildSeq || st.disposed);
    if (seq === st.pickBuildSeq && !st.disposed) st.pickGrid = grid;
  };
    st.buildPickIndex = buildPickIndex;

  st.pickHighlight = null;
}

function setupPickAt(st: GCodeLayerState) {
  const { pickA, pickB, plateNode } = st;
  const pickAt = (ray: BABYLON.Ray, pxPerUnit: number, fixedDistance?: number) => {
    const grid = st.pickGrid;
    if (!grid || !st.parsed || !st.sampler) return null;
    const { moves } = st.parsed;
    const inv = plateNode.getWorldMatrix().clone().invert();
    const o = BABYLON.Vector3.TransformCoordinates(ray.origin, inv);
    const d = BABYLON.Vector3.TransformNormal(ray.direction, inv).normalize();

    // Entrée/sortie du rayon dans la boîte de la grille (méthode des dalles).
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
    if (tEnter > tExit) return null;

    const queryId = ++st.pickQuery;
    const tLimit = st.time;
    let best: { t: number; u: number; x: number; y: number; z: number } | null = null;
    let lastCell = -1;
    const step = grid.cell * 0.5;
    const radius = BEAD_WIDTH_MM / 2;
    for (let u = tEnter; u <= tExit + step; u += step) {
      const x = Math.floor((o.x + d.x * u - grid.min.x) / grid.cell);
      const y = Math.floor((o.y + d.y * u - grid.min.y) / grid.cell);
      const z = Math.floor((o.z + d.z * u - grid.min.z) / grid.cell);
      if (x < 0 || y < 0 || z < 0 || x >= grid.nx || y >= grid.ny || z >= grid.nz) continue;
      const c = (z * grid.ny + y) * grid.nx + x;
      if (c === lastCell) continue;
      lastCell = c;
      for (let i = grid.cellStart[c]; i < grid.cellStart[c + 1]; i++) {
        const k = grid.items[i];
        if (grid.seen[k] === queryId) continue;
        grid.seen[k] = queryId;
        if (k - 1 > tLimit || !st.visibility[moves[k].type]) continue;
        const n = st.sampler.segments[k];
        st.sampler.tip(k, 0, pickA);
        for (let s = 1; s <= n; s++) {
          st.sampler.tip(k, s / n, pickB);
          // Plus proche approche rayon (o + u·d, u ≥ 0) / segment [A, B] (A + v·(B − A), v ∈ [0, 1]).
          const ex = pickB.x - pickA.x, ey = pickB.y - pickA.y, ez = pickB.z - pickA.z;
          const wx = o.x - pickA.x, wy = o.y - pickA.y, wz = o.z - pickA.z;
          const e2 = ex * ex + ey * ey + ez * ez;
          const de = d.x * ex + d.y * ey + d.z * ez;
          const dw = d.x * wx + d.y * wy + d.z * wz;
          const ew = ex * wx + ey * wy + ez * wz;
          const denom = e2 - de * de; // d est unitaire
          let v = denom > 1e-12 ? (ew - de * dw) / denom : 0;
          v = Math.max(0, Math.min(1, v));
          let uu = de * v - dw;
          if (uu < 0) { uu = 0; v = e2 > 1e-12 ? Math.max(0, Math.min(1, ew / e2)) : 0; }
          const cx = pickA.x + ex * v, cy = pickA.y + ey * v, cz = pickA.z + ez * v;
          const dx = o.x + d.x * uu - cx, dy = o.y + d.y * uu - cy, dz = o.z + d.z * uu - cz;
          const dist = Math.hypot(dx, dy, dz);
          const tol = radius + PICK_TOLERANCE_PX * pxPerUnit * (fixedDistance ?? uu);
          const tAt = k - 1 + (s - 1 + v) / n;
          if (dist <= tol && tAt <= tLimit && (!best || uu < best.u)) {
            best = { t: tAt, u: uu, x: cx, y: cy, z: cz };
          }
          pickA.copyFrom(pickB);
        }
      }
      if (best) break; // parcours de l'avant vers l'arrière : la première cellule touchée suffit
    }
    return best ? { t: best.t, local: new BABYLON.Vector3(best.x, best.y, best.z) } : null;
  };
  Object.assign(st, { pickAt });
}

export function setupGCodeLayerPick(st: GCodeLayerState) {
  setupPickGrid(st);
  setupBuildPickGrid(st);
  setupBuildPickIndex(st);
  setupPickAt(st);
}
