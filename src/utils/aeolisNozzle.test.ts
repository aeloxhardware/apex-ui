import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
});
const { DEFAULT_AEOLIS_NOZZLE, aeolisNozzleParams, getAeolisNozzle, setAeolisNozzle } = await import('./aeolisNozzle');

describe('réglages de buse d’Element Aeolis', () => {
  beforeEach(() => { store.clear(); setAeolisNozzle(DEFAULT_AEOLIS_NOZZLE); });

  it('les défauts sont ceux du moteur (10°, 2 mm) et n’envoient rien', () => {
    expect(getAeolisNozzle()).toEqual({ angleDeg: 10, reachMm: 2 });
    expect(aeolisNozzleParams()).toEqual({});
  });

  it('n’envoie que ce qui diffère du défaut', () => {
    setAeolisNozzle({ angleDeg: 35 });
    expect(aeolisNozzleParams()).toEqual({ nozzle_angle_deg: 35 });
    setAeolisNozzle({ reachMm: 8 });
    expect(aeolisNozzleParams()).toEqual({ nozzle_angle_deg: 35, nozzle_reach: 8 });
  });

  it('borne les valeurs et mémorise', () => {
    setAeolisNozzle({ angleDeg: 200, reachMm: -3 });
    expect(getAeolisNozzle()).toEqual({ angleDeg: 89, reachMm: 0 });
    expect(JSON.parse(store.get('apex-aeolis-nozzle') as string)).toEqual({ angleDeg: 89, reachMm: 0 });
  });
});
