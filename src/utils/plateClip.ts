// Coupe d'un maillage au plan du plateau (cf. plateStl.ts). Chaque triangle est découpé (Sutherland-Hodgman) en
// gardant ce qui est au-dessus ; les segments créés sur le plan, orientés comme le triangle, forment les bords de la
// section. Ils sont chaînés en boucles, puis la section est triangulée (découpage en oreilles, trous reliés à leur
// contour) en parcourant les boucles à l'envers des bords : le résultat reste un solide fermé, quelle que soit
// l'orientation globale des triangles.

type P3 = [number, number, number];
type P2 = [number, number];

/** Point de l'arête a-b sur le plan z = zc ; extrémités ordonnées pour que deux triangles voisins retombent sur les mêmes bits. */
function cutPoint(a: P3, b: P3, zc: number): P3 {
  const swap = a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));
  const [p, q] = swap ? [b, a] : [a, b];
  const t = (zc - p[2]) / (q[2] - p[2]);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, zc];
}

/** `tris` : x y z des trois sommets de chaque triangle, à la suite. Renvoie la partie à z >= zc, section rebouchée. */
export function clipAbovePlane(tris: number[], zc: number): number[] {
  const out: number[] = [];
  const segments: [P3, P3][] = [];
  const pushTri = (a: P3, b: P3, c: P3) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    if (Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) < 1e-9) return;
    out.push(...a, ...b, ...c);
  };
  for (let t = 0; t < tris.length; t += 9) {
    const v: P3[] = [
      [tris[t], tris[t + 1], tris[t + 2]],
      [tris[t + 3], tris[t + 4], tris[t + 5]],
      [tris[t + 6], tris[t + 7], tris[t + 8]],
    ];
    const above = v.map((p) => p[2] >= zc);
    if (above[0] && above[1] && above[2]) {
      for (let k = 0; k < 9; k++) out.push(tris[t + k]);
      continue;
    }
    if (!above[0] && !above[1] && !above[2]) continue;
    const poly: P3[] = [];
    let exit: P3 | null = null;
    let entry: P3 | null = null;
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3];
      if (above[i]) poly.push(a);
      if (above[i] !== above[(i + 1) % 3]) {
        const x = cutPoint(a, b, zc);
        poly.push(x);
        if (above[i]) exit = x; else entry = x;
      }
    }
    for (let i = 1; i + 1 < poly.length; i++) pushTri(poly[0], poly[i], poly[i + 1]);
    if (exit && entry && (exit[0] !== entry[0] || exit[1] !== entry[1])) segments.push([exit, entry]);
  }
  for (const [a, b, c] of capTriangles(segments, zc)) out.push(...a, ...b, ...c);
  return out;
}

const keyOf = (p: P3) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;

const areaOf = (ring: P2[]) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

