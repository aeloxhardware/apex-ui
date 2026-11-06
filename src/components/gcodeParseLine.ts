import { resolveLineType, type LineTypeId } from './gcodeLineTypes';
import { detectGeneratorSignature, guessGeneratorFromFeature } from './gcodeGenerator';
import {
  ARC_MAX_CHORD_MM, ARC_MAX_SEGMENTS, ARC_MAX_STEP_RAD, COMMAND_RE, E_EPS, FEATURE_RE, GENERATOR_SCAN_MOVES, HEADER_RE,
  ICESL_LAYER_RE, LAYER_Z_EPS, POLAR_LAYER_ANGLE_TOLERANCE_DEG, POLAR_LAYER_BUCKETS, TOOL_AXIS_RE, VELOCITY_LIMIT_RE,
  VELOCITY_PARAM_RE, WIDTH_RE, WIPE_END_RE, WIPE_START_RE, WORD_RE, shapeCenter,
} from './gcodeParseConstants';
import { WORD_KEYS, type ParseState, type Words } from './gcodeParseState';

/** Interprète un commentaire : type de ligne, essuyage, en-têtes (plateau, filament, imprimante…). */
function handleComment(s: ParseState, comment: string) {
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
  if (!header) return;
  const key = header[1].toLowerCase();
  const raw = header[2];
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

/** Ajoute un mouvement (position, extrusion) et met à jour tous les tableaux par mouvement. */
function push(s: ParseState, nx: number, ny: number, nz: number, nb: number, de: number, nc = s.c) {
  const moved = nx !== s.x || ny !== s.y || nz !== s.z || nb !== s.b;
  let restore = 0;
  let deposit = 0;
  if (de > E_EPS) {
    restore = Math.min(de, s.retracted);
    s.retracted -= restore;
    deposit = de - restore;
  } else if (de < -E_EPS) {
    s.retracted -= de;
  }

  let type: LineTypeId;
  let extruding = false;
  if (s.inWipe && moved) type = 'wipe';
  else if (moved && deposit > E_EPS) { type = s.feature; extruding = true; }
  else if (moved) type = 'travel';
  else if (de < -E_EPS) type = 'retraction';
  else if (de > E_EPS) type = 'unretraction';
  else type = 'travel';

  const k = s.moves.length;
  const retracting = de < -E_EPS;
  const restoring = restore > E_EPS;
  if (retracting && !s.prevRetracting) s.retractionAt.push(k);
  if (restoring && !s.prevRestoring) s.unretractionAt.push(k);
  s.prevRetracting = retracting;
  s.prevRestoring = restoring;
  // Couture : début d'une boucle de paroi extérieure, à la position d'où part ce mouvement.
  if (type === 'outerWall' && k > 0 && s.moves[k - 1].type !== 'outerWall') s.seamAt.push(k - 1);

  if (extruding) s.extrudingCount++;
  s.moves.push({ x: nx, y: ny, z: nz, b: nb, c: nc, extruding, type });
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

  // Épaisseur locale de couche (mm), seulement sur les dépôts : cartésien, palier Z classique
  // (delta avec le dernier Z extrudant vu) ; polaire, delta Z avec le dernier dépôt au même angle
  // C (modulo 360°, à POLAR_LAYER_ANGLE_TOLERANCE_DEG près) — reflète l'épaisseur réellement
  // posée à cet endroit, cohérent avec la nature hélicoïdale de l'impression polaire (pas de
  // palier Z global net). NaN tant qu'aucun repère n'existe encore (premier passage).
  let layerHeight = NaN;
  if (extruding) {
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
  }
  s.layerHeights.push(layerHeight);
  s.layerIndices.push(s.polar ? 0 : s.layerIdx);
  s.lineIndices.push(s.currentLine);
  s.eAbsBefores.push(s.relativeXYZ || s.relativeE ? NaN : s.currentEAbsBefore);
  s.eWordFlags.push(s.currentHasE ? 1 : 0);
  s.eRelFlags.push(s.relativeXYZ || s.relativeE ? 1 : 0);

  s.x = nx; s.y = ny; s.z = nz; s.b = nb; s.c = nc;
}

/** Lit les mots (lettre → valeur) d'une ligne de commande dans `s.w`, NaN si absent. */
function readWords(s: ParseState, args: string) {
  const w = s.w;
  for (const key of WORD_KEYS) w[key] = NaN;
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(args)) !== null) {
    if (m[1] in w) w[m[1] as keyof Words] = parseFloat(m[2]);
  }
}

const has = (v: number) => !Number.isNaN(v);

