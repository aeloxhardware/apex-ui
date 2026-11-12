import { describe, expect, it } from 'vitest';
import { activeKeyToSet } from './amsStore';
import type { AmsEntry } from './amsSpoolsState';

const e = (key: string): AmsEntry => ({ id: key, key, color: '#fff' });

describe('activeKeyToSet', () => {
  it('le filament actif suit la bobine du slot 1', () => {
    expect(activeKeyToSet([e('A|x'), e('B|y')], 'B|y')).toBe('A|x');
  });
  it('rien à changer quand le slot 1 est déjà le filament actif', () => {
    expect(activeKeyToSet([e('A|x'), e('B|y')], 'A|x')).toBeNull();
  });
  it('déplacer une autre bobine ne change pas le filament actif ; passer une bobine en tête, si', () => {
    expect(activeKeyToSet([e('A|x'), e('C|z'), e('B|y')], 'A|x')).toBeNull();
    expect(activeKeyToSet([e('B|y'), e('A|x')], 'A|x')).toBe('B|y');
  });
  it('une AMS vide ne touche à rien', () => {
    expect(activeKeyToSet([], 'A|x')).toBeNull();
  });
});
