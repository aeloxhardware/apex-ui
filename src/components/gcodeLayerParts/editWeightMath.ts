// Calculs sur les attributs d'édition par mouvement du calque G-code (logique pure, sans Babylon).

/** Valeurs par point d'édition (`indices`) déposées dans un tableau dense, une case par mouvement. */
export function denseScalar(moveCount: number, indices: ArrayLike<number>, values: ArrayLike<number>): Float32Array {
  const out = new Float32Array(moveCount);
  for (let i = 0; i < indices.length; i++) out[indices[i]] = values[i];
  return out;
}

/**
 * Trois valeurs par point d'édition dans un tableau dense (trois cases par mouvement). Le noyau est
 * en (x, y, z) machine, le plateau en (x, z, y) : y et z sont donc échangés au passage.
 */
export function denseVec3(moveCount: number, indices: ArrayLike<number>, values: ArrayLike<number>): Float32Array {
  const out = new Float32Array(3 * moveCount);
  for (let i = 0; i < indices.length; i++) {
    const k = 3 * indices[i];
    out[k] = values[3 * i];
    out[k + 1] = values[3 * i + 2];
    out[k + 2] = values[3 * i + 1];
  }
  return out;
}

/**
 * Valeur d'un tableau dense à la fraction `f` du mouvement `k`, interpolée entre le point précédent
 * et le point `k` (`stride` cases par mouvement, composante `c`). 0 sans tableau.
 */
export function lerpDense(dense: Float32Array | null, stride: number, k: number, f: number, c = 0): number {
  if (!dense) return 0;
  return (k > 0 ? dense[stride * (k - 1) + c] * (1 - f) : 0) + dense[stride * k + c] * f;
}