const axis = (s: ParseState, current: number, word: number, scale: number) =>
  has(word) ? (s.relativeXYZ ? current + word * scale : word * scale) : current;

/** Variation d'extrusion (mm) de la commande courante ; met à jour la position E absolue. */
function extrusionDelta(s: ParseState) {
  const w = s.w;
  s.currentHasE = has(w.E);
  s.currentEAbsBefore = s.eAbs ?? NaN;
  if (!has(w.E)) return 0;
  const e = w.E * s.unit;
  if (s.relativeXYZ || s.relativeE) return e;
  const de = s.eAbs === null ? 0 : e - s.eAbs;
  s.eAbs = e;
  return de;
}

/** Sépare code et commentaires d'une ligne (commentaires traités au passage) ; renvoie le code en majuscules. */
function prepareLine(s: ParseState, rawLine: string, lineNo: number): string {
  s.currentLine = lineNo;
  s.currentHasE = false;
  s.currentEAbsBefore = s.eAbs ?? NaN;
  const semi = rawLine.indexOf(';');
  if (semi >= 0) handleComment(s, rawLine.slice(semi + 1));
  let code = semi >= 0 ? rawLine.slice(0, semi) : rawLine;
  if (code.includes('(')) {
    code = code.replace(/\(([^)]*)\)/g, (_, comment: string) => { handleComment(s, comment); return ' '; });
  }
  return code.trim().toUpperCase();
}

/** Limites de vitesse écrites en paramètres (ACCEL, ACCEL_TO_DECEL, VELOCITY, SQUARE_CORNER_VELOCITY). */
function applyVelocityLimits(s: ParseState, code: string) {
    VELOCITY_PARAM_RE.lastIndex = 0;
    let p: RegExpExecArray | null;
    while ((p = VELOCITY_PARAM_RE.exec(code)) !== null) {
      const value = parseFloat(p[2]);
      if (!(value > 0)) continue;
      if (p[1] === 'ACCEL') s.accelPrint = s.accelTravel = value;
      else if (p[1] === 'ACCEL_TO_DECEL') s.accelToDecel = value;
      else if (p[1] === 'VELOCITY') s.maxSpeed = value;
      else s.jerk = value;
    }
}

/** Commandes M : mode E, limites, températures, ventilateur. */
function handleMCode(s: ParseState, num: number) {
  const w = s.w;
    if (num === 82) s.relativeE = false;
    else if (num === 83) s.relativeE = true;
    else if (num === 203 && w.X > 0) s.maxSpeed = w.X;
    else if (num === 204) {
      if (w.S > 0) s.accelPrint = s.accelTravel = w.S;
      if (w.P > 0) s.accelPrint = w.P;
      if (w.T > 0) s.accelTravel = w.T;
    } else if (num === 205 && w.X > 0) s.jerk = w.X;
    // Consigne commandée uniquement (M109/M190 attendent la stabilisation avant de continuer,
    // mais pour une prévisualisation statique seule la valeur cible importe).
    else if ((num === 104 || num === 109) && w.S >= 0) s.nozzleTemp = w.S;
    else if ((num === 140 || num === 190) && w.S >= 0) s.bedTemp = w.S;
    else if (num === 106 && w.S >= 0) s.fanPct = Math.round((w.S / 255) * 100);
    else if (num === 107) s.fanPct = 0;
}

/** G0 / G1 : déplacement linéaire (polaire, cartésien ou orienté outil). */
function handleLinear(s: ParseState) {
  const w = s.w;
    // Fichier Apex qui déclare sa machine : on ne la déduit pas des mots B et C (écrits à 0 sur tous les mouvements).
    if (s.apexMachine === 'polar') { if (has(w.B)) s.polar = true; }
    else if (s.apexMachine === null) {
      if (has(w.C)) s.toolOriented = true;
      if (has(w.B) && !s.toolOriented) s.polar = true;
    }
    if (has(w.F) && w.F > 0) s.feed = w.F * s.unit;
    // Orientation d'outil : B = −90 est l'outil vertical, donc l'inclinaison est B + 90.
    const bWord = s.toolOriented && has(w.B) ? w.B + 90 : w.B;
    if (!has(w.X) && !has(w.Y) && !has(w.Z) && !has(bWord) && !has(w.C) && !has(w.E)) return;
    const nx = axis(s, s.x, w.X, s.unit);
    const ny = axis(s, s.y, w.Y, s.unit);
    const nz = axis(s, s.z, w.Z, s.unit);
    const nb = s.toolOriented ? (has(bWord) ? bWord : s.b) : s.apexMachine === 'cartesian' ? 0 : axis(s, s.b, bWord, 1);
    push(s, nx, ny, nz, nb, extrusionDelta(s), s.toolOriented && has(w.C) ? w.C : s.c);
}

