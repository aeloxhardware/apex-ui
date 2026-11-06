import type { LineTypeId } from './gcodeLineTypes';
import { findAirContours } from './gcodeAirContours';
import type { GCodeGenerator } from './gcodeGenerator';
import type { ColorByRanges, ContinuousColorByMode, GCodeKind, LineTypeStat, ParsedGCode } from './gcodeTypes';
import { planCartesianTimes } from './gcodePlanTimes';
import { DEG2RAD, MIN_MOVE_S, PLATE_RADIUS_MM, moveLength, nozzleTip } from './gcodeParseConstants';
import { emptyStats, type ParseState } from './gcodeParseState';

/** Valeurs calculées après la lecture des lignes, passées d'une étape à l'autre. */
interface Derived {
  kind: GCodeKind;
  usedCenter: { x: number; y: number };
  nonPlanar: boolean;
  offPlateMoves: number[];
  offPlateTraits: number;
  times: Float64Array;
  speedMmS: Float32Array;
  segLengthMm: Float32Array;
  widthMm: Float32Array;
  layerMaxSpeedMmS: Float32Array;
  airRanges: number[];
  lineStats: Record<LineTypeId, LineTypeStat>;
  minZ: number; maxZ: number; maxR: number; minC: number; maxC: number;
  generator: GCodeGenerator | null;
  layerHeightMm: Float32Array;
  layerIndex: Uint32Array;
  accelMmS2: Float32Array;
  nozzleTempC: Float32Array;
  bedTempC: Float32Array;
  fanPctArr: Float32Array;
  ranges: ColorByRanges;
}

/** Cartésien : recentre la pièce sur le plateau, détecte le non plan et les dépôts hors plateau. */
function centerCartesian(s: ParseState, d: Derived) {
  const { kind } = d;
  let usedCenter = { x: 0, y: 0 };
  let nonPlanar = false;
  const offPlateMoves: number[] = [];
  let offPlateTraits = 0;
  if (kind === 'cartesian' && s.moves.length) {
    // Non plan : plus de 5 % des dépôts changent de Z en cours de trajet.
    let zVarying = 0;
    for (let k = 1; k < s.moves.length; k++) {
      if (s.moves[k].extruding && Math.abs(s.moves[k].z - s.moves[k - 1].z) > 1e-4) zVarying++;
    }
    nonPlanar = s.extrudingCount > 0 && zVarying / s.extrudingCount > 0.05;

    let center: { x: number; y: number } | null = s.bedCenter;
    if (!center && s.bedCircular) center = { x: 0, y: 0 };
    if (!center && s.bedSizeX > 0 && s.bedSizeY > 0) center = { x: s.bedSizeX / 2, y: s.bedSizeY / 2 };
    if (!center) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const anyExtruding = s.extrudingCount > 0;
      for (const mv of s.moves) {
        if (anyExtruding && !mv.extruding) continue;
        minX = Math.min(minX, mv.x); maxX = Math.max(maxX, mv.x);
        minY = Math.min(minY, mv.y); maxY = Math.max(maxY, mv.y);
      }
      center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }
    usedCenter = center;
    for (const mv of s.moves) {
      mv.x -= center.x;
      mv.y -= center.y;
      if (!s.toolOriented) mv.b = 0;
    }
    for (let k = 1; k < s.moves.length; k++) {
      const mv = s.moves[k];
      if (!mv.extruding || Math.hypot(mv.x, mv.y) <= PLATE_RADIUS_MM) continue;
      if (offPlateMoves[offPlateMoves.length - 1] !== k - 1) offPlateTraits++;
      offPlateMoves.push(k);
    }
  }
  d.usedCenter = usedCenter;
  d.nonPlanar = nonPlanar;
  d.offPlateMoves = offPlateMoves;
  d.offPlateTraits = offPlateTraits;
}

