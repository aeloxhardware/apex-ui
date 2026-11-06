// Issu de la découpe de createGCodeLayer (gcodeLayer.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (gcodeLayerState.ts).
import * as BABYLON from 'babylonjs';
import { EDIT_AXIS_KIND, EDIT_SLIDE_KIND, EDIT_WEIGHT_KIND } from '../gcodeEditDeform';
import { EDIT_VALUES_PER_POINT } from '@/utils/editKernelClient';
import { BEAD_HEIGHT_MM, TUBE_SIDES, writeSampleRing } from '../gcodeLayerGeometry';
import { type PathEntry } from './gcodeLayerShared';
import { denseScalar, denseVec3, lerpDense } from './editWeightMath';
import type { GCodeLayerState } from './gcodeLayerState';

function setupFlagOfSample(st: GCodeLayerState) {
  // ---------------------------------------------------------------------------------------------
  // Édition du G-code (onglet Édition) : poids d'influence par sommet pour la déformation en
  // direct par le vertex shader (gcodeEditDeform.ts), puis réécriture locale de la géométrie des
  // mouvements validés par le noyau C++.
  // ---------------------------------------------------------------------------------------------

  // Normales de paroi (repère du noyau, cf. slideNormals) : copiées en repère local (y ↔ z), et
  // interpolées entre les deux points d'un segment comme les poids ; le shader retire du
  // déplacement sa composante selon la normale, au prorata de sa longueur (une extrémité en coque,
  // l'autre non : glissement partiel, sans cassure du cordon).
  // Drapeaux d'édition par mouvement (bits EDIT_FLAG_*), écrits dans l'attribut de poids (valeur =
  // poids + 2 × drapeaux) : alertes de limites / collisions, matière verrouillée, dépôts rognés,
  // épaisseurs modifiées. Un échantillon prend les drapeaux du point d'extrémité le plus proche.
  st.moveFlags = null;
  const flagSets = new Map<number, Uint32Array>();
    st.flagSets = flagSets;
  st.lastWeights = null;
  const flagOfSample = (k: number, f: number) => (st.moveFlags ? st.moveFlags[f < 0.5 && k > 0 ? k - 1 : k] : 0);
  Object.assign(st, { flagOfSample });
}

function setupSetEditWeights(st: GCodeLayerState) {
  const { flagOfSample, flagSets } = st;
  const setEditWeights = (
    indices: Uint32Array | null, weights?: Float32Array | undefined, slideNormals?: Float32Array | undefined, axes?: Float32Array | undefined,
  ) => {
    if (!st.parsed) return;
    st.lastWeights = indices && weights && indices.length ? { indices, weights, slideNormals, axes } : null;
    const live = indices && weights && indices.length ? indices : null;
    const moveCount = st.parsed.moves.length;
    const dense = live && weights ? denseScalar(moveCount, live, weights) : null;
    const denseSlide = live && slideNormals && slideNormals.length === 3 * live.length ? denseVec3(moveCount, live, slideNormals) : null;
    const denseAxis = live && axes && axes.length === 3 * live.length ? denseVec3(moveCount, live, axes) : null;
    const anyFlag = flagSets.size > 0;
    for (const entry of st.paths) {
      const { mesh, sampleOwner: owner, sampleFrac: frac } = entry;
      if (!entry.isExtrusion || !mesh || !owner || !frac) continue;
      const hadWeights = !!entry.editWeights;
      if (!dense && !hadWeights && !anyFlag) continue;
      const data = entry.editWeights ?? new Float32Array(owner.length * TUBE_SIDES);
      // Glissement et axe (68 Mo chacun sur un gros fichier) : seulement pendant un nœud actif.
      const wantSlide = !!dense || !!entry.editSlide;
      const slide = wantSlide ? (entry.editSlide ?? new Float32Array(owner.length * TUBE_SIDES * 3)) : null;
      const axis = wantSlide ? (entry.editAxis ?? new Float32Array(owner.length * TUBE_SIDES * 3)) : null;
      let any = anyFlag;
      for (let j = 0; j < owner.length; j++) {
        const k = owner[j];
        const f = frac[j];
        const w = lerpDense(dense, 1, k, f);
        if (w > 0) any = true;
        data.fill(w + 2 * flagOfSample(k, f), j * TUBE_SIDES, (j + 1) * TUBE_SIDES);
        if (slide && axis) {
          for (let c = 0; c < 3; c++) {
            const v = lerpDense(denseSlide, 3, k, f, c);
            for (let t = 0; t < TUBE_SIDES; t++) slide[3 * (j * TUBE_SIDES + t) + c] = v;
            const a = lerpDense(denseAxis, 3, k, f, c);
            for (let t = 0; t < TUBE_SIDES; t++) axis[3 * (j * TUBE_SIDES + t) + c] = a;
          }
        }
      }
      if (!hadWeights && !any) continue;
      if (!hadWeights) {
        entry.editWeights = data;
        mesh.setVerticesData(EDIT_WEIGHT_KIND, data, true, 1);
      } else {
        mesh.updateVerticesData(EDIT_WEIGHT_KIND, data);
      }
      if (slide && axis) {
        if (!entry.editSlide) {
          entry.editSlide = slide;
          entry.editAxis = axis;
          mesh.setVerticesData(EDIT_SLIDE_KIND, slide, true, 3);
          mesh.setVerticesData(EDIT_AXIS_KIND, axis, true, 3);
        } else {
          mesh.updateVerticesData(EDIT_SLIDE_KIND, slide);
          mesh.updateVerticesData(EDIT_AXIS_KIND, axis);
        }
      }
    }
  };
    st.setEditWeights = setEditWeights;
}