/** G2 / G3 : arc, découpé en segments. */
function handleArc(s: ParseState, num: number) {
  const w = s.w;
    if (has(w.F) && w.F > 0) s.feed = w.F * s.unit;
    const ex = axis(s, s.x, w.X, s.unit);
    const ey = axis(s, s.y, w.Y, s.unit);
    const ez = axis(s, s.z, w.Z, s.unit);
    const de = extrusionDelta(s);
    const ccw = num === 3;
    let cx: number, cy: number;
    if (has(w.I) || has(w.J)) {
      cx = s.x + (has(w.I) ? w.I * s.unit : 0);
      cy = s.y + (has(w.J) ? w.J * s.unit : 0);
    } else if (has(w.R)) {
      const r = w.R * s.unit;
      const dx = ex - s.x, dy = ey - s.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9 || Math.abs(r) < d / 2) { push(s, ex, ey, ez, s.b, de); return; }
      const h = Math.sqrt(r * r - (d * d) / 4) * (ccw ? 1 : -1) * (r > 0 ? 1 : -1);
      cx = (s.x + ex) / 2 - (dy / d) * h;
      cy = (s.y + ey) / 2 + (dx / d) * h;
    } else {
      push(s, ex, ey, ez, s.b, de);
      return;
    }
    const radius = Math.hypot(s.x - cx, s.y - cy);
    const a0 = Math.atan2(s.y - cy, s.x - cx);
    let sweep = Math.atan2(ey - cy, ex - cx) - a0;
    if (ccw) { while (sweep <= 1e-9) sweep += 2 * Math.PI; }
    else { while (sweep >= -1e-9) sweep -= 2 * Math.PI; }
    const n = Math.min(ARC_MAX_SEGMENTS, Math.max(
      1,
      Math.ceil((Math.abs(sweep) * radius) / ARC_MAX_CHORD_MM),
      Math.ceil(Math.abs(sweep) / ARC_MAX_STEP_RAD),
    ));
    const z0 = s.z;
    for (let i = 1; i <= n; i++) {
      if (i === n) { push(s, ex, ey, ez, s.b, de / n); break; }
      const a = a0 + (sweep * i) / n;
      push(s, cx + radius * Math.cos(a), cy + radius * Math.sin(a), z0 + ((ez - z0) * i) / n, s.b, de / n);
    }
}

/** Autres commandes G : rétractions firmware, unités, origine, modes de position, G92. */
function handleModalG(s: ParseState, num: number) {
  const w = s.w;
  switch (num) {
    case 10:
      // G10 sans L/P/S : rétraction firmware (avec L/P : origine CNC ; avec S : température RRF — ignorés).
      if (!has(w.L) && !has(w.P) && !has(w.S)) push(s, s.x, s.y, s.z, s.b, -s.firmwareRetract);
      break;
    case 11:
      push(s, s.x, s.y, s.z, s.b, s.firmwareRetract);
      break;
    case 20: s.unit = 25.4; s.usesInches = true; break;
    case 21: s.unit = 1; break;
    case 28: {
      const all = !has(w.X) && !has(w.Y) && !has(w.Z);
      if (all || has(w.X)) s.x = 0;
      if (all || has(w.Y)) s.y = 0;
      if (all || has(w.Z)) s.z = 0;
      break;
    }
    case 90: s.relativeXYZ = false; break;
    case 91: s.relativeXYZ = true; break;
    case 92:
      if (has(w.X)) s.x = w.X * s.unit;
      if (has(w.Y)) s.y = w.Y * s.unit;
      if (has(w.Z)) s.z = w.Z * s.unit;
      if (has(w.B)) s.b = w.B;
      if (has(w.E)) s.eAbs = w.E * s.unit;
      break;
  }
}

/** Analyse une ligne du fichier. */
export function processLine(s: ParseState, rawLine: string, lineNo: number) {
  const code = prepareLine(s, rawLine, lineNo);
  if (!code) return;
  if (VELOCITY_LIMIT_RE.test(code)) { applyVelocityLimits(s, code); return; }
  const cmd = COMMAND_RE.exec(code);
  if (!cmd) return;
  const num = parseInt(cmd[2], 10);
  readWords(s, code.slice(cmd[0].length));
  if (cmd[1] === 'M') { handleMCode(s, num); return; }
  if (num === 0 || num === 1) handleLinear(s);
  else if (num === 2 || num === 3) handleArc(s, num);
  else handleModalG(s, num);
}
