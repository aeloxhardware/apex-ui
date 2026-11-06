import * as BABYLON from 'babylonjs';
import { EDIT_VALUES_PER_POINT } from '@/utils/editKernelClient';
import type { ParsedGCode } from '../gcodeParse';
import type { LayerState } from './state';
import type { PathEntry } from './types';
import type { Picker } from './pick';
import { BEAD_HEIGHT_MM, TUBE_SIDES } from './constants';
import { lowerBound } from './search';
import { writeSampleRing } from './ring';

// Réécriture locale de la géométrie des mouvements validés par le noyau C++, sans reconstruire les
// maillages : seuls les anneaux (ou sommets de trajet) touchés sont renvoyés au GPU.

export interface EditGeometryApi {
  /** Nouvelles valeurs validées par le noyau (R, C, Z, B, E par indice) ; met à jour les mouvements,
   * l'extrusion, la liste des mouvements modifiés et la géométrie des seuls segments touchés. */
  applyMoveEdits(indices: Uint32Array, values: Float64Array, trimmed?: Uint32Array, trimState?: boolean): void;
  /** Aperçu des déplacements à vide pendant un glissement ; null rétablit la géométrie validée. */
  setTravelPreview(indices: Uint32Array | null, tips?: Float32Array): void;
}

/** Réécrit les anneaux des échantillons [a, b] d'un cordon depuis les mouvements courants. */
function rewriteBeadSamples(st: LayerState, entry: PathEntry, a: number, b: number) {
  const { mesh, sampleOwner: owner, sampleFrac: frac, stripStart, positions, normals } = entry;
  const sampler = st.sampler;
  if (!mesh || !owner || !frac || !stripStart || !positions || !normals || !sampler) return;
  const count = owner.length;
  // Centres recalculés un échantillon au-delà de chaque bord : la tangente des anneaux réécrits
  // en dépend.
  const c0 = Math.max(0, a - 1);
  const c1 = Math.min(count - 1, b + 1);
  const n = c1 - c0 + 1;
  const centers = new Float32Array(n * 3);
  const axes = new Float32Array(n * 3);
  const tip = new BABYLON.Vector3();
  const ax = new BABYLON.Vector3();
  const halfH = BEAD_HEIGHT_MM / 2;
  for (let j = c0; j <= c1; j++) {
    sampler.tip(owner[j], frac[j], tip);
    sampler.axis(owner[j], frac[j], ax);
    const p = (j - c0) * 3;
    centers[p] = tip.x - ax.x * halfH;
    centers[p + 1] = tip.y - ax.y * halfH;
    centers[p + 2] = tip.z - ax.z * halfH;
    axes[p] = ax.x; axes[p + 1] = ax.y; axes[p + 2] = ax.z;
  }
  const localStrip = stripStart.subarray(c0, c1 + 1);
  const localPos = new Float32Array(n * TUBE_SIDES * 3);
  const localNrm = new Float32Array(n * TUBE_SIDES * 3);
  const tangent = { x: 1, y: 0, z: 0 };
  for (let j = a; j <= b; j++) writeSampleRing(localPos, localNrm, centers, axes, localStrip, n, j - c0, tangent);
  // Dépôt rogné : le cordon du mouvement n'existe plus, ses anneaux se réduisent à leur centre.
  const trimmedMoves = st.parsed?.trimmedMoves;
  if (trimmedMoves && trimmedMoves.size > 0) {
    for (let j = a; j <= b; j++) {
      if (!trimmedMoves.has(owner[j])) continue;
      const p = (j - c0) * 3;
      for (let t = 0; t < TUBE_SIDES; t++) {
        const q = ((j - c0) * TUBE_SIDES + t) * 3;
        localPos[q] = centers[p]; localPos[q + 1] = centers[p + 1]; localPos[q + 2] = centers[p + 2];
      }
    }
  }
  const from = (a - c0) * TUBE_SIDES * 3;
  const to = (b - c0 + 1) * TUBE_SIDES * 3;
  const offset = a * TUBE_SIDES * 3;
  positions.set(localPos.subarray(from, to), offset);
  normals.set(localNrm.subarray(from, to), offset);
  mesh.getVertexBuffer(BABYLON.VertexBuffer.PositionKind)?.updateDirectly(positions.subarray(offset, offset + to - from), offset);
  mesh.getVertexBuffer(BABYLON.VertexBuffer.NormalKind)?.updateDirectly(normals.subarray(offset, offset + to - from), offset);
}

