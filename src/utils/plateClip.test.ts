import { describe, expect, it } from 'vitest';
import { clipAbovePlane } from './plateClip';

// Boîte [x0,x1]×[y0,y1]×[z0,z1] en triangles (12), normales vers l'extérieur.
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): number[] {
  const v = (x: number, y: number, z: number) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
  return [
    ...quad(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)), // bas
    ...quad(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)), // haut
    ...quad(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)),
    ...quad(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)),
    ...quad(v(1, 1, 0), v(0, 1, 0), v(0, 1, 1), v(1, 1, 1)),
    ...quad(v(0, 1, 0), v(0, 0, 0), v(0, 0, 1), v(0, 1, 1)),
  ];
}

const volume = (t: number[]) => {
  let s = 0;
  for (let i = 0; i < t.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.slice(i, i + 9);
    s += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return s / 6;
};

// Chaque arête orientée doit avoir son opposée : surface fermée.
function isWatertight(t: number[]): boolean {
  const k = (i: number) => t.slice(i, i + 3).map((x) => Math.round(x * 1e4)).join(',');
  const count = new Map<string, number>();
  for (let i = 0; i < t.length; i += 9) {
    for (const [a, b] of [[0, 3], [3, 6], [6, 0]]) {
      const forward = `${k(i + a)}>${k(i + b)}`;
      const backward = `${k(i + b)}>${k(i + a)}`;
      if (count.get(backward)) count.set(backward, count.get(backward)! - 1);
      else count.set(forward, (count.get(forward) ?? 0) + 1);
    }
  }
  return [...count.values()].every((n) => n === 0);
}

describe('clipAbovePlane', () => {
  it('coupe un cube à cheval sur le plan et rebouche', () => {
    const out = clipAbovePlane(box(0, 10, 0, 10, -4, 6), 0);
    expect(volume(out)).toBeCloseTo(600, 3);
    expect(isWatertight(out)).toBe(true);
    for (let i = 2; i < out.length; i += 3) expect(out[i]).toBeGreaterThanOrEqual(0);
  });

  it('marche aussi avec l\'orientation inversée', () => {
    const t = box(0, 10, 0, 10, -4, 6);
    const flipped: number[] = [];
    for (let i = 0; i < t.length; i += 9) flipped.push(...t.slice(i, i + 3), ...t.slice(i + 6, i + 9), ...t.slice(i + 3, i + 6));
    const out = clipAbovePlane(flipped, 0);
    expect(Math.abs(volume(out))).toBeCloseTo(600, 3);
    expect(isWatertight(out)).toBe(true);
  });

  it("garde le trou d'un anneau dans la section", () => {
    const O = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const I = [[3, 3], [7, 3], [7, 7], [3, 7]];
    const p = (q: number[], z: number) => [q[0], q[1], z];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
    const ring: number[] = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      ring.push(...quad(p(O[i], 6), p(O[j], 6), p(I[j], 6), p(I[i], 6)));
      ring.push(...quad(p(I[i], -4), p(I[j], -4), p(O[j], -4), p(O[i], -4)));
      ring.push(...quad(p(O[i], -4), p(O[j], -4), p(O[j], 6), p(O[i], 6)));
      ring.push(...quad(p(I[j], -4), p(I[i], -4), p(I[i], 6), p(I[j], 6)));
    }
    expect(volume(ring)).toBeCloseTo(840, 3);
    const out = clipAbovePlane(ring, 0);
    expect(volume(out)).toBeCloseTo(504, 3);
    expect(isWatertight(out)).toBe(true);
  });

  it('un modèle entièrement sous le plan disparaît', () => {
    expect(clipAbovePlane(box(0, 1, 0, 1, -5, -1), 0)).toEqual([]);
  });
});
