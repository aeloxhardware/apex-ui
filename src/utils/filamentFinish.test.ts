import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { FilamentProfile } from './filamentCatalog';
import catalog from '../../public/filaments.json';

// Règles d'indexation de la brillance (script CommonJS du générateur de profils).
const require = createRequire(import.meta.url);
const { deriveFinish, finishFor } = require('../../scripts/profiles/filamentFinish.cjs') as {
  deriveFinish: (name: string, type: string | null) => string | null;
  finishFor: (vendor: string, name: string, type: string | null, overrides: Record<string, string>) => string | null;
};

describe('deriveFinish', () => {
  it('lit le mot du nom', () => {
    expect(deriveFinish('Bambu PLA Matte', 'PLA')).toBe('matte');
    expect(deriveFinish('Bambu PLA Silk+', 'PLA')).toBe('silk');
    expect(deriveFinish('Bambu PLA Metal', 'PLA')).toBe('metallic');
    expect(deriveFinish('Bambu PLA Sparkle', 'PLA')).toBe('sparkle');
    expect(deriveFinish('Bambu PETG Translucent', 'PETG')).toBe('glossy');
  });

  it('un renfort ou une charge donne un filament mat', () => {
    expect(deriveFinish('Bambu PLA-CF', 'PLA-CF')).toBe('matte');
    expect(deriveFinish('Bambu ABS-GF', 'ABS-GF')).toBe('matte');
    expect(deriveFinish('Bambu PLA Marble', 'PLA')).toBe('matte');
  });

  it('ne devine rien pour un nom neutre : non renseigné', () => {
    expect(deriveFinish('Bambu PLA Basic', 'PLA')).toBeNull();
    expect(deriveFinish('Generic PETG', 'PETG')).toBeNull();
    expect(deriveFinish('Afinia Value ABS', 'ABS')).toBeNull(); // « Value » ne contient pas « alu » métallique
  });
});

describe('finishFor', () => {
  it("une correction vérifiée l'emporte sur les règles", () => {
    expect(finishFor('BBL', 'Bambu PLA Basic', 'PLA', { 'BBL|Bambu PLA Basic': 'satin' })).toBe('satin');
    expect(finishFor('BBL', 'Bambu PLA Basic', 'PLA', {})).toBeNull();
  });
});

describe('catalogue public/filaments.json', () => {
  it('chaque profil porte le champ finish (valeur connue ou null)', () => {
    const known = new Set(['matte', 'satin', 'glossy', 'silk', 'metallic', 'sparkle', null]);
    const profiles = catalog.filaments as unknown as FilamentProfile[];
    expect(profiles.length).toBeGreaterThan(1000);
    expect(profiles.every((p) => 'finish' in p && known.has(p.finish))).toBe(true);
  });
});
