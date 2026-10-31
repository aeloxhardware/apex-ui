// Plateau de la scène → STL binaire pour le moteur. La scène Babylon a Y vers le haut (hauteur de
// l'imprimante) et Z en profondeur ; l'imprimante a Z vers le haut : (x, y, z)_scène → (x, z, y)_imprimante.
// Cette permutation est un miroir, donc l'orientation des triangles est vérifiée au volume signé et
// retournée si besoin (le moteur refuse ou répare des normales vers l'intérieur).

import { clipAbovePlane } from './plateClip';

export interface PlatePart {
  /** Sommets en repère monde de la scène, x y z à la suite. */
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Matrice monde de déterminant négatif : les triangles sont déjà retournés par le miroir. */
  mirrored: boolean;
}

export interface PlateStlOptions {
  /** Hauteur du plateau (repère imprimante, Z vers le haut) : ce qui est dessous est coupé, la section est rebouchée. */
  clipBelowZ?: number;
  /** Appelé quand une partie du modèle a effectivement été coupée. */
  onClipped?: () => void;
}

/** Marge (mm) sous laquelle un modèle « posé » sur le plateau n'est pas considéré comme le traversant. */
const CLIP_TOLERANCE_MM = 0.01;

export function buildPlateStl(parts: PlatePart[], options: PlateStlOptions = {}): Uint8Array | null {
  let tris: number[] = [];
  for (const part of parts) {
    const { positions: p, indices: ix } = part;
    for (let i = 0; i + 2 < ix.length; i += 3) {
      const order = part.mirrored ? [ix[i], ix[i + 2], ix[i + 1]] : [ix[i], ix[i + 1], ix[i + 2]];
      for (const v of order) tris.push(p[v * 3], p[v * 3 + 2], p[v * 3 + 1]);
    }
  }
  const clipZ = options.clipBelowZ;
  if (clipZ !== undefined) {
    let minZ = Infinity;
    for (let i = 2; i < tris.length; i += 3) minZ = Math.min(minZ, tris[i]);
    if (minZ < clipZ - CLIP_TOLERANCE_MM) {
      tris = clipAbovePlane(tris, clipZ);
      options.onClipped?.();
    }
  }
  const count = tris.length / 9;
  if (count === 0) return null;

  let volume = 0;
  for (let t = 0; t < tris.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.slice(t, t + 9);
    volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  const flip = volume < 0;

  const out = new Uint8Array(84 + count * 50);
  const view = new DataView(out.buffer);
  view.setUint32(80, count, true);
  let o = 84;
  for (let t = 0; t < tris.length; t += 9) {
    const v = tris.slice(t, t + 9);
    if (flip) [v[3], v[4], v[5], v[6], v[7], v[8]] = [v[6], v[7], v[8], v[3], v[4], v[5]];
    const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2];
    const wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const f of [nx, ny, nz, ...v]) { view.setFloat32(o, f, true); o += 4; }
    o += 2;
  }
  return out;
}
