import { describe, expect, it } from 'vitest';
import { brandOf, deOrD, materialNameOf } from './filamentText';
import { spoolTip, materialsTip } from './amsTooltips';
import type { FilamentProfile } from './filamentCatalog';

const p = (name: string, vendor = 'BBL', user = false) => ({ name, vendor, user: user ? true : undefined }) as FilamentProfile;

describe('marque et matériau', () => {
  it('lit la marque dans le premier mot du nom', () => {
    expect(brandOf(p('Bambu PLA Silk'))).toBe('Bambu');
    expect(materialNameOf(p('Bambu PLA Silk'))).toBe('PLA Silk');
  });
  it("un premier mot qui est un matériau n'est pas une marque : on prend le fabricant du profil", () => {
    expect(brandOf(p('PLA Basic', 'Creality'))).toBe('Creality');
    expect(materialNameOf(p('PLA Basic', 'Creality'))).toBe('PLA Basic');
  });
  it("de / d' selon la voyelle", () => {
    expect(deOrD('Bambu')).toBe('de Bambu');
    expect(deOrD('Anycubic')).toBe("d'Anycubic");
    expect(deOrD('Elegoo')).toBe("d'Elegoo");
  });
});

describe("infobulles de bas d'écran", () => {
  it("profil d'usine : voir ou éditer", () => {
    expect(spoolTip(p('Bambu PLA Silk'))).toBe('Matériau : PLA Silk provenant de Bambu. Cliquer pour voir le profil ou éditer.');
  });
  it("profil modifié : voir, éditer ou revenir au profil d'usine", () => {
    expect(spoolTip(p('Anycubic PLA Matte - Copie', 'Anycubic', true))).toBe(
      "Matériau : PLA Matte - Copie provenant d'Anycubic modifié par l'utilisateur. Cliquer pour voir le profil, éditer ou revenir au profil d'usine.",
    );
  });
  it('partie basse : accord du pluriel', () => {
    expect(materialsTip(24)).toBe('24 matériaux. Cliquer pour afficher les filaments sélectionnés.');
    expect(materialsTip(1)).toBe('1 matériau. Cliquer pour afficher les filaments sélectionnés.');
  });
});
