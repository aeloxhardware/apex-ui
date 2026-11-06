/**
 * Géométrie 2D de la disposition automatique (plan X/Z, mm) : enveloppe convexe, somme de Minkowski, gonflement,
 * boîte d'aire minimale, cercle englobant et axe principal d'un polygone. Réimplémentation de ce que l'arrangement
 * d'OrcaSlicer (`src/libslic3r/Arrange.cpp`, AGPL-3.0) et de libnest2d (T. Mészáros) demandent à leur bibliothèque de
 * polygones. Crédit : `src/utils/credits.ts`.
 */

export interface Pt {
  x: number;
  z: number;
}

export interface Box {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  cx: number;
  cz: number;
  w: number;
  h: number;
}

export const EPS = 1e-6;

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

/** Enveloppe convexe (chaîne monotone), sens trigonométrique. */
export const convexHull = (points: Pt[]): Pt[] => {
  const p = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const half = (seq: Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const q of seq) {
      while (out.length >= 2 && cross(out[out.length - 2] as Pt, out[out.length - 1] as Pt, q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return half(p).concat(half(p.slice().reverse()));
};

export const polygonArea = (poly: Pt[]): number => {
  let s = 0;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length] as Pt;
    s += a.x * b.z - b.x * a.z;
  });
  return Math.abs(s) / 2;
};

export const rotatePoly = (poly: Pt[], angle: number): Pt[] => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return poly.map((p) => ({ x: p.x * c - p.z * s, z: p.x * s + p.z * c }));
};

export const bbox = (poly: Pt[]): Box => {
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, minZ, maxX, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, h: maxZ - minZ };
};

/** Boîte englobant deux boîtes. */
export const unionBox = (a: Box, b: Box): Box => {
  const minX = Math.min(a.minX, b.minX),
    minZ = Math.min(a.minZ, b.minZ);
  const maxX = Math.max(a.maxX, b.maxX),
    maxZ = Math.max(a.maxZ, b.maxZ);
  return { minX, minZ, maxX, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, h: maxZ - minZ };
};

export const boxesTouch = (a: Box, b: Box): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minZ <= b.maxZ && b.minZ <= a.maxZ;

/** Gonfle un polygone convexe de `d` mm (somme de Minkowski avec un 16-gone inscrit corrigé du cosinus). */
export const inflate = (poly: Pt[], d: number): Pt[] => {
  if (d <= 0) return poly;
  const n = 16;
  const r = d / Math.cos(Math.PI / n);
  const pts: Pt[] = [];
  for (const p of poly) {
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      pts.push({ x: p.x + r * Math.cos(a), z: p.z + r * Math.sin(a) });
    }
  }
  return convexHull(pts);
};

/** Angle qui rend la boîte englobante de la pièce d'aire minimale (un côté de l'enveloppe est aligné sur un axe). */
export const minAreaBoxAngle = (hull: Pt[]): number => {
  let best = 0;
  let bestArea = Infinity;
  hull.forEach((a, i) => {
    const b = hull[(i + 1) % hull.length] as Pt;
    const ang = -Math.atan2(b.z - a.z, b.x - a.x);
    const bb = bbox(rotatePoly(hull, ang));
    if (bb.w * bb.h < bestArea - EPS) {
      bestArea = bb.w * bb.h;
      best = ang;
    }
  });
  return best;
};

/** Somme de Minkowski de deux polygones convexes (sens trigonométrique), par fusion des arêtes. */
export const minkowskiSum = (a: Pt[], b: Pt[]): Pt[] => {
  const lowest = (p: Pt[]) =>
    p.reduce((bi, q, i) => (q.z < (p[bi] as Pt).z || (q.z === (p[bi] as Pt).z && q.x < (p[bi] as Pt).x) ? i : bi), 0);
  const ia0 = lowest(a);
  const ib0 = lowest(b);
  const at = (p: Pt[], i0: number, k: number) => p[(i0 + k) % p.length] as Pt;
  const out: Pt[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const pa = at(a, ia0, i);
    const pb = at(b, ib0, j);
    out.push({ x: pa.x + pb.x, z: pa.z + pb.z });
    const na = at(a, ia0, i + 1);
    const nb = at(b, ib0, j + 1);
    const c = (na.x - pa.x) * (nb.z - pb.z) - (na.z - pa.z) * (nb.x - pb.x);
    if (i < a.length && (j >= b.length || c > EPS)) i++;
    else if (j < b.length && (i >= a.length || c < -EPS)) j++;
    else {
      i++;
      j++;
    }
  }
  return out;
};

/** Vrai si `p` est strictement à l'intérieur du polygone convexe (sens trigonométrique). */
export const strictlyInside = (poly: Pt[], p: Pt, tol: number): boolean => {
  for (let i = 0; i < poly.length; i++) {
    if (cross(poly[i] as Pt, poly[(i + 1) % poly.length] as Pt, p) <= tol) return false;
  }
  return true;
};

