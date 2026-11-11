import { describe, expect, it } from 'vitest';
import { AMS_HOVER_SPOOLS, AMS_MAX_SPOOLS, AMS_BASE_SPOOLS, amsLayout, type AmsMetrics } from './amsLayout';

const M: AmsMetrics = { caseW: 440, pad: 18, maxSize: 84, gapRatio: 0.12 };

describe('amsLayout', () => {
  it('garde le boîtier à sa longueur et rétrécit les bobines jusqu\'à la limite', () => {
    let previous = Infinity;
    for (let n = 1; n <= AMS_BASE_SPOOLS; n++) {
      const l = amsLayout(n, M);
      expect(l.size).toBeLessThanOrEqual(previous);
      expect(l.expandedW).toBe(M.caseW);
      expect(l.overflowing).toBe(false);
      expect(n * l.size + (n - 1) * l.gap).toBeLessThanOrEqual(M.caseW - 2 * M.pad + 0.5);
      previous = l.size;
    }
  });

  it('ne dépasse jamais le diamètre maximal', () => {
    expect(amsLayout(1, M).size).toBe(M.maxSize);
  });

  it('au-delà de la limite : taille figée, bout estompé, boîtier développé au survol', () => {
    const base = amsLayout(AMS_BASE_SPOOLS, M);
    const l = amsLayout(AMS_BASE_SPOOLS + 1, M);
    expect(l.size).toBe(base.size);
    expect(l.overflowing).toBe(true);
    expect(l.collapsedW).toBe(M.caseW);
    expect(l.expandedW).toBeGreaterThan(M.caseW);
    expect(amsLayout(AMS_MAX_SPOOLS, M).expandedW).toBeGreaterThan(l.expandedW);
  });

  it('borne le nombre de bobines', () => {
    expect(amsLayout(0, M)).toEqual(amsLayout(1, M));
    expect(amsLayout(99, M)).toEqual(amsLayout(AMS_MAX_SPOOLS, M));
  });

  it('un chevauchement (écart négatif) permet des bobines plus grandes dans un boîtier serré', () => {
    const tight: AmsMetrics = { caseW: 240, pad: 8, maxSize: 200, gapRatio: 0.1 };
    const fan = amsLayout(AMS_BASE_SPOOLS, { ...tight, gapRatio: -0.38 });
    expect(fan.size).toBeGreaterThan(amsLayout(AMS_BASE_SPOOLS, tight).size);
    expect(fan.gap).toBeLessThan(0);
  });

  it('le réglage de l’AMS (240 px, bobines de 52 px) montre exactement 4 bobines à pleine taille', () => {
    const ams: AmsMetrics = { caseW: 240, pad: 8, maxSize: 52, gapRatio: 0.1 };
    expect(AMS_BASE_SPOOLS).toBe(4);
    expect(amsLayout(4, ams).size).toBe(52);
    expect(amsLayout(2, ams).size).toBe(52);
    expect(amsLayout(5, ams).size).toBe(52);
    expect(amsLayout(5, ams).overflowing).toBe(true);
  });

  it('au-delà de AMS_HOVER_SPOOLS : le survol s’arrête à ce nombre, le clic montre tout', () => {
    const ams: AmsMetrics = { caseW: 240, pad: 8, maxSize: 52, gapRatio: 0.1 };
    const hover = amsLayout(AMS_HOVER_SPOOLS, ams);
    expect(hover.truncated).toBe(false);
    expect(hover.fullW).toBe(hover.expandedW);
    const many = amsLayout(AMS_HOVER_SPOOLS + 6, ams);
    expect(many.truncated).toBe(true);
    expect(many.expandedW).toBe(hover.expandedW);
    expect(many.fullW).toBeGreaterThan(many.expandedW);
    expect(amsLayout(AMS_MAX_SPOOLS, ams).fullW).toBeGreaterThan(many.fullW);
  });
});
