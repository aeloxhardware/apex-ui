import { describe, expect, it } from 'vitest';
import { suggestModelUnit } from './modelUnit';

describe('suggestModelUnit', () => {
  it('propose les pouces pour un petit objet lu en millimètres (dessiné en pouces)', () => {
    // 2 mm en millimètres = 2 pouces (50,8 mm) : la lecture en pouces est dans la plage.
    expect(suggestModelUnit(2, 'mm')).toBe('in');
    expect(suggestModelUnit(0.5, 'mm')).toBe('in');
  });

  it('ne propose rien pour une taille déjà plausible', () => {
    expect(suggestModelUnit(20, 'mm')).toBeNull();
    expect(suggestModelUnit(600, 'mm')).toBeNull();
  });

  it('ne propose pas les pouces pour un grand objet lu en millimètres (les pouces le rendraient encore plus grand)', () => {
    expect(suggestModelUnit(3000, 'mm')).toBeNull();
  });

  it('propose les millimètres pour un grand objet lu en pouces', () => {
    // 3000 affiché en pouces = 3000 / 25,4 ≈ 118 mm en millimètres : dans la plage.
    expect(suggestModelUnit(3000, 'in')).toBe('mm');
  });

  it('ne propose pas les millimètres pour un petit objet lu en pouces', () => {
    expect(suggestModelUnit(2, 'in')).toBeNull();
  });

  it('ne propose rien pour un objet vide', () => {
    expect(suggestModelUnit(0, 'mm')).toBeNull();
  });
});
