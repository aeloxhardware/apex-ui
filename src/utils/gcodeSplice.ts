import type { GCodeMove, InsertedRange, ParsedGCode } from '@/components/gcodeParse';
import { EDIT_VALUES_PER_POINT, type EditInsertBlock } from '@/utils/editKernelClient';

/**
 * Insertion et retrait de mouvements dans un `ParsedGCode` en mémoire (re-tranchage, cf. CLAUDE.md) :
 * les blocs de points que le noyau insère dans la trajectoire (ou qu'une annulation retire) sont
 * répercutés sur tous les tableaux par mouvement, sans réécrire ni relire le texte du fichier. Les
 * mouvements insérés n'ont pas de ligne dans le texte d'origine (`lineIndex` = INSERTED_LINE) : le
 * rédacteur (gcodeWriter.ts) les écrit à partir de `parsed.insertedBlocks`.
 */

/** `lineIndex` d'un mouvement inséré par l'édition (aucune ligne du texte d'origine). */
export const INSERTED_LINE = 0xffffffff;

/** Déplacement à vide supposé pour la durée des mouvements insérés (mm/s ; F3600 dans le fichier, cf. gcodeWriter). */
const TRAVEL_MM_S = 3600 / 60;
/** Distance entre la pointe de buse et le pivot de B (mm), cf. NOZZLE_PIVOT_MM. */
const PIVOT_MM = 46;

interface Plan {
  n2: number;
  /** Plages d'anciens indices recopiées : [src0, src1) vers dst0. */
  runs: { src0: number; src1: number; dst0: number }[];
  /** Plages créées (insertion) : `count` éléments à dst0 ; `host` : ancien indice devant lequel elles entrent. */
  gaps: { dst0: number; count: number; host: number; block: number }[];
  /** Nouvel indice d'un ancien indice, -1 s'il est retiré. */
  map: (k: number) => number;
}

function planInsert(n: number, blocks: EditInsertBlock[]): Plan {
  const runs: Plan['runs'] = [];
  const gaps: Plan['gaps'] = [];
  const oldAt: number[] = [];
  const cumulative: number[] = [];
  let src = 0, added = 0;
  blocks.forEach((b, i) => {
    const count = b.extruding.length;
    const old = b.at - added;
    if (old > src) runs.push({ src0: src, src1: old, dst0: src + added });
    gaps.push({ dst0: b.at, count, host: Math.min(old, n - 1), block: i });
    oldAt.push(old);
    added += count;
    cumulative.push(added);
    src = old;
  });
  if (n > src) runs.push({ src0: src, src1: n, dst0: src + added });
  return {
    n2: n + added,
    runs,
    gaps,
    map: (k) => {
      let lo = 0, hi = oldAt.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (oldAt[mid] <= k) lo = mid + 1; else hi = mid;
      }
      return k + (lo ? cumulative[lo - 1] : 0);
    },
  };
}

function planRemove(n: number, ranges: InsertedRange[]): Plan {
  const runs: Plan['runs'] = [];
  const starts: number[] = [];
  const cumulative: number[] = [];
  let src = 0, removed = 0;
  for (const b of ranges) {
    if (b.at > src) runs.push({ src0: src, src1: b.at, dst0: src - removed });
    removed += b.count;
    starts.push(b.at);
    cumulative.push(removed);
    src = b.at + b.count;
  }
  if (n > src) runs.push({ src0: src, src1: n, dst0: src - removed });
  return {
    n2: n - removed,
    runs,
    gaps: [],
    map: (k) => {
      let lo = 0, hi = starts.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= k) lo = mid + 1; else hi = mid;
      }
      if (lo > 0 && k < starts[lo - 1] + ranges[lo - 1].count) return -1;
      return k - (lo ? cumulative[lo - 1] : 0);
    },
  };
}

type Typed = Float64Array | Float32Array | Uint32Array | Uint8Array;

/** Copie `src` selon le plan ; les plages créées prennent la valeur de leur hôte, ou `constant` si donnée. */
function reshape<T extends Typed>(src: T, plan: Plan, constant?: number): T {
  const Ctor = src.constructor as new (length: number) => T;
  const dst = new Ctor(plan.n2);
  for (const r of plan.runs) dst.set(src.subarray(r.src0, r.src1), r.dst0);
  for (const g of plan.gaps) dst.fill(constant === undefined ? src[g.host] : constant, g.dst0, g.dst0 + g.count);
  return dst;
}

