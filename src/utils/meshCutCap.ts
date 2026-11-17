// Rebouchage de la section d'une coupe (meshCut.ts) : logique pure, sans Babylon.
//
// Les segments laissés par les triangles traversés sont raccordés en contours fermés, projetés dans le plan, puis
// triangulés par oreilles, les trous (pièce creuse, tube…) étant d'abord reliés à leur contour extérieur par un pont.
// Le contour de plus grande aire est forcément extérieur : son sens de parcours donne celui de tous les extérieurs (les
// trous tournent dans l'autre sens) et l'orientation des faces du maillage, que la section reprend.
/** Point ou vecteur de l'espace (repère de la scène). */
export type Vec3 = readonly [number, number, number];

export type Segment = [Vec3, Vec3];

/** Point d'un contour : position dans le plan (u, v) et dans l'espace. */
interface P {
  u: number;
  v: number;
  p: Vec3;
}

export interface Cap {
  /** Section du morceau haut (9 nombres par triangle). */
  upperFace: number[];
  /** Section du morceau bas : mêmes triangles, sens inverse. */
  lowerFace: number[];
  openLoops: number;
}

/** Clé de raccord : les extrémités communes sont identiques au bit près (meshCut.ts), l'arrondi n'est qu'une sécurité. */
const key = (p: Vec3): string => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;

/** Raccorde les segments bout à bout en contours ; un contour qui ne se referme pas est compté et écarté. */
function chainLoops(segments: readonly Segment[]): { loops: Vec3[][]; open: number } {
  const usable = segments.filter(([a, b]) => key(a) !== key(b));
  const byStart = new Map<string, number[]>();
  usable.forEach(([a], i) => byStart.set(key(a), [...(byStart.get(key(a)) ?? []), i]));
  const used = new Uint8Array(usable.length);
  const loops: Vec3[][] = [];
  let open = 0;
  // Les chaînes ouvertes sont parcourues depuis leur tête (aucun segment n'y arrive) : chacune n'est comptée qu'une fois.
  const ends = new Set(usable.map(([, b]) => key(b)));
  const heads = usable.map((_, i) => i).filter((i) => !ends.has(key(usable[i]?.[0] ?? [0, 0, 0])));
  for (const first of [...heads, ...usable.keys()]) {
    if (used[first]) continue;
    const loop = walk(usable, byStart, used, first);
    if (loop) loops.push(loop);
    else open++;
  }
  return { loops, open };
}

function walk(segments: readonly Segment[], byStart: Map<string, number[]>, used: Uint8Array, first: number): Vec3[] | null {
  const startKey = key(segments[first]?.[0] ?? [0, 0, 0]);
  const loop: Vec3[] = [];
  for (let cur: number | undefined = first; cur !== undefined; ) {
    const seg: Segment | undefined = segments[cur];
    if (!seg) return null;
    used[cur] = 1;
    loop.push(seg[0]);
    const endKey = key(seg[1]);
    if (endKey === startKey) return loop.length >= 3 ? loop : null;
    cur = byStart.get(endKey)?.find((i) => !used[i]);
  }
  return null;
}

// --- Géométrie plane -------------------------------------------------------------------------------

const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Base (u, v) du plan telle que u × v = n : un parcours positif dans (u, v) tourne autour de n. */
function planeBasis(n: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross3(helper, n));
  return [u, cross3(n, u)];
}

const area = (poly: readonly P[]): number =>
  poly.reduce((acc, a, i) => {
    const b = poly[(i + 1) % poly.length] ?? a;
    return acc + a.u * b.v - b.u * a.v;
  }, 0) / 2;

const orient = (a: P, b: P, c: P): number => (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);

const same = (a: P, b: P): boolean => a.u === b.u && a.v === b.v;

function insidePoly(pt: { u: number; v: number }, poly: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a.v > pt.v !== b.v > pt.v && pt.u < ((b.u - a.u) * (pt.v - a.v)) / (b.v - a.v) + a.u) inside = !inside;
  }
  return inside;
}

/** Croisement franc des segments [a, b] et [c, d] (un bout commun ne compte pas). */
function crosses(a: P, b: P, c: P, d: P): boolean {
  if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) return false;
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

// --- Trous ------------------------------------------------------------------------------------------

interface Region {
  outer: P[];
  holes: P[][];
}

function bridgeIsClear(a: P, b: P, region: Region, merged: readonly P[]): boolean {
  for (const loop of [merged, ...region.holes]) {
    for (let i = 0; i < loop.length; i++) {
      const c = loop[i];
      const d = loop[(i + 1) % loop.length];
      if (c && d && crosses(a, b, c, d)) return false;
    }
  }
  const mid = { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 };
  return insidePoly(mid, region.outer) && !region.holes.some((h) => insidePoly(mid, h));
}

/** Relie le trou au contour par le pont dégagé le plus court partant de son point le plus à droite. */
function bridgeHole(merged: P[], hole: P[], region: Region): P[] {
  const m = hole.reduce((best, p, i) => (p.u > (hole[best]?.u ?? -Infinity) ? i : best), 0);
  const M = hole[m];
  if (!M) return merged;
  const order = merged.map((_, i) => i).sort((i, j) => dist2(merged[i], M) - dist2(merged[j], M));
  const at = order.find((i) => {
    const o = merged[i];
    return o !== undefined && bridgeIsClear(o, M, region, merged);
  });
  if (at === undefined) return merged;
  const o = merged[at];
  if (!o) return merged;
  const ring = [...hole.slice(m), ...hole.slice(0, m), M];
  return [...merged.slice(0, at + 1), ...ring, o, ...merged.slice(at + 1)];
}

