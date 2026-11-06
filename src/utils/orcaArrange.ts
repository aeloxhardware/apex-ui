/**
 * Disposition automatique à la OrcaSlicer.
 *
 * Réimplémentation en TypeScript de l'arrangement d'OrcaSlicer, relu dans ses sources le 2026-11-06
 * (`src/libslic3r/Arrange.cpp`, `src/slic3r/GUI/Jobs/ArrangeJob.cpp`, AGPL-3.0, https://github.com/OrcaSlicer/OrcaSlicer ;
 * lui-même issu de PrusaSlicer, AGPL-3.0, et de libnest2d de Tamás Mészáros : `placers/nfpplacer.hpp`,
 * `selections/firstfit.hpp`). Repris du code d'Orca :
 *  - tri du plus grand au plus petit (aire de l'empreinte gonflée), une pièce après l'autre (« first fit ») ;
 *  - empreinte convexe gonflée de la moitié de l'écart ; rotations {0, 45°, 90°, 135°} ajoutées à l'angle de la boîte
 *    d'aire minimale ; sans rotation, option « Aligner sur l'axe Y » (axe principal des moments d'ordre 2) ;
 *  - première pièce posée dans le coin haut-droit du plateau, à l'angle de départ ; les suivantes cherchées sur le
 *    contour des polygones de non-recouvrement (NFP) avec les pièces déjà posées et le plateau ;
 *  - fonction objectif d'`AutoArranger::objfunc` : grandes pièces (> 2 % de l'aire du plateau) 0,8 · distance au tas
 *    + 0,2 · distance au coin d'origine, plus densité et terme d'alignement sur les voisines de même aire ; dernière
 *    grande pièce ; petites pièces autour des grandes ; avancement R = pièces restantes / pièces totales ;
 *  - pièces fixes (« fixed items ») : déjà posées, les autres les évitent ;
 *  - plateau rond : le tas doit tenir dans un cercle de rayon égal à celui du plateau (cercle englobant), puis il est
 *    recentré (alignement final CENTER).
 *
 * Écarts avec l'original, volontaires : Orca cherche le long des NFP avec l'optimiseur NLopt (L_SUBPLEX) et traite le tas
 * comme un polygone fusionné, éventuellement non convexe ; ici les NFP sont ceux des enveloppes convexes, échantillonnés
 * puis affinés sur la meilleure arête. Le contour réel n'est pas disponible côté interface : l'enveloppe convexe en tient
 * lieu, y compris pour l'axe principal. Les contraintes de température, d'extrudeur, de hauteur (impression séquentielle),
 * les zones interdites, la tour d'essuyage, le plateau-courroie, les plateaux multiples et les plateaux non ronds ne sont
 * pas repris. Après le recentrage, tout point qui sortirait du disque réel du plateau est ramené dans celui-ci.
 * Crédit : `src/utils/credits.ts`.
 */
import {
  EPS, bbox, boxesTouch, convexHull, enclosingCircle, inflate, minAreaBoxAngle, minkowskiSum, polygonArea,
  principalAxisAlignAngle, rotatePoly, strictlyInside, unionBox, type Box, type Pt,
} from './orcaArrangeGeometry';

export { convexHull, minkowskiSum, polygonArea };
export type { Pt };

export interface ArrangeInput {
  /** Contour (en mm, plan X/Z) de la pièce dans sa position actuelle. Il est remplacé par son enveloppe convexe. */
  outline: Pt[];
  /**
   * Pièce fixe (verrouillée, ou non sélectionnée quand on ne dispose que la sélection) : elle ne bouge pas et les autres
   * pièces l'évitent, comme les « fixed items » d'Orca. Son résultat porte `fixed: true` et `center: null`.
   */
  fixed?: boolean;
}

export interface ArrangeResult {
  /** Centre de la boîte englobante cible, ou null si la pièce ne tient pas sur le plateau (ou si elle est fixe). */
  center: Pt | null;
  /** Vrai pour une pièce fixe : à laisser où elle est. */
  fixed?: boolean;
  /** Rotation à appliquer autour de l'axe vertical, dans le sens x' = x·cos − z·sin, z' = x·sin + z·cos. */
  angle: number;
}

