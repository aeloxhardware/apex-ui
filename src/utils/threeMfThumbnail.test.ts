import { describe, expect, it } from 'vitest';
import { flatTriangles } from './threeMfThumbnail';

// Cube de 10 mm posé sur le plateau (repère imprimante, Z vers le haut).
const CUBE = {
  name: 'cube',
  positions: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10],
  indices: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7],
};

describe('flatTriangles', () => {
  it('ne garde que les faces tournées vers la vue, dans le cadre demandé', () => {
    const triangles = flatTriangles([CUBE], 240, 160);
    expect(triangles.length).toBeGreaterThan(0);
    expect(triangles.length).toBeLessThan(12);
    for (const t of triangles) {
      for (let i = 0; i < 6; i += 2) {
        expect(t.points[i] as number).toBeGreaterThanOrEqual(0);
        expect(t.points[i] as number).toBeLessThanOrEqual(240);
        expect(t.points[i + 1] as number).toBeGreaterThanOrEqual(0);
        expect(t.points[i + 1] as number).toBeLessThanOrEqual(160);
      }
      expect(t.shade).toBeGreaterThanOrEqual(0.3);
      expect(t.shade).toBeLessThanOrEqual(1);
    }
  });

  it("trie du fond vers l'avant", () => {
    const depths = flatTriangles([CUBE], 240, 160).map((t) => t.depth);
    expect([...depths].sort((a, b) => b - a)).toEqual(depths);
  });

  it('renvoie une liste vide sans géométrie', () => {
    expect(flatTriangles([], 240, 160)).toEqual([]);
  });
});
