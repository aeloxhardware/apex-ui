import * as BABYLON from 'babylonjs';
import 'babylonjs-loaders';
import headModelUrl from '@/assets/models/aetheris-4.glb?url';
import {
  LINE_TYPES,
  DEFAULT_LINE_VISIBILITY,
  resolveLineType,
  type LineTypeId,
  type LineTypeVisibility,
} from './gcodeLineTypes';
import { detectGeneratorSignature, guessGeneratorFromFeature, type GCodeGenerator } from './gcodeGenerator';
import { colorForMode, defaultColorByScope, type ColorByScope } from './gcodeColormap';
import { isColorByDeferred } from '@/utils/gcodeColorByPrefs';

import {
  type GCodeKind, type GCodeMove, type LineTypeStat, type MarkerTypeId, type ContinuousColorByMode,
  type ColorByMode, type ColorByRange, type ColorByRanges, type ParsedGCode, type ConversionMode,
  PLATE_RADIUS_MM, SUSPICIOUS_C_RANGE_DEG, NOZZLE_PIVOT_MM, MAX_SUBSEGMENT_DEG, DEG2RAD, nozzleTip, moveLength, parseGCode, timeAtIndex, indexAtTime, stateAt, toolAxisAt,
} from './gcodeParse';

// Le parseur (sans Babylon) vit dans gcodeParse.ts pour pouvoir tourner dans un Web Worker ;
// ré-exporté ici pour que les importeurs existants de gcodeLayer ne changent pas.
export * from './gcodeParse';

/**
 * Échantillonnage de la trajectoire en repère plateau (Babylon : y vers le haut) : position de la
 * pointe de buse et axe de la buse à la fraction `f` du mouvement `k`, et nombre de sous-segments
 * de chaque mouvement (subdivision angulaire en polaire, segment droit en cartésien).
 */
