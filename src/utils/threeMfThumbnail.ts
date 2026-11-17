// Miniature d'un projet 3MF : l'image du fichier s'il en porte une (Orca, Bambu), sinon un rendu à plat du plateau
// (triangles triés du fond vers l'avant, ombrage par la normale), sans WebGL : une vingtaine de miniatures se
// dessinent sur la page d'accueil sans second contexte GPU.
import JSZip from 'jszip';
import { readThreeMf, type ThreeMfMesh } from './threeMfRead';

export interface FlatTriangle {
  /** x1 y1 x2 y2 x3 y3, en pixels. */
  points: [number, number, number, number, number, number];
  /** 0 (sombre) … 1 (clair). */
  shade: number;
  depth: number;
}

const EMBEDDED = ['Metadata/plate_1.png', 'Metadata/thumbnail.png', 'Metadata/top_1.png', 'Metadata/pick_1.png'];
const ELEVATION = (35 * Math.PI) / 180;
const YAW = (-35 * Math.PI) / 180;
const MAX_TRIANGLES = 120_000;
const LIGHT = normalize([-0.4, -0.55, 0.75]);

function normalize(v: number[]): [number, number, number] {
  const n = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0) || 1;
  return [(v[0] ?? 0) / n, (v[1] ?? 0) / n, (v[2] ?? 0) / n];
}

/** Sommet imprimante (x, y, z) → repère de vue : x à droite, `up` vers le haut de l'image, `depth` vers le fond. */
function toView(x: number, y: number, z: number) {
  const rx = x * Math.cos(YAW) - y * Math.sin(YAW);
  const ry = x * Math.sin(YAW) + y * Math.cos(YAW);
  return {
    x: rx,
    up: z * Math.cos(ELEVATION) - ry * Math.sin(ELEVATION),
    depth: ry * Math.cos(ELEVATION) + z * Math.sin(ELEVATION),
    ry,
    z,
  };
}

type View = ReturnType<typeof toView>;

function faceShade(a: View, b: View, c: View): number | null {
  const u = [b.x - a.x, b.ry - a.ry, b.z - a.z] as const;
  const w = [c.x - a.x, c.ry - a.ry, c.z - a.z] as const;
  const n = normalize([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
  // Face tournée vers le fond de la vue : cachée (maillage fermé), non dessinée.
  if (n[1] * Math.cos(ELEVATION) + n[2] * Math.sin(ELEVATION) > 0) return null;
  return 0.3 + 0.7 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
}

function viewVertices(meshes: ThreeMfMesh[]) {
  return meshes.map((mesh) => {
    const out: View[] = [];
    for (let i = 0; i + 2 < mesh.positions.length; i += 3)
      out.push(toView(mesh.positions[i] ?? 0, mesh.positions[i + 1] ?? 0, mesh.positions[i + 2] ?? 0));
    return out;
  });
}

/** Triangles visibles, mis à l'échelle de `width × height` (marge comprise) et triés du fond vers l'avant. */
export function flatTriangles(meshes: ThreeMfMesh[], width: number, height: number, margin = 8): FlatTriangle[] {
  const views = viewVertices(meshes);
  let minX = Infinity,
    maxX = -Infinity,
    minUp = Infinity,
    maxUp = -Infinity;
  for (const vertices of views) {
    for (const v of vertices) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minUp = Math.min(minUp, v.up);
      maxUp = Math.max(maxUp, v.up);
    }
  }
  const span = Math.max(maxX - minX, maxUp - minUp);
  if (!Number.isFinite(span) || span <= 0) return [];
  const scale = (Math.min(width, height) - 2 * margin) / span;
  const ox = (width - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (height + (maxUp - minUp) * scale) / 2 + minUp * scale;
  const px = (v: View) => [v.x * scale + ox, oy - v.up * scale] as const;
  const out: FlatTriangle[] = [];
  meshes.forEach((mesh, m) => {
    const vertices = views[m] ?? [];
    const step = Math.max(1, Math.ceil(mesh.indices.length / 3 / (MAX_TRIANGLES / meshes.length)));
    for (let t = 0; t * 3 + 2 < mesh.indices.length; t += step) {
      const a = vertices[mesh.indices[t * 3] ?? 0],
        b = vertices[mesh.indices[t * 3 + 1] ?? 0],
        c = vertices[mesh.indices[t * 3 + 2] ?? 0];
      if (!a || !b || !c) continue;
      const shade = faceShade(a, b, c);
      if (shade === null) continue;
      out.push({ points: [...px(a), ...px(b), ...px(c)], shade, depth: (a.depth + b.depth + c.depth) / 3 });
    }
  });
  return out.sort((p, q) => q.depth - p.depth);
}

function paint(triangles: FlatTriangle[], width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return '';
  for (const t of triangles) {
    const c = Math.round(70 + 150 * t.shade);
    g.fillStyle = `rgb(${c},${Math.round(c * 1.04)},${Math.min(255, Math.round(c * 1.12))})`;
    g.strokeStyle = g.fillStyle;
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(t.points[0], t.points[1]);
    g.lineTo(t.points[2], t.points[3]);
    g.lineTo(t.points[4], t.points[5]);
    g.closePath();
    g.fill();
    g.stroke();
  }
  return canvas.toDataURL('image/png');
}

/** Miniature du projet (URL d'image), ou null s'il n'a ni image ni modèle. Aucune exception : une vignette manquante suffit. */
export async function projectThumbnail(bytes: Uint8Array, width = 240, height = 160): Promise<string | null> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    for (const name of EMBEDDED) {
      const file = zip.file(name);
      if (file) return URL.createObjectURL(new Blob([await file.async('uint8array')], { type: 'image/png' }));
    }
    const triangles = flatTriangles(await readThreeMf(bytes), width, height);
    return triangles.length > 0 ? paint(triangles, width, height) || null : null;
  } catch {
    return null;
  }
}