function setupRefreshFlagSamples(st: GCodeLayerState) {
  const { flagOfSample, flagSets } = st;
  /** Recalcule les drapeaux des échantillons proches des mouvements `changed`, sans toucher aux poids. */
  const refreshFlagSamples = (changed: Set<number>) => {
    if (!st.parsed) return;
    const owners = new Set<number>();
    for (const k of changed) { owners.add(k); owners.add(k + 1); }
    for (const entry of st.paths) {
      const { mesh, sampleOwner: owner, sampleFrac: frac } = entry;
      if (!entry.isExtrusion || !mesh || !owner || !frac) continue;
      if (!entry.editWeights) {
        if (flagSets.size === 0) continue;
        entry.editWeights = new Float32Array(owner.length * TUBE_SIDES);
        mesh.setVerticesData(EDIT_WEIGHT_KIND, entry.editWeights, true, 1);
      }
      const data = entry.editWeights;
      let touched = false;
      for (const kk of owners) {
        const lo = st.lowerBound(owner, kk);
        if (lo >= owner.length || owner[lo] !== kk) continue;
        const hi = st.lowerBound(owner, kk + 1);
        for (let j = lo; j < hi; j++) {
          const raw = data[j * TUBE_SIDES];
          const w = raw - 2 * Math.floor(raw * 0.5);
          data.fill(w + 2 * flagOfSample(kk, frac[j]), j * TUBE_SIDES, (j + 1) * TUBE_SIDES);
        }
        touched = true;
      }
      if (touched) mesh.updateVerticesData(EDIT_WEIGHT_KIND, data);
    }
  };

  const setEditFlagBit = (bit: number, indices: Uint32Array | null) => {
    if (!st.parsed) return;
    const n = st.parsed.moves.length;
    if (!st.moveFlags || st.moveFlags.length !== n) st.moveFlags = new Uint8Array(n);
    const changed = new Set<number>();
    const old = flagSets.get(bit);
    if (old) for (const k of old) { if (k < n && (st.moveFlags[k] & bit)) { st.moveFlags[k] &= ~bit; changed.add(k); } }
    if (indices && indices.length) {
      for (const k of indices) { if (k < n) { st.moveFlags[k] |= bit; changed.add(k); } }
      flagSets.set(bit, indices);
    } else {
      flagSets.delete(bit);
    }
    if (changed.size) refreshFlagSamples(changed);
  };

  // --- Aperçu des déplacements à vide pendant un glissement ----------------------------------------
  const travelPreviewKeys = new Set<number>();
    st.travelPreviewKeys = travelPreviewKeys;
  const tmpA = new BABYLON.Vector3();
  Object.assign(st, { setEditFlagBit, tmpA });
}