/** Boucles fermées formées par les segments de coupe ; une chaîne qui ne se referme pas (maillage ouvert) est ignorée. */
function chainLoops(segments: [P3, P3][]): P3[][] {
  const byStart = new Map<string, number[]>();
  segments.forEach((s, i) => {
    const k = keyOf(s[0]);
    const list = byStart.get(k);
    if (list) list.push(i); else byStart.set(k, [i]);
  });
  const used = new Array<boolean>(segments.length).fill(false);
  const loops: P3[][] = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const loop: P3[] = [segments[i][0]];
    const startKey = keyOf(segments[i][0]);
    let end = segments[i][1];
    let closed = true;
    while (keyOf(end) !== startKey) {
      const next = byStart.get(keyOf(end))?.find((j) => !used[j]);
      if (next === undefined) { closed = false; break; }
      used[next] = true;
      loop.push(segments[next][0]);
      end = segments[next][1];
    }
    if (closed && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function pointInRing(p: P2, ring: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function capTriangles(segments: [P3, P3][], zc: number): [P3, P3, P3][] {
  if (segments.length === 0) return [];
  // Sens inverse des bords du solide : chaque arête de la section est parcourue à l'opposé de celle du maillage.
  const rings = chainLoops(segments).map((loop) => loop.reverse());
  if (rings.length === 0) return [];
  const areas = rings.map((r) => areaOf(r.map((p): P2 => [p[0], p[1]])));
  let biggest = 0;
  areas.forEach((a, i) => { if (Math.abs(a) > Math.abs(areas[biggest])) biggest = i; });
  const dominant = Math.sign(areas[biggest]) || 1;
  // Espace de travail où les contours extérieurs sont anti-horaires et les trous horaires.
  const flat = rings.map((r) => r.map((p): P2 => [p[0] * dominant, p[1]]));
  const outers: number[] = [];
  const holes: number[] = [];
  areas.forEach((a, i) => (Math.sign(a) === dominant ? outers : holes).push(i));
  const holesOf = new Map<number, number[]>(outers.map((o) => [o, []]));
  for (const h of holes) {
    let owner = -1;
    for (const o of outers) {
      if (pointInRing(flat[h][0], flat[o]) && (owner < 0 || Math.abs(areas[o]) < Math.abs(areas[owner]))) owner = o;
    }
    if (owner >= 0) holesOf.get(owner)!.push(h);
  }
  const result: [P3, P3, P3][] = [];
  for (const o of outers) {
    const pts: P2[] = [...flat[o]];
    const originals: P3[] = [...rings[o]];
    const outerRing = flat[o].map((_, i) => i);
    const holeRings = (holesOf.get(o) ?? []).map((h) => {
      const base = pts.length;
      flat[h].forEach((p, i) => { pts.push(p); originals.push(rings[h][i]); });
      return flat[h].map((_, i) => base + i);
    });
    for (const [a, b, c] of earClip(pts, joinHoles(pts, outerRing, holeRings))) {
      result.push([
        [originals[a][0], originals[a][1], zc],
        [originals[b][0], originals[b][1], zc],
        [originals[c][0], originals[c][1], zc],
      ]);
    }
  }
  return result;
}

const cross2 = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same2 = (a: P2, b: P2) => a[0] === b[0] && a[1] === b[1];

/** Vrai si les segments ab et cd se croisent franchement (un point commun en bout ne compte pas). */
function crosses(a: P2, b: P2, c: P2, d: P2): boolean {
  if (same2(a, c) || same2(a, d) || same2(b, c) || same2(b, d)) return false;
  return cross2(a, b, c) * cross2(a, b, d) < 0 && cross2(c, d, a) * cross2(c, d, b) < 0;
}

/** Relie chaque trou au contour par un pont (du plus à droite au plus à gauche) : un seul polygone, sommets de pont répétés. */
function joinHoles(pts: P2[], outer: number[], holes: number[][]): number[] {
  let ring = outer.slice();
  const order = holes
    .map((h) => ({ h, maxX: Math.max(...h.map((i) => pts[i][0])) }))
    .sort((a, b) => b.maxX - a.maxX);
  for (const { h } of order) {
    let mi = 0;
    h.forEach((idx, k) => { if (pts[idx][0] > pts[h[mi]][0]) mi = k; });
    const m = pts[h[mi]];
    const edges: [P2, P2][] = [];
    for (const r of [ring, ...holes]) for (let i = 0; i < r.length; i++) edges.push([pts[r[i]], pts[r[(i + 1) % r.length]]]);
    const candidates = ring
      .map((idx, pos) => ({ pos, d: Math.hypot(pts[idx][0] - m[0], pts[idx][1] - m[1]) }))
      .sort((a, b) => a.d - b.d);
    const visible = candidates.find(({ pos }) => edges.every(([c, d]) => !crosses(m, pts[ring[pos]], c, d))) ?? candidates[0];
    const rotated = h.slice(mi).concat(h.slice(0, mi));
    ring = [...ring.slice(0, visible.pos + 1), ...rotated, rotated[0], ring[visible.pos], ...ring.slice(visible.pos + 1)];
  }
  return ring;
}

/** Découpage en oreilles d'un polygone anti-horaire (sommets éventuellement répétés par les ponts). */
function earClip(pts: P2[], ring: number[]): [number, number, number][] {
  const idx = ring.slice();
  const result: [number, number, number][] = [];
  const inside = (p: P2, a: P2, b: P2, c: P2) => cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;
  let i = 0;
  let misses = 0;
  while (idx.length > 3) {
    const n = idx.length;
    i %= n;
    const ia = idx[(i + n - 1) % n], ib = idx[i], ic = idx[(i + 1) % n];
    const a = pts[ia], b = pts[ib], c = pts[ic];
    let ear = cross2(a, b, c) > 1e-12;
    if (ear) {
      for (const k of idx) {
        const p = pts[k];
        if (same2(p, a) || same2(p, b) || same2(p, c)) continue;
        if (inside(p, a, b, c)) { ear = false; break; }
      }
    }
    if (ear || misses > n) {
      if (ear) result.push([ia, ib, ic]);
      idx.splice(i, 1);
      misses = 0;
    } else {
      i++;
      misses++;
    }
  }
  if (idx.length === 3 && cross2(pts[idx[0]], pts[idx[1]], pts[idx[2]]) > 1e-12) result.push([idx[0], idx[1], idx[2]]);
  return result;
}
