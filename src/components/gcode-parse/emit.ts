import type { LineTypeId } from '../gcodeLineTypes';
import type { ParserState } from './state';
import { E_EPS, LAYER_Z_EPS, POLAR_LAYER_ANGLE_TOLERANCE_DEG, POLAR_LAYER_BUCKETS } from './constants';

/** Sépare une variation de E en part réinjectée (après rétraction) et part déposée. */
function splitDeposit(s: ParserState, de: number) {
  let restore = 0;
  let deposit = 0;
  if (de > E_EPS) {
    restore = Math.min(de, s.retracted);
    s.retracted -= restore;
    deposit = de - restore;
  } else if (de < -E_EPS) {
    s.retracted -= de;
  }
  return { restore, deposit };
}

function classifyMove(s: ParserState, moved: boolean, deposit: number, de: number) {
  let type: LineTypeId;
  let extruding = false;
  if (s.inWipe && moved) type = 'wipe';
  else if (moved && deposit > E_EPS) { type = s.feature; extruding = true; }
  else if (moved) type = 'travel';
  else if (de < -E_EPS) type = 'retraction';
  else if (de > E_EPS) type = 'unretraction';
  else type = 'travel';
  return { type, extruding };
}

/**
 * Épaisseur locale de couche (mm), seulement sur les dépôts : cartésien, palier Z classique
 * (delta avec le dernier Z extrudant vu) ; polaire, delta Z avec le dernier dépôt au même angle
 * C (modulo 360°, à POLAR_LAYER_ANGLE_TOLERANCE_DEG près) — reflète l'épaisseur réellement
 * posée à cet endroit, cohérent avec la nature hélicoïdale de l'impression polaire (pas de
 * palier Z global net). NaN tant qu'aucun repère n'existe encore (premier passage).
 */
function trackLayerHeight(s: ParserState, ny: number, nz: number) {
  let layerHeight = NaN;
  if (!s.polar) {
    if (s.prevLayerExtrudingZ !== null && Math.abs(nz - s.prevLayerExtrudingZ) > LAYER_Z_EPS) s.layerIdx++;
    if (s.prevLayerExtrudingZ !== null) layerHeight = nz - s.prevLayerExtrudingZ;
    s.prevLayerExtrudingZ = nz;
  } else {
    const bucket = ((Math.round(ny / POLAR_LAYER_ANGLE_TOLERANCE_DEG) % POLAR_LAYER_BUCKETS) + POLAR_LAYER_BUCKETS) % POLAR_LAYER_BUCKETS;
    const prevZ = s.polarLayerZByBucket[bucket];
    if (!Number.isNaN(prevZ)) layerHeight = nz - prevZ;
    s.polarLayerZByBucket[bucket] = nz;
  }
  return layerHeight;
}

/** Colonnes parallèles aux mouvements : modal du firmware et correspondance avec le texte. */
function pushColumns(s: ParserState, de: number, deposit: number, extruding: boolean, layerHeight: number) {
  const relative = s.relativeXYZ || s.relativeE;
  s.feeds.push(s.feed);
  s.eDeltas.push(de);
  s.deposits.push(extruding ? deposit : 0);
  s.accels.push(extruding ? s.accelPrint : s.accelTravel);
  s.jerks.push(s.jerk);
  s.accelsToDecel.push(s.accelToDecel);
  s.temps.push(s.nozzleTemp);
  s.bedTemps.push(s.bedTemp);
  s.fans.push(s.fanPct);
  s.widths.push(s.explicitWidth);
  s.layerHeights.push(layerHeight);
  s.layerIndices.push(s.polar ? 0 : s.layerIdx);
  s.lineIndices.push(s.currentLine);
  s.eAbsBefores.push(relative ? NaN : s.currentEAbsBefore);
  s.eWordFlags.push(s.currentHasE ? 1 : 0);
  s.eRelFlags.push(relative ? 1 : 0);
}

/** Rétractions, réinjections et coutures : marqueurs ponctuels par index de mouvement. */
function recordMarkers(s: ParserState, k: number, type: LineTypeId, de: number, restore: number) {
  const retracting = de < -E_EPS;
  const restoring = restore > E_EPS;
  if (retracting && !s.prevRetracting) s.retractionAt.push(k);
  if (restoring && !s.prevRestoring) s.unretractionAt.push(k);
  s.prevRetracting = retracting;
  s.prevRestoring = restoring;
  // Couture : début d'une boucle de paroi extérieure, à la position d'où part ce mouvement.
  if (type === 'outerWall' && k > 0 && s.moves[k - 1].type !== 'outerWall') s.seamAt.push(k - 1);
}

/** Ajoute un mouvement à la position (nx, ny, nz, nb, nc) avec la variation d'extrudeur `de`. */
export function pushMove(s: ParserState, nx: number, ny: number, nz: number, nb: number, de: number, nc = s.c) {
  const moved = nx !== s.x || ny !== s.y || nz !== s.z || nb !== s.b;
  const { restore, deposit } = splitDeposit(s, de);
  const { type, extruding } = classifyMove(s, moved, deposit, de);
  recordMarkers(s, s.moves.length, type, de, restore);
  if (extruding) s.extrudingCount++;
  s.moves.push({ x: nx, y: ny, z: nz, b: nb, c: nc, extruding, type });
  pushColumns(s, de, deposit, extruding, extruding ? trackLayerHeight(s, ny, nz) : NaN);
  s.x = nx; s.y = ny; s.z = nz; s.b = nb; s.c = nc;
}
