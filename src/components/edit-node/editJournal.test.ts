import { describe, expect, it } from 'vitest';
import type { ApexJournalEntry } from '@/utils/apexHeader';
import type { EditInfluence } from '@/utils/editKernelClient';
import type { ParsedGCode } from '../gcodeParse';
import { currentValues, groupsOf, journalEntryOf, roundJournal, toHistory, type JournalCommit } from './editJournal';

const influence = (extra: Partial<EditInfluence> = {}) => ({
  spatial: { radiusMm: 5 }, along: { radiusMm: 5 }, adjacency: { hops: 1 }, combine: 'product', ...extra,
}) as unknown as EditInfluence;

const commit = (extra: Partial<JournalCommit> = {}): JournalCommit => ({
  node: 7,
  transform: { translation: Float64Array.of(1, 2, 3), axis: Float64Array.of(0, 0, 1), angleRad: 0.5 },
  influence: influence(),
  indices: Uint32Array.of(4, 5),
  before: Float64Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10),
  after: Float64Array.of(1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10),
  ...extra,
});

describe('roundJournal', () => {
  it('arrondit à 1e-7 : le bruit flottant ne change pas la valeur consignée', () => {
    expect(roundJournal(0.1 + 0.2)).toBe(0.3);
    expect(roundJournal(1.23456789012)).toBe(1.2345679);
  });
});

describe('journalEntryOf', () => {
  it('consigne nœud, transformation, points et valeurs arrondies, empreinte vide à calculer', () => {
    const entry = journalEntryOf(commit({ after: Float64Array.of(0.1 + 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0) }), '2026-11-04T00:00:00.000Z');
    expect(entry.at).toBe('2026-11-04T00:00:00.000Z');
    expect(entry.node).toBe(7);
    expect(entry.transform).toEqual({ translation: [1, 2, 3], axis: [0, 0, 1], angleRad: 0.5 });
    expect(entry.indices).toEqual([4, 5]);
    expect(entry.after[0]).toBe(0.3);
    expect(entry.fingerprint).toBe('');
  });

  it('met des tableaux vides pour les poignées et ancrages absents, arrondit ceux présents', () => {
    expect(journalEntryOf(commit()).influence).toMatchObject({ directions: [], anchors: [] });
    const entry = journalEntryOf(commit({ influence: influence({ directions: Float64Array.of(0.1 + 0.2, 1, 0, 4), anchors: Float64Array.of(1, 2, 3, 4) }) }));
    expect(entry.influence).toMatchObject({ directions: [0.3, 1, 0, 4], anchors: [1, 2, 3, 4] });
  });

  it('n\'écrit `trimmed` et `group` que s\'ils sont renseignés', () => {
    const bare = journalEntryOf(commit());
    expect('trimmed' in bare).toBe(false);
    expect('group' in bare).toBe(false);
    expect('trimmed' in journalEntryOf(commit({ trimmed: new Uint32Array(0) }))).toBe(false);
    const full = journalEntryOf(commit({ trimmed: Uint32Array.of(5), group: 'g1' }));
    expect(full.trimmed).toEqual([5]);
    expect(full.group).toBe('g1');
  });

  it('ne partage pas la mémoire des tableaux d\'origine', () => {
    const c = commit();
    const entry = journalEntryOf(c);
    c.indices[0] = 99;
    expect(entry.indices[0]).toBe(4);
  });
});

describe('toHistory', () => {
  it('rend les tableaux typés attendus par le noyau, `trimmed` absent si vide', () => {
    const entry = { ...journalEntryOf(commit({ trimmed: Uint32Array.of(5) })) };
    const history = toHistory(entry);
    expect(history.indices).toBeInstanceOf(Uint32Array);
    expect(history.before).toBeInstanceOf(Float64Array);
    expect(Array.from(history.trimmed!)).toEqual([5]);
    expect(toHistory({ ...entry, trimmed: [] }).trimmed).toBeUndefined();
    expect(toHistory({ ...entry, trimmed: undefined }).trimmed).toBeUndefined();
  });

  it('retrouve les valeurs consignées : aller-retour entrée → historique', () => {
    const history = toHistory(journalEntryOf(commit()));
    expect(Array.from(history.after)).toEqual(Array.from(commit().after));
  });
});

describe('groupsOf', () => {
  const e = (group?: string) => ({ group }) as ApexJournalEntry;
  it('regroupe les entrées consécutives de même groupe (une validation et ses copies)', () => {
    expect(groupsOf([e('a'), e('a'), e('a'), e('b'), e('a')])).toEqual([3, 1, 1]);
  });
  it('compte chaque entrée sans groupe à part, même consécutives', () => {
    expect(groupsOf([e(), e(), e('a')])).toEqual([1, 1, 1]);
  });
  it('vaut [] sans entrée', () => {
    expect(groupsOf([])).toEqual([]);
  });
});

describe('currentValues', () => {
  it('lit (x, y, z, b, E) de chaque point demandé, dans l\'ordre demandé', () => {
    const parsed = {
      moves: [{ x: 1, y: 2, z: 3, b: 4 }, { x: 5, y: 6, z: 7, b: 8 }],
      eDelta: [0.1, 0.2],
    } as unknown as ParsedGCode;
    expect(Array.from(currentValues(parsed, [1, 0]))).toEqual([5, 6, 7, 8, 0.2, 1, 2, 3, 4, 0.1]);
    expect(currentValues(parsed, [])).toHaveLength(0);
  });
});