function remapList(list: Uint32Array, plan: Plan): Uint32Array {
  const out: number[] = [];
  for (const k of list) {
    const m = plan.map(k);
    if (m >= 0) out.push(m);
  }
  return Uint32Array.from(out);
}

function remapSet(set: Set<number> | undefined, plan: Plan): Set<number> | undefined {
  if (!set) return set;
  const out = new Set<number>();
  for (const k of set) {
    const m = plan.map(k);
    if (m >= 0) out.add(m);
  }
  return out;
}

/** Nouvel indice d'un mouvement après l'insertion (ou après le retrait) des blocs ; -1 s'il est retiré. */
export function remapMoveIndex(k: number, blocks: EditInsertBlock[], inserted: boolean, length: number): number {
  const plan = inserted
    ? planInsert(length, blocks)
    : planRemove(length, blocks.map((b) => ({ at: b.at, count: b.extruding.length })));
  return plan.map(k);
}

/** Réorganise tous les tableaux par mouvement selon le plan ; `made` fournit les mouvements créés. */
function applyPlan(parsed: ParsedGCode, plan: Plan, made?: (gap: Plan['gaps'][number]) => GCodeMove[]) {
  const moves = new Array<GCodeMove>(plan.n2);
  for (const r of plan.runs) for (let k = r.src0; k < r.src1; k++) moves[r.dst0 + k - r.src0] = parsed.moves[k];
  if (made) {
    for (const g of plan.gaps) {
      const list = made(g);
      for (let i = 0; i < g.count; i++) moves[g.dst0 + i] = list[i];
    }
  }
  parsed.moves = moves;
  parsed.speedMmS = reshape(parsed.speedMmS, plan);
  parsed.accelMmS2 = reshape(parsed.accelMmS2, plan);
  parsed.nozzleTempC = reshape(parsed.nozzleTempC, plan);
  parsed.bedTempC = reshape(parsed.bedTempC, plan);
  parsed.fanPct = reshape(parsed.fanPct, plan);
  parsed.layerHeightMm = reshape(parsed.layerHeightMm, plan);
  parsed.widthMm = reshape(parsed.widthMm, plan);
  parsed.layerIndex = reshape(parsed.layerIndex, plan);
  parsed.layerMaxSpeedMmS = reshape(parsed.layerMaxSpeedMmS, plan);
  parsed.eRelative = reshape(parsed.eRelative, plan);
  parsed.segLengthMm = reshape(parsed.segLengthMm, plan, 0);
  parsed.depositMm = reshape(parsed.depositMm, plan, 0);
  parsed.lineIndex = reshape(parsed.lineIndex, plan, INSERTED_LINE);
  parsed.eDelta = reshape(parsed.eDelta, plan, 0);
  parsed.eAbsBefore = reshape(parsed.eAbsBefore, plan, NaN);
  parsed.hasEWord = reshape(parsed.hasEWord, plan, 0);
  parsed.markers = {
    retraction: remapList(parsed.markers.retraction, plan),
    unretraction: remapList(parsed.markers.unretraction, plan),
    seam: remapList(parsed.markers.seam, plan),
  };
  parsed.offPlate = { ...parsed.offPlate, moves: remapList(parsed.offPlate.moves, plan) };
  parsed.editedMoves = remapSet(parsed.editedMoves, plan);
  parsed.trimmedMoves = remapSet(parsed.trimmedMoves, plan);
}

/** Longueur (mm) parcourue par la pointe entre deux mouvements polaires (même formule que gcodeParse.moveLength). */
function polarLength(a: GCodeMove, b: GCodeMove) {
  const rad = Math.PI / 180;
  const ar = a.x - PIVOT_MM * Math.sin(a.b * rad), az = a.z + PIVOT_MM * (1 - Math.cos(a.b * rad));
  const br = b.x - PIVOT_MM * Math.sin(b.b * rad), bz = b.z + PIVOT_MM * (1 - Math.cos(b.b * rad));
  const arc = ((Math.abs(ar) + Math.abs(br)) / 2) * (b.y - a.y) * rad;
  return Math.hypot(br - ar, bz - az, arc);
}

/**
 * Insère les blocs du noyau dans `parsed` (positions `at` dans l'état avec les blocs, croissantes). Les
 * mouvements créés prennent le type, la vitesse, la température et le ventilateur de celui devant lequel
 * ils entrent ; les déplacements à vide insérés vont à 60 mm/s.
 */
