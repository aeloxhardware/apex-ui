import type { LineTypeId } from './gcodeLineTypes';

/**
 * Contours « dans l'air » : parois imprimées sans aucune matière dessous. Le PrusaSlicer à couches non
 * planaires (cf. `nonplanarFeatures` dans gcodeParse.ts) en émet parfois en trop ; la tête les
 * parcourt alors au-dessus de la pièce et peut la percuter. Détection géométrique seule, en suivant
 * l'ordre de dépôt : une paroi est « en l'air » si, sur presque toute sa longueur, aucune matière
 * déjà déposée ne se trouve dessous (rayon `CELL_MM`, jusqu'à `SUPPORT_GAP_MM` plus bas).
 */

/** Hauteur sous laquelle le plateau tient lieu d'appui. */
const PLATE_Z_MM = 0.6;
/** Écart vertical maximal entre un point de paroi et la matière qui le porte. */
export const SUPPORT_GAP_MM = 1.0;
/** Pas d'échantillonnage le long des cordons et taille des cases de la grille d'appui. */
const SAMPLE_STEP_MM = 0.5;
const CELL_MM = 1;
/** Part de la longueur d'un tronçon sans appui à partir de laquelle il est jugé en l'air. */
export const AIR_FRACTION = 0.9;
/** Longueur minimale d'une paroi en l'air (en dessous : amorce, couture, pas un contour). */
export const AIR_MIN_LENGTH_MM = 3;

/** Écart maximal entre la fin d'un tronçon de paroi et le départ du suivant pour les rattacher. */
const CHAIN_GAP_MM = 3;

/** Part sans appui à partir de laquelle une paroi peut être l'amorce d'un contour en l'air. */
const CANDIDATE_FRACTION = 0.3;

const WALL_TYPES = new Set<LineTypeId>(['outerWall', 'innerWall']);

interface AirMove { x: number; y: number; z: number; extruding: boolean; type: LineTypeId }

export interface AirRun {
  /** Premier et dernier mouvement du contour (indices dans `moves`, le premier pointe son segment d'arrivée). */
  start: number;
  end: number;
  lengthMm: number;
}

const cellKey = (ix: number, iy: number) => (ix + 32768) * 65536 + (iy + 32768);

/** Parois en l'air, dans l'ordre du fichier. `moves[k]` est l'arrivée du segment k − 1 → k. */
export function findAirContours(moves: readonly AirMove[]): AirRun[] {
  const grid = new Map<number, number[]>();
  const add = (x: number, y: number, z: number) => {
    const key = cellKey(Math.floor(x / CELL_MM), Math.floor(y / CELL_MM));
    const cell = grid.get(key);
    if (cell) cell.push(z); else grid.set(key, [z]);
  };
  const supported = (x: number, y: number, z: number) => {
    if (z < PLATE_Z_MM) return true;
    const cx = Math.floor(x / CELL_MM), cy = Math.floor(y / CELL_MM);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get(cellKey(cx + dx, cy + dy));
        if (!cell) continue;
        for (const zz of cell) if (zz < z - 0.02 && zz > z - SUPPORT_GAP_MM) return true;
      }
    }
    return false;
  };

  const result: AirRun[] = [];
  // Le contour en l'air est émis en une multitude de tronçons de quelques dixièmes de mm séparés par de
  // courts déplacements à vide : on juge chaque tronçon, puis on rattache ceux qui n'ont pas d'appui.
  let chainSamples: number[] = [];
  let chainLength = 0;
  let chainStart = -1;
  let chainEnd = -1;
  let candidate: { start: number; end: number; length: number; samples: number[] } | null = null;
  const dropCandidate = () => {
    if (!candidate) return;
    for (let s = 0; s < candidate.samples.length; s += 3) add(candidate.samples[s], candidate.samples[s + 1], candidate.samples[s + 2]);
    candidate = null;
  };
  const flush = () => {
    if (chainStart < 0) return;
    if (chainLength >= AIR_MIN_LENGTH_MM) {
      result.push({ start: chainStart, end: chainEnd, lengthMm: chainLength });
    } else {
      // Trop court pour un contour : simple amorce, la matière compte comme appui.
      for (let s = 0; s < chainSamples.length; s += 3) add(chainSamples[s], chainSamples[s + 1], chainSamples[s + 2]);
    }
    chainSamples = [];
    chainLength = 0;
    chainStart = chainEnd = -1;
  };

  let k = 1;
  while (k < moves.length) {
    if (!moves[k].extruding) { k++; continue; }
    // Suite continue de dépôts d'un même type.
    const start = k;
    const type = moves[k].type;
    while (k < moves.length && moves[k].extruding && moves[k].type === type) k++;
    const samples: number[] = [];
    let length = 0;
    for (let i = start; i < k; i++) {
      const a = moves[i - 1], b = moves[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const n = Math.max(1, Math.ceil(len / SAMPLE_STEP_MM));
      for (let u = 1; u <= n; u++) {
        const f = u / n;
        samples.push(a.x + f * (b.x - a.x), a.y + f * (b.y - a.y), a.z + f * (b.z - a.z));
      }
      length += len;
    }
    let fraction = 0;
    if (WALL_TYPES.has(type)) {
      let unsupported = 0;
      for (let s = 0; s < samples.length; s += 3) if (!supported(samples[s], samples[s + 1], samples[s + 2])) unsupported++;
      fraction = unsupported / (samples.length / 3);
    }
    if (fraction < AIR_FRACTION) {
      flush();
      dropCandidate();
      // Paroi en partie sans appui (montée verticale depuis la pièce vers un contour en l'air) :
      // gardée de côté, rattachée au contour qui suit s'il repart d'où elle s'arrête.
      if (fraction >= CANDIDATE_FRACTION) candidate = { start, end: k - 1, length, samples };
      else for (let s = 0; s < samples.length; s += 3) add(samples[s], samples[s + 1], samples[s + 2]);
      continue;
    }
    if (candidate && chainStart < 0) {
      const a = moves[candidate.end], b = moves[start - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= CHAIN_GAP_MM) {
        chainStart = candidate.start;
        chainEnd = candidate.end;
        chainLength = candidate.length;
        chainSamples = candidate.samples.slice();
        candidate = null;
      }
    }
    dropCandidate();
    // Sans appui : prolonge la chaîne si elle repart près de l'endroit où la précédente s'est arrêtée.
    if (chainStart >= 0) {
      const last = moves[chainEnd], first = moves[start - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) > CHAIN_GAP_MM) flush();
    }
    if (chainStart < 0) chainStart = start;
    chainEnd = k - 1;
    chainLength += length;
    for (let s = 0; s < samples.length; s++) chainSamples.push(samples[s]);
  }
  flush();
  dropCandidate();
  return result;
}
