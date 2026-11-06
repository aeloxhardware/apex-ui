import { nozzleTipActive } from '@/utils/kinematics';
import type { GCodeKind, GCodeMove } from './types';

export const DEG2RAD = Math.PI / 180;
// Pas angulaire max d'un sous-segment : au-delà, la corde cartésienne s'écarte visiblement de
// l'arc réellement décrit par le firmware (qui interpole en C, pas en x/y).
export const MAX_SUBSEGMENT_DEG = 0.5;
/** Au-delà de cette amplitude totale de C, le fichier vient très probablement de la version
 * boguée du générateur (C qui dérive de tour en tour au lieu d'osciller dans une plage étroite). */
export const SUSPICIOUS_C_RANGE_DEG = 720;

/**
 * Pointe de buse (rayon, hauteur) dans le demi-plan machine, depuis la position du pivot (R, Z)
 * et l'inclinaison B (radians). La tête penche vers +R (cf. `headDir` dans `apply`), donc la
 * buse, SOUS le pivot, part vers −R. Z est calé pour que tête droite (B = 0) la buse soit
 * exactement à Z : seul l'écart dû à l'inclinaison, L·(1 − cos B), s'ajoute en hauteur.
 */
export function nozzleTip(r: number, z: number, bRad: number, out: { r: number; z: number }) {
  return nozzleTipActive(r, z, bRad, out);
}

// Points réutilisés par `moveLength` pour éviter une allocation par mouvement (appelé O(n)).
const moveLengthTipA = { r: 0, z: 0 };
const moveLengthTipB = { r: 0, z: 0 };

/** Longueur (mm) parcourue par la pointe de buse entre les mouvements `a` et `b` : corde cartésienne
 * directe, ou longueur de l'arc réellement décrit en (R, C, Z) pour le polaire (même formule que la
 * durée polaire ci-dessous — une seule implémentation pour les deux usages). */
export function moveLength(a: GCodeMove, b: GCodeMove, kind: GCodeKind): number {
  if (kind === 'cartesian') {
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  nozzleTip(a.x, a.z, a.b * DEG2RAD, moveLengthTipA);
  nozzleTip(b.x, b.z, b.b * DEG2RAD, moveLengthTipB);
  const dr = moveLengthTipB.r - moveLengthTipA.r;
  const dz = moveLengthTipB.z - moveLengthTipA.z;
  const arc = ((Math.abs(moveLengthTipA.r) + Math.abs(moveLengthTipB.r)) / 2) * (b.y - a.y) * DEG2RAD;
  return Math.sqrt(dr * dr + dz * dz + arc * arc);
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
