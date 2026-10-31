import { describe, expect, it } from 'vitest';
import { arrange, convexHull, minkowskiSum, polygonArea, type Pt } from './orcaArrange';

const rect = (w: number, h: number): Pt[] => [
  { x: -w / 2, z: -h / 2 }, { x: w / 2, z: -h / 2 }, { x: w / 2, z: h / 2 }, { x: -w / 2, z: h / 2 },
];

describe('disposition automatique (Orca)', () => {
  it('la somme de Minkowski de deux carrés est un carré de côtés additionnés', () => {
    const s = minkowskiSum(convexHull(rect(10, 10)), convexHull(rect(4, 6)));
    expect(polygonArea(s)).toBeCloseTo(14 * 16, 6);
  });

  it('place plusieurs pièces sans chevauchement ni débord, avec l\'écart demandé', () => {
    const sizes = [60, 40, 40, 30, 20, 20, 15, 10];
    const res = arrange(sizes.map((s) => ({ outline: rect(s, s) })), { binRadius: 125, spacing: 5, allowRotations: false });
    res.forEach((r) => expect(r.center).not.toBeNull());
    for (let i = 0; i < sizes.length; i++) {
      const a = res[i].center!;
      const h = sizes[i] / 2;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        expect(Math.hypot(a.x + sx * h, a.z + sz * h)).toBeLessThanOrEqual(125 + 1e-3);
      }
      for (let j = i + 1; j < sizes.length; j++) {
        const b = res[j].center!;
        const gap = Math.max(Math.abs(a.x - b.x) - (sizes[i] + sizes[j]) / 2, Math.abs(a.z - b.z) - (sizes[i] + sizes[j]) / 2);
        expect(gap).toBeGreaterThanOrEqual(5 - 1e-3);
      }
    }
  });

  it('laisse sans position une pièce plus grande que le plateau', () => {
    const res = arrange([{ outline: rect(400, 400) }, { outline: rect(10, 10) }], { binRadius: 125, spacing: 5, allowRotations: false });
    expect(res[0].center).toBeNull();
    expect(res[1].center).not.toBeNull();
  });

  it('redresse une pièce inclinée à 30° grâce à la graine de rotation', () => {
    const a = (30 * Math.PI) / 180;
    const tilted = rect(80, 20).map((p) => ({ x: p.x * Math.cos(a) - p.z * Math.sin(a), z: p.x * Math.sin(a) + p.z * Math.cos(a) }));
    const [r] = arrange([{ outline: tilted }], { binRadius: 125, spacing: 0, allowRotations: true });
    const k = Math.abs(((r.angle + a) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    expect(Math.min(k, Math.PI / 2 - k)).toBeLessThan(1e-6);
  });
});