function setupWriteTravelSegment(st: GCodeLayerState) {
  const { tmpA, travelPreviewKeys } = st;
  const tmpB = new BABYLON.Vector3();
  const tmpP = new BABYLON.Vector3();
  /** Réécrit les sommets du segment k d'un trajet : géométrie validée, ou ligne droite entre des
   * extrémités données (début / fin, null : celle du G-code). */
  const writeTravelSegment = (entry: PathEntry, k: number, start: BABYLON.Vector3 | null, end: BABYLON.Vector3 | null) => {
    const { lineStart, positions } = entry;
    if (!lineStart || !positions || !st.sampler || k < 1 || k >= st.segments.length || !entry.include(k)) return;
    const vb = entry.mesh?.getVertexBuffer(BABYLON.VertexBuffer.PositionKind);
    const n = st.segments[k];
    const v0 = lineStart[k];
    if (start || end) {
      if (!start) st.sampler.tip(k - 1, 1, tmpA);
      if (!end) st.sampler.tip(k, 1, tmpB);
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
        st.sampler.tip(k, s / n, tmpP);
        const p = (v0 + s) * 3;
        positions[p] = tmpP.x; positions[p + 1] = tmpP.y; positions[p + 2] = tmpP.z;
      }
    }
    vb?.updateDirectly(positions.subarray(v0 * 3, (v0 + n + 1) * 3), v0 * 3);
  };

  const setTravelPreview = (indices: Uint32Array | null, tips?: Float32Array) => {
    if (!st.parsed || !st.sampler) return;
    for (const k of travelPreviewKeys) for (const entry of st.paths) if (!entry.isExtrusion) writeTravelSegment(entry, k, null, null);
    travelPreviewKeys.clear();
    if (!indices || !tips || !indices.length) return;
    const moved = new Map<number, BABYLON.Vector3>();
    for (let i = 0; i < indices.length; i++) moved.set(indices[i], new BABYLON.Vector3(tips[3 * i], tips[3 * i + 1], tips[3 * i + 2]));
    for (const k of moved.keys()) { travelPreviewKeys.add(k); travelPreviewKeys.add(k + 1); }
    for (const k of travelPreviewKeys) {
      for (const entry of st.paths) {
        if (!entry.isExtrusion) writeTravelSegment(entry, k, moved.get(k - 1) ?? null, moved.get(k) ?? null);
      }
    }
  };
  Object.assign(st, { setTravelPreview });
}

