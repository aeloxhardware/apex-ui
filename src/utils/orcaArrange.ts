/**
 * Disposition automatique à la OrcaSlicer.
 *
 * Réimplémentation en TypeScript de la démarche de l'arrangement d'OrcaSlicer (`src/slic3r/GUI/Jobs/
 * ArrangeJob.cpp` et `src/libslic3r/Arrange.cpp`, AGPL-3.0, https://github.com/OrcaSlicer/OrcaSlicer ;
 * lui-même issu de PrusaSlicer, AGPL-3.0, et de libnest2d de Tamás Mészáros). Sont repris : l'empreinte
 * convexe de chaque pièce gonflée de l'écart minimal, le tri du plus grand au plus petit, la graine de
 * rotation à l'angle de la boîte englobante d'aire minimale, les rotations {0, 45°, 90°, 135°}, le placement
 * par polygones de non-recouvrement (NFP), la sélection « first fit » (une pièce par plateau, au premier où
 * elle tient), la fonction objectif (grandes pièces > 2 % du plateau : 0,8 · distance au tas + 0,2 · distance
 * au centre du plateau, plus un terme de densité ; petites pièces : 0,8 · distance au centre du groupe de
 * grandes pièces + 0,2 · distance au centre) et le recentrage final du tas. Crédit : `src/utils/credits.ts`.
 *
 * Écarts avec l'original : le plateau est un disque ; l'empreinte est toujours convexe ; le terme
 * d'alignement sur les voisins de même aire, les contraintes de température, d'extrudeur, de hauteur et
 * d'impression séquentielle ne sont pas repris.
 */

export interface Pt { x: number; z: number }

export interface ArrangeInput {
  /** Contour (en mm, plan X/Z) de la pièce dans sa position actuelle. Il est remplacé par son enveloppe convexe. */
  outline: Pt[];
}

export interface ArrangeResult {
  /** Centre de la boîte englobante cible, ou null si la pièce ne tient pas sur le plateau. */
  center: Pt | null;
  /** Rotation à appliquer autour de l'axe vertical, dans le sens x' = x·cos − z·sin, z' = x·sin + z·cos. */
  angle: number;
}

export interface ArrangeParams {
  /** Rayon du plateau circulaire, centré en (0, 0). */
  binRadius: number;
  /** Écart minimal entre deux pièces, en mm. */
  spacing: number;
  allowRotations: boolean;
}

const EPS = 1e-6;
const BIG_ITEM_THRESHOLD = 0.02;
const ROTATIONS = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
const EDGE_SAMPLES = 4;

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

/** Enveloppe convexe (chaîne monotone), sens trigonométrique. */
export const convexHull = (points: Pt[]): Pt[] => {
  const p = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

export const polygonArea = (poly: Pt[]): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
};

const rotatePoly = (poly: Pt[], angle: number): Pt[] => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return poly.map((p) => ({ x: p.x * c - p.z * s, z: p.x * s + p.z * c }));
};

const bbox = (poly: Pt[]) => {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, minZ, maxX, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, h: maxZ - minZ };
};

/** Gonfle un polygone convexe de `d` mm (somme de Minkowski avec un 16-gone inscrit corrigé du cosinus). */
const inflate = (poly: Pt[], d: number): Pt[] => {
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
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ang = -Math.atan2(b.z - a.z, b.x - a.x);
    const bb = bbox(rotatePoly(hull, ang));
    const area = bb.w * bb.h;
    if (area < bestArea - EPS) {
      bestArea = area;
      best = ang;
    }
  }
  return best;
};

/** Somme de Minkowski de deux polygones convexes (sens trigonométrique), par fusion des arêtes. */
export const minkowskiSum = (a: Pt[], b: Pt[]): Pt[] => {
  const lowest = (p: Pt[]) => p.reduce((bi, q, i) => (q.z < p[bi].z || (q.z === p[bi].z && q.x < p[bi].x) ? i : bi), 0);
  const ia0 = lowest(a);
  const ib0 = lowest(b);
  const out: Pt[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const pa = a[(ia0 + i) % a.length];
    const pb = b[(ib0 + j) % b.length];
    out.push({ x: pa.x + pb.x, z: pa.z + pb.z });
    const ea = { x: a[(ia0 + i + 1) % a.length].x - pa.x, z: a[(ia0 + i + 1) % a.length].z - pa.z };
    const eb = { x: b[(ib0 + j + 1) % b.length].x - pb.x, z: b[(ib0 + j + 1) % b.length].z - pb.z };
    const c = ea.x * eb.z - ea.z * eb.x;
    if (i < a.length && (j >= b.length || c > EPS)) i++;
    else if (j < b.length && (i >= a.length || c < -EPS)) j++;
    else { i++; j++; }
  }
  return out;
};

/** Vrai si `p` est strictement à l'intérieur du polygone convexe (sens trigonométrique). */
const strictlyInside = (poly: Pt[], p: Pt, tol: number): boolean => {
  for (let i = 0; i < poly.length; i++) {
    if (cross(poly[i], poly[(i + 1) % poly.length], p) <= tol) return false;
  }
  return true;
};

interface Item {
  index: number;
  /** Polygone gonflé, centré sur le centre de sa boîte englobante, pour chaque rotation essayée. */
  variants: { angle: number; poly: Pt[]; neg: Pt[]; w: number; h: number }[];
  area: number;
}

interface Placed { poly: Pt[]; cx: number; cz: number; area: number }