export function insertMoves(parsed: ParsedGCode, blocks: EditInsertBlock[]): void {
  if (blocks.length === 0) return;
  const plan = planInsert(parsed.moves.length, blocks);
  const oldTimes = parsed.times;
  const hostType = parsed.moves.map((m) => m.type);
  applyPlan(parsed, plan, (g) => {
    const b = blocks[g.block];
    const out: GCodeMove[] = [];
    for (let i = 0; i < g.count; i++) {
      const v = b.values.subarray(EDIT_VALUES_PER_POINT * i, EDIT_VALUES_PER_POINT * (i + 1));
      out.push({ x: v[0], y: v[1], z: v[2], b: v[3], c: 0, extruding: b.extruding[i] === 1, type: hostType[g.host] });
    }
    return out;
  });

  // Mouvements créés : longueur, vitesse, E ; temps machine cumulé, décalé pour tout ce qui suit.
  const times = new Float64Array(plan.n2);
  const segments: { dst0: number; run?: Plan['runs'][number]; gap?: Plan['gaps'][number] }[] = [
    ...plan.runs.map((run) => ({ dst0: run.dst0, run })),
    ...plan.gaps.map((gap) => ({ dst0: gap.dst0, gap })),
  ].sort((x, y) => x.dst0 - y.dst0);
  let added = 0;
  for (const seg of segments) {
    if (seg.run) {
      const r = seg.run;
      for (let k = r.src0; k < r.src1; k++) times[r.dst0 + k - r.src0] = oldTimes[k] + added;
      continue;
    }
    const gap = seg.gap!;
    const b = blocks[gap.block];
    const t0 = gap.dst0 > 0 ? times[gap.dst0 - 1] : 0;
    let t = t0;
    for (let i = 0; i < gap.count; i++) {
      const k = gap.dst0 + i;
      const printing = b.extruding[i] === 1;
      const len = k > 0 ? polarLength(parsed.moves[k - 1], parsed.moves[k]) : 0;
      // Vitesse recopiée de l'hôte par `applyPlan` : un dépôt garde celle de la passe, un déplacement va à 60 mm/s.
      const speed = printing ? Math.max(parsed.speedMmS[k] || TRAVEL_MM_S, 1) : TRAVEL_MM_S;
      const e = b.values[EDIT_VALUES_PER_POINT * i + 4];
      parsed.segLengthMm[k] = len;
      parsed.speedMmS[k] = speed;
      parsed.eDelta[k] = printing ? e : 0;
      parsed.depositMm[k] = printing ? e : 0;
      parsed.hasEWord[k] = printing ? 1 : 0;
      t += Math.max(len / speed, 1e-3);
      times[k] = t;
    }
    added += t - t0;
  }
  parsed.times = times;
  const known = (parsed.insertedBlocks ?? []).map((r) => ({ at: plan.map(r.at), count: r.count }));
  const fresh = blocks.map((b) => ({ at: b.at, count: b.extruding.length }));
  parsed.insertedBlocks = [...known, ...fresh].sort((x, y) => x.at - y.at);
  parsed.extrudingCount += blocks.reduce((sum, b) => sum + b.extruding.reduce((s, v) => s + v, 0), 0);
}

/** Retire les blocs de `parsed` (positions `at` et nombre de points, dans l'état avec les blocs). */
export function removeMoves(parsed: ParsedGCode, blocks: EditInsertBlock[]): void {
  if (blocks.length === 0) return;
  const ranges = blocks.map((b) => ({ at: b.at, count: b.extruding.length }));
  const plan = planRemove(parsed.moves.length, ranges);
  const oldTimes = parsed.times;
  const oldInserted = parsed.insertedBlocks ?? [];
  let removedExtruding = 0;
  for (const r of ranges) for (let k = r.at; k < r.at + r.count; k++) if (parsed.moves[k]?.extruding) removedExtruding++;
  applyPlan(parsed, plan);
  // Temps : la durée des plages retirées est soustraite à tout ce qui suit.
  const times = new Float64Array(plan.n2);
  let removed = 0, g = 0;
  for (const r of plan.runs) {
    while (g < ranges.length && ranges[g].at < r.src0) {
      const rg = ranges[g++];
      removed += oldTimes[rg.at + rg.count - 1] - (rg.at > 0 ? oldTimes[rg.at - 1] : 0);
    }
    for (let k = r.src0; k < r.src1; k++) times[r.dst0 + k - r.src0] = oldTimes[k] - removed;
  }
  parsed.times = times;
  parsed.insertedBlocks = oldInserted
    .filter((r) => !ranges.some((x) => x.at === r.at && x.count === r.count))
    .map((r) => ({ at: plan.map(r.at), count: r.count }));
  parsed.extrudingCount -= removedExtruding;
}
