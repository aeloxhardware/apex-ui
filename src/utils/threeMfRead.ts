// Fichier 3MF → maillages (lecture, l'inverse de threeMf.ts). Repère du fichier : imprimante, Z vers le haut, en
// millimètres une fois l'unité du modèle appliquée. Le XML d'un 3MF est plat et régulier : un balayage de balises
// suffit (pas de DOMParser, absent des tests Node).
import JSZip from 'jszip';

export interface ThreeMfMesh {
  name: string;
  /** Sommets x y z à la suite, repère imprimante, millimètres, transformations de la construction appliquées. */
  positions: number[];
  indices: number[];
}

/** 12 nombres du 3MF (m00 m01 m02 m10 … m32) : point en ligne, p' = p · M + translation. */
type Matrix = number[];
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const MAX_DEPTH = 8;
const UNIT_MM: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

interface RawObject {
  name: string;
  vertices: number[];
  triangles: number[];
  components: { id: string; path: string | null; matrix: Matrix }[];
}

interface ParsedModel {
  scale: number;
  objects: Map<string, RawObject>;
  items: { id: string; matrix: Matrix }[];
}

function attributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1] ?? ''] = m[2] ?? '';
  return out;
}

function matrixOf(text: string | undefined): Matrix {
  const v = (text ?? '').trim().split(/\s+/).map(Number);
  return v.length === 12 && v.every(Number.isFinite) ? v : IDENTITY;
}

/** Applique `a` puis `b`. */
function then(a: Matrix, b: Matrix): Matrix {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8, ax, ay, az] = a as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8, bx, by, bz] = b as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return [
    a0 * b0 + a1 * b3 + a2 * b6,
    a0 * b1 + a1 * b4 + a2 * b7,
    a0 * b2 + a1 * b5 + a2 * b8,
    a3 * b0 + a4 * b3 + a5 * b6,
    a3 * b1 + a4 * b4 + a5 * b7,
    a3 * b2 + a4 * b5 + a5 * b8,
    a6 * b0 + a7 * b3 + a8 * b6,
    a6 * b1 + a7 * b4 + a8 * b7,
    a6 * b2 + a7 * b5 + a8 * b8,
    ax * b0 + ay * b3 + az * b6 + bx,
    ax * b1 + ay * b4 + az * b7 + by,
    ax * b2 + ay * b5 + az * b8 + bz,
  ];
}

type Attrs = Record<string, string>;
type Handler = (a: Attrs, model: ParsedModel, current: RawObject | null) => void;

/** Ce que chaque balise ajoute au modèle ; vertex, triangle et component ne comptent que dans un objet. */
const TAG_HANDLERS: Record<string, Handler> = {
  vertex: (a, _m, o) => o?.vertices.push(Number(a['x']), Number(a['y']), Number(a['z'])),
  triangle: (a, _m, o) => o?.triangles.push(Number(a['v1']), Number(a['v2']), Number(a['v3'])),
  component: (a, _m, o) => o?.components.push({ id: a['objectid'] ?? '', path: a['p:path'] ?? null, matrix: matrixOf(a['transform']) }),
  item: (a, m) => m.items.push({ id: a['objectid'] ?? '', matrix: matrixOf(a['transform']) }),
};

/** Ouvre un objet (le suivant s'y ajoute) ; renvoie null à `</object>`. */
function openObject(model: ParsedModel, closing: boolean, a: Attrs): RawObject | null {
  if (closing) return null;
  const object: RawObject = { name: a['name'] ?? '', vertices: [], triangles: [], components: [] };
  model.objects.set(a['id'] ?? '', object);
  return object;
}

/** Balayage d'un fichier .model : objets (maillage ou composants) et éléments de la construction. */
export function parseModelXml(xml: string): ParsedModel {
  const unit = /<model\b[^>]*\bunit="([^"]*)"/.exec(xml)?.[1] ?? 'millimeter';
  const model: ParsedModel = { scale: UNIT_MM[unit] ?? 1, objects: new Map(), items: [] };
  let current: RawObject | null = null;
  for (const m of xml.matchAll(/<(\/?)(object|vertex|triangle|component|item)\b([^>]*?)\/?>/g)) {
    const closing = m[1] === '/';
    const attrs = closing ? {} : attributes(m[3] ?? '');
    if (m[2] === 'object') current = openObject(model, closing, attrs);
    else TAG_HANDLERS[m[2] ?? '']?.(attrs, model, current);
  }
  return model;
}

