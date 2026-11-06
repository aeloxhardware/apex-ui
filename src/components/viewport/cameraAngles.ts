// Calculs d'angles de caméra du viewport (logique pure, sans Babylon).

export interface Direction { x: number; y: number; z: number }

/**
 * Angles (alpha, beta) d'une ArcRotateCamera qui regarde en face d'une surface de normale
 * unitaire `n`. Inverse de la projection qui place la caméra (position = cible + rayon·(cosα sinβ,
 * cosβ, sinα sinβ)) : la caméra se retrouve dans la direction de la normale, donc bien en face.
 *
 * Une face horizontale (|n.y| > 0,99) ne fixe pas l'azimut : on prend celui de la vue alignée du
 * plan XZ (x à droite, z en haut), et un bêta légèrement décalé pour éviter le blocage au pôle.
 */
export function cameraAnglesFacing(n: Direction): { alpha: number; beta: number; horizontal: boolean } {
  const horizontal = Math.abs(n.y) > 0.99;
  const beta = horizontal ? (n.y > 0 ? 0.01 : Math.PI - 0.01) : Math.acos(Math.max(-1, Math.min(1, n.y)));
  const alpha = horizontal ? -Math.PI / 2 : Math.atan2(n.z, n.x);
  return { alpha, beta, horizontal };
}
