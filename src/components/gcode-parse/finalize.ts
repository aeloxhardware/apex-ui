import { findAirContours } from '../gcodeAirContours';
import type { ParserState } from './state';
import type { GCodeKind, GCodeMove } from './types';
import { PLATE_RADIUS_MM } from './types';
import { moveLength } from './geometry';
import { planCartesianTimes } from './plan';
import { MIN_MOVE_S } from './constants';

/** Centre du plateau d'origine d'un fichier cartésien : en-tête, sinon dimensions, sinon pièce. */
function resolveBedCenter(s: ParserState) {
  let center: { x: number; y: number } | null = s.bedCenter;
  if (!center && s.bedCircular) center = { x: 0, y: 0 };
  if (!center && s.bedSizeX > 0 && s.bedSizeY > 0) center = { x: s.bedSizeX / 2, y: s.bedSizeY / 2 };
  if (center) return center;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const anyExtruding = s.extrudingCount > 0;
  for (const mv of s.moves) {
    if (anyExtruding && !mv.extruding) continue;
    minX = Math.min(minX, mv.x); maxX = Math.max(maxX, mv.x);
    minY = Math.min(minY, mv.y); maxY = Math.max(maxY, mv.y);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

export interface Placement {
  nonPlanar: boolean;
  bedCenter: { x: number; y: number };
  offPlateMoves: number[];
  offPlateTraits: number;
}

/** Cartésien : détecte le non plan, recentre sur le plateau et repère les dépôts hors plateau. */
export function placeOnPlate(s: ParserState, kind: GCodeKind): Placement {
  const moves = s.moves;
  const placement: Placement = { nonPlanar: false, bedCenter: { x: 0, y: 0 }, offPlateMoves: [], offPlateTraits: 0 };
  if (kind !== 'cartesian' || !moves.length) return placement;
  // Non plan : plus de 5 % des dépôts changent de Z en cours de trajet.
  let zVarying = 0;
  for (let k = 1; k < moves.length; k++) {
    if (moves[k].extruding && Math.abs(moves[k].z - moves[k - 1].z) > 1e-4) zVarying++;
  }
  placement.nonPlanar = s.extrudingCount > 0 && zVarying / s.extrudingCount > 0.05;

  const center = resolveBedCenter(s);
  placement.bedCenter = center;
  for (const mv of moves) {
    mv.x -= center.x;
    mv.y -= center.y;
    if (!s.toolOriented) mv.b = 0;
  }
  const off = placement.offPlateMoves;
  for (let k = 1; k < moves.length; k++) {
    const mv = moves[k];
    if (!mv.extruding || Math.hypot(mv.x, mv.y) <= PLATE_RADIUS_MM) continue;
    if (off[off.length - 1] !== k - 1) placement.offPlateTraits++;
    off.push(k);
  }
  return placement;
}

export interface Timing {
  times: Float64Array;
  speedMmS: Float32Array;
  segLengthMm: Float32Array;
}

/**
 * Durée de chaque mouvement. Sans ça, la lecture avancerait d'un nombre fixe de mouvements par
 * seconde : une longue ligne droite serait franchie aussi vite qu'un segment de 0,1 mm.
 *  - Cartésien : planificateur de vitesses (accélérations, jerk), cf. `planCartesianTimes`.
 *  - Polaire : distance parcourue par la pointe de buse relativement au plateau, à l'avance F.
 * Mouvement d'extrudeur seul : longueur de filament poussée/tirée, à l'avance F.
 */
export function computeTiming(s: ParserState, kind: GCodeKind): Timing {
  const { moves, feeds, eDeltas } = s;
  const speedMmS = new Float32Array(moves.length);
  const segLengthMm = new Float32Array(moves.length);
  if (kind === 'cartesian') {
    const cap = Math.min(s.maxSpeed, s.headerMaxSpeed);
    const planned = planCartesianTimes(moves, feeds, eDeltas, s.accels, s.accelsToDecel, s.jerks, cap);
    for (let k = 1; k < moves.length; k++) {
      segLengthMm[k] = moveLength(moves[k - 1], moves[k], 'cartesian');
      speedMmS[k] = planned.speeds[k];
    }
    return { times: planned.times, speedMmS, segLengthMm };
  }
  const times = new Float64Array(moves.length);
  for (let k = 1; k < moves.length; k++) {
    let dist = moveLength(moves[k - 1], moves[k], 'polar');
    if (dist < 1e-9) dist = Math.abs(eDeltas[k]);
    segLengthMm[k] = dist;
    const rate = feeds[k] / 60;
    times[k] = times[k - 1] + Math.max(MIN_MOVE_S, dist / rate);
    speedMmS[k] = dist > 1e-9 ? dist / Math.max(MIN_MOVE_S, times[k] - times[k - 1]) : rate;
  }
  return { times, speedMmS, segLengthMm };
}

/**
 * Largeur de cordon (mm) : commentaire explicite du générateur (`;WIDTH:`) s'il en pousse un
 * avant ce dépôt (widths[k] non-NaN) ; sinon estimée depuis le débit de matière — largeur =
 * volume déposé / (longueur du segment × épaisseur de couche) — seulement calculable là où
 * layerHeightMm est connu (pas au tout premier passage d'un endroit donné).
 */
export function computeWidths(s: ParserState, segLengthMm: Float32Array) {
  const moves = s.moves;
  const widthMm = new Float32Array(moves.length);
  for (let k = 1; k < moves.length; k++) {
    if (!moves[k].extruding) { widthMm[k] = NaN; continue; }
    if (!Number.isNaN(s.widths[k])) { widthMm[k] = s.widths[k]; continue; }
    const h = s.layerHeights[k];
    const len = segLengthMm[k];
    if (Number.isNaN(h) || h <= 0 || len <= 1e-6) { widthMm[k] = NaN; continue; }
    const volumeMm3 = s.deposits[k] * Math.PI * (s.filamentDiameter / 2) ** 2;
    widthMm[k] = volumeMm3 / (len * h);
  }
  return widthMm;
}

/**
 * Vitesse max de la couche courante (mm/s), pour `layerSpeedRatio` = speedMmS / layerMaxSpeedMmS.
 * Cartésien seulement (layerIndex reste à 0 partout en polaire, pas de palier global net).
 */
export function computeLayerMaxSpeed(s: ParserState, kind: GCodeKind, speedMmS: Float32Array) {
  const moves = s.moves;
  const byIndex = new Map<number, number>();
  if (kind === 'cartesian') {
    for (let k = 1; k < moves.length; k++) {
      if (!moves[k].extruding) continue;
      const idx = s.layerIndices[k];
      byIndex.set(idx, Math.max(byIndex.get(idx) ?? 0, speedMmS[k]));
    }
  }
  const layerMaxSpeedMmS = new Float32Array(moves.length);
  for (let k = 1; k < moves.length; k++) layerMaxSpeedMmS[k] = byIndex.get(s.layerIndices[k]) ?? 0;
  return layerMaxSpeedMmS;
}

function isAirWall(mv: GCodeMove) {
  return mv.extruding && (mv.type === 'outerWall' || mv.type === 'innerWall');
}

/**
 * Contours émis dans l'air par le PrusaSlicer à couches non planaires : requalifiés (rouge) avant les
 * statistiques, et leurs coutures retirées (une par tronçon : elles masqueraient le tracé).
 * Renvoie les plages [premier, dernier] aplaties.
 */
export function requalifyAirContours(s: ParserState, kind: GCodeKind) {
  const moves = s.moves;
  const airRanges: number[] = [];
  if (kind !== 'cartesian' || !s.nonplanarFeatures) return airRanges;
  for (const run of findAirContours(moves)) {
    airRanges.push(run.start, run.end);
    for (let k = run.start; k <= run.end; k++) if (isAirWall(moves[k])) moves[k].type = 'airContour';
  }
  if (!airRanges.length) return airRanges;
  const inAir = (k: number) => {
    for (let r = 0; r < airRanges.length; r += 2) if (k >= airRanges[r] - 1 && k <= airRanges[r + 1]) return true;
    return false;
  };
  for (let i = s.seamAt.length - 1; i >= 0; i--) if (inAir(s.seamAt[i])) s.seamAt.splice(i, 1);
  return airRanges;
}