function setupGetHeadSamples(st: GCodeLayerState) {
  const { headNode } = st;
  // --- Modèle de tête échantillonné (collisions) -----------------------------------------------------
  const getHeadSamples = (spacingMm = 3): Float32Array | null => {
    if (!st.headModelReady) return null;
    headNode.computeWorldMatrix(true);
    const toHead = new BABYLON.Matrix();
    const invHead = headNode.getWorldMatrix().clone().invert();
    const cells = new Map<string, [number, number, number]>();
    const MAX_SAMPLES = 4000;
    const keep = (p: BABYLON.Vector3) => {
      if (cells.size >= MAX_SAMPLES) return;
      const key = `${Math.floor(p.x / spacingMm)},${Math.floor(p.y / spacingMm)},${Math.floor(p.z / spacingMm)}`;
      if (!cells.has(key)) cells.set(key, [p.x, p.y, p.z]);
    };
    const v = new BABYLON.Vector3();
    const a = new BABYLON.Vector3();
    const b = new BABYLON.Vector3();
    const edge = new BABYLON.Vector3();
    for (const mesh of headNode.getChildMeshes()) {
      if (!(mesh instanceof BABYLON.Mesh) || mesh.name.includes('NOZZLE origin')) continue;
      const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      if (!pos) continue;
      mesh.computeWorldMatrix(true);
      mesh.getWorldMatrix().multiplyToRef(invHead, toHead);
      const idx = mesh.getIndices();
      const at = (i: number, out: BABYLON.Vector3) => {
        v.set(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
        BABYLON.Vector3.TransformCoordinatesToRef(v, toHead, out);
      };
      if (idx) {
        // Arêtes subdivisées au pas : une tête a de grandes faces dont les sommets seuls laisseraient des trous.
        for (let t = 0; t + 2 < idx.length; t += 3) {
          for (let e = 0; e < 3; e++) {
            at(idx[t + e], a);
            at(idx[t + ((e + 1) % 3)], b);
            const len = BABYLON.Vector3.Distance(a, b);
            const steps = Math.min(40, Math.max(1, Math.ceil(len / spacingMm)));
            for (let s = 0; s <= steps; s++) {
              BABYLON.Vector3.LerpToRef(a, b, s / steps, edge);
              keep(edge);
            }
          }
        }
      } else {
        for (let i = 0; i < pos.length / 3; i++) { at(i, a); keep(a); }
      }
    }
    const out = new Float32Array(cells.size * 3);
    let i = 0;
    for (const p of cells.values()) { out[i++] = p[0]; out[i++] = p[1]; out[i++] = p[2]; }
    return out;
  };
  Object.assign(st, { getHeadSamples });
}

function setupLowerBound(st: GCodeLayerState) {
  /** Premier échantillon de `owner` (croissant) dont le propriétaire est ≥ k. */
  const lowerBound = (owner: Uint32Array, k: number) => {
    let lo = 0, hi = owner.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (owner[mid] < k) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
    st.lowerBound = lowerBound;
}

function setupRewriteBeadSamples(st: GCodeLayerState) {
  /** Réécrit les anneaux des échantillons [a, b] d'un cordon depuis les mouvements courants. */
  const rewriteBeadSamples = (entry: PathEntry, a: number, b: number) => {
    const { mesh, sampleOwner: owner, sampleFrac: frac, stripStart, positions, normals } = entry;
    if (!mesh || !owner || !frac || !stripStart || !positions || !normals || !st.sampler) return;
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
      st.sampler.tip(owner[j], frac[j], tip);
      st.sampler.axis(owner[j], frac[j], ax);
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
  };
  Object.assign(st, { rewriteBeadSamples });
}

function setupApplyMoveEdits(st: GCodeLayerState) {
  const { apply, buildPickIndex, lowerBound, rewriteBeadSamples } = st;
  const applyMoveEdits = (indices: Uint32Array, values: Float64Array, trimmed?: Uint32Array, trimState?: boolean) => {
    if (!st.parsed || !st.sampler || !indices.length) return;
    const { moves } = st.parsed;
    const edited = (st.parsed.editedMoves ??= new Set<number>());
    const touched = new Set<number>();
    for (let i = 0; i < indices.length; i++) {
      const k = indices[i];
      const m = moves[k];
      const v = i * EDIT_VALUES_PER_POINT;
      m.x = values[v];
      m.y = values[v + 1];
      m.z = values[v + 2];
      m.b = values[v + 3];
      st.parsed.eDelta[k] = values[v + 4];
      edited.add(k);
      // Un point modifié change les deux segments qui le touchent : celui qui y arrive (k) et
      // celui qui en part (k + 1).
      touched.add(k);
      if (k + 1 < moves.length) touched.add(k + 1);
    }
    // Dépôts rognés (ou rétablis par une annulation) : le mouvement ne dépose plus (ou dépose de nouveau).
    if (trimmed && trimmed.length) {
      const set = (st.parsed.trimmedMoves ??= new Set<number>());
      for (const k of trimmed) {
        moves[k].extruding = !trimState;
        if (trimState) set.add(k); else set.delete(k);
        touched.add(k);
        if (k + 1 < moves.length) touched.add(k + 1);
      }
    }
    const dirty = Float64Array.from(touched).sort();

    for (const entry of st.paths) {
      if (!entry.mesh) continue;
      if (entry.sampleOwner) {
        // Plages contiguës d'échantillons à réécrire, un échantillon de marge (tangentes voisines).
        const owner = entry.sampleOwner;
        let runA = -1, runB = -1;
        const flush = () => { if (runA >= 0) rewriteBeadSamples(entry, runA, runB); };
        for (const k of dirty) {
          const lo = lowerBound(owner, k);
          if (lo >= owner.length || owner[lo] !== k) continue;
          const hi = lowerBound(owner, k + 1) - 1;
          const a = Math.max(0, lo - 1), b = Math.min(owner.length - 1, hi + 1);
          if (runA >= 0 && a <= runB + 1) runB = Math.max(runB, b);
          else { flush(); runA = a; runB = b; }
        }
        flush();
      } else if (entry.lineStart && entry.positions) {
        const { lineStart, positions } = entry;
        const vb = entry.mesh.getVertexBuffer(BABYLON.VertexBuffer.PositionKind);
        const tip = new BABYLON.Vector3();
        for (const k of dirty) {
          if (!entry.include(k)) continue;
          const n = st.segments[k];
          const v0 = lineStart[k];
          for (let s = 0; s <= n; s++) {
            st.sampler.tip(k, s / n, tip);
            const p = (v0 + s) * 3;
            positions[p] = tip.x; positions[p + 1] = tip.y; positions[p + 2] = tip.z;
          }
          vb?.updateDirectly(positions.subarray(v0 * 3, (v0 + n + 1) * 3), v0 * 3);
        }
      }
    }
    // L'index de sélection décrit l'ancienne géométrie.
    if (st.pickWanted) void buildPickIndex();
    else { st.pickBuildSeq++; st.pickGrid = null; }
    apply();
  };
  Object.assign(st, { applyMoveEdits });
}

export function setupGCodeLayerEdit(st: GCodeLayerState) {
  setupFlagOfSample(st);
  setupSetEditWeights(st);
  setupRefreshFlagSamples(st);
  setupWriteTravelSegment(st);
  setupGetHeadSamples(st);
  setupLowerBound(st);
  setupRewriteBeadSamples(st);
  setupApplyMoveEdits(st);
}
