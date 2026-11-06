import { EDIT_AXIS_KIND, EDIT_SLIDE_KIND, EDIT_WEIGHT_KIND } from '../gcodeEditDeform';
import type { LayerState } from './state';
import type { PathEntry } from './types';
import { TUBE_SIDES } from './constants';
import { lowerBound } from './search';

// Édition du G-code (onglet Édition) : poids d'influence par sommet pour la déformation en
// direct par le vertex shader (gcodeEditDeform.ts). Les drapeaux d'édition par mouvement (bits
// EDIT_FLAG_*) sont écrits dans l'attribut de poids (valeur = poids + 2 × drapeaux) : alertes de
// limites / collisions, matière verrouillée, dépôts rognés, épaisseurs modifiées. Un échantillon
// prend les drapeaux du point d'extrémité le plus proche.

export interface EditWeightsApi {
  setEditWeights(indices: Uint32Array | null, weights?: Float32Array, slideNormals?: Float32Array, axes?: Float32Array): void;
  setEditFlagBit(bit: number, indices: Uint32Array | null): void;
}

/** Valeurs par mouvement (indices épars) étalées sur tous les mouvements ; y et z de chaque triplet sont échangés (repère du noyau → local). */
function denseSwapped(indices: Uint32Array, src: Float32Array, moveCount: number) {
  const dense = new Float32Array(3 * moveCount);
  for (let i = 0; i < indices.length; i++) {
    const k = 3 * indices[i];
    dense[k] = src[3 * i];
    dense[k + 1] = src[3 * i + 2];
    dense[k + 2] = src[3 * i + 1];
  }
  return dense;
}

const flagOfSample = (st: LayerState, k: number, f: number) => (st.moveFlags ? st.moveFlags[f < 0.5 && k > 0 ? k - 1 : k] : 0);

interface DenseEdit {
  weights: Float32Array | null;
  slide: Float32Array | null;
  axis: Float32Array | null;
}

/** Valeur interpolée entre les deux points d'un segment (poids et normales vus comme ceux du segment k). */
const lerpPrev = (src: Float32Array, k: number, f: number, stride: number, c: number) =>
  (k > 0 ? src[stride * (k - 1) + c] * (1 - f) : 0) + src[stride * k + c] * f;

interface EntryAttributes {
  /** Vrai si quelque chose est à publier. */
  any: boolean;
  slide: Float32Array | null;
  axis: Float32Array | null;
}

/** Écrit poids, normales et axes d'un cordon. */
function fillEntryAttributes(st: LayerState, entry: PathEntry, dense: DenseEdit, data: Float32Array, anyFlag: boolean): EntryAttributes {
  const owner = entry.sampleOwner!;
  const frac = entry.sampleFrac!;
  // Glissement et axe (68 Mo chacun sur un gros fichier) : seulement pendant un nœud actif.
  const wantSlide = !!dense.weights || !!entry.editSlide;
  const slide = wantSlide ? (entry.editSlide ?? new Float32Array(owner.length * TUBE_SIDES * 3)) : null;
  const axis = wantSlide ? (entry.editAxis ?? new Float32Array(owner.length * TUBE_SIDES * 3)) : null;
  let any = anyFlag;
  for (let j = 0; j < owner.length; j++) {
    const k = owner[j];
    const f = frac[j];
    const w = dense.weights ? lerpPrev(dense.weights, k, f, 1, 0) : 0;
    if (w > 0) any = true;
    data.fill(w + 2 * flagOfSample(st, k, f), j * TUBE_SIDES, (j + 1) * TUBE_SIDES);
    if (slide && axis) {
      for (let c = 0; c < 3; c++) {
        const v = dense.slide ? lerpPrev(dense.slide, k, f, 3, c) : 0;
        for (let t = 0; t < TUBE_SIDES; t++) slide[3 * (j * TUBE_SIDES + t) + c] = v;
        const a = dense.axis ? lerpPrev(dense.axis, k, f, 3, c) : 0;
        for (let t = 0; t < TUBE_SIDES; t++) axis[3 * (j * TUBE_SIDES + t) + c] = a;
      }
    }
  }
  return { any, slide, axis };
}

