// Miniature grise d'un STL (menu « Ajouter des modèles pratiques ») : rendu logiciel sur un canvas 2D, sans contexte
// WebGL supplémentaire. Vue isométrique (Z vers le haut, comme l'imprimante), faces cachées écartées, tri du fond vers
// l'avant, ombrage de Lambert en gris.

/** Triangles à la suite : x y z des trois sommets. */
export function parseStl(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  if (buffer.byteLength >= 84) {
    const count = view.getUint32(80, true);
    if (84 + count * 50 === buffer.byteLength) {
      const out = new Float32Array(count * 9);
      for (let t = 0; t < count; t++) {
        const base = 84 + t * 50 + 12; // saute la normale
        for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(base + k * 4, true);
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(buffer);
  const values: number[] = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) values.push(Number(m[1]), Number(m[2]), Number(m[3]));
  return new Float32Array(values.slice(0, values.length - (values.length % 9)));
}

const MAX_TRIANGLES = 60000;
const YAW = (-35 * Math.PI) / 180;
const ELEVATION = (35 * Math.PI) / 180;
const LIGHT = (() => {
  const v = [-0.4, 0.55, 0.75];
  const n = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / n);
})();

/** Dessine le modèle dans `canvas` (carré), fond transparent. */
export function renderStlThumbnail(tris: Float32Array, canvas: HTMLCanvasElement) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  const total = Math.floor(tris.length / 9);
  if (total === 0) return;

  const cy = Math.cos(YAW), sy = Math.sin(YAW);
  const ce = Math.cos(ELEVATION), se = Math.sin(ELEVATION);
  // Sommet -> (x écran, haut écran, profondeur vers l'observateur)
  const project = (x: number, y: number, z: number): [number, number, number] => {
    const xr = x * cy - y * sy;
    const yr = x * sy + y * cy;
    return [xr, z * ce + yr * se, -yr * ce + z * se];
  };

  const step = Math.max(1, Math.ceil(total / MAX_TRIANGLES));
  const projected: { p: Float32Array; depth: number; shade: number }[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let t = 0; t < total; t += step) {
    const o = t * 9;
    const a = project(tris[o], tris[o + 1], tris[o + 2]);
    const b = project(tris[o + 3], tris[o + 4], tris[o + 5]);
    const c = project(tris[o + 6], tris[o + 7], tris[o + 8]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    nx /= len; ny /= len; nz /= len;
    if (nz <= 0) continue; // face tournée à l'opposé de l'observateur
    const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    projected.push({ p: Float32Array.of(a[0], a[1], b[0], b[1], c[0], c[1]), depth: (a[2] + b[2] + c[2]) / 3, shade: 55 + 175 * lambert });
    for (const v of [a, b, c]) {
      minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
    }
  }
  if (projected.length === 0) return;

  const margin = size * 0.08;
  const scale = (size - 2 * margin) / Math.max(maxX - minX, maxY - minY, 1e-6);
  const offX = (size - (maxX - minX) * scale) / 2 - minX * scale;
  const offY = (size - (maxY - minY) * scale) / 2 + maxY * scale; // l'écran a Y vers le bas
  projected.sort((u, v) => u.depth - v.depth); // du fond vers l'avant
  ctx.lineWidth = 0.6;
  ctx.lineJoin = 'round';
  for (const { p, shade } of projected) {
    const g = Math.round(shade);
    ctx.fillStyle = ctx.strokeStyle = `rgb(${g},${g},${g})`;
    ctx.beginPath();
    ctx.moveTo(p[0] * scale + offX, offY - p[1] * scale);
    ctx.lineTo(p[2] * scale + offX, offY - p[3] * scale);
    ctx.lineTo(p[4] * scale + offX, offY - p[5] * scale);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
