import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
});
const { DEFAULT_ARRANGE_PREFS, getArrangePrefs, setArrangePrefs } = await import('./arrangePrefs');

describe('réglages de la disposition automatique', () => {
  beforeEach(() => {
    store.clear();
    setArrangePrefs(DEFAULT_ARRANGE_PREFS);
  });

  it('démarre sur écart 5 mm, rotations permises, sans alignement sur Y ni disposition à l’import', () => {
    expect(getArrangePrefs()).toEqual({ spacingMm: 5, allowRotations: true, alignToY: false, arrangeOnImport: false });
  });

  it('ne change que le champ touché et le mémorise', () => {
    setArrangePrefs({ spacingMm: 12 });
    expect(getArrangePrefs()).toEqual({ spacingMm: 12, allowRotations: true, alignToY: false, arrangeOnImport: false });
    expect(JSON.parse(store.get('apex-arrange-prefs') as string).spacingMm).toBe(12);
  });

  it('borne l’écart et ignore une valeur absente', () => {
    setArrangePrefs({ spacingMm: 500 });
    expect(getArrangePrefs().spacingMm).toBe(50);
    setArrangePrefs({ spacingMm: -4, allowRotations: undefined });
    expect(getArrangePrefs()).toMatchObject({ spacingMm: 0, allowRotations: true });
  });
});
