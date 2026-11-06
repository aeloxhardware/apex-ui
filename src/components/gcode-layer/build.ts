import type * as BABYLON from 'babylonjs';
import { LINE_TYPES, type LineTypeId } from '../gcodeLineTypes';
import type { ParsedGCode } from '../gcodeParse';
import type { LayerState } from './state';
import type { MarkerEntry, PathEntry } from './types';
import type { PathSampler } from './sampler';
import type { Picker } from './pick';
import type { EditWeightsApi } from './editWeights';
import { createSampler, runSliced } from './sampler';
import { buildBeadMesh } from './beadMesh';
import { buildMarkerMesh, buildPathMesh } from './pathMesh';
import { GCODE_MESH_PREFIX } from './constants';

/** Reconstruction en cours : entrées accumulées localement et publiées d'un bloc en fin de
 * construction, pour qu'un setter appelé entre deux tranches (visibilité, coloration) ne voie
 * jamais un calque à moitié construit. */
interface BuildJob {
  cancelled(): boolean;
  paths: PathEntry[];
  markers: MarkerEntry[];
  offPlate: PathEntry | null;
}

export interface Builder {
  /** (Re)construit tous les maillages du calque pour `next`, avec la précision cartésienne
   * courante (ignorée en mode catégoriel — cf. createSampler). Ne touche jamais `time`.
   * `keepOld` : l'ancien affichage reste visible jusqu'à ce que le nouveau soit prêt. */
  buildAll(next: ParsedGCode, keepOld?: boolean): Promise<void>;
  disposeAll(): void;
}

export interface BuilderDeps {
  picker: Picker;
  edit: EditWeightsApi;
  applyVisibility(): void;
  applyColorBy(): void;
}

const disposeEntries = (paths: PathEntry[], markers: MarkerEntry[], offPlate: PathEntry | null) => {
  for (const entry of paths) entry.mesh?.dispose(false, false);
  for (const entry of markers) entry.mesh.dispose(false, true);
  offPlate?.mesh?.dispose(false, false);
};

/** Cordons extrudés, un par type de ligne ; faux si la construction est annulée. */
async function buildBeads(st: LayerState, job: BuildJob, next: ParsedGCode, sampler: PathSampler) {
  const { moves } = next;
  for (const t of LINE_TYPES) {
    if (t.kind !== 'extrusion') continue;
    const include = (k: number) => moves[k].type === t.id;
    const material = st.materials.beadMaterials.get(t.id)!;
    const built = await runSliced(buildBeadMesh(`${GCODE_MESH_PREFIX}Bead_${t.id}`, next, sampler, include, material, st.scene), job.cancelled);
    if (!built) return false;
    job.paths.push({ ...built, type: t.id, include, isExtrusion: true, categoryMaterial: material });
  }
  return true;
}

/** Trajets à vide : tout mouvement sans dépôt hors essuyage (rétractions sur place comprises,
 * de longueur nulle), et essuyages. */
async function buildTravels(st: LayerState, job: BuildJob, next: ParsedGCode, sampler: PathSampler) {
  const { moves } = next;
  const travelInclude = (k: number) => !moves[k].extruding && moves[k].type !== 'wipe';
  const wipeInclude = (k: number) => moves[k].type === 'wipe';
  for (const [type, include] of [['travel', travelInclude], ['wipe', wipeInclude]] as const) {
    const built = await runSliced(buildPathMesh(`${GCODE_MESH_PREFIX}Path_${type}`, next, sampler, include, st.materials.colors[type], st.scene), job.cancelled);
    if (!built) return false;
    job.paths.push({ ...built, type, include, isExtrusion: false });
  }
  return true;
}

async function buildMarkers(st: LayerState, job: BuildJob, next: ParsedGCode, sampler: PathSampler) {
  for (const [type, at] of Object.entries(next.markers) as [LineTypeId, Uint32Array][]) {
    const mesh = await runSliced(buildMarkerMesh(`${GCODE_MESH_PREFIX}Marker_${type}`, at, sampler, st.materials.colors[type], st.scene), job.cancelled);
    if (job.cancelled()) { mesh?.dispose(false, true); return false; }
    if (mesh) job.markers.push({ type, mesh, at });
  }
  return true;
}

