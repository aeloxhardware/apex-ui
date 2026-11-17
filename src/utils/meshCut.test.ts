import { describe, expect, it } from 'vitest';
import { cutTriangles, type Plane, type Vec3 } from './meshCut';
import { bounds, cutPlaneAt, flatNormals, paramsFromPlane, placePart, planeCenter, planeNormal, rotationBetween } from './cutPlane';

type Quad = [Vec3, Vec3, Vec3, Vec3];

/** Quadrilatère (a, b, c, d) en deux triangles, dans son sens. */
const quad = ([a, b, c, d]: Quad): number[] => [...a, ...b, ...c, ...a, ...c, ...d];

/** Pavé [x0, x1] × [y0, y1] × [z0, z1], faces orientées vers l'extérieur (sens direct). */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): number[] {
  return [
    quad([
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y0, z0],
    ]),
    quad([
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ]),
    quad([
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ]),
    quad([
      [x0, y1, z0],
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
    ]),
    quad([
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
    ]),
    quad([
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ]),
  ].flat();
}

/** Inverse le sens de chaque triangle. */
function reversed(tris: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < tris.length; i += 9) out.push(...tris.slice(i, i + 3), ...tris.slice(i + 6, i + 9), ...tris.slice(i + 3, i + 6));
  return out;
}

/**
 * Tube carré vertical (axe Y) : extérieur [0, 3]², trou [1, 2]², hauteur [0, 2]. Les couronnes du haut et du bas sont faites de
 * quatre trapèzes. Volume : 8 × 2 = 16.
 */
function tube(): number[] {
  const o: [number, number][] = [
    [0, 0],
    [3, 0],
    [3, 3],
    [0, 3],
  ];
  const h: [number, number][] = [
    [1, 1],
    [2, 1],
    [2, 2],
    [1, 2],
  ];
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [ox0, oz0] = o[i] ?? [0, 0];
    const [ox1, oz1] = o[(i + 1) % 4] ?? [0, 0];
    const [hx0, hz0] = h[i] ?? [0, 0];
    const [hx1, hz1] = h[(i + 1) % 4] ?? [0, 0];
    out.push(
      ...quad([
        [ox0, 0, oz0],
        [ox1, 0, oz1],
        [ox1, 2, oz1],
        [ox0, 2, oz0],
      ]),
    ); // paroi extérieure
    out.push(
      ...quad([
        [hx0, 0, hz0],
        [hx0, 2, hz0],
        [hx1, 2, hz1],
        [hx1, 0, hz1],
      ]),
    ); // paroi du trou
    out.push(
      ...quad([
        [ox0, 2, oz0],
        [ox1, 2, oz1],
        [hx1, 2, hz1],
        [hx0, 2, hz0],
      ]),
    ); // couronne du haut
    out.push(
      ...quad([
        [ox0, 0, oz0],
        [hx0, 0, hz0],
        [hx1, 0, hz1],
        [ox1, 0, oz1],
      ]),
    ); // couronne du bas
  }
  return reversed(out); // tracé ci-dessus dans le sens indirect
}