export interface Circle {
  x: number;
  z: number;
  r: number;
}

const circleOf2 = (a: Pt, b: Pt): Circle => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, r: Math.hypot(a.x - b.x, a.z - b.z) / 2 });

const circleOf3 = (a: Pt, b: Pt, c: Pt): Circle => {
  const d = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
  if (Math.abs(d) < 1e-12) {
    const pairs = [circleOf2(a, b), circleOf2(a, c), circleOf2(b, c)];
    return pairs.reduce((m, q) => (q.r > m.r ? q : m));
  }
  const a2 = a.x * a.x + a.z * a.z,
    b2 = b.x * b.x + b.z * b.z,
    c2 = c.x * c.x + c.z * c.z;
  const x = (a2 * (b.z - c.z) + b2 * (c.z - a.z) + c2 * (a.z - b.z)) / d;
  const z = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, z, r: Math.hypot(a.x - x, a.z - z) };
};

const inCircle = (c: Circle, p: Pt) => Math.hypot(p.x - c.x, p.z - c.z) <= c.r + 1e-9;

/** Plus petit cercle passant par `a` et `b` et contenant les `n` premiers points (étape intérieure de Welzl). */
const circleThrough2 = (p: Pt[], n: number, a: Pt, b: Pt): Circle => {
  let c = circleOf2(a, b);
  for (let k = 0; k < n; k++) {
    const pk = p[k] as Pt;
    if (!inCircle(c, pk)) c = circleOf3(a, b, pk);
  }
  return c;
};

/** Plus petit cercle passant par `a` et contenant les `n` premiers points. */
const circleThrough1 = (p: Pt[], n: number, a: Pt): Circle => {
  let c: Circle = { x: a.x, z: a.z, r: 0 };
  for (let j = 0; j < n; j++) {
    const pj = p[j] as Pt;
    if (!inCircle(c, pj)) c = circleThrough2(p, j, a, pj);
  }
  return c;
};

/** Plus petit cercle englobant (algorithme incrémental de Welzl) : le « bounding circle » dont Orca compare le rayon à celui du plateau rond. */
export const enclosingCircle = (points: Pt[]): Circle => {
  const first = points[0];
  if (!first) return { x: 0, z: 0, r: 0 };
  let c: Circle = { x: first.x, z: first.z, r: 0 };
  points.forEach((pi, i) => {
    if (!inCircle(c, pi)) c = circleThrough1(points, i, pi);
  });
  return c;
};

/**
 * Angle qui aligne l'axe principal du polygone sur l'axe Y (option « Aligner sur l'axe Y » d'Orca, `update_selected_items_axis_align`) :
 * moments d'ordre 2 de l'aire, direction du grand axe, puis `π/2 − θ`. `null` quand il n'y a pas d'axe dominant (rapport des
 * moments > 0,66) : la pièce n'est alors pas tournée. Orca l'applique au contour réel ; ici à l'enveloppe convexe.
 */
export const principalAxisAlignAngle = (poly: Pt[]): number | null => {
  let a00 = 0,
    a10 = 0,
    a01 = 0,
    a20 = 0,
    a11 = 0,
    a02 = 0;
  let prev = poly[poly.length - 1] as Pt;
  for (const cur of poly) {
    const dxy = prev.x * cur.z - cur.x * prev.z;
    const sx = prev.x + cur.x,
      sz = prev.z + cur.z;
    a00 += dxy;
    a10 += dxy * sx;
    a01 += dxy * sz;
    a20 += dxy * (prev.x * sx + cur.x * cur.x);
    a11 += dxy * (prev.x * (sz + prev.z) + cur.x * (sz + cur.z));
    a02 += dxy * (prev.z * sz + cur.z * cur.z);
    prev = cur;
  }
  if (Math.abs(a00) <= EPS) return null;
  const sign = a00 > 0 ? 1 : -1;
  const m00 = a00 * 0.5 * sign;
  const cx = (a10 * sign) / 6 / m00,
    cz = (a01 * sign) / 6 / m00;
  const a = (a20 * sign) / 12 / m00 - cx * cx;
  const b = (a11 * sign) / 24 / m00 - cx * cz;
  const c = (a02 * sign) / 12 / m00 - cz * cz;
  const ratio = Math.abs(a) > Math.abs(c) ? Math.abs(c / a) : Math.abs(c) > 0 ? Math.abs(a / c) : 0;
  if (ratio > 0.66) return null;
  const angle = Math.PI / 2 - Math.atan2(2 * b, a - c) / 2;
  return Math.abs(Math.abs(angle) - Math.PI) < 0.01 ? 0 : angle;
};
