import { describe, expect, it, vi } from 'vitest';
vi.mock('@/utils/interfaceMode', () => ({ isFlatUi: () => false }));

import { DROP_IN_MS, dropInOffset } from './viewportDropIn';

describe('dropInOffset', () => {
  it("dure moins d'une seconde", () => {
    expect(DROP_IN_MS).toBeLessThan(1000);
  });
  it('part au-dessus du plateau et finit posé', () => {
    expect(dropInOffset(0)).toBeGreaterThan(5);
    expect(dropInOffset(1)).toBe(0);
  });
  it("ne passe jamais sous le plateau et rebondit après l'impact", () => {
    const samples = Array.from({ length: 101 }, (_, i) => dropInOffset(i / 100));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(dropInOffset(0.45)).toBeCloseTo(0, 5);
    expect(dropInOffset(0.6)).toBeGreaterThan(1);
  });
});
