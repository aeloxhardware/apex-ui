import { LINE_TYPES, type LineTypeId } from '../gcodeLineTypes';
import type { GCodeGenerator } from '../gcodeGenerator';
import type { ParserState } from './state';
import type {
  ColorByRanges, ContinuousColorByMode, GCodeKind, GCodeMove, LineTypeStat,
} from './types';
import { DEG2RAD, nozzleTip } from './geometry';

const emptyStats = () =>
  Object.fromEntries(LINE_TYPES.map((t) => [t.id, { time: 0, filamentMm: 0, massG: 0 }])) as Record<LineTypeId, LineTypeStat>;

/** Temps, filament et masse par type de ligne. */
export function computeLineStats(s: ParserState, times: Float64Array) {
  const lineStats = emptyStats();
  const moves = s.moves;
  for (let k = 1; k < moves.length; k++) {
    const stat = lineStats[moves[k].type];
    stat.time += times[k] - times[k - 1];
    stat.filamentMm += s.deposits[k];
  }
  const gPerMm = Math.PI * (s.filamentDiameter / 2) ** 2 * s.filamentDensity / 1000;
  for (const stat of Object.values(lineStats)) stat.massG = stat.filamentMm * gPerMm;
  return lineStats;
}

/** Bornes en Z/R de la pointe de buse (ce qui est affiché), pas du pivot. */
export function computeBounds(moves: GCodeMove[], kind: GCodeKind) {
  let minZ = Infinity, maxZ = -Infinity, maxR = 0, minC = Infinity, maxC = -Infinity;
  const tip = { r: 0, z: 0 };
  for (const mv of moves) {
    if (kind === 'polar') {
      nozzleTip(mv.x, mv.z, mv.b * DEG2RAD, tip);
      if (Math.abs(tip.r) > maxR) maxR = Math.abs(tip.r);
      if (mv.y < minC) minC = mv.y;
      if (mv.y > maxC) maxC = mv.y;
    } else {
      tip.z = mv.z;
      maxR = Math.max(maxR, Math.hypot(mv.x, mv.y));
    }
    if (tip.z < minZ) minZ = tip.z;
    if (tip.z > maxZ) maxZ = tip.z;
  }
  if (!moves.length) { minZ = maxZ = 0; }
  if (minC > maxC) { minC = maxC = 0; }
  return { minZ, maxZ, maxR, minC, maxC };
}

/** Logiciel présumé du fichier : signature, sinon indices (polaire Apex, style des étiquettes, IceSL). */
export function detectGenerator(s: ParserState, kind: GCodeKind): GCodeGenerator | null {
  let generator: GCodeGenerator | null = null;
  if (s.signature) generator = { name: s.signature, inferred: false };
  else if (kind === 'polar') generator = { name: 'Générateur Apex 4 axes', inferred: true };
  else if (s.featureStyleGuess) generator = { name: s.featureStyleGuess, inferred: true };
  else if (s.iceSLLayers) generator = { name: 'IceSL', inferred: true };
  // PrusaSlicer modifié (couches non planaires) : ses marqueurs `;TYPE:Nonplanar …` n'existent pas dans l'original.
  if (generator && s.nonplanarFeatures && /PrusaSlicer/i.test(generator.name)) generator.name += ' (Non-planar fork)';
  return generator;
}

/** Colonnes dont dérivent les critères de coloration continus. */
export interface RangeInputs {
  moves: GCodeMove[];
  times: Float64Array;
  deposits: number[];
  filamentDiameter: number;
  speedMmS: Float32Array;
  accelMmS2: Float32Array;
  segLengthMm: Float32Array;
  widthMm: Float32Array;
  layerHeightMm: Float32Array;
  nozzleTempC: Float32Array;
  fanPct: Float32Array;
  layerMaxSpeedMmS: Float32Array;
}

const CONTINUOUS_MODES: ContinuousColorByMode[] = [
  'speed', 'accel', 'headAngle', 'segmentLength', 'elapsedTime', 'extrusionRatio',
  'volumetricFlow', 'layerSpeedRatio', 'lineWidth', 'layerHeight', 'temperature', 'fanSpeed',
];

/**
 * Débit volumétrique (mm³/s) et pression d'extrusion relative (E/mm) : purs ratios dérivés,
 * recalculés à la volée plutôt que stockés, réutilisés pour l'agrégation min/max/moyenne.
 */
function valueGetters(i: RangeInputs): Record<ContinuousColorByMode, (k: number) => number> {
  const { moves, times, segLengthMm, speedMmS, layerMaxSpeedMmS } = i;
  return {
    speed: (k) => speedMmS[k],
    accel: (k) => i.accelMmS2[k],
    headAngle: (k) => Math.abs(moves[k].b),
    segmentLength: (k) => segLengthMm[k],
    elapsedTime: (k) => times[k],
    extrusionRatio: (k) => (!moves[k].extruding || segLengthMm[k] <= 1e-6 ? NaN : i.deposits[k] / segLengthMm[k]),
    volumetricFlow: (k) => {
      const dt = times[k] - times[k - 1];
      if (!moves[k].extruding || dt <= 0) return NaN;
      return (i.deposits[k] * Math.PI * (i.filamentDiameter / 2) ** 2) / dt;
    },
    layerSpeedRatio: (k) =>
      (!moves[k].extruding || layerMaxSpeedMmS[k] <= 1e-6 ? NaN : (speedMmS[k] / layerMaxSpeedMmS[k]) * 100),
    lineWidth: (k) => i.widthMm[k],
    layerHeight: (k) => i.layerHeightMm[k],
    temperature: (k) => i.nozzleTempC[k],
    fanSpeed: (k) => i.fanPct[k],
  };
}

/** Min/max/moyenne par fichier de chaque critère continu, pour normaliser le dégradé. */
export function computeRanges(inputs: RangeInputs): ColorByRanges {
  const valueAt = valueGetters(inputs);
  const count = inputs.moves.length;
  const ranges = {} as ColorByRanges;
  for (const mode of CONTINUOUS_MODES) {
    const get = valueAt[mode];
    let min = Infinity, max = -Infinity, sum = 0, n = 0;
    for (let k = 1; k < count; k++) {
      const v = get(k);
      if (Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      n++;
    }
    ranges[mode] = n > 0 ? { min, max, avg: sum / n } : { min: 0, max: 0, avg: 0 };
  }
  return ranges;
}