interface PathSampler {
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
function* createSampler(parsed: ParsedGCode, maxSegmentMm?: number | null): Generator<void, PathSampler, void> {
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
const SLICE_MASK = 0x1fff;
const SLICE_BUDGET_MS = 6;
/** Tolérance de visée (pixels) en plus du rayon du cordon, pour sélectionner un point de trajectoire. */
const PICK_TOLERANCE_PX = 6;

async function runSliced<T>(gen: Generator<void, T, void>, isCancelled: () => boolean): Promise<T | null> {
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

interface PathMesh {
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
}

/** Section du cordon déposé (mm) : largeur de part et d'autre de la trajectoire, et épaisseur le
 * long de l'axe de la buse. Valeurs nominales (pas de largeur/hauteur de couche lue). */
export const BEAD_WIDTH_MM = 0.6;
export const BEAD_HEIGHT_MM = 0.3;
/** Nombre de facettes de la section du cordon. */
const TUBE_SIDES = 6;
/** Diamètre des sphères des marqueurs ponctuels (rétractions, coutures). */
const MARKER_DIAMETER_MM = 0.8;

const RING_COS = Float32Array.from({ length: TUBE_SIDES }, (_, i) => Math.cos((i / TUBE_SIDES) * Math.PI * 2));
const RING_SIN = Float32Array.from({ length: TUBE_SIDES }, (_, i) => Math.sin((i / TUBE_SIDES) * Math.PI * 2));

/**
 * Écrit l'anneau n° `ring` du cordon (TUBE_SIDES sommets et normales) : ellipse centrée en c,
 * perpendiculaire à la tangente unitaire t, écrasée le long de l'axe de buse a (BEAD_HEIGHT_MM)
 * et large de BEAD_WIDTH_MM sur le côté.
 */
function writeRing(
  positions: Float32Array,
  normals: Float32Array,
  ring: number,
  cx: number, cy: number, cz: number,
  tx: number, ty: number, tz: number,
  ax: number, ay: number, az: number,
) {
  const halfW = BEAD_WIDTH_MM / 2;
  const halfH = BEAD_HEIGHT_MM / 2;
  // Axe de buse rendu orthogonal à la tangente ; s'il lui est parallèle (déplacement le long
  // de la buse), n'importe quelle perpendiculaire convient.
  let ux = ax, uy = ay, uz = az;
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

/**
 * Construit le cordon de matière (repère plateau) : un tube à section elliptique le long des
 * mouvements retenus par `include`, dans l'ordre du fichier. La section est orientée selon l'axe
 * de la buse au moment du dépôt (écrasée le long de cet axe, BEAD_HEIGHT_MM) et centrée une
 * demi-épaisseur sous la pointe de buse, là où la matière est réellement posée. Les mouvements
 * retenus consécutifs partagent leurs anneaux de jonction : un seul tube continu par suite
 * ininterrompue. N'importe quel préfixe s'affiche en changeant `indexCount`, sans reconstruire.
 */
function* buildBeadMesh(
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
  const emptyOwner = new Uint32Array(0);

  let capacity = 0;
  for (let k = 1; k < moves.length; k++) {
    if (include(k)) capacity += segments[k] + 1;
  }
  if (capacity === 0) return { mesh: null, cumIndices, indicesPerStep, vertexOwner: emptyOwner };

  // Passe 1 : échantillons le long de la trajectoire — centre du cordon, axe de buse, mouvement
  // propriétaire et début de tube (pas de sous-segment qui le relie au précédent).
  const centers = new Float32Array(capacity * 3);
  const axes = new Float32Array(capacity * 3);
  const owner = new Uint32Array(capacity);
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
      stripStart[count] = s === 0 ? 1 : 0;
      count++;
    }
  }

  // Passe 2 : un anneau elliptique par échantillon, dans le repère (côté, axe de buse)
  // perpendiculaire à la tangente, puis les quads entre anneaux consécutifs d'un même tube.
  const positions = new Float32Array(count * TUBE_SIDES * 3);
  const normals = new Float32Array(count * TUBE_SIDES * 3);
  const indices = new Uint32Array(count * indicesPerStep);
  // Dernière tangente valide : reprise pour les échantillons confondus, dont la tangente locale
  // est nulle.
  let tx = 1, ty = 0, tz = 0;
  let idx = 0;

  for (let j = 0; j < count; j++) {
    if ((j & SLICE_MASK) === 0) yield;
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
      tx = dx / len; ty = dy / len; tz = dz / len;
    }
    writeRing(positions, normals, j, centers[p], centers[p + 1], centers[p + 2], tx, ty, tz, axes[p], axes[p + 1], axes[p + 2]);

    if (hasPrev) {
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
  data.indices = indices.subarray(0, idx);
  data.applyToMesh(mesh);
  mesh.material = material;
  finalizePathMesh(mesh);
  return { mesh, cumIndices, indicesPerStep, vertexOwner };
}

/** Construit un LinesMesh (repère plateau) des mouvements retenus par `include`, dans l'ordre du
 * fichier. N'importe quel préfixe s'affiche ensuite en changeant `indexCount`. */
function* buildPathMesh(
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
  const tip = new BABYLON.Vector3();
  let v = 0;
  let idx = 0;

  for (let k = 1; k < moves.length; k++) {
    if ((k & SLICE_MASK) === 0) yield;
    if (include(k)) {
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
  data.applyToMesh(mesh);
  mesh.color = color;
  mesh.alpha = 0.85;
  finalizePathMesh(mesh);
  return { mesh, cumIndices, indicesPerStep: 2, vertexOwner: new Uint32Array(0) };
}

/** Sphères (instances légères) aux positions de fin des mouvements `at`. */
function* buildMarkerMesh(
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
function countUpTo(sorted: Uint32Array, t: number) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export interface GCodeLayer {
  /** Construit le maillage par tranches (l'interface ne gèle pas) ; résolu une fois affiché. */
  load(parsed: ParsedGCode): Promise<void>;
  /** Position de lecture, en index de mouvement fractionnaire. */
  setTime(t: number): void;
  /** Types de ligne affichés (cf. `apex-gcode-line-visibility`). */
  setLineTypeVisibility(visibility: LineTypeVisibility): void;
  /** Surligne en rouge les traits hors plateau (cf. `apex-gcode-highlight-offplate`). */
  setOffPlateHighlight(show: boolean): void;
  /** Fait clignoter le surlignage hors-plateau au lieu d'un rouge fixe (pendant une conversion en
   * cours, cf. `apex-gcode-highlight-offplate` { blinking }) — sans effet si le surlignage est
   * éteint (`setOffPlateHighlight(false)`). */
  setOffPlateBlinking(blinking: boolean): void;
  /** Tête complète (défaut) ou buse seule — masque tous les maillages de la tête sauf ceux nommés
   * « NOZZLE » (cf. `apex-gcode-show-full-head`). */
  setFullHead(show: boolean): void;
  /** Critère de coloration du tracé et sa portée affichée (curseurs min/max de la légende, cf.
   * `apex-gcode-color-by`) : `lineType` (défaut) ou un mode continu recadré sur `scope` — les
   * valeurs comprises dedans s'étalent sur toute la rampe, celles en dehors sont grisées ou
   * écrêtées à l'extrême le plus proche selon `scope.grayOutOfScope` (cf. gcodeColormap.ts).
   * `scope` est ignoré (et peut être omis) quand `mode === 'lineType'`. */
  setColorBy(mode: ColorByMode, scope?: ColorByScope): void;
  /** Longueur maximale (mm) d'un sous-segment cartésien en mode continu (cf. « Précision du
   * rendu » de la légende, createSampler) — `null` restaure le comportement le moins précis (un
   * anneau par mouvement). Reconstruit la géométrie des maillages extrudés ; sans effet en mode
   * catégoriel tant que celui-ci n'est pas actif (appliqué au prochain passage en mode continu). */
  setRenderPrecision(mm: number | null): void;
  /** Active la sélection d'un point de trajectoire : construit (par tranches) l'index spatial qui
   * rend `pickAt` instantané même sur des millions de mouvements. */
  setPickingEnabled(enabled: boolean): void;
  /** Point de trajectoire visible (déposé, type affiché) le plus proche du rayon monde `ray`, ou
   * null. `pxPerUnit` : taille monde d'un pixel à 1 unité de distance de la caméra (tolérance de
   * visée de quelques pixels). `t` : index de mouvement fractionnaire où la tête dépose ce point
   * (cf. `setTime`) ; `local` : sa position dans le repère du plateau. */
  pickAt(ray: BABYLON.Ray, pxPerUnit: number): { t: number; local: BABYLON.Vector3 } | null;
  /** Surligne un point (repère du plateau, cf. `pickAt`) ; null l'éteint. */
  setPickHighlight(local: BABYLON.Vector3 | null): void;
  setEnabled(enabled: boolean): void;
  /** Rotation courante du plateau autour de Y (radians, repère Babylon), 0 sans G-code. */
  getPlateRotation(): number;
  dispose(): void;
}

/** Préfixe de nom de tous les maillages du calque (cf. exclusion de la capture du flou). */
export const GCODE_MESH_PREFIX = 'gcode';

/** Le glTF est en mètres, la scène en millimètres. */
const GLTF_TO_MM = 1000;
/** Rotation du modèle de tête autour de l'axe de sa buse (radians) : tel qu'exporté, son axe de
 * basculement B est perpendiculaire à celui de la machine (Z du repère tête, la tête penchant
 * dans le plan radial XY). */
const HEAD_MODEL_YAW = Math.PI / 2;


/**
 * Charge le modèle de la tête (aetheris-4.glb) sous `headNode`, pointe de buse à l'origine du
 * noeud et corps vers +Y local. Le fichier est déjà posé debout sur la buse, mais le centre de
 * la face de sortie de la buse (maillage « NOZZLE origin ») est légèrement décalé de son
 * origine : on recale le modèle sur ce point plutôt que de faire confiance à l'origine.
 * Chargé dans un conteneur et renommé AVANT l'ajout à la scène : Viewport3D trie les maillages
 * par nom dès leur arrivée (capture du flou, sélection de modèles) et doit ignorer ceux du calque.
 */
async function loadHeadModel(scene: BABYLON.Scene, headNode: BABYLON.TransformNode, isDisposed: () => boolean) {
  const container = await BABYLON.SceneLoader.LoadAssetContainerAsync('', headModelUrl, scene, null, '.glb');
  if (isDisposed()) {
    container.dispose();
    return { loaded: false as const };
  }
  // Repérés AVANT le renommage ci-dessous (sur le nom d'origine du glTF, jamais reconstruit à
  // partir du nom préfixé/modifié) et renvoyés tels quels à l'appelant (cf. `setFullHead`) : plus
  // sûr qu'un `.includes('NOZZLE')` a posteriori sur des noms qui ont pu être transformés.
  const nozzleMeshes = container.meshes.filter((m) => m.name.includes('NOZZLE'));
  const prefix = `${GCODE_MESH_PREFIX}HeadModel_`;
  for (const mesh of container.meshes) {
    mesh.name = prefix + mesh.name;
    mesh.isPickable = false;
  }
  for (const node of container.transformNodes) node.name = prefix + node.name;

  const model = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}HeadModel`, scene);
  model.scaling.setAll(GLTF_TO_MM);
  for (const node of container.rootNodes) node.parent = model;

  // Pointe de buse mesurée avec le modèle seul (non encore rattaché à la tête) : son repère
  // monde n'est alors que l'échelle, donc la boîte monde est directement en repère tête.
  const nozzle = container.meshes.find((m) => m.name.includes('NOZZLE origin'));
  if (nozzle) {
    const chain: BABYLON.Node[] = [];
    for (let n: BABYLON.Node | null = nozzle; n; n = n.parent) chain.unshift(n);
    for (const n of chain) (n as BABYLON.TransformNode).computeWorldMatrix(true);
    const { minimumWorld: min, maximumWorld: max } = nozzle.getBoundingInfo().boundingBox;
    model.position.set(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
  }
  // Rotation portée par un noeud intermédiaire, APRÈS le recalage : elle tourne autour de l'axe
  // vertical passant par la pointe de buse, qui reste donc à l'origine.
  const mount = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}HeadModelMount`, scene);
  mount.rotation.y = HEAD_MODEL_YAW;
  mount.parent = headNode;
  model.parent = mount;
  container.addAllToScene();
  return { loaded: true as const, nozzleMeshes };
}

interface PathEntry extends PathMesh {
  type: LineTypeId;
  include: (k: number) => boolean;
  /** Cordon extrudé (bead) : seul recolorable par sommet en mode « colorer par » continu ; travel
   * et wipe gardent toujours leur couleur fixe (aucun critère ne s'applique à un déplacement à vide). */
  isExtrusion: boolean;
  /** Matériau catégoriel (type de ligne) à restaurer quand on revient au mode `lineType` — n'existe
   * que pour les entrées `isExtrusion`. */
  categoryMaterial?: BABYLON.Material;
}

interface MarkerEntry {
  type: LineTypeId;
  mesh: BABYLON.Mesh;
  at: Uint32Array;
}

/**
 * Calque de prévisualisation G-code posé dans une scène existante. `parent` est le repère du
 * plateau (origine au centre de sa surface) : Z = 0 du G-code y correspond.
 */
export function createGCodeLayer(
  scene: BABYLON.Scene,
  parent: BABYLON.TransformNode,
  /** Appelé à chaque mise à jour de la rotation du plateau (radians), pour y caler du décor. */
  onPlateRotation?: (rotationY: number) => void,
): GCodeLayer {
  const root = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}Root`, scene);
  root.parent = parent;
  root.setEnabled(false);

  // Repère tournant du plateau : toute la matière déposée en est enfant.
  const plateNode = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}Plate`, scene);
  plateNode.parent = root;

  // Tête : pointe de buse à l'origine du noeud, corps qui monte le long de +Y local ; le noeud
  // est ensuite orienté pour que ce corps penche de B vers +R. Primitives provisoires, remplacées
  // par le vrai modèle (loadHeadModel) une fois chargé ; gardées en repli s'il échoue.
  const headNode = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}Head`, scene);
  headNode.parent = root;
  headNode.rotationQuaternion = BABYLON.Quaternion.Identity();

  // Tête complète ou buse seule (cf. `setFullHead`) : simple bascule de visibilité par maillage,
  // « NOZZLE » (nom du modèle réel, cf. loadHeadModel) faisant office de repère — pas de plan de
  // coupe : plus simple, et jamais de coquille ouverte à boucher puisque chaque maillage garde ses
  // propres faces fermées, jamais tronquées à mi-hauteur.
  let fullHead = true;

  const nozzleMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}NozzleMat`, scene);
  nozzleMat.diffuseColor = new BABYLON.Color3(1, 0.55, 0.05);
  nozzleMat.emissiveColor = new BABYLON.Color3(0.35, 0.17, 0);
  const nozzle = BABYLON.MeshBuilder.CreateCylinder(`${GCODE_MESH_PREFIX}Nozzle`, { diameterTop: 7, diameterBottom: 0.6, height: 9, tessellation: 20 }, scene);
  nozzle.position.y = 4.5;
  nozzle.material = nozzleMat;
  nozzle.parent = headNode;
  const bodyMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}HeadBodyMat`, scene);
  bodyMat.diffuseColor = new BABYLON.Color3(0.55, 0.58, 0.64);
  bodyMat.alpha = 0.55;
  const body = BABYLON.MeshBuilder.CreateCylinder(`${GCODE_MESH_PREFIX}HeadBody`, { diameter: 14, height: 26, tessellation: 24 }, scene);
  body.position.y = 9 + 13;
  body.material = bodyMat;
  body.parent = headNode;
  nozzle.isPickable = false;
  body.isPickable = false;
  // `body` (le corps de la tête) n'a pas de contrepartie « NOZZLE » : c'est lui qu'il faut masquer
  // quand `fullHead` est faux, `nozzle` restant visible dans les deux cas (repli du modèle glTF,
  // où seuls les maillages nommés NOZZLE restent visibles — cf. le `.then` ci-dessous).
  body.setEnabled(fullHead);
  headNode.setEnabled(false);

  // Tête complète ou buse seule (cf. `setFullHead`), applicable aux deux états possibles de la
  // tête : primitives de repli (nozzle/body, avant chargement du modèle ou s'il échoue) ou vrai
  // modèle glTF (après, cf. le `.then` ci-dessous) — jamais les deux en même temps, l'un dispose
  // l'autre. Sur le modèle réel, seuls les maillages de `headModelNozzleMeshes` (repérés une fois
  // pour toutes à leur chargement par `loadHeadModel`, cf. plus bas — jamais reconstruits ici par
  // un `.includes('NOZZLE')` sur un nom déjà transformé) restent visibles ; le reste (corps,
  // radiateur, ventilateur, connecteurs…) est simplement désactivé — jamais de plan de coupe ni de
  // bouchon à poser, chaque maillage garde ses propres faces, déjà fermées, intactes.
  let headModelNozzleMeshes: BABYLON.AbstractMesh[] | null = null;
  const applyHeadVisibility = () => {
    if (!headModelNozzleMeshes) {
      // Modèle glTF pas encore chargé (ou échec) : seules les primitives de repli existent.
      if (!body.isDisposed()) body.setEnabled(fullHead);
      return;
    }
    const nozzleSet = new Set<BABYLON.Node>(headModelNozzleMeshes);
    // `isEnabled()` d'un maillage suit toute sa chaîne d'ancêtres (cf. Node.isEnabled) : le loader
    // glTF parente souvent tout sous un noeud technique (`__root__`) — le désactiver, lui, masque
    // aussi ses enfants NOZZLE bien que LEUR propre drapeau reste actif. Jamais désactiver un
    // ancêtre d'un maillage NOZZLE, donc, seulement les branches qui n'en contiennent aucun.
    const ancestorsOfNozzle = new Set<BABYLON.Node>();
    for (const nozzleMesh of headModelNozzleMeshes) {
      for (let n: BABYLON.Node | null = nozzleMesh.parent; n && n !== headNode; n = n.parent) ancestorsOfNozzle.add(n);
    }
    for (const mesh of headNode.getChildMeshes()) {
      if (!nozzleSet.has(mesh) && !ancestorsOfNozzle.has(mesh)) mesh.setEnabled(fullHead);
    }
  };

  let disposed = false;
  loadHeadModel(scene, headNode, () => disposed)
    .then((result) => {
      if (!result.loaded) return;
      nozzle.dispose(false, true);
      body.dispose(false, true);
      headModelNozzleMeshes = result.nozzleMeshes;
      applyHeadVisibility();
    })
    .catch((err) => console.warn('Modèle de tête G-code non chargé, primitives conservées :', err));

  // Un matériau par type de ligne extrudé (couleur de la légende) ; seul l'éclairage varie le long
  // du cordon. Faces arrière dessinées pour ne pas dépendre du sens des triangles, les normales
  // explicites (vers l'extérieur) donnant l'éclairage.
  const colors = Object.fromEntries(
    LINE_TYPES.map((t) => [t.id, BABYLON.Color3.FromHexString(t.color)]),
  ) as Record<LineTypeId, BABYLON.Color3>;
  const beadMaterials = new Map<LineTypeId, BABYLON.StandardMaterial>();
  for (const t of LINE_TYPES) {
    if (t.kind !== 'extrusion') continue;
    const mat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}BeadMat_${t.id}`, scene);
    mat.diffuseColor = colors[t.id];
    mat.emissiveColor = colors[t.id].scale(0.18);
    mat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
    mat.specularPower = 48;
    mat.backFaceCulling = false;
    beadMaterials.set(t.id, mat);
  }
  // Matériau partagé des cordons en mode « colorer par » continu (cf. setColorBy) : couleur par
  // sommet (VertexData.colors), éclairage désactivé pour qu'elle ne soit pas teintée — remplace,
  // maillage par maillage, le matériau par type ci-dessus sans reconstruire la géométrie.
  const vertexColorBeadMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}BeadMatVertexColor`, scene);
  vertexColorBeadMat.disableLighting = true;
  vertexColorBeadMat.emissiveColor = BABYLON.Color3.White();
  vertexColorBeadMat.backFaceCulling = false;
  // Tronçon vivant en mode continu (cf. updateLive) : couleur plate recalculée chaque image, trop
  // petit pour justifier une mise à jour de couleurs par sommet à chaque frame (cf. plan §3).
  const liveColorByMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}LiveBeadMatColorBy`, scene);
  liveColorByMat.disableLighting = true;
  liveColorByMat.backFaceCulling = false;

  // Tronçon « vivant » : portion du mouvement en cours entre la dernière jonction déjà dessinée
  // (préfixe des maillages, au sous-segment près) et la position exacte de la buse, recalculée à
  // chaque image — le tracé avance en continu sous la buse au lieu d'apparaître d'un bloc à la fin
  // de chaque mouvement (ou sous-segment), sans alourdir la géométrie des maillages complets.
  const livePositions = new Float32Array(2 * TUBE_SIDES * 3);
  const liveNormals = new Float32Array(2 * TUBE_SIDES * 3);
  const liveIndices: number[] = [];
  for (let i = 0; i < TUBE_SIDES; i++) {
    const i1 = (i + 1) % TUBE_SIDES;
    liveIndices.push(i, TUBE_SIDES + i, i1, i1, TUBE_SIDES + i, TUBE_SIDES + i1);
  }
  const liveBead = new BABYLON.Mesh(`${GCODE_MESH_PREFIX}LiveBead`, scene);
  const liveData = new BABYLON.VertexData();
  liveData.positions = livePositions;
  liveData.normals = liveNormals;
  liveData.indices = liveIndices;
  liveData.applyToMesh(liveBead, true);
  const livePoints = [new BABYLON.Vector3(), new BABYLON.Vector3(0, 0, 1e-3)];
  let liveLine = BABYLON.MeshBuilder.CreateLines(`${GCODE_MESH_PREFIX}LiveLine`, { points: livePoints, updatable: true }, scene);
  liveLine.alpha = 0.85;
  for (const mesh of [liveBead, liveLine]) {
    mesh.parent = plateNode;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
  }
  const liveA = new BABYLON.Vector3();
  const liveB = new BABYLON.Vector3();
  const liveAxA = new BABYLON.Vector3();
  const liveAxB = new BABYLON.Vector3();

  let parsed: ParsedGCode | null = null;
  let sampler: PathSampler | null = null;
  let segments = new Uint32Array(0);
  let paths: PathEntry[] = [];
  let markers: MarkerEntry[] = [];
  // Longueur max (mm) d'un sous-segment cartésien en mode continu (cf. createSampler, « Précision
  // du rendu » de la légende) ; null = comportement actuel (un anneau par mouvement), utilisé tant
  // que setRenderPrecision n'a jamais été appelé et toujours en mode catégoriel.
  let renderPrecisionMm: number | null = null;
  // Traits hors plateau surlignés en rouge (proposition de suppression avant conversion) : cordon
  // doublé, rendu devant l'original (zOffset) plutôt qu'en remplaçant sa couleur.
  const offPlateMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}OffPlateMat`, scene);
  const OFF_PLATE_EMISSIVE = new BABYLON.Color3(0.75, 0.05, 0.05);
  offPlateMat.diffuseColor = new BABYLON.Color3(1, 0.12, 0.12);
  offPlateMat.emissiveColor = OFF_PLATE_EMISSIVE.clone();
  offPlateMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
  offPlateMat.backFaceCulling = false;
  offPlateMat.zOffset = -2;

  // Clignotement pendant une conversion en cours (cf. setOffPlateBlinking) : bandes « chantier »
  // rouge/jaune en diagonale, défilant dans l'espace monde (comme des puces qui se déplacent),
  // plutôt qu'une simple pulsation de couleur uniforme — motif procédural (pas de texture/UV
  // requis) basé sur vPositionW, dans le même style que boundaryFragmentShader (Viewport3D.tsx).
  BABYLON.Effect.ShadersStore["offPlateHazardVertexShader"] = `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    uniform mat4 worldViewProjection;
    uniform mat4 world;
    varying vec3 vPositionW;
    varying vec3 vNormalW;
    void main(void) {
        gl_Position = worldViewProjection * vec4(position, 1.0);
        vPositionW = vec3(world * vec4(position, 1.0));
        vNormalW = normalize(vec3(world * vec4(normal, 0.0)));
    }
  `;
  BABYLON.Effect.ShadersStore["offPlateHazardFragmentShader"] = `
    precision highp float;
    varying vec3 vPositionW;
    varying vec3 vNormalW;
    uniform float time;
    void main(void) {
        // Ruban de signalisation chantier : jaune citron vif / rouge sang profond, bandes larges et
        // nettes à 45°.
        vec3 red = vec3(0.65, 0.03, 0.02);
        vec3 yellow = vec3(0.98, 0.92, 0.05);
        // Diagonale à 45° dans le plan du plateau (X + Z), défilée par time pour l'effet de
        // déplacement continu (comme des puces qui glissent).
        float diag = (vPositionW.x + vPositionW.z) * 0.22 - time;
        // Bande nette (pas de dégradé lissé, pour l'aspect « bande de signalisation ») : la partie
        // fractionnaire de diag bascule rouge/jaune à mi-cycle.
        float band = step(0.5, fract(diag));
        vec3 stripeColor = mix(red, yellow, band);
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float diffuse = max(dot(normalize(vNormalW), lightDir), 0.6);
        gl_FragColor = vec4(stripeColor * diffuse + stripeColor * 0.35, 1.0);
    }
  `;
  const offPlateHazardMat = new BABYLON.ShaderMaterial(
    `${GCODE_MESH_PREFIX}OffPlateHazardMat`, scene,
    { vertex: "offPlateHazard", fragment: "offPlateHazard" },
    { attributes: ["position", "normal"], uniforms: ["worldViewProjection", "world", "time"] },
  );
  offPlateHazardMat.backFaceCulling = false;
  offPlateHazardMat.zOffset = -2;

  let offPlatePath: PathEntry | null = null;
  let highlightOffPlate = false;
  // N'anime (et n'assigne le matériau chantier) que quand nécessaire (posé/retiré par
  // setOffPlateBlinking), pas en permanence — coût nul le reste du temps.
  let blinkingOffPlate = false;
  let offPlateBlinkObserver: BABYLON.Observer<BABYLON.Scene> | null = null;
  let offPlateBlinkStart = 0;
  // Vitesse de défilement des bandes (unités de `diag` par seconde) — indépendante de la fréquence
  // de clignotement d'origine, purement visuelle ici : à ajuster au ressenti.
  const OFF_PLATE_HAZARD_SPEED = 1.5;
  let time = 0;
  let visibility: LineTypeVisibility = { ...DEFAULT_LINE_VISIBILITY };
  // Mode de coloration actif et sa portée affichée (cf. setColorBy). `lineType` restaure le
  // matériau catégoriel existant sans recalcul ; un mode continu recolore les sommets des cordons
  // (jamais travel/wipe) par le matériau partagé `vertexColorBeadMat`, sans reconstruire la
  // géométrie (cf. plan §3). `colorByScope` n'a de sens que pour un mode continu — recalculée par
  // `defaultColorByScope` sur les bornes du fichier tant que React n'en a pas fourni une (avant le
  // premier appel à `setColorBy` avec un mode continu, ou juste après `load()`).
  let colorBy: ColorByMode = 'lineType';
  let colorByScope: ColorByScope = { min: 0, max: 0, grayOutOfScope: false };
  // Couleur réutilisée à chaque sommet recoloré (évite une allocation par sommet, potentiellement
  // des dizaines de milliers par bascule de mode).
  const colorScratch = new BABYLON.Color3();

  const up = BABYLON.Vector3.Up();
  const headDir = new BABYLON.Vector3();
  const headTip = { r: 0, z: 0 };
  const toolAxis = { x: 0, y: 0, z: 1 };

  const apply = () => {
    if (!parsed || parsed.moves.length === 0) return;
    const last = parsed.moves.length - 1;
    const t = Math.max(0, Math.min(last, time));
    const state = stateAt(parsed.moves, t);

    if (parsed.kind === 'polar') {
      // Dans le repère main gauche de Babylon, rotation.y = ψ envoie un angle local θ
      // (x = cos θ, z = sin θ) sur θ − ψ. Avec ψ = C courant, un point déposé à C_dépôt est à
      // l'angle machine C_dépôt − C : pile sous la tête (angle 0) au moment de son dépôt, puis
      // entraîné avec le plateau. Le signe opposé ferait apparaître la pièce en miroir.
      plateNode.rotation.y = state.y * DEG2RAD;
      onPlateRotation?.(plateNode.rotation.y);

      const bRad = state.b * DEG2RAD;
      nozzleTip(state.x, state.z, bRad, headTip);
      headNode.position.set(headTip.r, headTip.z, 0);
      // headDir.x positif = tête penchée vers +X, donc vers +R (à l'opposé de l'axe de rotation,
      // situé en X=0) puisque le nœud de tête est lui-même posé en X=+R. Signe vérifié visuellement
      // contre le comportement réel de la machine (le signe opposé penchait la tête vers l'axe).
      headDir.set(Math.sin(bRad), Math.cos(bRad), 0);
      BABYLON.Quaternion.FromUnitVectorsToRef(up, headDir, headNode.rotationQuaternion!);
    } else {
      // Cartésien : plateau fixe, tête qui suit la buse en X/Y/Z (Y du G-code → z Babylon), droite
      // sauf si le fichier pilote l'orientation de l'outil (B/C) : la tête prend alors cet axe.
      plateNode.rotation.y = 0;
      onPlateRotation?.(0);
      headNode.position.set(state.x, state.z, state.y);
      if (parsed.toolOriented) {
        toolAxisAt(parsed.moves, t, toolAxis);
        headDir.set(toolAxis.x, toolAxis.z, toolAxis.y);
        BABYLON.Quaternion.FromUnitVectorsToRef(up, headDir, headNode.rotationQuaternion!);
      } else {
        headNode.rotationQuaternion!.set(0, 0, 0, 1);
      }
    }

    // Préfixe affiché : mouvements terminés + fraction du mouvement en cours, au sous-segment
    // près. Chaque mouvement a `segments[k]` sous-segments dans chaque maillage qui le contient.
    const i = Math.floor(t);
    const next = Math.min(last, i + 1);
    const partialSteps = next > i ? Math.floor((t - i) * segments[next]) : 0;
    for (const entry of offPlatePath ? [...paths, offPlatePath] : paths) {
      if (!entry.mesh) continue;
      let count = entry.cumIndices[i];
      if (next > i && entry.include(next)) count += partialSteps * entry.indicesPerStep;
      const sub = entry.mesh.subMeshes?.[0];
      if (sub) sub.indexCount = count;
      entry.mesh.isVisible = count > 0;
    }
    for (const entry of markers) {
      const count = countUpTo(entry.at, t);
      entry.mesh.thinInstanceCount = count;
      entry.mesh.isVisible = count > 0;
    }
    updateLive(i, next, t);
  };

  /** Tronçon vivant du mouvement `next` en cours, de la fin du préfixe dessiné à la buse. */
  const updateLive = (i: number, next: number, t: number) => {
    let showBead = false;
    let showLine = false;
    if (parsed && sampler && next > i) {
      const m = parsed.moves[next];
      const seg = segments[next];
      const f = t - i;
      const f0 = Math.floor(f * seg) / seg;
      const type: LineTypeId = m.extruding ? m.type : m.type === 'wipe' ? 'wipe' : 'travel';
      if (f - f0 > 1e-6 && visibility[type]) {
        sampler.tip(next, f0, liveA);
        sampler.tip(next, f, liveB);
        if (m.extruding) {
          const dx = liveB.x - liveA.x, dy = liveB.y - liveA.y, dz = liveB.z - liveA.z;
          const len = Math.hypot(dx, dy, dz);
          if (len > 1e-6) {
            sampler.axis(next, f0, liveAxA);
            sampler.axis(next, f, liveAxB);
            const halfH = BEAD_HEIGHT_MM / 2;
            const tx = dx / len, ty = dy / len, tz = dz / len;
            writeRing(livePositions, liveNormals, 0,
              liveA.x - liveAxA.x * halfH, liveA.y - liveAxA.y * halfH, liveA.z - liveAxA.z * halfH,
              tx, ty, tz, liveAxA.x, liveAxA.y, liveAxA.z);
            writeRing(livePositions, liveNormals, 1,
              liveB.x - liveAxB.x * halfH, liveB.y - liveAxB.y * halfH, liveB.z - liveAxB.z * halfH,
              tx, ty, tz, liveAxB.x, liveAxB.y, liveAxB.z);
            liveBead.updateVerticesData(BABYLON.VertexBuffer.PositionKind, livePositions);
            liveBead.updateVerticesData(BABYLON.VertexBuffer.NormalKind, liveNormals);
            if (colorBy === 'lineType') {
              liveBead.material = beadMaterials.get(m.type) ?? null;
            } else {
              colorForMode(colorBy as ContinuousColorByMode, next, parsed, colorByScope, colorScratch);
              liveColorByMat.emissiveColor.copyFrom(colorScratch);
              liveBead.material = liveColorByMat;
            }
            showBead = true;
          }
        } else {
          livePoints[0].copyFrom(liveA);
          livePoints[1].copyFrom(liveB);
          liveLine = BABYLON.MeshBuilder.CreateLines(liveLine.name, { points: livePoints, instance: liveLine });
          liveLine.color = colors[type];
          showLine = true;
        }
      }
    }
    liveBead.setEnabled(showBead);
    liveLine.setEnabled(showLine);
  };

  const applyVisibility = () => {
    for (const entry of paths) entry.mesh?.setEnabled(visibility[entry.type]);
    for (const entry of markers) entry.mesh.setEnabled(visibility[entry.type]);
    offPlatePath?.mesh?.setEnabled(highlightOffPlate);
  };

  // Recalcul différé (réglage Paramètres, cf. utils/gcodeColorByPrefs.ts) : un changement de mode
  // qui arrive avant l'image différée annule la précédente, jamais deux recalculs empilés.
  let deferredColorByRaf = 0;

  /** Recolore (ou restaure) les cordons extrudés selon `colorBy`, sans reconstruire leur géométrie
   * (cf. plan §3) : `lineType` réapplique le matériau catégoriel déjà construit à `load()` ;
   * un mode continu bascule le maillage sur le matériau partagé `vertexColorBeadMat` et met à jour
   * son tampon de couleurs par sommet via `updateVerticesData`, jamais un `VertexData.applyToMesh`
   * complet (qui retoucherait aussi positions/indices/normales, inutile ici). */
  const applyColorBy = () => {
    if (deferredColorByRaf) {
      cancelAnimationFrame(deferredColorByRaf);
      deferredColorByRaf = 0;
    }
    const run = () => {
      if (!parsed) return;
      const isContinuous = colorBy !== 'lineType';
      for (const entry of paths) {
        if (!entry.isExtrusion || !entry.mesh) continue;
        if (!isContinuous) {
          entry.mesh.material = entry.categoryMaterial ?? entry.mesh.material;
          continue;
        }
        entry.mesh.material = vertexColorBeadMat;
        const { vertexOwner } = entry;
        const vertexColors = new Float32Array(vertexOwner.length * 4);
        for (let v = 0; v < vertexOwner.length; v++) {
          colorForMode(colorBy as ContinuousColorByMode, vertexOwner[v], parsed, colorByScope, colorScratch);
          vertexColors[v * 4] = colorScratch.r;
          vertexColors[v * 4 + 1] = colorScratch.g;
          vertexColors[v * 4 + 2] = colorScratch.b;
          vertexColors[v * 4 + 3] = 1;
        }
        // `updateVerticesData` une fois le tampon de couleurs déjà créé (bascules suivantes entre
        // modes continus) ; sinon `setVerticesData` le crée la première fois (premier passage en
        // mode continu pour ce maillage) — ni l'un ni l'autre ne retouche positions/indices/normales.
        if (entry.mesh.isVerticesDataPresent(BABYLON.VertexBuffer.ColorKind)) {
          entry.mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind, vertexColors);
        } else {
          entry.mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, vertexColors, true);
        }
      }
    };
    if (isColorByDeferred()) {
      deferredColorByRaf = requestAnimationFrame(() => { deferredColorByRaf = 0; run(); });
    } else {
      run();
    }
  };

  const disposeAll = () => {
    for (const entry of paths) entry.mesh?.dispose(false, false);
    for (const entry of markers) entry.mesh.dispose(false, true);
    offPlatePath?.mesh?.dispose(false, false);
    paths = [];
    markers = [];
    offPlatePath = null;
  };

  /** (Re)construit tous les maillages du calque pour `next`, avec la précision cartésienne
   * courante (`renderPrecisionMm`, ignorée en mode catégoriel — cf. createSampler). Utilisée par
   * `load()` (nouveau fichier) et `setRenderPrecision()` (même fichier, juste une géométrie plus
   * ou moins fine) — ne touche jamais `time`, laissé à l'appelant. */
  // Numéro de la construction en cours : une plus récente (nouveau fichier, autre précision)
  // annule la précédente à la prochaine tranche.
  let buildSeq = 0;

  const buildAll = async (next: ParsedGCode): Promise<void> => {
    const seq = ++buildSeq;
    const cancelled = () => seq !== buildSeq;
    disposeAll();
    pickBuildSeq++; // l'index de sélection de l'ancienne géométrie n'est plus valable
    pickGrid = null;
    pickHighlight?.setEnabled(false);
    parsed = next;
    const { moves } = next;
    const precisionMm = colorBy !== 'lineType' ? renderPrecisionMm : null;
    const pathSampler = await runSliced(createSampler(next, precisionMm), cancelled);
    if (!pathSampler) return;
    sampler = pathSampler;
    segments = pathSampler.segments;

    // Entrées accumulées localement et publiées d'un bloc en fin de construction : un setter
    // appelé entre deux tranches (visibilité, coloration) ne voit jamais un calque à moitié construit.
    const newPaths: typeof paths = [];
    const newMarkers: typeof markers = [];
    const abort = () => {
      for (const e of newPaths) e.mesh?.dispose(false, false);
      for (const e of newMarkers) e.mesh.dispose(false, true);
    };

    for (const t of LINE_TYPES) {
      if (t.kind !== 'extrusion') continue;
      const include = (k: number) => moves[k].type === t.id;
      const material = beadMaterials.get(t.id)!;
      const built = await runSliced(buildBeadMesh(`${GCODE_MESH_PREFIX}Bead_${t.id}`, next, pathSampler, include, material, scene), cancelled);
      if (!built) { abort(); return; }
      newPaths.push({ ...built, type: t.id, include, isExtrusion: true, categoryMaterial: material });
    }
    // Trajets à vide : tout mouvement sans dépôt hors essuyage (rétractions sur place comprises,
    // de longueur nulle).
    const travelInclude = (k: number) => !moves[k].extruding && moves[k].type !== 'wipe';
    const wipeInclude = (k: number) => moves[k].type === 'wipe';
    for (const [type, include] of [['travel', travelInclude], ['wipe', wipeInclude]] as const) {
      const built = await runSliced(buildPathMesh(`${GCODE_MESH_PREFIX}Path_${type}`, next, pathSampler, include, colors[type], scene), cancelled);
      if (!built) { abort(); return; }
      newPaths.push({ ...built, type, include, isExtrusion: false });
    }
    for (const [type, at] of Object.entries(next.markers) as [LineTypeId, Uint32Array][]) {
      const mesh = await runSliced(buildMarkerMesh(`${GCODE_MESH_PREFIX}Marker_${type}`, at, pathSampler, colors[type], scene), cancelled);
      if (cancelled()) { mesh?.dispose(false, true); abort(); return; }
      if (mesh) newMarkers.push({ type, mesh, at });
    }
    let newOffPlate: typeof offPlatePath = null;
    if (next.offPlate.moves.length) {
      const flags = new Uint8Array(moves.length);
      for (const k of next.offPlate.moves) flags[k] = 1;
      const include = (k: number) => flags[k] === 1;
      const built = await runSliced(buildBeadMesh(`${GCODE_MESH_PREFIX}OffPlate`, next, pathSampler, include, offPlateMat, scene), cancelled);
      if (!built) { abort(); return; }
      newOffPlate = { ...built, type: 'custom', include, isExtrusion: false };
      if (newOffPlate.mesh) {
        newOffPlate.mesh.parent = plateNode;
        // Un rechargement pendant un clignotement déjà en cours (rare) doit reconstruire avec le
        // bon matériau, pas retomber sur le rouge fixe de buildBeadMesh ci-dessus.
        if (blinkingOffPlate) newOffPlate.mesh.material = offPlateHazardMat;
      }
    }
    paths = newPaths;
    markers = newMarkers;
    offPlatePath = newOffPlate;
    for (const entry of [...paths, ...markers]) {
      if (entry.mesh) entry.mesh.parent = plateNode;
    }
    applyVisibility();
    applyColorBy();
    headNode.setEnabled(moves.length > 0);
    if (pickWanted) void buildPickIndex();
  };

  // ---------------------------------------------------------------------------------------------
  // Sélection d'un point de trajectoire. Un lancer de rayon Babylon parcourrait tous les triangles
  // de chaque maillage (des millions) à chaque survol : on indexe donc les segments extrudés dans
  // une grille 3D régulière (format CSR : `cellStart`/`items`), puis on ne parcourt que les
  // cellules traversées par le rayon. Construite par tranches, invalidée à chaque reconstruction.
  // ---------------------------------------------------------------------------------------------
  interface PickGrid {
    min: BABYLON.Vector3;
    cell: number;
    nx: number; ny: number; nz: number;
    cellStart: Uint32Array;
    items: Uint32Array;
    /** Dernière requête ayant testé le mouvement k (évite de le tester une fois par cellule). */
    seen: Uint32Array;
  }
  const PICK_CELL_MM = 3;
  const PICK_MAX_CELLS = 4_000_000;
  const PICK_PAD_MM = 0.6; // un segment est aussi inscrit dans les cellules voisines à moins de ça
  let pickGrid: PickGrid | null = null;
  let pickWanted = false;
  let pickBuildSeq = 0;
  let pickQuery = 0;
  const pickA = new BABYLON.Vector3();
  const pickB = new BABYLON.Vector3();

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

  const buildPickIndex = async () => {
    const seq = ++pickBuildSeq;
    pickGrid = null;
    if (!parsed || !sampler) return;
    const grid = await runSliced(buildPickGrid(parsed, sampler), () => seq !== pickBuildSeq || disposed);
    if (seq === pickBuildSeq && !disposed) pickGrid = grid;
  };

  let pickHighlight: BABYLON.Mesh | null = null;

  const pickAt = (ray: BABYLON.Ray, pxPerUnit: number) => {
    const grid = pickGrid;
    if (!grid || !parsed || !sampler) return null;
    const { moves } = parsed;
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

    const queryId = ++pickQuery;
    const tLimit = time;
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
        if (k - 1 > tLimit || !visibility[moves[k].type]) continue;
        const n = sampler.segments[k];
        sampler.tip(k, 0, pickA);
        for (let s = 1; s <= n; s++) {
          sampler.tip(k, s / n, pickB);
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
          const tol = radius + PICK_TOLERANCE_PX * pxPerUnit * uu;
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

  return {
    async load(next) {
      await buildAll(next);
      if (parsed !== next) return; // supplanté par un chargement plus récent
      time = next.moves.length - 1;
      apply();
    },
    setRenderPrecision(mm) {
      renderPrecisionMm = mm;
      if (!parsed || colorBy === 'lineType') return;
      const current = parsed;
      void buildAll(current).then(() => { if (parsed === current) apply(); });
    },
    setTime(t) {
      time = t;
      apply();
    },
    setLineTypeVisibility(next) {
      visibility = { ...next };
      applyVisibility();
    },
    setColorBy(mode, scope) {
      // Un réglage de précision cartésienne (renderPrecisionMm) change la géométrie elle-même
      // (plus de sous-segments par mouvement, cf. createSampler) SEULEMENT en mode continu — passer
      // de/vers `lineType` alors qu'une précision est déjà réglée doit donc reconstruire, pas
      // seulement recolorer, sans quoi le mode catégoriel hériterait de la géométrie subdivisée (ou
      // l'inverse) au lieu de celle qui lui correspond.
      const needsRebuild = renderPrecisionMm != null && (mode === 'lineType') !== (colorBy === 'lineType');
      colorBy = mode;
      if (scope) colorByScope = scope;
      else if (mode !== 'lineType' && parsed) colorByScope = defaultColorByScope(parsed.ranges[mode]);
      if (needsRebuild && parsed) {
        const current = parsed;
        void buildAll(current).then(() => { if (parsed === current) apply(); });
      } else {
        applyColorBy();
      }
    },
    setOffPlateHighlight(show) {
      highlightOffPlate = show;
      applyVisibility();
    },
    setOffPlateBlinking(blinking) {
      blinkingOffPlate = blinking;
      if (blinking && !offPlateBlinkObserver) {
        // Bascule vers le matériau « chantier » (bandes diagonales défilantes) tant que le
        // clignotement est actif ; jamais de trou (ni éteint ni immobile) — cf. demande d'origine
        // (« les laisser en rouge... mais les faire clignoter »), étendue à un motif qui se déplace
        // sur toute la surface visible plutôt qu'une simple pulsation de couleur uniforme.
        if (offPlatePath?.mesh) offPlatePath.mesh.material = offPlateHazardMat;
        offPlateBlinkStart = performance.now();
        offPlateBlinkObserver = scene.onBeforeRenderObservable.add(() => {
          const elapsed = (performance.now() - offPlateBlinkStart) / 1000;
          offPlateHazardMat.setFloat('time', elapsed * OFF_PLATE_HAZARD_SPEED);
        });
      } else if (!blinking && offPlateBlinkObserver) {
        scene.onBeforeRenderObservable.remove(offPlateBlinkObserver);
        offPlateBlinkObserver = null;
        if (offPlatePath?.mesh) offPlatePath.mesh.material = offPlateMat;
      }
    },
    setFullHead(show) {
      fullHead = show;
      applyHeadVisibility();
    },
    setPickingEnabled(enabled) {
      pickWanted = enabled;
      if (enabled) { if (!pickGrid) void buildPickIndex(); } else { pickBuildSeq++; pickGrid = null; }
    },
    pickAt,
    setPickHighlight(local) {
      if (!local) { pickHighlight?.setEnabled(false); return; }
      if (!pickHighlight) {
        pickHighlight = BABYLON.MeshBuilder.CreateSphere(`${GCODE_MESH_PREFIX}PickHighlight`, { diameter: 1.8, segments: 12 }, scene);
        const mat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}PickHighlightMat`, scene);
        mat.disableLighting = true;
        mat.emissiveColor = new BABYLON.Color3(0.0, 0.94, 1.0);
        mat.alpha = 0.9;
        mat.disableDepthWrite = true;
        pickHighlight.material = mat;
        pickHighlight.parent = plateNode;
        pickHighlight.isPickable = false;
        pickHighlight.renderingGroupId = 1; // par-dessus le tracé, même caché derrière une paroi
      }
      pickHighlight.position.copyFrom(local);
      pickHighlight.setEnabled(true);
    },
    setEnabled(enabled) {
      root.setEnabled(enabled);
    },
    getPlateRotation() {
      return plateNode.rotation.y;
    },
    dispose() {
      disposed = true;
      if (deferredColorByRaf) cancelAnimationFrame(deferredColorByRaf);
      if (offPlateBlinkObserver) scene.onBeforeRenderObservable.remove(offPlateBlinkObserver);
      disposeAll();
      root.dispose(false, true);
    },
  };
}
