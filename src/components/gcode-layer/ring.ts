import { BEAD_HEIGHT_MM, BEAD_WIDTH_MM, TUBE_SIDES } from './constants';

const RING_COS = Float32Array.from({ length: TUBE_SIDES }, (_, i) => Math.cos((i / TUBE_SIDES) * Math.PI * 2));
const RING_SIN = Float32Array.from({ length: TUBE_SIDES }, (_, i) => Math.sin((i / TUBE_SIDES) * Math.PI * 2));

/** Repère d'un anneau : centre c, tangente unitaire t, axe de buse a. Réutilisé pour éviter une allocation par anneau. */
export interface RingFrame {
  cx: number; cy: number; cz: number;
  tx: number; ty: number; tz: number;
  ax: number; ay: number; az: number;
}

export const newRingFrame = (): RingFrame => ({ cx: 0, cy: 0, cz: 0, tx: 1, ty: 0, tz: 0, ax: 0, ay: 1, az: 0 });

/**
 * Écrit l'anneau n° `ring` du cordon (TUBE_SIDES sommets et normales) : ellipse centrée en c,
 * perpendiculaire à la tangente unitaire t, écrasée le long de l'axe de buse a (BEAD_HEIGHT_MM)
 * et large de BEAD_WIDTH_MM sur le côté.
 */
export function writeRing(positions: Float32Array, normals: Float32Array, ring: number, f: RingFrame) {
  const { cx, cy, cz, tx, ty, tz } = f;
  const halfW = BEAD_WIDTH_MM / 2;
  const halfH = BEAD_HEIGHT_MM / 2;
  // Axe de buse rendu orthogonal à la tangente ; s'il lui est parallèle (déplacement le long
  // de la buse), n'importe quelle perpendiculaire convient.
  let ux = f.ax, uy = f.ay, uz = f.az;
  const dot = ux * tx + uy * ty + uz * tz;
  ux -= dot * tx; uy -= dot * ty; uz -= dot * tz;
  let len = Math.hypot(ux, uy, uz);
  if (len < 1e-6) {
    ux = -ty; uy = tx; uz = 0;
    len = Math.hypot(ux, uy, uz);
    if (len < 1e-6) { ux = 0; uy = -tz; uz = ty; len = Math.hypot(uy, uz); }
  }
  ux /= len; uy /= len; uz /= len;
  // Côté = tangente × axe.
  const sx = ty * uz - tz * uy;
  const sy = tz * ux - tx * uz;
  const sz = tx * uy - ty * ux;

  for (let i = 0; i < TUBE_SIDES; i++) {
    const v = (ring * TUBE_SIDES + i) * 3;
    const cs = RING_COS[i], sn = RING_SIN[i];
    positions[v] = cx + sx * halfW * cs + ux * halfH * sn;
    positions[v + 1] = cy + sy * halfW * cs + uy * halfH * sn;
    positions[v + 2] = cz + sz * halfW * cs + uz * halfH * sn;
    // Normale d'ellipse : gradient (cos/a, sin/b) dans le repère (côté, axe).
    let nx = sx * cs / halfW + ux * sn / halfH;
    let ny = sy * cs / halfW + uy * sn / halfH;
    let nz = sz * cs / halfW + uz * sn / halfH;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    normals[v] = nx;
    normals[v + 1] = ny;
    normals[v + 2] = nz;
  }
}

const sampleFrame = newRingFrame();

/**
 * Anneau de l'échantillon j d'un cordon : tangente par différence centrée entre ses voisins du
 * même tube (`stripStart` marque les débuts de tube), reprise de la dernière tangente valide quand
 * les voisins sont confondus. `tangent` porte cette dernière tangente d'un appel à l'autre.
 */
export function writeSampleRing(
  positions: Float32Array,
  normals: Float32Array,
  centers: Float32Array,
  axes: Float32Array,
  stripStart: Uint8Array,
  count: number,
  j: number,
  tangent: { x: number; y: number; z: number },
) {
  const p = j * 3;
  const hasPrev = !stripStart[j];
  const hasNext = j + 1 < count && !stripStart[j + 1];
  const from = hasPrev ? p - 3 : p;
  const to = hasNext ? p + 3 : p;
  const dx = centers[to] - centers[from];
  const dy = centers[to + 1] - centers[from + 1];
  const dz = centers[to + 2] - centers[from + 2];
  const len = Math.hypot(dx, dy, dz);
  if (len > 1e-6) {
    tangent.x = dx / len; tangent.y = dy / len; tangent.z = dz / len;
  }
  const f = sampleFrame;
  f.cx = centers[p]; f.cy = centers[p + 1]; f.cz = centers[p + 2];
  f.tx = tangent.x; f.ty = tangent.y; f.tz = tangent.z;
  f.ax = axes[p]; f.ay = axes[p + 1]; f.az = axes[p + 2];
  writeRing(positions, normals, j, f);
}
