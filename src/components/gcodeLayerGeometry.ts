import * as BABYLON from 'babylonjs';
import { type ParsedGCode, MAX_SUBSEGMENT_DEG, DEG2RAD, nozzleTip, moveLength } from './gcodeParse';

// Géométrie du tracé G-code (échantillonnage, cordon, trajets, marqueurs) : sans état, extraite de
// gcodeLayer.ts pour pouvoir être testée sans scène complète.

/**
 * Échantillonnage de la trajectoire en repère plateau (Babylon : y vers le haut) : position de la
 * pointe de buse et axe de la buse à la fraction `f` du mouvement `k`, et nombre de sous-segments
 * de chaque mouvement (subdivision angulaire en polaire, segment droit en cartésien).
 */
export interface PathSampler {
  segments: Uint32Array;
  tip(k: number, f: number, out: BABYLON.Vector3): void;
  axis(k: number, f: number, out: BABYLON.Vector3): void;
}

/**
 * @param maxSegmentMm Longueur maximale (mm) d'un sous-segment cartésien avant d'être encore
 *   subdivisé — cf. « Précision du rendu » (GCodeLineTypeLegend.tsx), pertinent seulement en mode
 *   de coloration continu : le mode catégoriel garde un anneau par mouvement (`undefined`/`null`),
 *   c'est la géométrie actuelle et la moins coûteuse, suffisante quand la couleur ne varie pas
 *   dans un mouvement. Un mode continu a besoin de plus de points d'échantillonnage le long d'un
 *   long mouvement, sinon la couleur n'y change qu'entre ses deux extrémités (l'interpolation RVB
 *   du GPU produit alors l'effet de moiré observé sur de longs traits). Le polaire garde sa
 *   subdivision angulaire existante (MAX_SUBSEGMENT_DEG) dans tous les cas — déjà assez fine.
 */
export function* createSampler(parsed: ParsedGCode, maxSegmentMm?: number | null): Generator<void, PathSampler, void> {
  const { moves } = parsed;
  const segments = new Uint32Array(moves.length);
  const from = (k: number) => moves[k > 0 ? k - 1 : 0];

  if (parsed.kind === 'cartesian') {
    if (maxSegmentMm && maxSegmentMm > 0) {
      for (let k = 1; k < moves.length; k++) {
        const len = moveLength(moves[k - 1], moves[k], 'cartesian');
        segments[k] = Math.max(1, Math.ceil(len / maxSegmentMm));
        if ((k & SLICE_MASK) === 0) yield;
      }
    } else {
      segments.fill(1);
    }
    return {
      segments,
      tip(k, f, out) {
        const a = from(k), m = moves[k];
        out.set(a.x + (m.x - a.x) * f, a.z + (m.z - a.z) * f, a.y + (m.y - a.y) * f);
      },
      axis(_k, _f, out) {
        out.set(0, 1, 0);
      },
    };
  }

  for (let k = 1; k < moves.length; k++) {
    const dc = Math.abs(moves[k].y - moves[k - 1].y);
    segments[k] = Math.max(1, Math.ceil(dc / MAX_SUBSEGMENT_DEG));
    if ((k & SLICE_MASK) === 0) yield;
  }
  const tipRZ = { r: 0, z: 0 };
  return {
    segments,
    // Interpolation en coordonnées pivot (comme le firmware), puis conversion à la buse.
    tip(k, f, out) {
      const a = from(k), m = moves[k];
      const c = (a.y + (m.y - a.y) * f) * DEG2RAD;
      nozzleTip(a.x + (m.x - a.x) * f, a.z + (m.z - a.z) * f, (a.b + (m.b - a.b) * f) * DEG2RAD, tipRZ);
      out.set(tipRZ.r * Math.cos(c), tipRZ.z, tipRZ.r * Math.sin(c));
    },
    // Axe de buse (vers le haut de la tête) : (sin B, cos B) dans le demi-plan machine, dont la
    // direction radiale est à l'angle C du dépôt.
    axis(k, f, out) {
      const a = from(k), m = moves[k];
      const c = (a.y + (m.y - a.y) * f) * DEG2RAD;
      const b = (a.b + (m.b - a.b) * f) * DEG2RAD;
      out.set(Math.sin(b) * Math.cos(c), Math.cos(b), Math.sin(b) * Math.sin(c));
    },
  };
}

/**
 * Construction du maillage par TRANCHES : les générateurs ci-dessous `yield` toutes les
 * SLICE_MASK+1 itérations, et `runSliced` ne rend la main au navigateur (image suivante) que quand
 * la tranche en cours dépasse SLICE_BUDGET_MS — un fichier énorme se construit donc en plusieurs
 * dizaines d'images au lieu de figer l'interface (et le rideau de chargement continue d'animer).
 */
