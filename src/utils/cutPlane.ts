// Plan de l'outil Couper et mise en place des morceaux : logique pure, sans Babylon.
//
// Repères : l'interface parle dans celui de l'imprimante (Z vertical, comme la boîte Déplacer / Pivoter) ; la scène est
// celle de Babylon (Y vertical). X imprimante = x Babylon, Y imprimante = z Babylon, Z imprimante = y Babylon.
import type { Plane, Vec3 } from './meshCut';

/** Réglages du plan, dans le repère de l'imprimante. */
export interface CutPlaneParams {
  /** Hauteur du centre du plan, en mm au-dessus du plateau. */
  height: number;
  /**
   * Décalage du centre du plan par rapport au centre du modèle, en mm, selon X et Y de l'imprimante : 0 tant qu'on ne règle
   * que la hauteur ; la flèche du gizmo, qui pousse le plan le long de sa normale, le fait sortir de l'aplomb du modèle.
   */
  x: number;
  y: number;
  /** Rotations du plan en degrés : A autour de X, B autour de Y, C autour de Z (0, 0, 0 = plan horizontal). */
  a: number;
  b: number;
  c: number;
}

/** Ce que devient un morceau : laissé tel quel, posé sur la face coupée, ou retourné tête en bas. */
export type PartPlacement = 'keep' | 'on-cut' | 'flip';

const RAD = Math.PI / 180;

/** Normale du plan dans la scène : (0, 0, 1) de l'imprimante tourné de A, puis B, puis C. */
export function planeNormal({ a, b, c }: Pick<CutPlaneParams, 'a' | 'b' | 'c'>): Vec3 {
  const [ca, sa] = [Math.cos(a * RAD), Math.sin(a * RAD)];
  const [cb, sb] = [Math.cos(b * RAD), Math.sin(b * RAD)];
  const [cc, sc] = [Math.cos(c * RAD), Math.sin(c * RAD)];
  // Rx(a)·(0,0,1) = (0, -sa, ca) ; Ry(b) ; Rz(c).
  const x1 = ca * sb;
  const y1 = -sa;
  const z1 = ca * cb;
  const x = x1 * cc - y1 * sc;
  const y = x1 * sc + y1 * cc;
  return [x, z1, y];
}

/** Centre du plan dans la scène : celui du modèle décalé de (x, y), à `height` au-dessus du plateau. */
export function planeCenter(params: CutPlaneParams, center: Vec3, plateY: number): Vec3 {
  return [center[0] + params.x, plateY + params.height, center[2] + params.y];
}

/** Plan de coupe (repère de la scène). */
export function cutPlaneAt(params: CutPlaneParams, center: Vec3, plateY: number): Plane {
  const normal = planeNormal(params);
  const point = planeCenter(params, center, plateY);
  return { normal, offset: normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2] };
}

/**
 * Réglages qui donnent ce centre et cette normale (repère de la scène), C étant gardé : inverse de `planeCenter` et de
 * `planeNormal`, pour relire le plan déplacé ou incliné au gizmo. A reste dans [−90°, 90°], B dans ]−180°, 180°].
 */
export function paramsFromPlane(point: Vec3, normal: Vec3, c: number, center: Vec3, plateY: number): CutPlaneParams {
  const [cc, sc] = [Math.cos(c * RAD), Math.sin(c * RAD)];
  // Repère de l'imprimante (X, Y, Z) = (x, z, y) de la scène, puis rotation de −C autour de Z.
  const [nx, ny, nz] = [normal[0], normal[2], normal[1]];
  const x1 = nx * cc + ny * sc;
  const y1 = -nx * sc + ny * cc;
  const a = -Math.asin(Math.max(-1, Math.min(1, y1))) / RAD;
  const b = Math.atan2(x1, nz) / RAD;
  return { height: point[1] - plateY, x: point[0] - center[0], y: point[2] - center[2], a, b, c };
}

// --- Rotations ---------------------------------------------------------------------------------------

type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Rotation d'angle `angle` autour de l'axe unitaire `k` (Rodrigues). */
function axisAngle(k: Vec3, angle: number): Mat3 {
  const [x, y, z] = k;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}

