// Coupe d'un maillage par un plan (outil Couper de Préparation) : logique pure, sans Babylon.
//
// Entrée : une liste de triangles à plat (9 nombres par triangle, coordonnées du monde). Sortie : les triangles de chaque
// côté du plan, la section rebouchée des deux côtés (meshCutCap.ts), et le nombre de contours restés ouverts (maillage
// non étanche : ces contours ne sont pas bouchés).
//
// Robustesse :
//  - un sommet à moins de EPS du plan est compté du côté positif : aucun sommet n'est jamais exactement sur le plan, chaque
//    triangle est donc entier d'un côté ou franchement traversé ;
//  - le point d'intersection d'une arête est calculé dans un ordre canonique de ses deux extrémités : les deux triangles
//    voisins trouvent le même point au bit près, et les segments de la section se raccordent sans tolérance.
import { capFromSegments, type Segment, type Vec3 } from './meshCutCap';

export type { Vec3 };

export interface Plane {
  /** Normale unitaire : la partie « haute » est du côté où elle pointe. */
  normal: Vec3;
  /** Le plan est l'ensemble des points p tels que normal · p = offset. */
  offset: number;
}

export interface CutResult {
  /** Triangles du côté de la normale (9 nombres par triangle), section comprise. */
  upper: number[];
  /** Triangles de l'autre côté, section comprise. */
  lower: number[];
  /** Contours de la section restés ouverts (maillage non étanche), donc non bouchés. */
  openLoops: number;
}

const EPS = 1e-6;

function vertex(tris: ArrayLike<number>, i: number): Vec3 {
  return [tris[3 * i] ?? 0, tris[3 * i + 1] ?? 0, tris[3 * i + 2] ?? 0];
}

/** Distance signée de chaque sommet au plan ; jamais nulle (voir l'en-tête). */
function signedDistances(tris: ArrayLike<number>, plane: Plane): Float64Array {
  const [nx, ny, nz] = plane.normal;
  const s = new Float64Array(Math.floor(tris.length / 3));
  for (let i = 0; i < s.length; i++) {
    const d = nx * (tris[3 * i] ?? 0) + ny * (tris[3 * i + 1] ?? 0) + nz * (tris[3 * i + 2] ?? 0) - plane.offset;
    s[i] = Math.abs(d) < EPS ? EPS : d;
  }
  return s;
}

function before(p: Vec3, q: Vec3): boolean {
  if (p[0] !== q[0]) return p[0] < q[0];
  if (p[1] !== q[1]) return p[1] < q[1];
  return p[2] < q[2];
}

/** Point où l'arête (a, b) traverse le plan, calculé dans un ordre fixe de ses extrémités. */
function crossing(pa: Vec3, sa: number, pb: Vec3, sb: number): Vec3 {
  const [p, sp, q, sq] = before(pa, pb) ? [pa, sa, pb, sb] : [pb, sb, pa, sa];
  const t = sp / (sp - sq);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
}

function pushTri(out: number[], a: Vec3, b: Vec3, c: Vec3) {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

interface Sides {
  upper: number[];
  lower: number[];
  segments: Segment[];
}

/**
 * Triangle traversé : le sommet seul de son côté garde un triangle, l'autre côté reçoit un quadrilatère (deux triangles),
 * dans l'ordre d'origine des sommets (l'orientation des faces est conservée). Le segment de section est orienté comme le
 * bord du morceau haut : du point de sortie vers le point d'entrée.
 */
function splitTriangle(p: [Vec3, Vec3, Vec3], s: [number, number, number], out: Sides) {
  const upCount = s.filter((v) => v > 0).length;
  const k = s.findIndex((v) => v > 0 === (upCount === 1));
  const ia = k;
  const ib = (k + 1) % 3;
  const ic = (k + 2) % 3;
  const [a, b, c] = [p[ia], p[ib], p[ic]];
  const [sa, sb, sc] = [s[ia], s[ib], s[ic]];
  if (!a || !b || !c || sa === undefined || sb === undefined || sc === undefined) return;
  const i1 = crossing(a, sa, b, sb);
  const i2 = crossing(c, sc, a, sa);
  const lone = upCount === 1 ? out.upper : out.lower;
  const rest = upCount === 1 ? out.lower : out.upper;
  pushTri(lone, a, i1, i2);
  pushTri(rest, i1, b, c);
  pushTri(rest, i1, c, i2);
  out.segments.push(upCount === 1 ? [i1, i2] : [i2, i1]);
}

/** Coupe les triangles par le plan et rebouche la section des deux côtés. */
export function cutTriangles(tris: ArrayLike<number>, plane: Plane): CutResult {
  const s = signedDistances(tris, plane);
  const out: Sides = { upper: [], lower: [], segments: [] };
  for (let t = 0; t + 2 < s.length; t += 3) {
    const p: [Vec3, Vec3, Vec3] = [vertex(tris, t), vertex(tris, t + 1), vertex(tris, t + 2)];
    const st: [number, number, number] = [s[t] ?? 0, s[t + 1] ?? 0, s[t + 2] ?? 0];
    const up = st.filter((v) => v > 0).length;
    if (up === 3) pushTri(out.upper, ...p);
    else if (up === 0) pushTri(out.lower, ...p);
    else splitTriangle(p, st, out);
  }
  const cap = capFromSegments(out.segments, plane.normal);
  // Pas de `push(...grand tableau)` : au-delà de quelques dizaines de milliers d'éléments, la pile d'appel déborde.
  for (const v of cap.upperFace) out.upper.push(v);
  for (const v of cap.lowerFace) out.lower.push(v);
  return { upper: out.upper, lower: out.lower, openLoops: cap.openLoops };
}