export const SLICE_MASK = 0x1fff;
const SLICE_BUDGET_MS = 6;

export async function runSliced<T>(gen: Generator<void, T, void>, isCancelled: () => boolean): Promise<T | null> {
  let sliceStart = performance.now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (isCancelled()) { gen.return(undefined as never); return null; }
    if (performance.now() - sliceStart > SLICE_BUDGET_MS) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      sliceStart = performance.now();
    }
  }
}

export interface PathMesh {
  mesh: BABYLON.Mesh | null;
  /** Nombre d'indices à dessiner une fois le mouvement k terminé. */
  cumIndices: Uint32Array;
  /** Nombre d'indices par sous-segment : granularité de l'affichage d'un mouvement partiel. */
  indicesPerStep: number;
  /** Mouvement propriétaire de chaque SOMMET (pas échantillon) du maillage, dans l'ordre de
   * `VertexData.positions` — permet de recalculer les couleurs par sommet (mode « colorer par »
   * continu) sans reconstruire la géométrie : un sommet appartient au même mouvement que
   * l'échantillon dont il est issu (TUBE_SIDES sommets par échantillon pour un cordon, 1 par
   * échantillon pour un LinesMesh). Vide (mesh === null ou mode jamais recoloré) sinon. */
  vertexOwner: Uint32Array;
  /** Cordons : par ÉCHANTILLON (TUBE_SIDES sommets chacun), mouvement propriétaire, fraction le
   * long de ce mouvement, et début de tube — pour l'édition (poids par sommet interpolés entre les
   * deux points du mouvement, et recalcul local de la géométrie après validation). */
  sampleOwner?: Uint32Array;
  sampleFrac?: Float32Array;
  stripStart?: Uint8Array;
  /** Trajets (LinesMesh) : premier sommet de chaque mouvement retenu (inutilisé sinon). */
  lineStart?: Uint32Array;
  /** Copies CPU des sommets (mêmes tableaux que ceux passés à Babylon) : une mise à jour partielle
   * du tampon GPU fait oublier à Babylon sa propre copie, l'édition garde donc la sienne. */
  positions?: Float32Array;
  normals?: Float32Array;
  /** Poids d'édition par sommet (cordons), alloué au premier usage. */
  editWeights?: Float32Array;
  /** Normale de paroi d'édition par sommet (3 valeurs, repère local ; nulle hors coque). */
  editSlide?: Float32Array;
  /** Axe de tête d'édition par sommet (3 valeurs, repère local ; mode « empilement »). */
  editAxis?: Float32Array;
}

/** Section du cordon déposé (mm) : largeur de part et d'autre de la trajectoire, et épaisseur le
 * long de l'axe de la buse. Valeurs nominales (pas de largeur/hauteur de couche lue). */
export const BEAD_WIDTH_MM = 0.6;
export const BEAD_HEIGHT_MM = 0.3;
/** Nombre de facettes de la section du cordon. */
export const TUBE_SIDES = 6;
/** Diamètre des sphères des marqueurs ponctuels (rétractions, coutures). */
const MARKER_DIAMETER_MM = 0.8;

const RING_COS = Float32Array.from({ length: TUBE_SIDES }, (_, i) => Math.cos((i / TUBE_SIDES) * Math.PI * 2));
const RING_SIN = Float32Array.from({ length: TUBE_SIDES }, (_, i) => Math.sin((i / TUBE_SIDES) * Math.PI * 2));

/**
 * Écrit l'anneau n° `ring` du cordon (TUBE_SIDES sommets et normales) : ellipse centrée en c,
 * perpendiculaire à la tangente unitaire t, écrasée le long de l'axe de buse a (BEAD_HEIGHT_MM)
 * et large de BEAD_WIDTH_MM sur le côté.
 */
export interface Vec3 { x: number; y: number; z: number }

