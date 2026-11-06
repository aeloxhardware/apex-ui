import type { GCodeMove } from './types';
import { moveLength } from './geometry';
import { MIN_MOVE_S } from './constants';

/**
 * Temps machine cumulé d'une trajectoire cartésienne, comme le planificateur du firmware :
 * profil trapézoïdal par mouvement (accélération du moment), vitesses de jonction limitées par le
 * jerk (écart de vitesse par axe) puis propagées en arrière et en avant pour que chaque mouvement
 * puisse freiner à temps. Les mouvements d'extrudeur seul se font à l'arrêt, à l'avance F.
 */
export function planCartesianTimes(
  moves: GCodeMove[],
  feeds: number[],
  eDeltas: number[],
  accels: number[],
  accelsToDecel: number[],
  jerks: number[],
  maxSpeed: number,
) {
  const n = moves.length;
  const times = new Float64Array(n);
  // Vitesse réellement atteinte par mouvement (mm/s), remplie plus bas avec `vp` — exposée pour la
  // coloration « Vitesse » (cf. ParsedGCode.speedMmS), qui reflète ainsi les ralentissements dans
  // les détails/coins plutôt que la seule avance F commandée.
  const speeds = new Float64Array(n);
  const len = new Float64Array(n);
  const dirs = new Float64Array(n * 3);
  for (let k = 1; k < n; k++) {
    const a = moves[k - 1], m = moves[k];
    const d = moveLength(a, m, 'cartesian');
    len[k] = d;
    if (d > 1e-9) {
      dirs[k * 3] = (m.x - a.x) / d;
      dirs[k * 3 + 1] = (m.y - a.y) / d;
      dirs[k * 3 + 2] = (m.z - a.z) / d;
    }
  }
  const moving = (k: number) => k >= 1 && k < n && len[k] > 1e-9;
  const vmax = (k: number) => Math.min(feeds[k] / 60, maxSpeed);

  // v[k] : vitesse au début du mouvement k (= fin du mouvement k − 1) ; v[n] : arrêt final.
  const v = new Float64Array(n + 1);
  for (let k = 1; k < n; k++) {
    if (!moving(k)) continue;
    let maxDiff = 0;
    let limit = vmax(k);
    for (let i = 0; i < 3; i++) {
      const prev = moving(k - 1) ? dirs[(k - 1) * 3 + i] : 0;
      maxDiff = Math.max(maxDiff, Math.abs(dirs[k * 3 + i] - prev));
    }
    if (moving(k - 1)) limit = Math.min(limit, vmax(k - 1));
    if (maxDiff > 1e-9) limit = Math.min(limit, jerks[k] / maxDiff);
    v[k] = limit;
  }
  for (let k = n - 1; k >= 1; k--) {
    if (moving(k)) v[k] = Math.min(v[k], Math.sqrt(v[k + 1] ** 2 + 2 * accels[k] * len[k]));
  }
  for (let k = 1; k < n; k++) {
    if (moving(k) && moving(k + 1)) v[k + 1] = Math.min(v[k + 1], Math.sqrt(v[k] ** 2 + 2 * accels[k] * len[k]));
  }

  for (let k = 1; k < n; k++) {
    let dt: number;
    if (!moving(k)) {
      const rate = feeds[k] / 60;
      dt = Math.abs(eDeltas[k]) / rate;
      speeds[k] = rate;
    } else {
      const a = accels[k], d = len[k];
      const v0 = v[k];
      const v1 = moving(k + 1) ? v[k + 1] : 0;
      const vm = vmax(k);
      // Klipper (ACCEL_TO_DECEL) : la vitesse de croisière atteignable est plafonnée par une
      // accélération « lissée » plus faible, sans changer les rampes elles-mêmes.
      const reach = Math.min(a, accelsToDecel[k]) * d + (v0 * v0 + v1 * v1) / 2;
      const vp = Math.sqrt(Math.max(Math.min(vm * vm, reach), v0 * v0, v1 * v1));
      const cruise = Math.max(0, d - (vp * vp - v0 * v0) / (2 * a) - (vp * vp - v1 * v1) / (2 * a));
      dt = (vp - v0) / a + (vp - v1) / a + cruise / vp;
      speeds[k] = vp;
    }
    times[k] = times[k - 1] + Math.max(MIN_MOVE_S, dt);
  }
  return { times, speeds };
}