export interface ArrangeParams {
  /** Rayon du plateau circulaire, centré en (0, 0). */
  binRadius: number;
  /** Écart minimal entre deux pièces, en mm. */
  spacing: number;
  allowRotations: boolean;
  /** « Aligner sur l'axe Y » d'Orca : sans effet quand les rotations sont permises (Orca les remplace alors). */
  alignToY?: boolean;
}

const BIG_ITEM_THRESHOLD = 0.02;
const ROTATIONS = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
const EDGE_SAMPLES = 6;
const REFINE_SAMPLES = 12;
/** Les NFP touchent les pièces posées : une tolérance évite de rejeter la position de contact exacte. */
const NFP_TOLERANCE = 1e-4;

interface Variant { angle: number; poly: Pt[]; neg: Pt[]; w: number; h: number }
interface Item { index: number; variants: Variant[]; area: number }
interface Placed { poly: Pt[]; cx: number; cz: number; area: number; box: Box }

/** Angle de départ d'une pièce : boîte d'aire minimale (rotations permises), axe Y (option), sinon aucun. */
const seedAngle = (hull: Pt[], { allowRotations, alignToY }: ArrangeParams): number => {
  if (allowRotations) return minAreaBoxAngle(hull);
  return alignToY ? (principalAxisAlignAngle(hull) ?? 0) : 0;
};

/** Pièces à placer : enveloppe convexe gonflée de la marge, une variante par rotation essayée, grandes d'abord. */
const buildItems = (inputs: ArrangeInput[], params: ArrangeParams): Item[] => {
  const items: Item[] = [];
  inputs.forEach((inp, index) => {
    if (inp.fixed) return;
    const hull = convexHull(inp.outline);
    const seed = seedAngle(hull, params);
    const angles = params.allowRotations ? ROTATIONS.map((r) => seed + r) : [seed];
    const variants = angles.map((angle) => {
      const rotated = inflate(rotatePoly(hull, angle), params.spacing / 2);
      const bb = bbox(rotated);
      const poly = rotated.map((p) => ({ x: p.x - bb.cx, z: p.z - bb.cz }));
      return { angle, poly, neg: poly.map((p) => ({ x: -p.x, z: -p.z })), w: bb.w, h: bb.h };
    });
    // L'aire d'Orca est celle de l'empreinte gonflée.
    items.push({ index, variants, area: polygonArea(inflate(hull, params.spacing / 2)) });
  });
  return items.sort((p, q) => q.area - p.area);
};

/** Pièces fixes déjà posées : leur enveloppe convexe gonflée de l'écart, à leur place actuelle. */
const fixedPlacements = (inputs: ArrangeInput[], spacing: number): Placed[] =>
  inputs.filter((inp) => inp.fixed && inp.outline.length > 0).map((inp) => {
    const inflated = inflate(convexHull(inp.outline), spacing / 2);
    const bb = bbox(inflated);
    return { poly: inflated.map((p) => ({ x: p.x - bb.cx, z: p.z - bb.cz })), cx: bb.cx, cz: bb.cz, area: polygonArea(inflated), box: bb };
  });

const absPoints = (pl: Placed): Pt[] => pl.poly.map((p) => ({ x: p.x + pl.cx, z: p.z + pl.cz }));

/** Tas déjà posé et constantes du plateau, tels que l'`AutoArranger` d'Orca les tient entre deux pièces. */
interface Scene {
  radius: number;
  binArea: number;
  /** Échelle des distances (`m_norm` = racine de l'aire du plateau). */
  norm: number;
  /** Point d'origine de l'objectif : coin bas-gauche de la boîte du plateau, comme `AutoArranger<Circle>::get_objfn`. */
  origin: Pt;
  placed: Placed[];
  pileBox: Box | null;
  /** Enveloppe convexe de tous les points posés : sert au cercle englobant. */
  pileHull: Pt[];
  /** Nombre total de pièces, fixes comprises (`m_item_count`). */
  total: number;
  hasFixed: boolean;
}

