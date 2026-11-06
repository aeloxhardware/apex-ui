// Arêtes « franches » d'un maillage triangulé (sans Babylon) : sert à la sélection d'arêtes du
// viewport. Une arête est franche si elle borde une seule face, plus de deux, ou deux faces dont
// les normales forment plus de 25° ; les arêtes franches se chaînent tant que le tracé ne tourne
// pas de plus de 35° et qu'aucun autre trait n'y aboutit (un côté droit ou un cercle tessellé est
// UNE arête).

const FEATURE_COS = Math.cos((25 * Math.PI) / 180);
const CHAIN_COS = Math.cos((35 * Math.PI) / 180);
/** Au-delà, le calcul serait trop long à chaque sélection : le maillage n'offre pas d'arêtes. */
export const MAX_FEATURE_INDICES = 450000;

type Vec = [number, number, number];
interface TriEdge { a: number; b: number; n: Vec; n2: Vec | null; faces: number }
interface Welded { coords: number[]; remap: Int32Array }

/** Soudure des sommets confondus (les maillages à faces indépendantes dupliquent leurs sommets). */
function weldVertices(positions: ArrayLike<number>, quantum: number): Welded {
  const welded = new Map<string, number>();
  const remap = new Int32Array(positions.length / 3);
  const coords: number[] = [];
  for (let i = 0; i < remap.length; i += 1) {
    const x = positions[i * 3]; const y = positions[i * 3 + 1]; const z = positions[i * 3 + 2];
    const k = `${Math.round(x / quantum)},${Math.round(y / quantum)},${Math.round(z / quantum)}`;
    let id = welded.get(k);
    if (id === undefined) { id = coords.length / 3; welded.set(k, id); coords.push(x, y, z); }
    remap[i] = id;
  }
  return { coords, remap };
}

/** Arêtes du maillage soudé, chacune avec la normale de ses (au plus deux premières) faces. */
function collectTriangleEdges(indices: ArrayLike<number>, { coords, remap }: Welded): Map<number, TriEdge> {
  const count = coords.length / 3;
  const edges = new Map<number, TriEdge>();
  const addEdge = (u: number, v: number, n: Vec) => {
    const a = Math.min(u, v); const b = Math.max(u, v);
    const key = a * count + b;
    const e = edges.get(key);
    if (!e) edges.set(key, { a, b, n, n2: null, faces: 1 });
    else { e.faces += 1; if (!e.n2) e.n2 = n; }
  };
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const i0 = remap[indices[t]]; const i1 = remap[indices[t + 1]]; const i2 = remap[indices[t + 2]];
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    const ux = coords[i1 * 3] - coords[i0 * 3]; const uy = coords[i1 * 3 + 1] - coords[i0 * 3 + 1]; const uz = coords[i1 * 3 + 2] - coords[i0 * 3 + 2];
    const vx = coords[i2 * 3] - coords[i0 * 3]; const vy = coords[i2 * 3 + 1] - coords[i0 * 3 + 1]; const vz = coords[i2 * 3 + 2] - coords[i0 * 3 + 2];
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-18) continue;
    nx /= len; ny /= len; nz /= len;
    const n: Vec = [nx, ny, nz];
    addEdge(i0, i1, n); addEdge(i1, i2, n); addEdge(i2, i0, n);
  }
  return edges;
}

function isSharp(e: TriEdge): boolean {
  return e.faces !== 2 || !e.n2
    || Math.abs(e.n[0] * e.n2[0] + e.n[1] * e.n2[1] + e.n[2] * e.n2[2]) < FEATURE_COS;
}

/** Chaîne les arêtes franches en polylignes d'indices de sommets soudés. */
function chainEdges(feature: TriEdge[], coords: number[]): number[][] {
  const adjacency = new Map<number, number[]>();
  feature.forEach((e, i) => {
    [e.a, e.b].forEach((v) => { const l = adjacency.get(v); if (l) l.push(i); else adjacency.set(v, [i]); });
  });
  const dirOf = (u: number, v: number): Vec => {
    const dx = coords[v * 3] - coords[u * 3]; const dy = coords[v * 3 + 1] - coords[u * 3 + 1]; const dz = coords[v * 3 + 2] - coords[u * 3 + 2];
    const l = Math.hypot(dx, dy, dz) || 1;
    return [dx / l, dy / l, dz / l];
  };
  const used = new Uint8Array(feature.length);
  const chains: number[][] = [];
  for (let s = 0; s < feature.length; s += 1) {
    if (used[s]) continue;
    used[s] = 1;
    const pts = [feature[s].a, feature[s].b];
    const extend = (forward: boolean) => {
      for (;;) {
        const tip = forward ? pts[pts.length - 1] : pts[0];
        const prev = forward ? pts[pts.length - 2] : pts[1];
        const start = forward ? pts[0] : pts[pts.length - 1];
        const list = adjacency.get(tip);
        if (!list || list.length !== 2) return;
        const next = list.find((i) => !used[i]);
        if (next === undefined) return;
        const e = feature[next];
        const other = e.a === tip ? e.b : e.a;
        const d1 = dirOf(prev, tip); const d2 = dirOf(tip, other);
        if (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2] < CHAIN_COS) return;
        used[next] = 1;
        if (forward) pts.push(other); else pts.unshift(other);
        if (other === start) return;
      }
    };
    extend(true);
    extend(false);
    chains.push(pts);
  }
  return chains;
}

/**
 * Polylignes des arêtes franches, en coordonnées locales aplaties (x, y, z, x, y, z, …).
 * `radius` : rayon de la sphère englobante, qui fixe la tolérance de soudure des sommets.
 */
export function extractFeatureChains(
  positions: ArrayLike<number> | null | undefined,
  indices: ArrayLike<number> | null | undefined,
  radius: number,
): number[][] {
  if (!positions || !indices || indices.length === 0 || indices.length > MAX_FEATURE_INDICES) return [];
  const welded = weldVertices(positions, Math.max(1e-6, (radius || 1) * 1e-5));
  const feature: TriEdge[] = [];
  collectTriangleEdges(indices, welded).forEach((e) => { if (isSharp(e)) feature.push(e); });
  const { coords } = welded;
  return chainEdges(feature, coords).map((pts) => pts.flatMap((v) => [coords[v * 3], coords[v * 3 + 1], coords[v * 3 + 2]]));
}
