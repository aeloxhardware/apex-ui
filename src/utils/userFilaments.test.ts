import { describe, expect, it } from 'vitest';
import { baseNameOf, makeUserCopy, nextCopyName } from './userFilaments';
import { filamentKey, type FilamentProfile } from './filamentCatalog';

const factory = { name: 'Bambu PLA Silk', vendor: 'BBL', finish: 'silk', nozzle_temp: 220 } as FilamentProfile;

describe('nextCopyName', () => {
  it('« - Copie » puis « - Copie (2) », « (3) »… selon les noms déjà pris', () => {
    expect(nextCopyName('X', [])).toBe('X - Copie');
    expect(nextCopyName('X', ['X - Copie'])).toBe('X - Copie (2)');
    expect(nextCopyName('X', ['X - Copie', 'X - Copie (2)'])).toBe('X - Copie (3)');
  });
  it('copier une copie repart du nom de base', () => {
    expect(baseNameOf('X - Copie (2)')).toBe('X');
    expect(nextCopyName('X - Copie', ['X - Copie'])).toBe('X - Copie (2)');
  });
});

describe('makeUserCopy', () => {
  it("ne modifie jamais le profil d'origine et garde la trace du profil d'usine", () => {
    const before = JSON.stringify(factory);
    const copy = makeUserCopy(factory, { nozzle_temp: 230, finish: 'matte' }, []);
    expect(JSON.stringify(factory)).toBe(before);
    expect(copy).toMatchObject({
      name: 'Bambu PLA Silk - Copie',
      user: true,
      nozzle_temp: 230,
      finish: 'matte',
      baseKey: filamentKey(factory),
    });
  });
  it("la copie d'une copie pointe toujours le profil d'usine", () => {
    const first = makeUserCopy(factory, {}, []);
    const second = makeUserCopy(first, { bed_temp: 60 }, [first.name]);
    expect(second.name).toBe('Bambu PLA Silk - Copie (2)');
    expect(second.baseKey).toBe(filamentKey(factory));
    expect(first.bed_temp).toBeUndefined();
  });
});
