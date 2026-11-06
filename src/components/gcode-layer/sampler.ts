import type * as BABYLON from 'babylonjs';
import { DEG2RAD, MAX_SUBSEGMENT_DEG, moveLength, nozzleTip, type ParsedGCode } from '../gcodeParse';
import { SLICE_BUDGET_MS, SLICE_MASK } from './constants';

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