/** Réécrit les cordons touchés : plages contiguës d'échantillons, un échantillon de marge (tangentes voisines). */
function rewriteBeadEntry(st: LayerState, entry: PathEntry, dirty: Float64Array) {
  const owner = entry.sampleOwner!;
  let runA = -1, runB = -1;
  const flush = () => { if (runA >= 0) rewriteBeadSamples(st, entry, runA, runB); };
  for (const k of dirty) {
    const lo = lowerBound(owner, k);
    if (lo >= owner.length || owner[lo] !== k) continue;
    const hi = lowerBound(owner, k + 1) - 1;
    const a = Math.max(0, lo - 1), b = Math.min(owner.length - 1, hi + 1);
    if (runA >= 0 && a <= runB + 1) runB = Math.max(runB, b);
    else { flush(); runA = a; runB = b; }
  }
  flush();
}

/** Réécrit les sommets des trajets (LinesMesh) des mouvements touchés. */
function rewritePathEntry(st: LayerState, entry: PathEntry, dirty: Float64Array) {
  const { lineStart, positions } = entry;
  const sampler = st.sampler!;
  const vb = entry.mesh!.getVertexBuffer(BABYLON.VertexBuffer.PositionKind);
  const tip = new BABYLON.Vector3();
  for (const k of dirty) {
    if (!entry.include(k)) continue;
    const n = st.segments[k];
    const v0 = lineStart![k];
    for (let s = 0; s <= n; s++) {
      sampler.tip(k, s / n, tip);
      const p = (v0 + s) * 3;
      positions![p] = tip.x; positions![p + 1] = tip.y; positions![p + 2] = tip.z;
    }
    vb?.updateDirectly(positions!.subarray(v0 * 3, (v0 + n + 1) * 3), v0 * 3);
  }
}

/** Recopie les valeurs du noyau dans les mouvements ; renvoie les mouvements dont la géométrie change. */
function storeEditedValues(parsed: ParsedGCode, indices: Uint32Array, values: Float64Array) {
  const { moves } = parsed;
  const edited = (parsed.editedMoves ??= new Set<number>());
  const touched = new Set<number>();
  for (let i = 0; i < indices.length; i++) {
    const k = indices[i];
    const m = moves[k];
    const v = i * EDIT_VALUES_PER_POINT;
    m.x = values[v];
    m.y = values[v + 1];
    m.z = values[v + 2];
    m.b = values[v + 3];
    parsed.eDelta[k] = values[v + 4];
    edited.add(k);
    // Un point modifié change les deux segments qui le touchent : celui qui y arrive (k) et
    // celui qui en part (k + 1).
    touched.add(k);
    if (k + 1 < moves.length) touched.add(k + 1);
  }
  return touched;
}

/** Dépôts rognés (ou rétablis par une annulation) : le mouvement ne dépose plus (ou dépose de nouveau). */
function storeTrimmed(parsed: ParsedGCode, trimmed: Uint32Array, trimState: boolean | undefined, touched: Set<number>) {
  const { moves } = parsed;
  const set = (parsed.trimmedMoves ??= new Set<number>());
  for (const k of trimmed) {
    moves[k].extruding = !trimState;
    if (trimState) set.add(k); else set.delete(k);
    touched.add(k);
    if (k + 1 < moves.length) touched.add(k + 1);
  }
}

