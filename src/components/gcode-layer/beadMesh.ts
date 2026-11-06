import * as BABYLON from 'babylonjs';
import type { ParsedGCode } from '../gcodeParse';
import type { PathSampler } from './sampler';
import type { PathMesh } from './types';
import { BEAD_HEIGHT_MM, SLICE_MASK, TUBE_SIDES } from './constants';
import { writeSampleRing } from './ring';
import { finalizePathMesh } from './pathMesh';

/** Échantillons le long de la trajectoire : centre du cordon, axe de buse, mouvement propriétaire
 * et début de tube (pas de sous-segment qui le relie au précédent). */
interface BeadSamples {
  centers: Float32Array;
  axes: Float32Array;
  owner: Uint32Array;
  frac: Float32Array;
  stripStart: Uint8Array;
  count: number;
}

/** Passe 1 : échantillonne les mouvements retenus par `include` (au plus `capacity` échantillons). */
function* sampleBead(
  parsed: ParsedGCode,
  sampler: PathSampler,
  include: (k: number) => boolean,
  capacity: number,
): Generator<void, BeadSamples, void> {
  const { moves } = parsed;
  const { segments } = sampler;
  const centers = new Float32Array(capacity * 3);
  const axes = new Float32Array(capacity * 3);
  const owner = new Uint32Array(capacity);
  const frac = new Float32Array(capacity);
  const stripStart = new Uint8Array(capacity);
  const tip = new BABYLON.Vector3();
  const ax = new BABYLON.Vector3();
  const halfH = BEAD_HEIGHT_MM / 2;
  let count = 0;

  for (let k = 1; k < moves.length; k++) {
    if ((k & SLICE_MASK) === 0) yield;
    if (!include(k)) continue;
    // Le mouvement précédent était déjà dans ce cordon : son dernier échantillon est notre point
    // de départ, on prolonge le même tube au lieu d'en ouvrir un nouveau.
    const continues = k > 1 && include(k - 1);
    const n = segments[k];
    for (let s = continues ? 1 : 0; s <= n; s++) {
      const f = s / n;
      sampler.tip(k, f, tip);
      sampler.axis(k, f, ax);
      centers[count * 3] = tip.x - ax.x * halfH;
      centers[count * 3 + 1] = tip.y - ax.y * halfH;
      centers[count * 3 + 2] = tip.z - ax.z * halfH;
      axes[count * 3] = ax.x;
      axes[count * 3 + 1] = ax.y;
      axes[count * 3 + 2] = ax.z;
      owner[count] = k;
      frac[count] = f;
      stripStart[count] = s === 0 ? 1 : 0;
      count++;
    }
  }
  return { centers, axes, owner, frac, stripStart, count };
}

interface BeadGeometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  indexCount: number;
}

/**
 * Passe 2 : un anneau elliptique par échantillon, dans le repère (côté, axe de buse)
 * perpendiculaire à la tangente, puis les quads entre anneaux consécutifs d'un même tube. Remplit
 * `cumIndices` (nombre d'indices à dessiner une fois chaque mouvement terminé).
 */
function* buildBeadGeometry(
  s: BeadSamples,
  cumIndices: Uint32Array,
  indicesPerStep: number,
): Generator<void, BeadGeometry, void> {
  const { centers, axes, owner, stripStart, count } = s;
  const positions = new Float32Array(count * TUBE_SIDES * 3);
  const normals = new Float32Array(count * TUBE_SIDES * 3);
  const indices = new Uint32Array(count * indicesPerStep);
  const tangent = { x: 1, y: 0, z: 0 };
  let idx = 0;

  for (let j = 0; j < count; j++) {
    if ((j & SLICE_MASK) === 0) yield;
    writeSampleRing(positions, normals, centers, axes, stripStart, count, j, tangent);

    if (!stripStart[j]) {
      const a0 = (j - 1) * TUBE_SIDES;
      const b0 = j * TUBE_SIDES;
      for (let i = 0; i < TUBE_SIDES; i++) {
        const i1 = (i + 1) % TUBE_SIDES;
        indices[idx++] = a0 + i;
        indices[idx++] = b0 + i;
        indices[idx++] = a0 + i1;
        indices[idx++] = a0 + i1;
        indices[idx++] = b0 + i;
        indices[idx++] = b0 + i1;
      }
      cumIndices[owner[j]] = idx;
    }
  }
  return { positions, normals, indices, indexCount: idx };
}

/**
 * Construit le cordon de matière (repère plateau) : un tube à section elliptique le long des
 * mouvements retenus par `include`, dans l'ordre du fichier. La section est orientée selon l'axe
 * de la buse au moment du dépôt (écrasée le long de cet axe, BEAD_HEIGHT_MM) et centrée une
 * demi-épaisseur sous la pointe de buse, là où la matière est réellement posée. Les mouvements
 * retenus consécutifs partagent leurs anneaux de jonction : un seul tube continu par suite
 * ininterrompue. N'importe quel préfixe s'affiche en changeant `indexCount`, sans reconstruire.
 */
export function* buildBeadMesh(
  name: string,
  parsed: ParsedGCode,
  sampler: PathSampler,
  include: (k: number) => boolean,
  material: BABYLON.Material,
  scene: BABYLON.Scene,
): Generator<void, PathMesh, void> {
  const { moves } = parsed;
  const { segments } = sampler;
  const indicesPerStep = TUBE_SIDES * 6;
  const cumIndices = new Uint32Array(moves.length);

  let capacity = 0;
  for (let k = 1; k < moves.length; k++) {
    if (include(k)) capacity += segments[k] + 1;
  }
  if (capacity === 0) return { mesh: null, cumIndices, indicesPerStep, vertexOwner: new Uint32Array(0) };

  const samples = yield* sampleBead(parsed, sampler, include, capacity);
  const { owner, frac, stripStart, count } = samples;
  const { positions, normals, indices, indexCount } = yield* buildBeadGeometry(samples, cumIndices, indicesPerStep);
  // Mouvements hors de ce cordon : même compte que le précédent.
  for (let k = 1; k < moves.length; k++) {
    if (cumIndices[k] < cumIndices[k - 1]) cumIndices[k] = cumIndices[k - 1];
    if ((k & SLICE_MASK) === 0) yield;
  }

  // Mouvement propriétaire de chaque SOMMET (TUBE_SIDES sommets par échantillon j, cf. writeRing) :
  // permet de recalculer les couleurs par sommet (mode « colorer par » continu) sans reconstruire
  // la géométrie, cf. PathMesh.vertexOwner.
  const vertexOwner = new Uint32Array(count * TUBE_SIDES);
  for (let j = 0; j < count; j++) {
    vertexOwner.fill(owner[j], j * TUBE_SIDES, (j + 1) * TUBE_SIDES);
    if ((j & SLICE_MASK) === 0) yield;
  }

  const mesh = new BABYLON.Mesh(name, scene);
  const data = new BABYLON.VertexData();
  data.positions = positions;
  data.normals = normals;
  data.indices = indices.subarray(0, indexCount);
  // Modifiable : l'édition réécrit en place les sommets des mouvements validés.
  data.applyToMesh(mesh, true);
  mesh.material = material;
  finalizePathMesh(mesh);
  return {
    mesh, cumIndices, indicesPerStep, vertexOwner,
    sampleOwner: owner.subarray(0, count), sampleFrac: frac.subarray(0, count), stripStart: stripStart.subarray(0, count),
    positions, normals,
  };
}
