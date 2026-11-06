import { describe, expect, it } from 'vitest';
import { fixedFlags, lockToggleTarget, nothingToMove } from './arrangePlan';

describe('plan de disposition', () => {
  const models = [
    { locked: false, selected: true },
    { locked: true, selected: true },
    { locked: false, selected: false },
  ];

  it('tout le plateau : seuls les verrouillés restent', () => {
    expect(fixedFlags(models, false)).toEqual([false, true, false]);
  });

  it('sélection seule : les verrouillés et les non-sélectionnés restent', () => {
    expect(fixedFlags(models, true)).toEqual([false, true, true]);
  });

  it('rien à déplacer quand tout est fixe (ou qu’il n’y a rien)', () => {
    expect(nothingToMove([true, true])).toBe(true);
    expect(nothingToMove([true, false])).toBe(false);
    expect(nothingToMove([])).toBe(true);
  });

  it('la bascule verrouille, sauf si toute la sélection est déjà verrouillée', () => {
    expect(lockToggleTarget([false, true])).toBe(true);
    expect(lockToggleTarget([true, true])).toBe(false);
    expect(lockToggleTarget([])).toBe(true);
  });
});
