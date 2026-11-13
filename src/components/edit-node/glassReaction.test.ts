import { describe, expect, it } from 'vitest';
import { glassContentShift, glassSigma, glassTarget } from './glassReaction';

const BUTTON = { left: 100, top: 100, width: 170, height: 44 };
const CENTER = { x: 185, y: 122 };

describe('glassTarget', () => {
  it('reste au repos quand le bouton est inactif', () => {
    const t = glassTarget(false, true, BUTTON, CENTER.x, CENTER.y);
    expect(t.pull).toBe(0);
    expect(t.gw).toBe(0);
  });

  it("n'attire pas la matière quand le pointeur est hors de portée", () => {
    const t = glassTarget(true, false, BUTTON, 2000, 2000);
    expect(t.pull).toBe(0);
    expect(t.gw).toBe(0);
    // L'aimant reste borné près du bouton (pas à l'infini avec le pointeur).
    expect(Math.abs(t.mx)).toBeLessThanOrEqual(BUTTON.width / 2 + 90);
  });

  it('attire de plus en plus à mesure que le pointeur approche', () => {
    const far = glassTarget(true, false, BUTTON, 270 + 70, CENTER.y);
    const close = glassTarget(true, false, BUTTON, 270 + 20, CENTER.y);
    const on = glassTarget(true, false, BUTTON, 260, CENTER.y);
    expect(far.pull).toBeGreaterThan(0);
    expect(close.pull).toBeGreaterThan(far.pull);
    expect(on.pull).toBeGreaterThan(close.pull);
  });

  it("place l'aimant sous le pointeur, relatif au centre", () => {
    const t = glassTarget(true, false, BUTTON, CENTER.x + 40, CENTER.y - 10);
    expect(t.mx).toBeCloseTo(40);
    expect(t.my).toBeCloseTo(-10);
  });

  it("écrase la goutte à l'appui : plus large, plus basse, attirée plus fort", () => {
    const hover = glassTarget(true, false, BUTTON, CENTER.x, CENTER.y);
    const press = glassTarget(true, true, BUTTON, CENTER.x, CENTER.y);
    expect(press.gw).toBeGreaterThan(hover.gw);
    expect(press.gh).toBeLessThan(hover.gh);
    expect(press.pull).toBeGreaterThan(hover.pull);
  });
});

describe('glassContentShift', () => {
  const sigma = glassSigma(BUTTON.width / 2, BUTTON.height / 2);

  it("est nul au repos et quand l'aimant est au centre", () => {
    expect(glassContentShift({ mx: 30, my: 0, pull: 0 }, sigma)).toEqual({ x: 0, y: 0 });
    expect(glassContentShift({ mx: 0, my: 0, pull: 12 }, sigma)).toEqual({ x: 0, y: 0 });
  });

  it("va vers l'aimant sans jamais dépasser sa force", () => {
    const s = glassContentShift({ mx: 60, my: -20, pull: 12 }, sigma);
    expect(s.x).toBeGreaterThan(0);
    expect(s.y).toBeLessThan(0);
    expect(Math.hypot(s.x, s.y)).toBeLessThan(12);
  });
});