export function writeRing(
  positions: Float32Array,
  normals: Float32Array,
  ring: number,
  c: Vec3,
  t: Vec3,
  a: Vec3,
) {
  const { x: cx, y: cy, z: cz } = c;
  const { x: tx, y: ty, z: tz } = t;
  const halfW = BEAD_WIDTH_MM / 2;
  const halfH = BEAD_HEIGHT_MM / 2;
  // Axe de buse rendu orthogonal à la tangente ; s'il lui est parallèle (déplacement le long
  // de la buse), n'importe quelle perpendiculaire convient.
  let ux = a.x, uy = a.y, uz = a.z;
  const dot = ux * tx + uy * ty + uz * tz;
  ux -= dot * tx; uy -= dot * ty; uz -= dot * tz;
  let len = Math.hypot(ux, uy, uz);
  if (len < 1e-6) {
    ux = -ty; uy = tx; uz = 0;
    len = Math.hypot(ux, uy, uz);
    if (len < 1e-6) { ux = 0; uy = -tz; uz = ty; len = Math.hypot(uy, uz); }
  }
  ux /= len; uy /= len; uz /= len;
  // Côté = tangente × axe.
  const sx = ty * uz - tz * uy;
  const sy = tz * ux - tx * uz;
  const sz = tx * uy - ty * ux;

  for (let i = 0; i < TUBE_SIDES; i++) {
    const v = (ring * TUBE_SIDES + i) * 3;
    const cs = RING_COS[i], sn = RING_SIN[i];
    positions[v] = cx + sx * halfW * cs + ux * halfH * sn;
    positions[v + 1] = cy + sy * halfW * cs + uy * halfH * sn;
    positions[v + 2] = cz + sz * halfW * cs + uz * halfH * sn;
    // Normale d'ellipse : gradient (cos/a, sin/b) dans le repère (côté, axe).
    let nx = sx * cs / halfW + ux * sn / halfH;
    let ny = sy * cs / halfW + uy * sn / halfH;
    let nz = sz * cs / halfW + uz * sn / halfH;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    normals[v] = nx;
    normals[v + 1] = ny;
    normals[v + 2] = nz;
  }
}

/** Donne à un sous-maillage affiché par préfixe (`indexCount`) une boîte englobante propre. */
function finalizePathMesh(mesh: BABYLON.Mesh) {
  // Tant que `indexCount` couvre toute la géométrie, Babylon traite le sous-maillage comme
  // « global » et lui prête la boîte englobante du maillage ; dès qu'on n'en affiche qu'un
  // préfixe, il lit sa boîte propre — jamais créée, d'où un crash dans le tri des objets
  // transparents qui arrêtait la boucle de rendu. On lui en donne une une fois pour toutes :
  // celle de la trajectoire complète, qui englobe n'importe quel préfixe (pas de
  // `refreshBoundingInfo`, qui reparcourrait les indices à chaque rotation du plateau).
  const { minimum, maximum } = mesh.getBoundingInfo();
  mesh.subMeshes[0].setBoundingInfo(new BABYLON.BoundingInfo(minimum.clone(), maximum.clone()));
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
}

/** Échantillons d'un cordon (passe 1) : un par point de la trajectoire retenue. */
interface BeadSamples {
  centers: Float32Array;
  axes: Float32Array;
  owner: Uint32Array;
  frac: Float32Array;
  stripStart: Uint8Array;
  count: number;
}

/**
 * Passe 1 : échantillons le long de la trajectoire — centre du cordon, axe de buse, mouvement
 * propriétaire et début de tube (pas de sous-segment qui le relie au précédent).
 */
function* sampleBeadPath(
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

/** Géométrie d'un cordon (passe 2) : sommets, normales, indices et indices cumulés par mouvement. */
interface BeadGeometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  cumIndices: Uint32Array;
  indexCount: number;
}

/**
 * Passe 2 : un anneau elliptique par échantillon, dans le repère (côté, axe de buse)
 * perpendiculaire à la tangente, puis les quads entre anneaux consécutifs d'un même tube.
 */