function addPlaced(scene: Scene, pl: Placed) {
  scene.placed.push(pl);
  scene.pileBox = scene.pileBox ? unionBox(scene.pileBox, pl.box) : pl.box;
  scene.pileHull = convexHull([...scene.pileHull, ...absPoints(pl)]);
}

const createScene = (params: ArrangeParams, fixed: Placed[], movable: number): Scene => {
  const binArea = Math.PI * params.binRadius * params.binRadius;
  const scene: Scene = {
    radius: params.binRadius, binArea, norm: Math.sqrt(binArea), origin: { x: -params.binRadius, z: -params.binRadius },
    placed: [], pileBox: null, pileHull: [], total: movable + fixed.length, hasFixed: fixed.length > 0,
  };
  fixed.forEach((pl) => addPlaced(scene, pl));
  return scene;
};

const isBig = (scene: Scene, area: number) => area / scene.binArea > BIG_ITEM_THRESHOLD;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);

const boxAt = (v: Pick<Variant, 'w' | 'h'>, c: Pt): Box => ({
  minX: c.x - v.w / 2, maxX: c.x + v.w / 2, minZ: c.z - v.h / 2, maxZ: c.z + v.h / 2, cx: c.x, cz: c.z, w: v.w, h: v.h,
});

/** Meilleur alignement avec une voisine de même aire (0 = parfait), 1 s'il n'y en a pas. */
const alignmentScore = (neighbours: Placed[], area: number, ibb: Box): number => {
  let best = 1;
  for (const p of neighbours) {
    if (Math.abs(1 - p.area / area) >= 1e-6) continue;
    const u = unionBox(p.box, ibb);
    best = Math.min(best, 1 - (area + p.area) / (u.w * u.h));
  }
  return best;
};

/** Objectif des grandes pièces, hors dernière (`BIG_ITEM` d'Orca). */
const bigItemScore = (scene: Scene, area: number, ibb: Box, remaining: number): number => {
  const { norm, origin } = scene;
  const fullbb = scene.pileBox ? unionBox(scene.pileBox, ibb) : ibb;
  const cc = { x: fullbb.cx, z: fullbb.cz };
  const anchors: Pt[] = [
    { x: ibb.minX, z: ibb.minZ }, { x: ibb.maxX, z: ibb.maxZ }, { x: ibb.cx, z: ibb.cz },
    { x: ibb.minX, z: ibb.maxZ }, { x: ibb.maxX, z: ibb.minZ },
  ];
  const dPile = Math.min(...anchors.map((a) => dist(a, cc))) / norm;
  const d = 0.8 * dPile + 0.2 * (dist({ x: ibb.maxX, z: ibb.maxZ }, origin) / norm);
  const index = isBig(scene, area) ? scene.placed.filter((p) => isBig(scene, p.area)) : scene.placed;
  const near = index.filter((p) => boxesTouch(p.box, ibb));
  const density = Math.sqrt((fullbb.w / norm) * (fullbb.h / norm));
  if (near.length === 0) return 0.5 * d + 0.5 * density;
  const R = remaining / scene.total;
  const weight = Math.max(0.3, (0.6 * area) / (ibb.w * ibb.h));
  return (1 - 0.2 - weight) * d + (1 - R) * 0.2 * density + weight * alignmentScore(near, area, ibb);
};

/** `AutoArranger::objfunc` : note d'une position candidate (plus petit = meilleur). */
const objective = (scene: Scene, area: number, ibb: Box, remaining: number): number => {
  const bigs = scene.placed.filter((p) => isBig(scene, p.area));
  const bigitems = isBig(scene, area) || bigs.length === 0;
  const ic = { x: ibb.cx, z: ibb.cz };
  if (bigitems && remaining > 0) return bigItemScore(scene, area, ibb, remaining);
  if (bigitems) {
    const target = scene.pileBox ? { x: scene.pileBox.cx, z: scene.pileBox.cz } : scene.origin;
    return (0.5 * dist(ic, target)) / scene.norm;
  }
  const bigBox = bigs.map((p) => p.box).reduce(unionBox);
  return (0.8 * dist(ic, { x: bigBox.cx, z: bigBox.cz })) / scene.norm + (0.2 * dist(ic, scene.origin)) / scene.norm;
};

