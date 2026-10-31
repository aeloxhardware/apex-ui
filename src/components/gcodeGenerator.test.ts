import { describe, expect, it } from 'vitest';
import { apexGenerator, apexMetaRows, formatGeneratorLabel } from './gcodeGenerator';

describe('métadonnées du bloc Apex', () => {
  const meta = {
    apex_version: 'alpha-0.2.3.0.3.3.0.221',
    generator: 'Apex engine',
    layer_height: 0.2,
    kinematics: { pivot_to_tip: 12.5, z_reference: 'tip' },
    algorithm_name: 'Aeolis',
    futur_champ: 3,
  };

  it('met tout à plat, sans répéter la version déjà affichée', () => {
    const rows = apexMetaRows(meta);
    expect(rows).toContainEqual(['Hauteur de couche', '0,2 mm']);
    expect(rows).toContainEqual(['Pivot → pointe', '12,5 mm']);
    expect(rows).toContainEqual(['Algorithme', 'Aeolis']);
    expect(rows).toContainEqual(['futur_champ', '3']);
    expect(rows.some(([label]) => label.includes('version'))).toBe(false);
  });

  it("résume la description de cinématique en une ligne et lit les champs d'Aeolis", () => {
    const rows = apexMetaRows({
      kinematics_description: { schema: 'apex-kinematics/1', machine: 'cartesian', axes: [{ letter: 'X' }], chain: { bed: ['Y'] } },
      algorithm: 'nonplanar-heightfield/1',
      min_layer_height: 0.1,
      intermediate_layers: true,
    });
    expect(rows).toEqual([
      ['Description de la cinématique', 'apex-kinematics/1'],
      ["Version de l'algorithme", 'nonplanar-heightfield/1'],
      ['Épaisseur de couche min', '0,1 mm'],
      ['Inter-couches', 'oui'],
    ]);
  });

  it('transmet meta au générateur et garde la ligne « Généré par »', () => {
    const generator = apexGenerator({ meta });
    expect(generator.apex?.meta).toBe(meta);
    expect(formatGeneratorLabel(generator).value).toBe('Apex Slicer V0.2.3.0.3.3.0.221 (alpha)');
  });

  it('ne rend rien sans bloc', () => {
    expect(apexMetaRows(undefined)).toEqual([]);
  });
});