function publishEntry(entry: PathEntry, data: Float32Array, hadWeights: boolean, attrs: EntryAttributes) {
  const mesh = entry.mesh!;
  if (!hadWeights) {
    entry.editWeights = data;
    mesh.setVerticesData(EDIT_WEIGHT_KIND, data, true, 1);
  } else {
    mesh.updateVerticesData(EDIT_WEIGHT_KIND, data);
  }
  const { slide, axis } = attrs;
  if (!slide || !axis) return;
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

export function createEditWeights(st: LayerState): EditWeightsApi {
  const setEditWeights: EditWeightsApi['setEditWeights'] = (indices, weights, slideNormals, axes) => {
    const { parsed } = st;
    if (!parsed) return;
    const count = parsed.moves.length;
    const active = !!(indices && weights && indices.length);
    st.lastWeights = active ? { indices: indices!, weights: weights!, slideNormals, axes } : null;
    const dense: DenseEdit = { weights: null, slide: null, axis: null };
    if (active) {
      dense.weights = new Float32Array(count);
      for (let i = 0; i < indices!.length; i++) dense.weights[indices![i]] = weights![i];
      if (slideNormals && slideNormals.length === 3 * indices!.length) dense.slide = denseSwapped(indices!, slideNormals, count);
      if (axes && axes.length === 3 * indices!.length) dense.axis = denseSwapped(indices!, axes, count);
    }
    const anyFlag = st.flagSets.size > 0;
    for (const entry of st.paths) {
      const { mesh, sampleOwner: owner, sampleFrac: frac } = entry;
      if (!entry.isExtrusion || !mesh || !owner || !frac) continue;
      const hadWeights = !!entry.editWeights;
      if (!dense.weights && !hadWeights && !anyFlag) continue;
      const data = entry.editWeights ?? new Float32Array(owner.length * TUBE_SIDES);
      const attrs = fillEntryAttributes(st, entry, dense, data, anyFlag);
      if (!hadWeights && !attrs.any) continue;
      publishEntry(entry, data, hadWeights, attrs);
    }
  };

  /** Recalcule les drapeaux des échantillons proches des mouvements `changed`, sans toucher aux poids. */
  const refreshFlagSamples = (changed: Set<number>) => {
    if (!st.parsed) return;
    const owners = new Set<number>();
    for (const k of changed) { owners.add(k); owners.add(k + 1); }
    for (const entry of st.paths) {
      const { mesh, sampleOwner: owner, sampleFrac: frac } = entry;
      if (!entry.isExtrusion || !mesh || !owner || !frac) continue;
      if (!entry.editWeights) {
        if (st.flagSets.size === 0) continue;
        entry.editWeights = new Float32Array(owner.length * TUBE_SIDES);
        mesh.setVerticesData(EDIT_WEIGHT_KIND, entry.editWeights, true, 1);
      }
      const data = entry.editWeights;
      let touched = false;
      for (const kk of owners) {
        const lo = lowerBound(owner, kk);
        if (lo >= owner.length || owner[lo] !== kk) continue;
        const hi = lowerBound(owner, kk + 1);
        for (let j = lo; j < hi; j++) {
          const raw = data[j * TUBE_SIDES];
          const w = raw - 2 * Math.floor(raw * 0.5);
          data.fill(w + 2 * flagOfSample(st, kk, frac[j]), j * TUBE_SIDES, (j + 1) * TUBE_SIDES);
        }
        touched = true;
      }
      if (touched) mesh.updateVerticesData(EDIT_WEIGHT_KIND, data);
    }
  };

  const setEditFlagBit = (bit: number, indices: Uint32Array | null) => {
    const { parsed } = st;
    if (!parsed) return;
    const n = parsed.moves.length;
    if (!st.moveFlags || st.moveFlags.length !== n) st.moveFlags = new Uint8Array(n);
    const flags = st.moveFlags;
    const changed = new Set<number>();
    const old = st.flagSets.get(bit);
    if (old) for (const k of old) { if (k < n && (flags[k] & bit)) { flags[k] &= ~bit; changed.add(k); } }
    if (indices && indices.length) {
      for (const k of indices) { if (k < n) { flags[k] |= bit; changed.add(k); } }
      st.flagSets.set(bit, indices);
    } else {
      st.flagSets.delete(bit);
    }
    if (changed.size) refreshFlagSamples(changed);
  };

  return { setEditWeights, setEditFlagBit };
}
