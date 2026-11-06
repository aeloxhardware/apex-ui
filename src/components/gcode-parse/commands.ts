import type { ParserState, Words } from './state';
import { WORD_KEYS } from './state';
import { handleComment } from './comments';
import { pushMove } from './emit';
import {
  ARC_MAX_CHORD_MM, ARC_MAX_SEGMENTS, ARC_MAX_STEP_RAD, COMMAND_RE, VELOCITY_LIMIT_RE,
  VELOCITY_PARAM_RE, WORD_RE,
} from './constants';

const has = (v: number) => !Number.isNaN(v);

function readWords(s: ParserState, args: string) {
  const w = s.w;
  for (const key of WORD_KEYS) w[key] = NaN;
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(args)) !== null) {
    if (m[1] in w) w[m[1] as keyof Words] = parseFloat(m[2]);
  }
}

function axis(s: ParserState, current: number, word: number, scale: number) {
  return has(word) ? (s.relativeXYZ ? current + word * scale : word * scale) : current;
}

/** Variation de E de la ligne en cours (mm), et mémorise la position E absolue. */
function extrusionDelta(s: ParserState) {
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

/** Klipper : SET_VELOCITY_LIMIT [VELOCITY=] [ACCEL=] [ACCEL_TO_DECEL=] [SQUARE_CORNER_VELOCITY=]. */
function handleVelocityLimit(s: ParserState, code: string) {
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

function handleMCode(s: ParserState, num: number) {
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

/** G0/G1 : déplacement linéaire. */
function handleLinear(s: ParserState) {
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
  const nb = s.toolOriented
    ? (has(bWord) ? bWord : s.b)
    : s.apexMachine === 'cartesian' ? 0 : axis(s, s.b, bWord, 1);
  pushMove(s, nx, ny, nz, nb, extrusionDelta(s), s.toolOriented && has(w.C) ? w.C : s.c);
}

/** Centre de l'arc G2/G3 (I/J ou rayon R) ; null si l'arc se réduit à une corde. */
function arcCenter(s: ParserState, ex: number, ey: number, ccw: boolean) {
  const w = s.w;
  if (has(w.I) || has(w.J)) {
    return { cx: s.x + (has(w.I) ? w.I * s.unit : 0), cy: s.y + (has(w.J) ? w.J * s.unit : 0) };
  }
  if (!has(w.R)) return null;
  const r = w.R * s.unit;
  const dx = ex - s.x, dy = ey - s.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9 || Math.abs(r) < d / 2) return null;
  const h = Math.sqrt(r * r - (d * d) / 4) * (ccw ? 1 : -1) * (r > 0 ? 1 : -1);
  return { cx: (s.x + ex) / 2 - (dy / d) * h, cy: (s.y + ey) / 2 + (dx / d) * h };
}

/** G2/G3 : arc découpé en segments droits (corde et angle maxima). */
function handleArc(s: ParserState, num: number) {
  const w = s.w;
  if (has(w.F) && w.F > 0) s.feed = w.F * s.unit;
  const ex = axis(s, s.x, w.X, s.unit);
  const ey = axis(s, s.y, w.Y, s.unit);
  const ez = axis(s, s.z, w.Z, s.unit);
  const de = extrusionDelta(s);
  const ccw = num === 3;
  const center = arcCenter(s, ex, ey, ccw);
  if (!center) { pushMove(s, ex, ey, ez, s.b, de); return; }
  const { cx, cy } = center;
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
    if (i === n) { pushMove(s, ex, ey, ez, s.b, de / n); break; }
    const a = a0 + (sweep * i) / n;
    pushMove(s, cx + radius * Math.cos(a), cy + radius * Math.sin(a), z0 + ((ez - z0) * i) / n, s.b, de / n);
  }
}

/** G28 (origine) et G92 (position courante). */
function handleHoming(s: ParserState, num: number) {
  const w = s.w;
  if (num === 28) {
    const all = !has(w.X) && !has(w.Y) && !has(w.Z);
    if (all || has(w.X)) s.x = 0;
    if (all || has(w.Y)) s.y = 0;
    if (all || has(w.Z)) s.z = 0;
    return;
  }
  if (has(w.X)) s.x = w.X * s.unit;
  if (has(w.Y)) s.y = w.Y * s.unit;
  if (has(w.Z)) s.z = w.Z * s.unit;
  if (has(w.B)) s.b = w.B;
  if (has(w.E)) s.eAbs = w.E * s.unit;
}

function handleGCode(s: ParserState, num: number) {
  const w = s.w;
  switch (num) {
    case 0:
    case 1: handleLinear(s); break;
    case 2:
    case 3: handleArc(s, num); break;
    // G10 sans L/P/S : rétraction firmware (avec L/P : origine CNC ; avec S : température RRF — ignorés).
    case 10: if (!has(w.L) && !has(w.P) && !has(w.S)) pushMove(s, s.x, s.y, s.z, s.b, -s.firmwareRetract); break;
    case 11: pushMove(s, s.x, s.y, s.z, s.b, s.firmwareRetract); break;
    case 20: s.unit = 25.4; s.usesInches = true; break;
    case 21: s.unit = 1; break;
    case 28:
    case 92: handleHoming(s, num); break;
    case 90: s.relativeXYZ = false; break;
    case 91: s.relativeXYZ = true; break;
  }
}

/** Code d'une ligne sans commentaires (`;` et `( … )` transmis à handleComment), en majuscules. */
function stripComments(s: ParserState, rawLine: string) {
  const semi = rawLine.indexOf(';');
  if (semi >= 0) handleComment(s, rawLine.slice(semi + 1));
  let code = semi >= 0 ? rawLine.slice(0, semi) : rawLine;
  if (code.includes('(')) {
    code = code.replace(/\(([^)]*)\)/g, (_, comment: string) => { handleComment(s, comment); return ' '; });
  }
  return code.trim().toUpperCase();
}

/** Interprète une ligne du fichier (index `lineNo` à partir de 0). */
export function parseLine(s: ParserState, rawLine: string, lineNo: number) {
  s.currentLine = lineNo;
  s.currentHasE = false;
  s.currentEAbsBefore = s.eAbs ?? NaN;
  const code = stripComments(s, rawLine);
  if (!code) return;
  if (VELOCITY_LIMIT_RE.test(code)) { handleVelocityLimit(s, code); return; }
  const cmd = COMMAND_RE.exec(code);
  if (!cmd) return;
  const num = parseInt(cmd[2], 10);
  readWords(s, code.slice(cmd[0].length));
  if (cmd[1] === 'M') handleMCode(s, num);
  else handleGCode(s, num);
}
