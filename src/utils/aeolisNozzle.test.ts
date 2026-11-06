import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
});
const { DEFAULT_AEOLIS_NOZZLE, aeolisNozzleParams, getAeolisNozzle, nozzleOfProfile, resetAeolisNozzle, setActivePrinterNozzle, setAeolisNozzle } =
  await import('./aeolisNozzle');
const profile = (nozzle: unknown) => ({ apex: { default_nozzle_profile: nozzle } });

describe('réglages de buse d’Element Aeolis', () => {
  beforeEach(() => { store.clear(); setActivePrinterNozzle('Test', null); resetAeolisNozzle(); });

  it('démarre sur les défauts du moteur et n’envoie rien', () => {
    expect(getAeolisNozzle()).toEqual({ angleDeg: 10, reachMm: 2 });
    expect(aeolisNozzleParams()).toEqual({});
  });

  it('n’envoie au moteur que ce qui diffère de son défaut', () => {
    setAeolisNozzle({ angleDeg: 35 });
    expect(aeolisNozzleParams()).toEqual({ nozzle_angle_deg: 35 });
    setAeolisNozzle({ reachMm: 8 });
    expect(aeolisNozzleParams()).toEqual({ nozzle_angle_deg: 35, nozzle_reach: 8 });
  });

  it('borne les valeurs et les mémorise par imprimante', () => {
    setAeolisNozzle({ angleDeg: 200, reachMm: -3 });
    expect(getAeolisNozzle()).toEqual({ angleDeg: 89, reachMm: 0 });
    expect(JSON.parse(store.get('apex-aeolis-nozzle-by-printer') as string)).toEqual({ Test: { angleDeg: 89, reachMm: 0 } });
  });

  it('prend longueur et angle dans le profil de l’imprimante, sans deviner ce qu’il ne dit pas', () => {
    setActivePrinterNozzle('A', profile({ length_mm: 6, angle_deg: 30, outer_width_mm: 1.2 }));
    expect(getAeolisNozzle()).toEqual({ angleDeg: 30, reachMm: 6 });
    expect(nozzleOfProfile(profile({ length_mm: 6, angle_deg: 'Inconnu', outer_width_mm: 'Inconnu' })))
      .toEqual({ angleDeg: DEFAULT_AEOLIS_NOZZLE.angleDeg, reachMm: 6, outerWidthMm: null });
  });

  it('garde un réglage par imprimante, et un champ non touché suit le profil', () => {
    setActivePrinterNozzle('A', profile({ length_mm: 6, angle_deg: 30 }));
    setAeolisNozzle({ angleDeg: 45 });
    setActivePrinterNozzle('B', profile({ length_mm: 3, angle_deg: 20 }));
    expect(getAeolisNozzle()).toEqual({ angleDeg: 20, reachMm: 3 });
    setActivePrinterNozzle('A', profile({ length_mm: 7, angle_deg: 30 }));
    expect(getAeolisNozzle()).toEqual({ angleDeg: 45, reachMm: 7 });
  });

  it('reprend les valeurs du profil après une remise à zéro', () => {
    setActivePrinterNozzle('A', profile({ length_mm: 6, angle_deg: 30 }));
    setAeolisNozzle({ angleDeg: 45, reachMm: 9 });
    resetAeolisNozzle();
    expect(getAeolisNozzle()).toEqual({ angleDeg: 30, reachMm: 6 });
  });
});