/** Écrit un segment de trajet : géométrie validée, ou ligne droite entre des extrémités données. */
function createTravelWriter(st: LayerState) {
  const tmpA = new BABYLON.Vector3();
  const tmpB = new BABYLON.Vector3();
  const tmpP = new BABYLON.Vector3();
  /** Réécrit les sommets du segment k d'un trajet (début / fin null : celle du G-code). */
  return (entry: PathEntry, k: number, start: BABYLON.Vector3 | null, end: BABYLON.Vector3 | null) => {
    const { lineStart, positions } = entry;
    const sampler = st.sampler;
    if (!lineStart || !positions || !sampler || k < 1 || k >= st.segments.length || !entry.include(k)) return;
    const vb = entry.mesh?.getVertexBuffer(BABYLON.VertexBuffer.PositionKind);
    const n = st.segments[k];
    const v0 = lineStart[k];
    if (start || end) {
      if (!start) sampler.tip(k - 1, 1, tmpA);
      if (!end) sampler.tip(k, 1, tmpB);
      const a = start ?? tmpA;
      const b = end ?? tmpB;
      for (let s = 0; s <= n; s++) {
        const f = s / n;
        const p = (v0 + s) * 3;
        positions[p] = a.x + (b.x - a.x) * f;
        positions[p + 1] = a.y + (b.y - a.y) * f;
        positions[p + 2] = a.z + (b.z - a.z) * f;
      }
    } else {
      for (let s = 0; s <= n; s++) {
        sampler.tip(k, s / n, tmpP);
        const p = (v0 + s) * 3;
        positions[p] = tmpP.x; positions[p + 1] = tmpP.y; positions[p + 2] = tmpP.z;
      }
    }
    vb?.updateDirectly(positions.subarray(v0 * 3, (v0 + n + 1) * 3), v0 * 3);
  };
}

export function createEditGeometry(st: LayerState, picker: Picker, apply: () => void): EditGeometryApi {
  const writeTravelSegment = createTravelWriter(st);

  const setTravelPreview: EditGeometryApi['setTravelPreview'] = (indices, tips) => {
    if (!st.parsed || !st.sampler) return;
    const keys = st.travelPreviewKeys;
    for (const k of keys) for (const entry of st.paths) if (!entry.isExtrusion) writeTravelSegment(entry, k, null, null);
    keys.clear();
    if (!indices || !tips || !indices.length) return;
    const moved = new Map<number, BABYLON.Vector3>();
    for (let i = 0; i < indices.length; i++) moved.set(indices[i], new BABYLON.Vector3(tips[3 * i], tips[3 * i + 1], tips[3 * i + 2]));
    for (const k of moved.keys()) { keys.add(k); keys.add(k + 1); }
    for (const k of keys) {
      for (const entry of st.paths) {
        if (!entry.isExtrusion) writeTravelSegment(entry, k, moved.get(k - 1) ?? null, moved.get(k) ?? null);
      }
    }
  };

  const applyMoveEdits: EditGeometryApi['applyMoveEdits'] = (indices, values, trimmed, trimState) => {
    const { parsed } = st;
    if (!parsed || !st.sampler || !indices.length) return;
    const touched = storeEditedValues(parsed, indices, values);
    if (trimmed && trimmed.length) storeTrimmed(parsed, trimmed, trimState, touched);
    const dirty = Float64Array.from(touched).sort();
    for (const entry of st.paths) {
      if (!entry.mesh) continue;
      if (entry.sampleOwner) rewriteBeadEntry(st, entry, dirty);
      else if (entry.lineStart && entry.positions) rewritePathEntry(st, entry, dirty);
    }
    // L'index de sélection décrit l'ancienne géométrie.
    if (picker.isWanted()) void picker.rebuild();
    else picker.invalidate();
    apply();
  };

  return { applyMoveEdits, setTravelPreview };
}
