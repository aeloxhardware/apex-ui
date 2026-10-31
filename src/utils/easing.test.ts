import { describe, expect, it } from 'vitest';
import { apexEase, cubicBezier } from './easing';

describe('cubicBezier', () => {
  it('reste linéaire pour la courbe (0, 0, 1, 1)', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0.25)).toBeCloseTo(0.25, 4);
    expect(linear(0.5)).toBeCloseTo(0.5, 4);
  });

  it('part de 0 et finit à 1, sans dépassement pour la courbe de l\'application', () => {
    expect(apexEase(0)).toBe(0);
    expect(apexEase(1)).toBe(1);
    let previous = 0;
    for (let i = 1; i <= 100; i++) {
      const value = apexEase(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(value).toBeLessThanOrEqual(1 + 1e-9);
      previous = value;
    }
  });

  it('démarre vite (ease-out) : plus de la moitié du chemin à mi-durée', () => {
    expect(apexEase(0.5)).toBeGreaterThan(0.8);
  });
});
