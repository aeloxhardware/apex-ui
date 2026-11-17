// Projet Apex → fichier 3MF (zip : modèles du plateau + G-code éventuel). La scène Babylon a Y vers le haut,
// l'imprimante Z vers le haut : (x, y, z)_scène → (x, z, y)_imprimante, un miroir. L'orientation des triangles est donc
// rétablie au volume signé, comme pour le STL du moteur (plateStl.ts).
import JSZip from 'jszip';

export interface ThreeMfPart {
  name: string;
  /** Sommets en repère monde de la scène, x y z à la suite. */
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Matrice monde de déterminant négatif : les triangles sont déjà retournés par le miroir. */
  mirrored: boolean;
}

export interface ThreeMfInput {
  parts: ThreeMfPart[];
  /** G-code du projet, rangé à la manière d'Orca (`Metadata/plate_1.gcode`). */
  gcode?: { name: string; text: string } | null;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="gcode" ContentType="text/x.gcode"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

/** Triangles (indices de sommets) rangés pour que le volume signé du repère imprimante soit positif. */
export function printerTriangles(part: ThreeMfPart): number[] {
  const { positions: p, indices: ix } = part;
  const out: number[] = [];
  let volume = 0;
  for (let i = 0; i + 2 < ix.length; i += 3) {
    const [a, b, c] = part.mirrored ? [ix[i], ix[i + 2], ix[i + 1]] : [ix[i], ix[i + 1], ix[i + 2]];
    out.push(a, b, c);
    // Repère imprimante : (x, z, y) de la scène.
    const [ax, ay, az] = [p[a * 3], p[a * 3 + 2], p[a * 3 + 1]];
    const [bx, by, bz] = [p[b * 3], p[b * 3 + 2], p[b * 3 + 1]];
    const [cx, cy, cz] = [p[c * 3], p[c * 3 + 2], p[c * 3 + 1]];
    volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (volume < 0) for (let i = 0; i + 2 < out.length; i += 3) [out[i + 1], out[i + 2]] = [out[i + 2], out[i + 1]];
  return out;
}

function objectXml(part: ThreeMfPart, id: number): string {
  const p = part.positions;
  const vertices: string[] = [];
  for (let i = 0; i + 2 < p.length; i += 3) vertices.push(`<vertex x="${p[i]}" y="${p[i + 2]}" z="${p[i + 1]}"/>`);
  const t = printerTriangles(part);
  const triangles: string[] = [];
  for (let i = 0; i + 2 < t.length; i += 3) triangles.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>`);
  return `<object id="${id}" type="model" name="${escapeXml(part.name)}"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
}

function threeMfModelXml(parts: ThreeMfPart[]): string {
  const objects = parts.map((part, i) => objectXml(part, i + 1)).join('');
  const items = parts.map((_, i) => `<item objectid="${i + 1}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Apex</metadata><resources>${objects}</resources><build>${items}</build></model>`;
}

/** Octets du .3mf (zip compressé). */
export async function buildThreeMf(input: ThreeMfInput): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('3D/3dmodel.model', threeMfModelXml(input.parts));
  if (input.gcode) {
    zip.file('Metadata/plate_1.gcode', input.gcode.text);
    zip.file('Metadata/plate_1.gcode.name', input.gcode.name);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
