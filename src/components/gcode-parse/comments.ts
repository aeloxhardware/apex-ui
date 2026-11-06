import { resolveLineType } from '../gcodeLineTypes';
import { detectGeneratorSignature, guessGeneratorFromFeature } from '../gcodeGenerator';
import type { ParserState } from './state';
import {
  FEATURE_RE, GENERATOR_SCAN_MOVES, HEADER_RE, ICESL_LAYER_RE, TOOL_AXIS_RE, WIDTH_RE,
  WIPE_END_RE, WIPE_START_RE,
} from './constants';

/** Centre du rectangle englobant d'une liste de points « AxB,CxD,… » (printable_area, bed_shape). */
function shapeCenter(value: string) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pt of value.split(',')) {
    const [a, b] = pt.split('x').map(parseFloat);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    minX = Math.min(minX, a); maxX = Math.max(maxX, a);
    minY = Math.min(minY, b); maxY = Math.max(maxY, b);
  }
  return minX <= maxX ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : null;
}

/** Réglage d'en-tête `clé = valeur` : plateau, filament, vitesse max, imprimante, conversion. */
function applyHeaderSetting(s: ParserState, key: string, raw: string) {
  const value = parseFloat(raw);
  switch (key) {
    case 'printable_area':
    case 'bed_shape':
      s.bedCenter = shapeCenter(raw) ?? s.bedCenter;
      break;
    case 'bed_size_x_mm': if (value > 0) s.bedSizeX = value; break;
    case 'bed_size_y_mm': if (value > 0) s.bedSizeY = value; break;
    case 'bed_circular': s.bedCircular = /^true/i.test(raw); break;
    case 'filament_diameter':
    case 'filament_diameter_mm_0':
      if (value > 0) s.filamentDiameter = value;
      break;
    case 'filament_density': if (value > 0) s.filamentDensity = value; break;
    case 'machine_max_speed_x': if (value > 0) s.headerMaxSpeed = value; break;
    case 'retraction_length': if (value > 0) s.firmwareRetract = value; break;
    case 'printer_model':
    case 'printer':
    case 'target_machine.name':
      if (!s.printer && raw) s.printer = raw;
      break;
    case 'apex_conversion_mode':
      if (raw === 'polar' || raw === 'dynamic') s.conversion = raw;
      break;
  }
}

/** Interprète un commentaire : essuyage, type de ligne, largeur de cordon, en-tête de réglages. */
export function handleComment(s: ParserState, comment: string) {
  if (TOOL_AXIS_RE.test(comment)) { if (!s.apexMachine) s.toolOriented = true; return; }
  if (WIPE_START_RE.test(comment)) { s.inWipe = true; return; }
  if (WIPE_END_RE.test(comment)) { s.inWipe = false; return; }
  if (!s.signature && s.moves.length < GENERATOR_SCAN_MOVES) s.signature = detectGeneratorSignature(comment);
  const feat = FEATURE_RE.exec(comment);
  if (feat && !comment.includes('=')) {
    s.feature = resolveLineType(feat[1]);
    if (s.feature === 'nonplanarSolidInfill' || s.feature === 'nonplanarTopSurface') s.nonplanarFeatures = true;
    s.featureStyleGuess ??= guessGeneratorFromFeature(feat[1], !/^\s*(?:TYPE|FEATURE)\s*:/i.test(comment));
    return;
  }
  if (ICESL_LAYER_RE.test(comment)) { s.iceSLLayers = true; return; }
  const width = WIDTH_RE.exec(comment);
  if (width) { s.explicitWidth = parseFloat(width[1]); return; }
  const header = HEADER_RE.exec(comment);
  if (header) applyHeaderSetting(s, header[1].toLowerCase(), header[2]);
}
