import { describe, expect, it } from 'vitest';
import { STORM_MAX_PIXELS, stormCanvasSize, stormPower } from './digitalStormEngine';

describe('stormCanvasSize', () => {
  it('garde la taille CSS sous le plafond', () => {
    expect(stormCanvasSize(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(stormCanvasSize(1600, 900)).toEqual({ width: 1600, height: 900 });
  });

  it('sous-échantillonne au-delà du plafond en gardant les proportions', () => {
    const size = stormCanvasSize(3840, 2160);
    expect(size).toEqual({ width: 1600, height: 900 });
    expect(size.width * size.height).toBeLessThanOrEqual(STORM_MAX_PIXELS);
  });

  it('ne renvoie jamais un canevas vide', () => {
    expect(stormCanvasSize(0, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe('stormPower', () => {
  it('monte de 0 à 1 puis reste à 1', () => {
    expect(stormPower(0)).toBe(0);
    expect(stormPower(0.7)).toBeCloseTo(0.5);
    expect(stormPower(1.4)).toBe(1);
    expect(stormPower(60)).toBe(1);
  });
});