/** Le tas, avec la pièce candidate, tient-il sur le plateau rond ? Sans pièce fixe : cercle englobant (Orca) ; avec : disque réel. */
const fitsBin = (scene: Scene, v: Variant, c: Pt): boolean => {
  const cand = v.poly.map((p) => ({ x: p.x + c.x, z: p.z + c.z }));
  if (scene.hasFixed) return cand.every((p) => Math.hypot(p.x, p.z) <= scene.radius + EPS);
  return enclosingCircle(convexHull([...scene.pileHull, ...cand])).r <= scene.radius + EPS;
};

interface Candidate { c: Pt; a: Pt; b: Pt; t: number }

/** Positions candidates : points échantillonnés sur les contours des NFP et du rectangle de placement dans le plateau. */
const candidatesOf = (nfps: Pt[][], ifp: Pt[]): Candidate[] => {
  const out: Candidate[] = [];
  for (const poly of [...nfps, ifp]) {
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length] as Pt;
      for (let k = 0; k < EDGE_SAMPLES; k++) {
        const t = k / EDGE_SAMPLES;
        out.push({ c: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, a, b, t });
      }
    });
  }
  return out;
};

interface Best { score: number; c: Pt; angle: number; poly: Pt[]; w: number; h: number }

/** Échantillons resserrés autour d'une position retenue, sur la même arête de NFP. */
const refine = (cand: Candidate): Candidate[] =>
  Array.from({ length: REFINE_SAMPLES }, (_, k) => {
    const t = Math.min(1, Math.max(0, cand.t - 1 / EDGE_SAMPLES + ((2 / EDGE_SAMPLES) * k) / (REFINE_SAMPLES - 1)));
    return { ...cand, t, c: { x: cand.a.x + (cand.b.x - cand.a.x) * t, z: cand.a.z + (cand.b.z - cand.a.z) * t } };
  });

/** Rectangle des positions où la boîte de la variante reste dans la boîte du plateau (NFP intérieur de `nfpInnerRectBed`). */
const innerFitRect = (scene: Scene, v: Variant): Pt[] => {
  const x = scene.radius - v.w / 2, z = scene.radius - v.h / 2;
  return x < 0 || z < 0 ? [] : [{ x: -x, z: -z }, { x, z: -z }, { x, z }, { x: -x, z }];
};

const asBest = (score: number, c: Pt, v: Variant): Best => ({ score, c, angle: v.angle, poly: v.poly, w: v.w, h: v.h });

/** Meilleure position d'une variante parmi celles qui tiennent sans recouvrir le tas. */
const bestForVariant = (scene: Scene, area: number, v: Variant, remaining: number, best: Best | null): Best | null => {
  const ifp = innerFitRect(scene, v);
  if (ifp.length === 0) return best;
  const nfps = scene.placed.map((pl) => minkowskiSum(absPoints(pl), v.neg));
  const inBed = (c: Pt) => Math.abs(c.x) <= scene.radius - v.w / 2 + EPS && Math.abs(c.z) <= scene.radius - v.h / 2 + EPS;
  let top: Best | null = best;
  let topCand: Candidate | null = null;
  const consider = (cand: Candidate) => {
    if (!inBed(cand.c) || nfps.some((nfp) => strictlyInside(nfp, cand.c, NFP_TOLERANCE))) return;
    const score = objective(scene, area, boxAt(v, cand.c), remaining);
    if ((top && score >= top.score - EPS) || !fitsBin(scene, v, cand.c)) return;
    top = asBest(score, cand.c, v);
    topCand = cand;
  };
  candidatesOf(nfps, ifp).forEach(consider);
  if (topCand) refine(topCand).forEach(consider);
  return top;
};

/** Première pièce du plateau : coin haut-droit, angle de départ, sans recherche (`first_object` de `_trypack`). */
const firstPlacement = (scene: Scene, item: Item): Best | null => {
  const v = item.variants[0] as Variant;
  const c = { x: scene.radius - v.w / 2 - 1e-5, z: scene.radius - v.h / 2 - 1e-5 };
  return enclosingCircle(v.poly).r <= scene.radius + EPS ? asBest(0.2, c, v) : null;
};

