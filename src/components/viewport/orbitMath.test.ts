import { describe, expect, it } from 'vitest';
import { orbitAngles } from './orbitMath';

describe('orbitAngles', () => {
  it("autour de l'axe vertical, seul alpha change", () => {
    const r = orbitAngles(0.5, 1.1, { x: 0, y: 1, z: 0 }, 0.7);
    expect(r.beta).toBeCloseTo(1.1, 6);
    expect(Math.cos(r.alpha - 0.5)).toBeCloseTo(Math.cos(0.7), 6);
    expect(r.clamped).toBe(false);
  });

  it('un angle nul laisse la vue intacte', () => {
    const r = orbitAngles(0.5, 1.1, { x: 1, y: 0, z: 0 }, 0);
    expect(r.alpha).toBeCloseTo(0.5, 6);
    expect(r.beta).toBeCloseTo(1.1, 6);
  });

  it("autour d'un axe horizontal, bêta change sans jamais franchir le pôle", () => {
    const r = orbitAngles(Math.PI / 2, 0.05, { x: 1, y: 0, z: 0 }, -0.045);
    expect(r.beta).toBeGreaterThan(0);
    expect(r.beta).toBeLessThan(Math.PI);
    expect(r.clamped).toBe(true);
  });
});
