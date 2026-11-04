import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_PROFILE, PLATE_RADIUS_MM, machineFacts } from './machineProfile';
import { PLATE_RADIUS_MM as PARSER_RADIUS_MM } from '@/components/gcodeParse';
import { DEFAULT_MACHINE_LIMITS } from './machineLimits';

// R-031 point 5 : le rayon du plateau vient du profil d'imprimante, jamais d'une constante recopiée.
describe('rayon du plateau', () => {
  it('vient du profil par défaut (Aetheris-4 : 150 mm)', () => {
    expect(PLATE_RADIUS_MM).toBe(150);
    expect(PLATE_RADIUS_MM).toBe(machineFacts(DEFAULT_PRINTER_PROFILE).plateRadiusMm);
  });

  it("l'analyseur G-code et les limites de l'édition lisent la même valeur", () => {
    expect(PARSER_RADIUS_MM).toBe(PLATE_RADIUS_MM);
    expect(DEFAULT_MACHINE_LIMITS.plateRadiusMm).toBe(PLATE_RADIUS_MM);
  });
});