/** Cordon doublé des traits hors plateau (proposition de suppression avant conversion). */
async function buildOffPlate(st: LayerState, job: BuildJob, next: ParsedGCode, sampler: PathSampler) {
  if (!next.offPlate.moves.length) return true;
  const flags = new Uint8Array(next.moves.length);
  for (const k of next.offPlate.moves) flags[k] = 1;
  const include = (k: number) => flags[k] === 1;
  const built = await runSliced(buildBeadMesh(`${GCODE_MESH_PREFIX}OffPlate`, next, sampler, include, st.materials.offPlateMat, st.scene), job.cancelled);
  if (!built) return false;
  const entry: PathEntry = { ...built, type: 'custom', include, isExtrusion: false };
  if (entry.mesh) {
    entry.mesh.parent = st.plateNode;
    // Un rechargement pendant un clignotement déjà en cours (rare) doit reconstruire avec le
    // bon matériau, pas retomber sur le rouge fixe de buildBeadMesh ci-dessus.
    if (st.blinkingOffPlate) entry.mesh.material = st.materials.offPlateHazardMat;
  }
  job.offPlate = entry;
  return true;
}

export function createBuilder(st: LayerState, deps: BuilderDeps): Builder {
  const { picker, edit } = deps;
  // Numéro de la construction en cours : une plus récente (nouveau fichier, autre précision)
  // annule la précédente à la prochaine tranche.
  let buildSeq = 0;

  const disposeAll = () => {
    disposeEntries(st.paths, st.markers, st.offPlatePath);
    st.paths = [];
    st.markers = [];
    st.offPlatePath = null;
  };

  /** Autre fichier : drapeaux, poids et aperçus d'édition décrivaient l'ancien. */
  const resetEditState = () => {
    st.moveFlags = null;
    st.flagSets.clear();
    st.lastWeights = null;
    st.travelPreviewKeys.clear();
  };

  const publish = (job: BuildJob, moveCount: number) => {
    st.paths = job.paths;
    st.markers = job.markers;
    st.offPlatePath = job.offPlate;
    for (const entry of [...st.paths, ...st.markers]) {
      if (entry.mesh) entry.mesh.parent = st.plateNode;
    }
    deps.applyVisibility();
    deps.applyColorBy();
    st.head.node.setEnabled(moveCount > 0);
    if (picker.isWanted()) void picker.rebuild();
    // Reconstruction du même fichier : les attributs d'édition sont à reposer sur les nouveaux maillages.
    const last = st.lastWeights;
    if (st.flagSets.size > 0 || last) edit.setEditWeights(last?.indices ?? null, last?.weights, last?.slideNormals, last?.axes);
  };

  const buildAll: Builder['buildAll'] = async (next, keepOld = false) => {
    const seq = ++buildSeq;
    const cancelled = () => seq !== buildSeq;
    // Reconstruction « à chaud » : l'ancien affichage reste jusqu'à ce que le nouveau soit prêt.
    const previous = keepOld ? { paths: st.paths, markers: st.markers, offPlatePath: st.offPlatePath } : null;
    if (!keepOld) disposeAll();
    picker.invalidate(); // l'index de sélection de l'ancienne géométrie n'est plus valable
    picker.hideHighlight();
    if (next !== st.parsed) resetEditState();
    st.parsed = next;
    const precisionMm = st.colorBy !== 'lineType' ? st.renderPrecisionMm : null;
    const sampler = await runSliced(createSampler(next, precisionMm), cancelled);
    if (!sampler) return;
    st.sampler = sampler;
    st.segments = sampler.segments;

    const job: BuildJob = { cancelled, paths: [], markers: [], offPlate: null };
    const steps = [buildBeads, buildTravels, buildMarkers, buildOffPlate];
    for (const step of steps) {
      if (!(await step(st, job, next, sampler))) {
        disposeEntries(job.paths, job.markers, null);
        return;
      }
    }
    if (previous) disposeEntries(previous.paths, previous.markers, previous.offPlatePath);
    publish(job, next.moves.length);
  };

  return { buildAll, disposeAll };
}
