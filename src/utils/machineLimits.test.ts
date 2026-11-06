import { describe, expect, it } from 'vitest';
import { DEFAULT_MACHINE_LIMITS } from './machineLimits';
import { DEFAULT_PRINTER_NAME, DEFAULT_PRINTER_PROFILE, PLATE_RADIUS_MM, machineFacts } from './machineProfile';

describe('limites de machine par défaut', () => {
  it("viennent toutes du profil d'imprimante par défaut", () => {
    const f = machineFacts(DEFAULT_PRINTER_PROFILE);
    expect([DEFAULT_MACHINE_LIMITS.bMinDeg, DEFAULT_MACHINE_LIMITS.bMaxDeg]).toEqual(f.bRangeDeg);
    expect(DEFAULT_MACHINE_LIMITS.bSpeedDegS).toBe(f.bSpeedDegS);
    expect(DEFAULT_MACHINE_LIMITS.bAccelDegS2).toBe(f.bAccelDegS2);
    expect(DEFAULT_MACHINE_LIMITS.plateRadiusMm).toBe(PLATE_RADIUS_MM);
  });

  it("nomme l'imprimante active d'après le profil", () => {
    expect(DEFAULT_PRINTER_NAME).toBe('Aetheris-4');
  });
});