function* buildBeadGeometry(
  samples: BeadSamples,
  moveCount: number,
  indicesPerStep: number,
): Generator<void, BeadGeometry, void> {
  const { centers, axes, owner, stripStart, count } = samples;
  const cumIndices = new Uint32Array(moveCount);
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
  // Mouvements hors de ce cordon : même compte que le précédent.
  for (let k = 1; k < moveCount; k++) {
    if (cumIndices[k] < cumIndices[k - 1]) cumIndices[k] = cumIndices[k - 1];
    if ((k & SLICE_MASK) === 0) yield;
  }
  return { positions, normals, indices, cumIndices, indexCount: idx };
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

  let capacity = 0;
  for (let k = 1; k < moves.length; k++) {
    if (include(k)) capacity += segments[k] + 1;
  }
  if (capacity === 0) {
    return { mesh: null, cumIndices: new Uint32Array(moves.length), indicesPerStep, vertexOwner: new Uint32Array(0) };
  }

  const samples = yield* sampleBeadPath(parsed, sampler, include, capacity);
  const { positions, normals, indices, cumIndices, indexCount } = yield* buildBeadGeometry(samples, moves.length, indicesPerStep);
  const { owner, frac, stripStart, count } = samples;

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

/**
 * Anneau de l'échantillon j d'un cordon : tangente par différence centrée entre ses voisins du
 * même tube (`stripStart` marque les débuts de tube), reprise de la dernière tangente valide quand
 * les voisins sont confondus. `tangent` porte cette dernière tangente d'un appel à l'autre.
 */
export function writeSampleRing(
  positions: Float32Array,
  normals: Float32Array,
  centers: Float32Array,
  axes: Float32Array,
  stripStart: Uint8Array,
  count: number,
  j: number,
  tangent: { x: number; y: number; z: number },
) {
  const p = j * 3;
  const hasPrev = !stripStart[j];
  const hasNext = j + 1 < count && !stripStart[j + 1];
  const from = hasPrev ? p - 3 : p;
  const to = hasNext ? p + 3 : p;
  const dx = centers[to] - centers[from];
  const dy = centers[to + 1] - centers[from + 1];
  const dz = centers[to + 2] - centers[from + 2];
  const len = Math.hypot(dx, dy, dz);
  if (len > 1e-6) {
    tangent.x = dx / len; tangent.y = dy / len; tangent.z = dz / len;
  }
  writeRing(positions, normals, j,
    { x: centers[p], y: centers[p + 1], z: centers[p + 2] },
    tangent,
    { x: axes[p], y: axes[p + 1], z: axes[p + 2] });
}

/** Construit un LinesMesh (repère plateau) des mouvements retenus par `include`, dans l'ordre du
 * fichier. N'importe quel préfixe s'affiche ensuite en changeant `indexCount`. */
export function* buildPathMesh(
  name: string,
  parsed: ParsedGCode,
  sampler: PathSampler,
  include: (k: number) => boolean,
  color: BABYLON.Color3,
  scene: BABYLON.Scene,
): Generator<void, PathMesh, void> {
  const { moves } = parsed;
  const { segments } = sampler;
  let vertexTotal = 0;
  for (let k = 1; k < moves.length; k++) {
    if (include(k)) vertexTotal += segments[k] + 1;
  }

  const cumIndices = new Uint32Array(moves.length);
  // Travel/wipe restent en couleur fixe même en mode « colorer par » continu (pas de critère
  // applicable à un déplacement à vide) — jamais recolorés, vertexOwner n'a donc pas d'usage ici.
  if (vertexTotal === 0) return { mesh: null, cumIndices, indicesPerStep: 2, vertexOwner: new Uint32Array(0) };

  const positions = new Float32Array(vertexTotal * 3);
  const indices = new Uint32Array((vertexTotal - 1) * 2);
  const lineStart = new Uint32Array(moves.length);
  const tip = new BABYLON.Vector3();
  let v = 0;
  let idx = 0;

  for (let k = 1; k < moves.length; k++) {
    if ((k & SLICE_MASK) === 0) yield;
    if (include(k)) {
      lineStart[k] = v;
      const n = segments[k];
      for (let s = 0; s <= n; s++) {
        sampler.tip(k, s / n, tip);
        positions[v * 3] = tip.x;
        positions[v * 3 + 1] = tip.y;
        positions[v * 3 + 2] = tip.z;
        if (s > 0) {
          indices[idx++] = v - 1;
          indices[idx++] = v;
        }
        v++;
      }
    }
    cumIndices[k] = idx;
  }

  const mesh = new BABYLON.LinesMesh(name, scene);
  const data = new BABYLON.VertexData();
  data.positions = positions;
  data.indices = indices.subarray(0, idx);
  data.applyToMesh(mesh, true);
  mesh.color = color;
  mesh.alpha = 0.85;
  finalizePathMesh(mesh);
  return { mesh, cumIndices, indicesPerStep: 2, vertexOwner: new Uint32Array(0), lineStart, positions };
}

/** Sphères (instances légères) aux positions de fin des mouvements `at`. */
export function* buildMarkerMesh(
  name: string,
  at: Uint32Array,
  sampler: PathSampler,
  color: BABYLON.Color3,
  scene: BABYLON.Scene,
): Generator<void, BABYLON.Mesh | null, void> {
  if (!at.length) return null;
  const mesh = BABYLON.MeshBuilder.CreateSphere(name, { diameter: MARKER_DIAMETER_MM, segments: 6 }, scene);
  const material = new BABYLON.StandardMaterial(`${name}Mat`, scene);
  material.disableLighting = true;
  material.emissiveColor = color;
  mesh.material = material;
  const matrices = new Float32Array(at.length * 16);
  const p = new BABYLON.Vector3();
  const m = new BABYLON.Matrix();
  for (let j = 0; j < at.length; j++) {
    if ((j & SLICE_MASK) === 0) yield;
    sampler.tip(at[j], 1, p);
    BABYLON.Matrix.TranslationToRef(p.x, p.y, p.z, m);
    m.copyToArray(matrices, j * 16);
  }
  mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

/** Nombre d'éléments de `sorted` (croissant) inférieurs ou égaux à `t`. */
export function countUpTo(sorted: Uint32Array, t: number) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}