const normalizePath = (p: string) => p.replace(/^\/+/, '');

/** Fichier .model de la relation racine, `3D/3dmodel.model` à défaut. */
async function rootModelPath(zip: JSZip): Promise<string> {
  const rels = await zip.file('_rels/.rels')?.async('string');
  const target = rels ? /Target="([^"]+\.model)"/i.exec(rels)?.[1] : undefined;
  return normalizePath(target ?? '3D/3dmodel.model');
}

interface Accumulator {
  positions: number[];
  indices: number[];
}

type ModelLoader = (path: string) => ParsedModel | undefined;

function appendObject(load: ModelLoader, file: string, id: string, matrix: Matrix, acc: Accumulator, depth: number) {
  const object = load(file)?.objects.get(id);
  if (!object || depth > MAX_DEPTH) return;
  const base = acc.positions.length / 3;
  const v = object.vertices;
  for (let i = 0; i + 2 < v.length; i += 3) {
    const x = v[i] as number,
      y = v[i + 1] as number,
      z = v[i + 2] as number;
    const [a, b, c, d, e, f, g, h, k, tx, ty, tz] = matrix as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    acc.positions.push(x * a + y * d + z * g + tx, x * b + y * e + z * h + ty, x * c + y * f + z * k + tz);
  }
  for (const index of object.triangles) acc.indices.push(index + base);
  for (const c of object.components) {
    appendObject(load, c.path ? normalizePath(c.path) : file, c.id, then(c.matrix, matrix), acc, depth + 1);
  }
}

/** Les maillages d'un 3MF, un par élément de la construction ; vide si le fichier n'en contient pas. */
export async function readThreeMf(bytes: Uint8Array, fallbackName = 'Projet'): Promise<ThreeMfMesh[]> {
  const zip = await JSZip.loadAsync(bytes);
  const rootPath = await rootModelPath(zip);
  const cache = new Map<string, ParsedModel>();
  const names = Object.keys(zip.files).filter((n) => n.endsWith('.model'));
  for (const name of names) {
    const xml = await zip.file(name)?.async('string');
    if (xml) cache.set(normalizePath(name), parseModelXml(xml));
  }
  const root = cache.get(rootPath);
  if (!root) return [];
  const meshes: ThreeMfMesh[] = [];
  root.items.forEach((item, n) => {
    const acc: Accumulator = { positions: [], indices: [] };
    appendObject((p) => cache.get(p), rootPath, item.id, item.matrix, acc, 0);
    if (acc.indices.length === 0) return;
    const scaled = root.scale === 1 ? acc.positions : acc.positions.map((p) => p * root.scale);
    const name = root.objects.get(item.id)?.name || `${fallbackName} ${n + 1}`;
    meshes.push({ name, positions: scaled, indices: acc.indices });
  });
  return meshes;
}

/**
 * STL binaire du maillage dans le repère de la scène (x, y, z)imprimante → (x, z, y)scène, comme à l'export (threeMf.ts) :
 * c'est un miroir, l'ordre des sommets de chaque triangle est donc inversé. Il entre par le même chemin que tout STL.
 */
export function sceneStlBytes(mesh: ThreeMfMesh): Uint8Array {
  const count = Math.floor(mesh.indices.length / 3);
  const out = new DataView(new ArrayBuffer(84 + count * 50));
  out.setUint32(80, count, true);
  const p = mesh.positions;
  const at = (i: number): [number, number, number] => [p[i * 3] ?? 0, p[i * 3 + 2] ?? 0, p[i * 3 + 1] ?? 0];
  for (let t = 0; t < count; t++) {
    const a = at(mesh.indices[t * 3] ?? 0),
      b = at(mesh.indices[t * 3 + 2] ?? 0),
      c = at(mesh.indices[t * 3 + 1] ?? 0);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const,
      w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0) || 1;
    const offset = 84 + t * 50;
    [...n.map((v) => v / len), ...a, ...b, ...c].forEach((v, i) => out.setFloat32(offset + i * 4, v, true));
  }
  return new Uint8Array(out.buffer);
}
