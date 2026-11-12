import { describe, expect, it } from 'vitest';
import { draftOf, isDirty } from './filamentSheetData';
import type { FilamentProfile } from '@/utils/filamentCatalog';

const profile = {
  name: 'Bambu PLA Silk',
  vendor: 'BBL',
  type: 'PLA',
  finish: 'silk',
  density: 1.24,
  diameter: 1.75,
  cost: 25,
  nozzle_temp: 220,
  nozzle_temp_initial_layer: 220,
  nozzle_temp_range: [190, 240],
  bed_temp: 55,
  flow_ratio: 0.98,
  max_volumetric_speed: 12,
} as FilamentProfile;

describe('draftOf / isDirty', () => {
  it("un brouillon intact n'est pas modifié", () => {
    expect(isDirty(draftOf(profile), profile)).toBe(false);
  });
  it("détecte un changement de valeur, d'aspect ou de plage", () => {
    expect(isDirty({ ...draftOf(profile), bed_temp: 60 }, profile)).toBe(true);
    expect(isDirty({ ...draftOf(profile), finish: null }, profile)).toBe(true);
    expect(isDirty({ ...draftOf(profile), nozzle_temp_range: [190, 250] }, profile)).toBe(true);
  });
  it("le brouillon est une copie : le profil d'origine ne bouge pas", () => {
    const draft = draftOf(profile);
    if (draft.nozzle_temp_range) draft.nozzle_temp_range[0] = 100;
    expect(profile.nozzle_temp_range[0]).toBe(190);
  });
});