const dist2 = (a: P | undefined, b: P): number => (a ? (a.u - b.u) ** 2 + (a.v - b.v) ** 2 : Infinity);

// --- Oreilles ---------------------------------------------------------------------------------------

function isEar(pts: readonly P[], idx: readonly number[], at: number): boolean {
  const n = idx.length;
  const a = pts[idx[(at + n - 1) % n] ?? 0];
  const b = pts[idx[at] ?? 0];
  const c = pts[idx[(at + 1) % n] ?? 0];
  if (!a || !b || !c || orient(a, b, c) <= 0) return false;
  return idx.every((k) => {
    const p = pts[k];
    if (!p || same(p, a) || same(p, b) || same(p, c)) return true;
    return !(orient(a, b, p) >= 0 && orient(b, c, p) >= 0 && orient(c, a, p) >= 0);
  });
}

/** Sommet `at` de la liste et ses deux voisins. */
function cornerAt(idx: readonly number[], at: number): [number, number, number] {
  const n = idx.length;
  return [idx[(at + n - 1) % n] as number, idx[at] as number, idx[(at + 1) % n] as number];
}

/** Triangule un polygone parcouru dans le sens positif ; renvoie des triplets d'indices. */
function earClip(pts: readonly P[]): [number, number, number][] {
  const idx = pts.map((_, i) => i);
  const tris: [number, number, number][] = [];
  let at = 0;
  let misses = 0;
  while (idx.length > 3) {
    at %= idx.length;
    const n = idx.length;
    if (isEar(pts, idx, at) || misses >= n) {
      // Sans oreille après un tour complet (polygone dégénéré), on coupe quand même : la boucle se termine toujours.
      tris.push(cornerAt(idx, at));
      idx.splice(at, 1);
      misses = 0;
    } else {
      at++;
      misses++;
    }
  }
  if (idx.length === 3) tris.push(cornerAt(idx, 1));
  return tris;
}

// --- Assemblage -------------------------------------------------------------------------------------

/** Contours projetés et rangés en régions (extérieur + ses trous), tous ramenés au sens positif pour l'extérieur. */
function regions(loops: Vec3[][], n: Vec3): { regions: Region[]; sign: number } {
  const [u, v] = planeBasis(n);
  const polys = loops.map((l) => l.map((p) => ({ u: dot3(p, u), v: dot3(p, v), p })));
  const areas = polys.map(area);
  const biggest = areas.reduce((best, a, i) => (Math.abs(a) > Math.abs(areas[best] ?? 0) ? i : best), 0);
  const sign = Math.sign(areas[biggest] ?? 0) || 1;
  const outers: { poly: P[]; area: number }[] = [];
  const holes: P[][] = [];
  polys.forEach((poly, i) => {
    const a = (areas[i] ?? 0) * sign;
    const oriented = sign > 0 ? poly : [...poly].reverse();
    if (a > 0) outers.push({ poly: oriented, area: a });
    else if (a < 0) holes.push(oriented);
  });
  outers.sort((x, y) => x.area - y.area);
  const out: Region[] = outers.map((o) => ({ outer: o.poly, holes: [] }));
  for (const hole of holes) {
    const owner = out.find((r) => hole[0] && insidePoly(hole[0], r.outer));
    owner?.holes.push(hole);
  }
  return { regions: out, sign };
}

function triangulateRegion(region: Region, face: number[]) {
  const holes = [...region.holes].sort((a, b) => maxU(b) - maxU(a));
  let merged = region.outer;
  holes.forEach((hole, i) => {
    merged = bridgeHole(merged, hole, { outer: region.outer, holes: holes.slice(i) });
  });
  for (const [a, b, c] of earClip(merged)) {
    for (const k of [a, b, c]) {
      const p = merged[k]?.p ?? [0, 0, 0];
      face.push(p[0], p[1], p[2]);
    }
  }
}

const maxU = (poly: readonly P[]): number => poly.reduce((m, p) => Math.max(m, p.u), -Infinity);

/** Retourne chaque triangle (sens inverse). */
function flipped(face: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 8 < face.length; i += 9) {
    out.push(...face.slice(i, i + 3), ...face.slice(i + 6, i + 9), ...face.slice(i + 3, i + 6));
  }
  return out;
}

/**
 * Section bouchée à partir des segments de coupe (orientés comme le bord du morceau haut). Triangulée dans le sens positif
 * de la base du plan, elle regarde vers +n : c'est la face du morceau bas ; le morceau haut reçoit la même, retournée. Si le
 * maillage est orienté dans l'autre sens (sign < 0), les deux sont échangées pour rester cohérentes avec lui.
 */
export function capFromSegments(segments: readonly Segment[], n: Vec3): Cap {
  const { loops, open } = chainLoops(segments);
  if (loops.length === 0) return { upperFace: [], lowerFace: [], openLoops: open };
  const { regions: list, sign } = regions(loops, unit(n));
  const face: number[] = [];
  list.forEach((r) => triangulateRegion(r, face));
  const back = flipped(face);
  return sign > 0 ? { upperFace: back, lowerFace: face, openLoops: open } : { upperFace: face, lowerFace: back, openLoops: open };
}
