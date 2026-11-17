// Orbite de caméra autour d'un axe du monde (logique pure, sans Babylon).

export interface Axis3 { x: number; y: number; z: number }

const BETA_MIN = 0.01;

/**
 * Nouveaux angles (alpha, beta) d'une ArcRotateCamera dont la position (cible + rayon·(cosα sinβ, cosβ,
 * sinα sinβ)) tourne de `angle` radians autour de l'axe `axis` (unitaire) passant par la cible. La vue n'est
 * alignée sur rien : elle part de l'orientation courante. Bêta est borné pour ne pas franchir le pôle, la caméra
 * ne gérant pas de roulis : `clamped` signale que le pôle est atteint (l'appelant renvoie alors la caméra dans l'autre sens).
 */
export function orbitAngles(alpha: number, beta: number, axis: Axis3, angle: number): { alpha: number; beta: number; clamped: boolean } {
  const v = { x: Math.cos(alpha) * Math.sin(beta), y: Math.cos(beta), z: Math.sin(alpha) * Math.sin(beta) };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = axis.x * v.x + axis.y * v.y + axis.z * v.z;
  // Formule de Rodrigues : v·cos + (axe × v)·sin + axe·(axe·v)·(1 − cos).
  const x = v.x * cos + (axis.y * v.z - axis.z * v.y) * sin + axis.x * dot * (1 - cos);
  const y = v.y * cos + (axis.z * v.x - axis.x * v.z) * sin + axis.y * dot * (1 - cos);
  const z = v.z * cos + (axis.x * v.y - axis.y * v.x) * sin + axis.z * dot * (1 - cos);
  const length = Math.hypot(x, y, z) || 1;
  const rawBeta = Math.acos(Math.max(-1, Math.min(1, y / length)));
  const newBeta = Math.min(Math.PI - BETA_MIN, Math.max(BETA_MIN, rawBeta));
  // Près du pôle l'azimut n'est plus défini : on garde l'ancien.
  const newAlpha = Math.hypot(x, z) < 1e-6 ? alpha : Math.atan2(z, x);
  return { alpha: newAlpha, beta: newBeta, clamped: newBeta !== rawBeta };
}