/** Rotation qui amène le vecteur unitaire `from` sur `to` (demi-tour autour d'un axe perpendiculaire s'ils sont opposés). */
export function rotationBetween(from: Vec3, to: Vec3): Mat3 {
  const axis: Vec3 = [from[1] * to[2] - from[2] * to[1], from[2] * to[0] - from[0] * to[2], from[0] * to[1] - from[1] * to[0]];
  const s = Math.hypot(...axis);
  const c = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (s > 1e-9) return axisAngle([axis[0] / s, axis[1] / s, axis[2] / s], Math.atan2(s, c));
  if (c > 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const side: Vec3 = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const perp: Vec3 = [from[1] * side[2] - from[2] * side[1], from[2] * side[0] - from[0] * side[2], from[0] * side[1] - from[1] * side[0]];
  const l = Math.hypot(...perp);
  return axisAngle([perp[0] / l, perp[1] / l, perp[2] / l], Math.PI);
}

/** Boîte englobante des triangles à plat (9 nombres par triangle). */
export function bounds(tris: readonly number[]): { min: Vec3; max: Vec3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  tris.forEach((v, i) => {
    const k = i % 3;
    if (v < (min[k] as number)) min[k] = v;
    if (v > (max[k] as number)) max[k] = v;
  });
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

/** Applique `m` autour du centre de la boîte englobante. */
function rotateAboutCenter(tris: readonly number[], m: Mat3): number[] {
  const { min, max } = bounds(tris);
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const out = new Array<number>(tris.length);
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const x = (tris[i] ?? 0) - cx;
    const y = (tris[i + 1] ?? 0) - cy;
    const z = (tris[i + 2] ?? 0) - cz;
    out[i] = m[0] * x + m[1] * y + m[2] * z + cx;
    out[i + 1] = m[3] * x + m[4] * y + m[5] * z + cy;
    out[i + 2] = m[6] * x + m[7] * y + m[8] * z + cz;
  }
  return out;
}

const DOWN: Vec3 = [0, -1, 0];

/**
 * Met un morceau en place : `cutFaceNormal` est la normale sortante de sa face coupée (−n pour le morceau haut, +n pour le
 * bas). « Sur la coupe » tourne cette face vers le plateau, « retourner » fait un demi-tour autour de X ; dans tous les cas
 * le morceau est ensuite posé sur le plateau (`plateY`).
 */
export function placePart(tris: readonly number[], placement: PartPlacement, cutFaceNormal: Vec3, plateY: number): number[] {
  let out: number[];
  if (placement === 'on-cut') out = rotateAboutCenter(tris, rotationBetween(cutFaceNormal, DOWN));
  else if (placement === 'flip') out = rotateAboutCenter(tris, axisAngle([1, 0, 0], Math.PI));
  else out = [...tris];
  const dy = plateY - bounds(out).min[1];
  for (let i = 1; i < out.length; i += 3) out[i] = (out[i] ?? 0) + dy;
  return out;
}

/** Normale géométrique (non normée) du triangle (a, b, c) : (b − a) × (c − a). */
export function faceCross(t: ArrayLike<number>, i: number): Vec3 {
  const ax = t[i] as number,
    ay = t[i + 1] as number,
    az = t[i + 2] as number;
  const ux = (t[i + 3] as number) - ax,
    uy = (t[i + 4] as number) - ay,
    uz = (t[i + 5] as number) - az;
  const vx = (t[i + 6] as number) - ax,
    vy = (t[i + 7] as number) - ay,
    vz = (t[i + 8] as number) - az;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/**
 * Normales à plat (une par triangle, recopiée sur ses trois sommets). `sign` reprend la convention du modèle d'origine :
 * +1 si ses normales suivent (b − a) × (c − a), −1 si elles sont de l'autre côté. Les morceaux s'éclairent ainsi comme lui,
 * quel que soit le sens de rotation des faces du fichier.
 */
export function flatNormals(tris: readonly number[], sign: 1 | -1): Float32Array {
  const out = new Float32Array(tris.length);
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const [x, y, z] = faceCross(tris, i);
    const k = sign / (Math.hypot(x, y, z) || 1);
    for (let j = 0; j < 9; j += 3) out.set([x * k, y * k, z * k], i + j);
  }
  return out;
}