const placeItem = (scene: Scene, item: Item, remaining: number): Best | null => {
  if (scene.placed.length === 0) return firstPlacement(scene, item);
  let best: Best | null = null;
  for (const v of item.variants) best = bestForVariant(scene, item.area, v, remaining, best);
  return best;
};

/** Avancement de la disposition : pièces déjà traitées sur le total à placer. */
export interface ArrangeProgress { done: number; total: number }

/** Recentre le tas (alignement final CENTER d'Orca) ; ramène dans le disque réel du plateau ce qui en sortirait. */
const recenter = (scene: Scene, results: ArrangeResult[]) => {
  const pts = scene.placed.flatMap(absPoints);
  if (pts.length === 0) return;
  const pile = bbox(pts);
  const inside = (dx: number, dz: number) => pts.every((p) => Math.hypot(p.x + dx, p.z + dz) <= scene.radius + EPS);
  const circle = enclosingCircle(convexHull(pts));
  const shift = inside(-pile.cx, -pile.cz) ? { x: -pile.cx, z: -pile.cz } : inside(-circle.x, -circle.z) ? { x: -circle.x, z: -circle.z } : null;
  if (!shift) return;
  for (const r of results) if (r.center) r.center = { x: r.center.x + shift.x, z: r.center.z + shift.z };
};

/**
 * Disposition pièce par pièce : le générateur rend la main après chacune (avancement), ce qui permet d'afficher une
 * progression et d'annuler une grosse scène. Sa valeur de retour est le résultat, dans l'ordre d'entrée.
 */
export function* arrangeSteps(inputs: ArrangeInput[], params: ArrangeParams): Generator<ArrangeProgress, ArrangeResult[]> {
  const results: ArrangeResult[] = inputs.map((inp): ArrangeResult => (inp.fixed ? { center: null, angle: 0, fixed: true } : { center: null, angle: 0 }));
  const items = buildItems(inputs, params);
  const scene = createScene(params, fixedPlacements(inputs, params.spacing), items.length);

  for (const [done, item] of items.entries()) {
    const best = placeItem(scene, item, items.length - done - 1);
    if (best) {
      addPlaced(scene, { poly: best.poly, cx: best.c.x, cz: best.c.z, area: item.area, box: boxAt(best, best.c) });
      results[item.index] = { center: { ...best.c }, angle: best.angle };
    }
    yield { done: done + 1, total: items.length };
  }
  // Avec des pièces fixes, recentrer le tas déplacerait les pièces mobiles par rapport à elles.
  if (!scene.hasFixed) recenter(scene, results);
  return results;
}

/**
 * Dispose les pièces sur un plateau circulaire. Retourne, dans l'ordre d'entrée, le centre cible et la
 * rotation de chaque pièce ; `center` vaut null pour celles qui ne tiennent pas (ou qui sont fixes).
 */
export const arrange = (inputs: ArrangeInput[], params: ArrangeParams): ArrangeResult[] => {
  const steps = arrangeSteps(inputs, params);
  for (let step = steps.next(); ; step = steps.next()) if (step.done) return step.value;
};

export interface ArrangeAsyncOptions {
  onProgress?: (progress: ArrangeProgress) => void;
  /** Annulation : vérifiée entre deux pièces ; la promesse est alors rejetée par une `ArrangeCancelled`. */
  signal?: AbortSignal;
}

export class ArrangeCancelled extends Error {
  constructor() { super('Disposition annulée.'); this.name = 'ArrangeCancelled'; }
}

/** Même résultat que `arrange`, en laissant l'interface respirer entre deux pièces. */
export const arrangeAsync = async (inputs: ArrangeInput[], params: ArrangeParams, options: ArrangeAsyncOptions = {}): Promise<ArrangeResult[]> => {
  const steps = arrangeSteps(inputs, params);
  for (let step = steps.next(); ; step = steps.next()) {
    if (step.done) return step.value;
    options.onProgress?.(step.value);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (options.signal?.aborted) throw new ArrangeCancelled();
  }
};
