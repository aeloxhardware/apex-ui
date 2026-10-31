import { beforeEach, describe, expect, it, vi } from 'vitest';

// Le module écoute `window` dès son chargement et lit `localStorage` : doubles minimaux, import après.
const store = new Map<string, string>();
vi.stubGlobal('window', { addEventListener: () => {} });
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
});
const { SLICING_MODES, getSlicingMode, isSlicingModeAvailable, setSlicingMode } = await import('./slicingMode');

const [ARVA, ARDOR, AEOLIS, AEQUOR] = SLICING_MODES;

describe('modes de tranchage disponibles', () => {
  beforeEach(() => store.clear());

  it('Element Arva et Element Aequor sont inactifs, Ardor et Aeolis actifs', () => {
    expect(isSlicingModeAvailable(ARVA)).toBe(false);
    expect(isSlicingModeAvailable(AEQUOR)).toBe(false);
    expect(isSlicingModeAvailable(ARDOR)).toBe(true);
    expect(isSlicingModeAvailable(AEOLIS)).toBe(true);
  });

  it('refuse de choisir un mode inactif et garde le précédent', () => {
    setSlicingMode(AEOLIS, '5-axes');
    setSlicingMode(ARVA, '5-axes');
    setSlicingMode(AEQUOR, '5-axes');
    expect(getSlicingMode('5-axes')).toBe(AEOLIS);
  });

  it('ignore un ancien choix mémorisé pour un mode devenu inactif', () => {
    store.set('apex-slicing-mode:3-axes', ARVA);
    store.set('apex-slicing-mode:5-axes', 'Lissage non-planaire');
    expect(getSlicingMode('3-axes')).toBe(AEOLIS);
    expect(getSlicingMode('5-axes')).toBe(ARDOR);
  });

  it('défauts : Aeolis en 3 axes, Ardor en 5 axes', () => {
    expect(getSlicingMode('3-axes')).toBe(AEOLIS);
    expect(getSlicingMode('5-axes')).toBe(ARDOR);
  });
});

describe('sans mode dev', () => {
  beforeEach(() => store.clear());

  it('seul Element Aeolis reste sélectionnable en 3 axes ; les 5 axes ne changent pas', async () => {
    const { setDevModeEnabled } = await import('./devModePrefs');
    setDevModeEnabled(false);
    expect(isSlicingModeAvailable(AEOLIS, '3-axes')).toBe(true);
    expect(isSlicingModeAvailable(ARDOR, '3-axes')).toBe(false);
    expect(isSlicingModeAvailable(ARDOR, '5-axes')).toBe(true);
    store.set('apex-slicing-mode:3-axes', ARDOR);
    expect(getSlicingMode('3-axes')).toBe(AEOLIS);
    setDevModeEnabled(true);
    expect(isSlicingModeAvailable(ARDOR, '3-axes')).toBe(true);
  });
});

describe('seuil de sécurité en triangles', () => {
  it('200 000 pour Element Ardor, 800 000 pour Element Aeolis', async () => {
    const { triangleSafetyThreshold } = await import('./slicingMode');
    expect(triangleSafetyThreshold(ARDOR)).toBe(200_000);
    expect(triangleSafetyThreshold(AEOLIS)).toBe(800_000);
  });
});