/** Durée, vitesse et longueur de chaque mouvement. */
function computeTimes(s: ParseState, d: Derived) {
  const { kind } = d;
  // Durée de chaque mouvement. Sans ça, la lecture avancerait d'un nombre fixe de mouvements par
  // seconde : une longue ligne droite serait franchie aussi vite qu'un segment de 0,1 mm.
  //  - Cartésien : planificateur de vitesses (accélérations, jerk), cf. `planCartesianTimes`.
  //  - Polaire : distance parcourue par la pointe de buse relativement au plateau, à l'avance F.
  // Mouvement d'extrudeur seul : longueur de filament poussée/tirée, à l'avance F.
  let times: Float64Array;
  const speedMmS = new Float32Array(s.moves.length);
  const segLengthMm = new Float32Array(s.moves.length);
  if (kind === 'cartesian') {
    const cap = Math.min(s.maxSpeed, s.headerMaxSpeed);
    const planned = planCartesianTimes(s.moves, s.feeds, s.eDeltas, s.accels, s.accelsToDecel, s.jerks, cap);
    times = planned.times;
    for (let k = 1; k < s.moves.length; k++) {
      segLengthMm[k] = moveLength(s.moves[k - 1], s.moves[k], 'cartesian');
      speedMmS[k] = planned.speeds[k];
    }
  } else {
    times = new Float64Array(s.moves.length);
    for (let k = 1; k < s.moves.length; k++) {
      let dist = moveLength(s.moves[k - 1], s.moves[k], 'polar');
      if (dist < 1e-9) dist = Math.abs(s.eDeltas[k]);
      segLengthMm[k] = dist;
      const rate = s.feeds[k] / 60;
      times[k] = times[k - 1] + Math.max(MIN_MOVE_S, dist / rate);
      speedMmS[k] = dist > 1e-9 ? dist / Math.max(MIN_MOVE_S, times[k] - times[k - 1]) : rate;
    }
  }
  d.times = times;
  d.speedMmS = speedMmS;
  d.segLengthMm = segLengthMm;
}

/** Largeur de cordon (explicite, sinon estimée depuis le débit). */
function computeWidths(s: ParseState, d: Derived) {
  const { segLengthMm } = d;
  // Largeur de cordon (mm) : commentaire explicite du générateur (`;WIDTH:`) s'il en pousse un
  // avant ce dépôt (widths[k] non-NaN, cf. push()) ; sinon estimée depuis le débit de matière —
  // largeur = volume déposé / (longueur du segment × épaisseur de couche) — seulement calculable
  // là où layerHeightMm est connu (pas au tout premier passage d'un endroit donné).
  const widthMm = new Float32Array(s.moves.length);
  for (let k = 1; k < s.moves.length; k++) {
    if (!s.moves[k].extruding) { widthMm[k] = NaN; continue; }
    if (!Number.isNaN(s.widths[k])) { widthMm[k] = s.widths[k]; continue; }
    const h = s.layerHeights[k];
    const len = segLengthMm[k];
    if (Number.isNaN(h) || h <= 0 || len <= 1e-6) { widthMm[k] = NaN; continue; }
    const volumeMm3 = s.deposits[k] * Math.PI * (s.filamentDiameter / 2) ** 2;
    widthMm[k] = volumeMm3 / (len * h);
  }
  d.widthMm = widthMm;
}

/** Vitesse max de la couche courante, pour `layerSpeedRatio`. */
function computeLayerSpeeds(s: ParseState, d: Derived) {
  const { kind, speedMmS } = d;
  // Vitesse max de la couche courante (mm/s), pour `layerSpeedRatio` = speedMmS / layerMaxSpeedMmS.
  // Cartésien seulement (layerIndex reste à 0 partout en polaire, pas de palier global net).
  const layerMaxSpeedByIndex = new Map<number, number>();
  if (kind === 'cartesian') {
    for (let k = 1; k < s.moves.length; k++) {
      if (!s.moves[k].extruding) continue;
      const idx = s.layerIndices[k];
      layerMaxSpeedByIndex.set(idx, Math.max(layerMaxSpeedByIndex.get(idx) ?? 0, speedMmS[k]));
    }
  }
  const layerMaxSpeedMmS = new Float32Array(s.moves.length);
  for (let k = 1; k < s.moves.length; k++) {
    layerMaxSpeedMmS[k] = layerMaxSpeedByIndex.get(s.layerIndices[k]) ?? 0;
  }
  d.layerMaxSpeedMmS = layerMaxSpeedMmS;
}

/** Requalifie les contours imprimés dans l'air et retire leurs coutures. */
function markAirContours(s: ParseState, d: Derived) {
  const { kind } = d;
  // Contours émis dans l'air par le PrusaSlicer à couches non planaires : requalifiés (rouge) avant les
  // statistiques, et leurs coutures retirées (une par tronçon : elles masqueraient le tracé).
  const airRanges: number[] = [];
  if (kind === 'cartesian' && s.nonplanarFeatures) {
    for (const run of findAirContours(s.moves)) {
      airRanges.push(run.start, run.end);
      for (let k = run.start; k <= run.end; k++) {
        if (s.moves[k].extruding && (s.moves[k].type === 'outerWall' || s.moves[k].type === 'innerWall')) s.moves[k].type = 'airContour';
      }
    }
    if (airRanges.length) {
      const inAir = (k: number) => {
        for (let r = 0; r < airRanges.length; r += 2) if (k >= airRanges[r] - 1 && k <= airRanges[r + 1]) return true;
        return false;
      };
      for (let i = s.seamAt.length - 1; i >= 0; i--) if (inAir(s.seamAt[i])) s.seamAt.splice(i, 1);
    }
  }
  d.airRanges = airRanges;
}

