// Placement d'un nouveau modèle sur le plateau circulaire (logique pure, sans Babylon).

/** Cercle englobant, en X/Z, d'un modèle déjà posé. */
export interface Disc { x: number; z: number; r: number }
export interface Spot { x: number; z: number }

/** Jeu laissé entre deux modèles (mm). */
const MARGIN = 5;
const ANGLE_STEPS = 180;
/** Pas (mm) du balayage de secours. */
const SCAN_STEP = 2;

const collides = (existing: Disc[], footprintRadius: number, x: number, z: number): boolean =>
  existing.some((e) => Math.hypot(x - e.x, z - e.z) < footprintRadius + e.r + MARGIN);

/** Tangent à chaque modèle existant, dans toutes les directions. */
function tangentToOne(existing: Disc[], footprintRadius: number): Spot[] {
  const out: Spot[] = [];
  existing.forEach((e) => {
    const rr = footprintRadius + e.r + MARGIN;
    for (let i = 0; i < ANGLE_STEPS; i++) {
      const a = (i / ANGLE_STEPS) * Math.PI * 2;
      out.push({ x: e.x + rr * Math.cos(a), z: e.z + rr * Math.sin(a) });
    }
  });
  return out;
}

/**
 * Tangent à deux modèles existants simultanément (intersection des deux cercles de sécurité) —
 * c'est là que se trouvent les emplacements les plus compacts en packing.
 */
function tangentToTwo(existing: Disc[], footprintRadius: number): Spot[] {
  const out: Spot[] = [];
  for (let i = 0; i < existing.length; i++) {
    for (let j = i + 1; j < existing.length; j++) {
      const a = existing[i];
      const b = existing[j];
      const ra = footprintRadius + a.r + MARGIN;
      const rb = footprintRadius + b.r + MARGIN;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d === 0 || d > ra + rb) continue;
      const aDist = (ra * ra - rb * rb + d * d) / (2 * d);
      const h2 = ra * ra - aDist * aDist;
      if (h2 < 0) continue;
      const h = Math.sqrt(h2);
      const mx = a.x + (aDist * dx) / d;
      const mz = a.z + (aDist * dz) / d;
      out.push({ x: mx + (h * dz) / d, z: mz - (h * dx) / d });
      out.push({ x: mx - (h * dz) / d, z: mz + (h * dx) / d });
    }
  }
  return out;
}

/** Filet de sécurité : balayage fin du plateau, on garde le point valide le plus proche du centre. */
function scanPlate(existing: Disc[], footprintRadius: number, maxReach: number): Spot | null {
  let best: Spot | null = null;
  let bestDist = Infinity;
  for (let x = -maxReach; x <= maxReach; x += SCAN_STEP) {
    for (let z = -maxReach; z <= maxReach; z += SCAN_STEP) {
      const d = Math.hypot(x, z);
      if (d > maxReach || d >= bestDist || collides(existing, footprintRadius, x, z)) continue;
      best = { x, z };
      bestDist = d;
    }
  }
  return best;
}

/**
 * Position libre la plus proche du centre pour un nouveau modèle (approximé par son cercle
 * englobant), par circle-packing : en configuration optimale, une position libre la plus proche
 * est toujours tangente soit au bord du plateau, soit à un modèle existant, soit à deux modèles
 * existants à la fois — on génère donc ces candidats géométriques précis plutôt que
 * d'échantillonner au hasard, avec un balayage fin en filet de sécurité si aucun n'est valide.
 */
export function findFreeSpotAmong(existing: Disc[], footprintRadius: number, plateRadius: number): Spot {
  const maxReach = plateRadius - footprintRadius - 2;
  if (maxReach <= 0) return { x: 0, z: 0 };
  if (existing.length === 0 || !collides(existing, footprintRadius, 0, 0)) return { x: 0, z: 0 };

  const candidates = [...tangentToOne(existing, footprintRadius), ...tangentToTwo(existing, footprintRadius)];
  const valid = candidates
    .filter((c) => Math.hypot(c.x, c.z) <= maxReach && !collides(existing, footprintRadius, c.x, c.z))
    .sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
  if (valid.length > 0) return valid[0];

  return scanPlate(existing, footprintRadius, maxReach) ?? { x: 0, z: 0 };
}
