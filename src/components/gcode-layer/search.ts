/** Nombre d'éléments de `sorted` (croissant) inférieurs ou égaux à `t`. */
export function countUpTo(sorted: Uint32Array, t: number) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Premier indice de `owner` (croissant) dont la valeur est ≥ k. */
export function lowerBound(owner: Uint32Array, k: number) {
  let lo = 0, hi = owner.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (owner[mid] < k) lo = mid + 1; else hi = mid;
  }
  return lo;
}
