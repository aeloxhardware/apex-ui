import type { GCodeMove, ParsedGCode } from './gcodeTypes';
import { createParseState } from './gcodeParseState';
import { processLine } from './gcodeParseLine';
import { DEG2RAD } from './gcodeParseConstants';
import { finalizeParse } from './gcodeParsePost';

/**
 * Parseur G-code + calque Babylon de prévisualisation. Deux familles de fichiers :
 *
 * 1. G-code polaire 4 axes de l'Apex (reconnu à la présence d'un mot B dans les déplacements) :
 *    `G00 Y<C> X<R> Z<Z> B<B> [E<e>] F<f>`.
 *    - X = R : rayon depuis le centre du plateau (mm, ≥ 0).
 *    - Y = C : angle du plateau (degrés, absolu, JAMAIS replié modulo 360 — le générateur garde
 *      la continuité angulaire, un C > 360 ou négatif est normal).
 *    - Z : hauteur (mm). B : inclinaison de la tête vers +R (à l'opposé de l'axe de rotation), en
 *      degrés.
 *    - R/Z sont les positions machine du PIVOT de l'axe B, pas de la buse : la pointe de buse est
 *      à NOZZLE_PIVOT_MM sous le pivot, le long de l'axe de la tête (cf. `nozzleTip`).
 *    - La matière est stockée en repère plateau sous un noeud dont la rotation suit le C courant :
 *      plateau et matière tournent ensemble, la tête reste dans le demi-plan machine (R, 0, Z).
 *    - Tout est interpolé dans l'espace (R, C, Z, B) du firmware, jamais en cartésien : les
 *      segments sont subdivisés en angle pour suivre l'arc réellement parcouru.
 *
 * 2. G-code cartésien de slicer (Orca, Bambu, Anycubic Slicer Next, Creality Print, PrusaSlicer,
 *    Cura, Simplify3D…) : G0/G1, arcs G2/G3 (I/J ou R), G90/G91, M82/M83, G92, G10/G11, G20/G21,
 *    G28. La pièce est recentrée sur le centre du plateau d'origine (`printable_area`/`bed_shape`
 *    de l'en-tête, sinon centre de la pièce) ; plateau fixe, la tête se déplace en X/Y/Z.
 *
 *    Variante multi-axes (Unlayered Slicer : mots B/C + `; TOOL_AXIS:x,y,z`) : X/Y/Z restent
 *    cartésiens, B/C ne sont que l'orientation de l'outil et ne rendent pas le fichier polaire.
 *
 * Dans les deux cas, les types de ligne (`;TYPE:`, `; FEATURE:`…), essuyages (`;WIPE_START`),
 * rétractions et coutures sont reconnus pour la légende et la coloration (cf. gcodeLineTypes.ts).
 */

export * from './gcodeTypes';
export { PLATE_RADIUS_MM, DEG2RAD, MAX_SUBSEGMENT_DEG, SUSPICIOUS_C_RANGE_DEG, nozzleTip, moveLength, type ConversionMode } from './gcodeParseConstants';

/** Analyse un G-code (polaire 4 axes de l'Apex ou cartésien) : lecture ligne à ligne, puis calculs dérivés. */
export function parseGCode(text: string): ParsedGCode {
  const s = createParseState(text);
  const lines = text.split('\n');
  for (let lineNo = 0; lineNo < lines.length; lineNo++) processLine(s, lines[lineNo], lineNo);
  return finalizeParse(s);
}

/** Temps machine (s) à l'index de mouvement fractionnaire `t`. */
export function timeAtIndex(times: Float64Array, t: number) {
  const last = times.length - 1;
  const i = Math.max(0, Math.min(last, Math.floor(t)));
  if (i >= last) return times[last];
  return times[i] + (times[i + 1] - times[i]) * (t - i);
}

/** Index de mouvement fractionnaire atteint au temps machine `s` (inverse de `timeAtIndex`). */
export function indexAtTime(times: Float64Array, s: number) {
  const last = times.length - 1;
  if (s <= 0) return 0;
  if (s >= times[last]) return last;
  let lo = 0, hi = last; // times[lo] <= s < times[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= s) lo = mid; else hi = mid;
  }
  return lo + (s - times[lo]) / (times[hi] - times[lo]);
}

/** Position machine (x, y, z, b) interpolée linéairement — comme le firmware — au temps `t`
 * exprimé en index de mouvement fractionnaire. */
export function stateAt(moves: GCodeMove[], t: number) {
  const i = Math.max(0, Math.min(moves.length - 1, Math.floor(t)));
  const a = moves[i];
  const b = moves[Math.min(moves.length - 1, i + 1)];
  const f = Math.max(0, Math.min(1, t - i));
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
    b: a.b + (b.b - a.b) * f,
    c: a.c + (b.c - a.c) * f,
  };
}


/** Axe de l'outil (vecteur unitaire, repère G-code X/Y/Z, orienté de la buse vers le haut de la tête)
 * au temps `t` d'un fichier à orientation d'outil : (cos C · sin β, sin C · sin β, cos β), β = `b`.
 * β est interpolé linéairement et C par le plus court chemin angulaire (un C qui passe de +179° à
 * −179° tourne de 2°, pas de 358°) : la rotation reste continue, sans passer par un axe nul même
 * pour un demi-tour de C. */
export function toolAxisAt(moves: GCodeMove[], t: number, out: { x: number; y: number; z: number }) {
  const i = Math.max(0, Math.min(moves.length - 1, Math.floor(t)));
  const a = moves[i];
  const m = moves[Math.min(moves.length - 1, i + 1)];
  const f = Math.max(0, Math.min(1, t - i));
  const dc = ((((m.c - a.c) % 360) + 540) % 360) - 180;
  const beta = (a.b + (m.b - a.b) * f) * DEG2RAD;
  const gamma = (a.c + dc * f) * DEG2RAD;
  out.x = Math.cos(gamma) * Math.sin(beta);
  out.y = Math.sin(gamma) * Math.sin(beta);
  out.z = Math.cos(beta);
  return out;
}
