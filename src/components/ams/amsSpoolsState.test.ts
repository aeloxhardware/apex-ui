import { describe, expect, it } from 'vitest';
import { entryFor, insertEntry, reorderByIds, replaceKey, resizeEntries, sampleEntry } from './amsSpoolsState';

const three = () => resizeEntries([], 3);

describe('amsSpoolsState', () => {
  it('resizeEntries ajoute ou retire en fin de rangée sans toucher aux premières bobines', () => {
    const list = three();
    const more = resizeEntries(list, 5);
    expect(more).toHaveLength(5);
    expect(more.slice(0, 3)).toEqual(list);
    expect(resizeEntries(more, 2).map((e) => e.id)).toEqual(list.slice(0, 2).map((e) => e.id));
  });

  it('insertEntry place la bobine entre deux autres, ou en fin', () => {
    const list = three();
    const e = sampleEntry(9);
    expect(insertEntry(list, 1, e).map((x) => x.id)).toEqual([list[0]?.id, e.id, list[1]?.id, list[2]?.id]);
    expect(insertEntry(list, 99, e).at(-1)?.id).toBe(e.id);
  });

  it("reorderByIds change l'ordre (donc le numéro) sans perdre ni dupliquer de bobine", () => {
    const [a, b, c] = three();
    expect(reorderByIds([a, b, c] as never, [c?.id, a?.id, b?.id] as string[]).map((x) => x.id)).toEqual([c?.id, a?.id, b?.id]);
    expect(reorderByIds([a, b, c] as never, [a?.id] as string[])).toEqual([a, b, c]);
  });

  it('entryFor prend la couleur du profil si elle existe', () => {
    expect(entryFor('k', '#123456', 0).color).toBe('#123456');
    expect(entryFor('k', null, 0).color).toMatch(/^#/);
  });

  it('replaceKey ne change que la bobine visée', () => {
    const list = three();
    const next = replaceKey(list, list[1]?.id ?? '', 'user|X - Copie');
    expect(next.map((e) => e.key)).toEqual([list[0]?.key, 'user|X - Copie', list[2]?.key]);
  });
});