/** Volume signé (positif pour un solide fermé orienté vers l'extérieur). */
function volume(tris: number[]): number {
  let v = 0;
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const [ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0, cx = 0, cy = 0, cz = 0] = tris.slice(i, i + 9);
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** Étanche : chaque arête est parcourue autant de fois dans un sens que dans l'autre. */
function isClosed(tris: number[]): boolean {
  const k = (i: number) =>
    tris
      .slice(i, i + 3)
      .map((v) => Math.round(v * 1e6))
      .join(',');
  const count = new Map<string, number>();
  for (let i = 0; i + 8 < tris.length; i += 9) {
    for (const [a, b] of [
      [i, i + 3],
      [i + 3, i + 6],
      [i + 6, i],
    ] as const) {
      const [ka, kb] = [k(a), k(b)];
      if (ka === kb) continue;
      const fwd = `${ka}>${kb}`;
      const back = `${kb}>${ka}`;
      if ((count.get(back) ?? 0) > 0) count.set(back, (count.get(back) ?? 0) - 1);
      else count.set(fwd, (count.get(fwd) ?? 0) + 1);
    }
  }
  return [...count.values()].every((n) => n === 0);
}

const horizontal = (y: number): Plane => ({ normal: [0, 1, 0], offset: y });

describe('cutTriangles', () => {
  it('coupe un cube en deux solides fermés dont les volumes s’additionnent', () => {
    const { upper, lower, openLoops } = cutTriangles(box(0, 1, 0, 1, 0, 1), horizontal(0.3));
    expect(openLoops).toBe(0);
    expect(volume(upper)).toBeCloseTo(0.7, 9);
    expect(volume(lower)).toBeCloseTo(0.3, 9);
    expect(isClosed(upper)).toBe(true);
    expect(isClosed(lower)).toBe(true);
    expect(bounds(upper).min[1]).toBeCloseTo(0.3, 9);
    expect(bounds(lower).max[1]).toBeCloseTo(0.3, 9);
  });

  it('suit un plan incliné', () => {
    const n = Math.sqrt(3);
    const { upper, lower } = cutTriangles(box(0, 1, 0, 1, 0, 1), { normal: [1 / n, 1 / n, 1 / n], offset: 1.2 / n });
    expect(volume(upper) + volume(lower)).toBeCloseTo(1, 9);
    expect(volume(upper)).toBeGreaterThan(0);
    expect(volume(lower)).toBeGreaterThan(0);
    expect(isClosed(upper) && isClosed(lower)).toBe(true);
  });

  it('laisse le trou d’une pièce creuse ouvert (section en couronne)', () => {
    expect(volume(tube())).toBeCloseTo(16, 9);
    const { upper, lower, openLoops } = cutTriangles(tube(), horizontal(0.5));
    expect(openLoops).toBe(0);
    expect(volume(lower)).toBeCloseTo(8 * 0.5, 9);
    expect(volume(upper)).toBeCloseTo(8 * 1.5, 9);
    expect(isClosed(upper) && isClosed(lower)).toBe(true);
  });

  it('reste cohérent avec un maillage orienté dans l’autre sens', () => {
    const { upper, lower } = cutTriangles(reversed(box(0, 2, 0, 2, 0, 2)), horizontal(1.5));
    expect(volume(upper)).toBeCloseTo(-2, 9);
    expect(volume(lower)).toBeCloseTo(-6, 9);
    expect(isClosed(upper) && isClosed(lower)).toBe(true);
  });

  it('coupe deux pièces disjointes d’un même modèle', () => {
    const { upper, lower } = cutTriangles([...box(0, 1, 0, 1, 0, 1), ...box(3, 4, 0, 2, 0, 1)], horizontal(0.5));
    expect(volume(upper)).toBeCloseTo(0.5 + 1.5, 9);
    expect(volume(lower)).toBeCloseTo(1, 9);
    expect(isClosed(upper) && isClosed(lower)).toBe(true);
  });

  it('ne coupe rien quand le plan passe au ras d’une face', () => {
    const { upper, lower } = cutTriangles(box(0, 1, 0, 1, 0, 1), horizontal(0));
    expect(lower).toHaveLength(0);
    expect(volume(upper)).toBeCloseTo(1, 9);
  });

  it('compte les contours ouverts d’un maillage non étanche', () => {
    const open = box(0, 1, 0, 1, 0, 1).slice(18); // sans la face z = 0
    expect(cutTriangles(open, horizontal(0.5)).openLoops).toBe(1);
  });
});

describe('plan de coupe', () => {
  it('est horizontal par défaut et se retourne avec A = 180°', () => {
    expect(planeNormal({ a: 0, b: 0, c: 0 })).toEqual([0, 1, 0]);
    const down = planeNormal({ a: 180, b: 0, c: 0 });
    expect(down[1]).toBeCloseTo(-1, 12);
  });

  it('penche vers X imprimante (x de la scène) avec B', () => {
    const [x, y, z] = planeNormal({ a: 0, b: 90, c: 0 });
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(0, 12);
  });

  it('penche vers Y imprimante (z de la scène) avec A', () => {
    const [x, y, z] = planeNormal({ a: -90, b: 0, c: 0 });
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(1, 12);
  });

  it('passe à la hauteur demandée au-dessus du plateau', () => {
    const plane = cutPlaneAt({ height: 10, x: 0, y: 0, a: 0, b: 0, c: 0 }, [5, 7, 5], 2);
    expect(plane.offset).toBeCloseTo(12, 12);
  });

  it('amène un vecteur sur un autre, opposé compris', () => {
    for (const from of [
      [0, 1, 0],
      [1, 0, 0],
      [0, 0.6, 0.8],
    ] as Vec3[]) {
      const m = rotationBetween(from, [0, -1, 0]);
      expect(m[0] * from[0] + m[1] * from[1] + m[2] * from[2]).toBeCloseTo(0, 12);
      expect(m[3] * from[0] + m[4] * from[1] + m[5] * from[2]).toBeCloseTo(-1, 12);
      expect(m[6] * from[0] + m[7] * from[1] + m[8] * from[2]).toBeCloseTo(0, 12);
    }
  });
});

describe('paramsFromPlane', () => {
  it.each([
    [0, 0, 0],
    [30, -20, 0],
    [-45, 60, 25],
    [10, 170, -90],
  ])('relit A = %d°, B = %d°, C = %d° depuis la normale', (a, b, c) => {
    const params = { height: 12, x: 3, y: -4, a, b, c };
    const center: Vec3 = [10, 50, -6];
    const back = paramsFromPlane(planeCenter(params, center, 2), planeNormal(params), c, center, 2);
    expect(back.a).toBeCloseTo(a, 9);
    expect(back.b).toBeCloseTo(b, 9);
    expect(back.height).toBeCloseTo(12, 9);
    expect(back.x).toBeCloseTo(3, 9);
    expect(back.y).toBeCloseTo(-4, 9);
  });

  it('retrouve la même normale quand A dépasse 90° (plan retourné)', () => {
    const n = planeNormal({ a: 180, b: 0, c: 0 });
    const back = paramsFromPlane([0, 0, 0], n, 0, [0, 0, 0], 0);
    const again = planeNormal(back);
    for (let i = 0; i < 3; i++) expect(again[i]).toBeCloseTo(n[i] ?? 0, 9);
  });
});

describe('placePart', () => {
  it('pose la face coupée d’un morceau haut sur le plateau', () => {
    const n = Math.sqrt(2);
    const { upper } = cutTriangles(box(0, 1, 0, 1, 0, 1), { normal: [1 / n, 1 / n, 0], offset: 1 / n });
    const placed = placePart(upper, 'on-cut', [-1 / n, -1 / n, 0], 0);
    expect(bounds(placed).min[1]).toBeCloseTo(0, 9);
    // Le plan passe exactement par deux sommets du cube : ils sont comptés en haut, à 1e-6 près (meshCut.ts).
    expect(volume(placed)).toBeCloseTo(volume(upper), 5);
    // La face coupée (un triangle rectangle) repose à plat : trois sommets au moins à y = 0.
    const onPlate = new Set<string>();
    for (let i = 0; i < placed.length; i += 3)
      if (Math.abs(placed[i + 1] ?? 1) < 1e-9) onPlate.add(`${placed[i]?.toFixed(6)},${placed[i + 2]?.toFixed(6)}`);
    expect(onPlate.size).toBeGreaterThanOrEqual(3);
  });

  it('retourne un morceau et le repose sur le plateau', () => {
    const placed = placePart(box(0, 1, 5, 7, 0, 1), 'flip', [0, -1, 0], 0);
    expect(bounds(placed).min[1]).toBeCloseTo(0, 9);
    expect(bounds(placed).max[1]).toBeCloseTo(2, 9);
    expect(volume(placed)).toBeCloseTo(2, 9);
  });

  it('laisse un morceau tel quel mais le pose sur le plateau', () => {
    const placed = placePart(box(0, 1, 5, 7, 0, 1), 'keep', [0, -1, 0], 1);
    expect(bounds(placed).min).toEqual([0, 1, 0]);
  });
});

describe('flatNormals', () => {
  it('donne une normale unitaire par triangle, dans la convention demandée', () => {
    const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    expect(Array.from(flatNormals(tri, 1))).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(Array.from(flatNormals(tri, -1).slice(0, 3))).toEqual([-0, -0, -1]);
  });
});
