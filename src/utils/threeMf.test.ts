import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildThreeMf, printerTriangles, type ThreeMfPart } from './threeMf';

/** Tétraèdre dont les faces sont dans l'ordre direct de la scène (Y vers le haut). */
const tetra = (mirrored = false): ThreeMfPart => ({
  name: 'Pièce <1>',
  positions: [0, 0, 0, 10, 0, 0, 0, 0, 10, 0, 10, 0],
  indices: [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2],
  mirrored,
});

function signedVolume(part: ThreeMfPart): number {
  const t = printerTriangles(part);
  const p = part.positions;
  const v = (i: number) => [p[i * 3], p[i * 3 + 2], p[i * 3 + 1]];
  let volume = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [v(t[i]), v(t[i + 1]), v(t[i + 2])];
    volume += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return volume;
}

describe('threeMf', () => {
  it('oriente les triangles vers l’extérieur, miroir ou non', () => {
    expect(signedVolume(tetra())).toBeGreaterThan(0);
    expect(signedVolume({ ...tetra(), indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3] })).toBeGreaterThan(0);
  });

  it('produit un zip avec le modèle, échappe les noms et range le G-code', async () => {
    const bytes = await buildThreeMf({ parts: [tetra()], gcode: { name: 'a.gcode', text: 'G1 X1\n' } });
    const zip = await JSZip.loadAsync(bytes);
    const model = await zip.file('3D/3dmodel.model')?.async('string');
    expect(model).toContain('name="Pièce &lt;1&gt;"');
    expect(model).toContain('<build><item objectid="1"/></build>');
    expect(await zip.file('Metadata/plate_1.gcode')?.async('string')).toBe('G1 X1\n');
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
  });

  it('accepte un projet sans modèle (G-code seul)', async () => {
    const zip = await JSZip.loadAsync(await buildThreeMf({ parts: [], gcode: { name: 'b.gcode', text: '' } }));
    expect(await zip.file('3D/3dmodel.model')?.async('string')).toContain('<build></build>');
  });
});