/**
 * Dispose les pièces sur un plateau circulaire. Retourne, dans l'ordre d'entrée, le centre cible et la
 * rotation de chaque pièce ; `center` vaut null pour celles qui ne tiennent pas.
 */
export const arrange = (inputs: ArrangeInput[], params: ArrangeParams): ArrangeResult[] => {
  const { binRadius, spacing, allowRotations } = params;
  const binArea = Math.PI * binRadius * binRadius;
  const results: ArrangeResult[] = inputs.map(() => ({ center: null, angle: 0 }));

  const items: Item[] = inputs.map((inp, index) => {
    const hull = convexHull(inp.outline);
    const seed = allowRotations ? minAreaBoxAngle(hull) : 0;
    const angles = allowRotations ? ROTATIONS.map((r) => seed + r) : [0];
    const variants = angles.map((angle) => {
      const rotated = inflate(rotatePoly(hull, angle), spacing / 2);
      const bb = bbox(rotated);
      const poly = rotated.map((p) => ({ x: p.x - bb.cx, z: p.z - bb.cz }));
      return { angle, poly, neg: poly.map((p) => ({ x: -p.x, z: -p.z })), w: bb.w, h: bb.h };
    });
    return { index, variants, area: polygonArea(hull) };
  });
  items.sort((p, q) => q.area - p.area);

  const placed: Placed[] = [];
  const fits = (poly: Pt[], c: Pt) => poly.every((p) => Math.hypot(p.x + c.x, p.z + c.z) <= binRadius + EPS);

  for (const item of items) {
    const isBig = item.area > BIG_ITEM_THRESHOLD * binArea;
    const remaining = items.length - placed.length;
    const R = remaining / items.length;
    let pileBox = placed.length ? bbox(placed.flatMap((pl) => pl.poly.map((p) => ({ x: p.x + pl.cx, z: p.z + pl.cz })))) : null;
    const bigs = placed.filter((pl) => pl.area > BIG_ITEM_THRESHOLD * binArea);
    const bigCenter = bigs.length
      ? { x: bigs.reduce((s, b) => s + b.cx, 0) / bigs.length, z: bigs.reduce((s, b) => s + b.cz, 0) / bigs.length }
      : pileBox ? { x: pileBox.cx, z: pileBox.cz } : { x: 0, z: 0 };

    let best: { score: number; c: Pt; angle: number; poly: Pt[] } | null = null;
    for (const v of item.variants) {
      const candidates: Pt[] = [{ x: 0, z: 0 }];
      const nfps = placed.map((pl) => minkowskiSum(pl.poly.map((p) => ({ x: p.x + pl.cx, z: p.z + pl.cz })), v.neg));
      for (const nfp of nfps) {
        for (let i = 0; i < nfp.length; i++) {
          const a = nfp[i];
          const b = nfp[(i + 1) % nfp.length];
          for (let k = 0; k < EDGE_SAMPLES; k++) {
            const t = k / EDGE_SAMPLES;
            candidates.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
          }
        }
      }
      for (const c of candidates) {
        if (!fits(v.poly, c)) continue;
        if (nfps.some((nfp) => strictlyInside(nfp, c, 1e-4))) continue;
        const dBin = Math.hypot(c.x, c.z);
        let score: number;
        const norm = 2 * binRadius;
        if (!pileBox) {
          score = dBin / norm;
        } else if (isBig) {
          const anchors: Pt[] = [
            { x: c.x, z: c.z },
            { x: c.x - v.w / 2, z: c.z - v.h / 2 }, { x: c.x + v.w / 2, z: c.z + v.h / 2 },
            { x: c.x - v.w / 2, z: c.z + v.h / 2 }, { x: c.x + v.w / 2, z: c.z - v.h / 2 },
          ];
          const dPile = Math.min(...anchors.map((a) => Math.hypot(a.x - pileBox!.cx, a.z - pileBox!.cz)));
          const dist = (0.8 * dPile + 0.2 * dBin) / norm;
          const wBox = Math.max(pileBox.maxX, c.x + v.w / 2) - Math.min(pileBox.minX, c.x - v.w / 2);
          const hBox = Math.max(pileBox.maxZ, c.z + v.h / 2) - Math.min(pileBox.minZ, c.z - v.h / 2);
          const density = Math.sqrt((wBox / norm) * (hBox / norm));
          score = 0.8 * dist + (1 - R) * 0.2 * density;
        } else {
          score = (0.8 * Math.hypot(c.x - bigCenter.x, c.z - bigCenter.z) + 0.2 * dBin) / norm;
        }
        if (!best || score < best.score - EPS) best = { score, c, angle: v.angle, poly: v.poly };
      }
    }
    if (best) {
      placed.push({ poly: best.poly, cx: best.c.x, cz: best.c.z, area: item.area });
      results[item.index] = { center: { ...best.c }, angle: best.angle };
    }
  }

  // Recentrage final du tas sur le centre du plateau (Orca : alignement final CENTER), s'il reste dans le plateau.
  if (placed.length) {
    const pile = bbox(placed.flatMap((pl) => pl.poly.map((p) => ({ x: p.x + pl.cx, z: p.z + pl.cz }))));
    if (placed.every((pl) => fits(pl.poly, { x: pl.cx - pile.cx, z: pl.cz - pile.cz }))) {
      results.forEach((r) => {
        if (r.center) r.center = { x: r.center.x - pile.cx, z: r.center.z - pile.cz };
      });
    }
  }
  return results;
};