/** Statistiques par type de ligne (durée, filament, masse). */
function computeLineStats(s: ParseState, d: Derived) {
  const { times } = d;
  const lineStats = emptyStats();
  for (let k = 1; k < s.moves.length; k++) {
    const stat = lineStats[s.moves[k].type];
    stat.time += times[k] - times[k - 1];
    stat.filamentMm += s.deposits[k];
  }
  const gPerMm = Math.PI * (s.filamentDiameter / 2) ** 2 * s.filamentDensity / 1000;
  for (const stat of Object.values(lineStats)) stat.massG = stat.filamentMm * gPerMm;
  d.lineStats = lineStats;
}

/** Bornes en Z/R de la pointe de buse (ce qui est affiché), pas du pivot. */
function computeBounds(s: ParseState, d: Derived) {
  const { kind } = d;
  // Bornes en Z/R de la pointe de buse (ce qui est affiché), pas du pivot.
  let minZ = Infinity, maxZ = -Infinity, maxR = 0, minC = Infinity, maxC = -Infinity;
  const tip = { r: 0, z: 0 };
  for (const mv of s.moves) {
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
  if (!s.moves.length) { minZ = maxZ = 0; }
  if (minC > maxC) { minC = maxC = 0; }
  d.minZ = minZ;
  d.maxZ = maxZ;
  d.maxR = maxR;
  d.minC = minC;
  d.maxC = maxC;
}

/** Générateur du fichier : signature, sinon déduction. */
function resolveGenerator(s: ParseState, d: Derived) {
  const { kind } = d;
  let generator: GCodeGenerator | null = null;
  if (s.signature) generator = { name: s.signature, inferred: false };
  else if (kind === 'polar') generator = { name: 'Générateur Apex 4 axes', inferred: true };
  else if (s.featureStyleGuess) generator = { name: s.featureStyleGuess, inferred: true };
  else if (s.iceSLLayers) generator = { name: 'IceSL', inferred: true };
  // PrusaSlicer modifié (couches non planaires) : ses marqueurs `;TYPE:Nonplanar …` n'existent pas dans l'original.
  if (generator && s.nonplanarFeatures && /PrusaSlicer/i.test(generator.name)) generator.name += ' (Non-planar fork)';
  d.generator = generator;
}

/** Tableaux typés par mouvement et bornes (min, max, moyenne) de chaque mode de coloration continu. */
function computeRanges(s: ParseState, d: Derived) {
  const { times, speedMmS, segLengthMm, widthMm, layerMaxSpeedMmS } = d;
  const layerHeightMm = Float32Array.from(s.layerHeights);
  const layerIndex = Uint32Array.from(s.layerIndices);
  const accelMmS2 = Float32Array.from(s.accels);
  const nozzleTempC = Float32Array.from(s.temps);
  const bedTempC = Float32Array.from(s.bedTemps);
  const fanPctArr = Float32Array.from(s.fans);

  // Débit volumétrique (mm³/s) et pression d'extrusion relative (E/mm) : purs ratios dérivés,
  // recalculés à la volée plutôt que stockés (cf. plan §1.4) — un seul passage supplémentaire,
  // négligeable à côté des passes déjà faites ci-dessus, réutilisé pour l'agrégation min/max/moy.
  const volumetricFlowAt = (k: number) => {
    const dt = times[k] - times[k - 1];
    if (!s.moves[k].extruding || dt <= 0) return NaN;
    const volumeMm3 = s.deposits[k] * Math.PI * (s.filamentDiameter / 2) ** 2;
    return volumeMm3 / dt;
  };
  const extrusionRatioAt = (k: number) => {
    if (!s.moves[k].extruding || segLengthMm[k] <= 1e-6) return NaN;
    return s.deposits[k] / segLengthMm[k];
  };
  const layerSpeedRatioAt = (k: number) => {
    if (!s.moves[k].extruding || layerMaxSpeedMmS[k] <= 1e-6) return NaN;
    return (speedMmS[k] / layerMaxSpeedMmS[k]) * 100;
  };

  const CONTINUOUS_MODES: ContinuousColorByMode[] = [
    'speed', 'accel', 'headAngle', 'segmentLength', 'elapsedTime', 'extrusionRatio',
    'volumetricFlow', 'layerSpeedRatio', 'lineWidth', 'layerHeight', 'temperature', 'fanSpeed',
  ];
  const valueAt: Record<ContinuousColorByMode, (k: number) => number> = {
    speed: (k) => speedMmS[k],
    accel: (k) => accelMmS2[k],
    headAngle: (k) => Math.abs(s.moves[k].b),
    segmentLength: (k) => segLengthMm[k],
    elapsedTime: (k) => times[k],
    extrusionRatio: extrusionRatioAt,
    volumetricFlow: volumetricFlowAt,
    layerSpeedRatio: layerSpeedRatioAt,
    lineWidth: (k) => widthMm[k],
    layerHeight: (k) => layerHeightMm[k],
    temperature: (k) => nozzleTempC[k],
    fanSpeed: (k) => fanPctArr[k],
  };
  const ranges = {} as ColorByRanges;
  for (const mode of CONTINUOUS_MODES) {
    const get = valueAt[mode];
    let min = Infinity, max = -Infinity, sum = 0, n = 0;
    for (let k = 1; k < s.moves.length; k++) {
      const v = get(k);
      if (Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      n++;
    }
    ranges[mode] = n > 0 ? { min, max, avg: sum / n } : { min: 0, max: 0, avg: 0 };
  }
  d.layerHeightMm = layerHeightMm;
  d.layerIndex = layerIndex;
  d.accelMmS2 = accelMmS2;
  d.nozzleTempC = nozzleTempC;
  d.bedTempC = bedTempC;
  d.fanPctArr = fanPctArr;
  d.ranges = ranges;
}

/** Assemble le résultat final. */
function buildResult(s: ParseState, d: Derived): ParsedGCode {
  const {
    kind, usedCenter, nonPlanar, offPlateMoves, offPlateTraits, times, speedMmS, segLengthMm, widthMm, layerMaxSpeedMmS,
    airRanges, lineStats, minZ, maxZ, maxR, minC, maxC, generator, layerHeightMm, layerIndex, accelMmS2, nozzleTempC,
    bedTempC, fanPctArr, ranges,
  } = d;
  return {
    kind,
    kinematics: s.kinematics,
    kinematicsDeclared: s.declaredKinematics !== null,
    moves: s.moves,
    times,
    minZ,
    maxZ,
    maxR,
    minC,
    maxC,
    extrudingCount: s.extrudingCount,
    lineStats,
    generator,
    printer: s.printer,
    nonPlanar,
    toolOriented: s.toolOriented,
    bedCenter: usedCenter,
    conversion: s.conversion,
    offPlate: { moves: Uint32Array.from(offPlateMoves), traits: offPlateTraits },
    airContours: Uint32Array.from(airRanges),
    markers: {
      retraction: Uint32Array.from(s.retractionAt),
      unretraction: Uint32Array.from(s.unretractionAt),
      seam: Uint32Array.from(s.seamAt),
    },
    speedMmS,
    accelMmS2,
    nozzleTempC,
    bedTempC,
    fanPct: fanPctArr,
    layerHeightMm,
    widthMm,
    segLengthMm,
    depositMm: Float32Array.from(s.deposits),
    filamentDiameterMm: s.filamentDiameter,
    layerIndex,
    layerMaxSpeedMmS,
    ranges,
    lineIndex: Uint32Array.from(s.lineIndices),
    eDelta: Float64Array.from(s.eDeltas),
    eAbsBefore: Float64Array.from(s.eAbsBefores),
    hasEWord: Uint8Array.from(s.eWordFlags),
    eRelative: Uint8Array.from(s.eRelFlags),
    usesInches: s.usesInches,
  };
}

/** Après la lecture des lignes : géométrie, durées, statistiques, bornes, plages de coloration. */
export function finalizeParse(s: ParseState): ParsedGCode {
  const d = { kind: s.polar ? 'polar' : 'cartesian' } as Derived;
  centerCartesian(s, d);
  computeTimes(s, d);
  computeWidths(s, d);
  computeLayerSpeeds(s, d);
  markAirContours(s, d);
  computeLineStats(s, d);
  computeBounds(s, d);
  resolveGenerator(s, d);
  computeRanges(s, d);
  return buildResult(s, d);
}
