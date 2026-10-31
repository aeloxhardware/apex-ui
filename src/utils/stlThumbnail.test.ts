import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStl } from './stlThumbnail';

const dir = 'src/assets/practical-models';

describe('parseStl', () => {
  it('lit tous les modèles pratiques (nombre de triangles = taille du fichier)', () => {
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.stl'))) {
      const bytes = readFileSync(`${dir}/${name}`);
      const tris = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      expect(tris.length, name).toBeGreaterThan(0);
      expect(tris.every(Number.isFinite), name).toBe(true);
      if (bytes.length === 84 + bytes.readUInt32LE(80) * 50) expect(tris.length / 9, name).toBe(bytes.readUInt32LE(80));
    }
  });

  it('lit un STL ASCII', () => {
    const text = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid';
    expect(Array.from(parseStl(new TextEncoder().encode(text).buffer))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
});
