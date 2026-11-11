import { describe, expect, it } from 'vitest';
import { PEEK, GAP, cardPose, layoutStack } from './notificationLayout';
import { dismissDirection, releaseVelocity } from './notificationMotion';

const heightOf = () => 50;

describe('layoutStack', () => {
  it('replié : la face plus une bande par carte du fond (2 au plus)', () => {
    expect(layoutStack(['a', 'b', 'c', 'd'], heightOf, false).height).toBe(50 + 2 * PEEK);
  });
  it('déplié : toutes les cartes, séparées par GAP', () => {
    const layout = layoutStack(['a', 'b', 'c'], heightOf, true);
    expect(layout.offsets).toEqual([0, 50 + GAP, 2 * (50 + GAP)]);
    expect(layout.height).toBe(150 + 2 * GAP);
  });
  it('pile vide : hauteur nulle', () => {
    expect(layoutStack([], heightOf, true).height).toBe(0);
    expect(layoutStack([], heightOf, false).height).toBe(0);
  });
});

describe('cardPose', () => {
  const layout = layoutStack(['a', 'b', 'c', 'd'], heightOf, false);
  it("la face est en haut, à l'échelle 1", () => {
    expect(cardPose(0, false, layout, 50)).toMatchObject({ y: 0, scale: 1, hidden: false, peek: false });
  });
  it('une carte du fond a son bord bas PEEK sous celui de la précédente', () => {
    const pose = cardPose(1, false, layout, 50);
    expect(pose.y + 50 * pose.scale).toBeCloseTo(50 + PEEK);
    expect(pose.peek).toBe(true);
  });
  it('au-delà de la pile visible, la carte est cachée sauf si déplié', () => {
    expect(cardPose(3, false, layout, 50).hidden).toBe(true);
    expect(cardPose(3, true, layout, 50).hidden).toBe(false);
  });
});

describe('balayage', () => {
  it('une courte course lente revient', () => {
    expect(dismissDirection(30, 0.01)).toBe(0);
  });
  it('une longue course sort du côté du déplacement', () => {
    expect(dismissDirection(-120, 0)).toBe(-1);
  });
  it("un geste vif sort, mais pas s'il revient vers le milieu", () => {
    expect(dismissDirection(20, 0.3)).toBe(1);
    expect(dismissDirection(20, -0.3)).toBe(0);
  });
  it('la vitesse se lit sur la fenêtre finale', () => {
    expect(
      releaseVelocity([
        { t: 0, x: 0 },
        { t: 200, x: 100 },
        { t: 240, x: 104 },
      ]),
    ).toBeCloseTo(0.1);
    expect(releaseVelocity([])).toBe(0);
  });
});
