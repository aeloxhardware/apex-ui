import { describe, expect, it } from 'vitest';
import { STEP_SUBSTEPS, stepLabel } from './sliceStepLabels';

describe('libellés des étapes (R-026)', () => {
  it('nomme les deux étapes propres à Element Aeolis', () => {
    expect(stepLabel('heightfield', 'Heightfield')).toBe('Modèle de surface en hauteur');
    expect(stepLabel('layer_surfaces', 'Layer surfaces')).toBe('Surfaces des couches');
  });

  it('garde les libellés communs et retombe sur celui du moteur pour un identifiant inconnu', () => {
    expect(stepLabel('toolpath2d', 'x')).toBe('Parois et remplissage');
    expect(stepLabel('collision', 'x')).toBe('Simulation de collision');
    expect(stepLabel('nouvelle_etape', 'Libellé du moteur')).toBe('Libellé du moteur');
  });
});

describe('STEP_SUBSTEPS', () => {
  it('annonce les trois sous-étapes de la tétraédralisation, dans l’ordre du moteur', () => {
    expect(STEP_SUBSTEPS.tetrahedralization?.map((s) => s.slug)).toEqual(['prepare', 'tetrahedralize', 'verify']);
  });
});
