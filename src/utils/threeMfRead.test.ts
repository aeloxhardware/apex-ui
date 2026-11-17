import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildThreeMf } from './threeMf';
import { parseModelXml, readThreeMf, sceneStlBytes } from './threeMfRead';

const TETRA = {
  positions: [0, 0, 0, 10, 0, 0, 0, 0, 10, 0, 10, 0], // repère scène : (x, y, z)
  indices: [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2],
};

describe('readThreeMf', () => {
  it('relit un projet écrit par Apex (repère scène → imprimante)', async () => {
    const bytes = await buildThreeMf({ parts: [{ name: 'Pièce', ...TETRA, mirrored: false }] });
    const [mesh] = await readThreeMf(bytes);
    expect(mesh?.name).toBe('Pièce');
    expect(mesh?.positions).toHaveLength(12);
    // (x, y, z)scène → (x, z, y)imprimante
    expect(mesh?.positions.slice(6, 9)).toEqual([0, 10, 0]);
    expect(mesh?.indices).toHaveLength(12);
  });

  it("applique l'unité, les composants et les transformations de la construction", async () => {
    const zip = new JSZip();
    zip.file(
      '3D/3dmodel.model',
      `<model unit="centimeter"><resources>
        <object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>
        <triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
        <object id="2" name="Assemblage"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></components></object>
      </resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 3"/></build></model>`,
    );
    const [mesh] = await readThreeMf(await zip.generateAsync({ type: 'uint8array' }));
    expect(mesh?.name).toBe('Assemblage');
    // composant décalé de 5 en x, élément relevé de 3 en z, le tout en centimètres → millimètres
    expect(mesh?.positions.slice(0, 3)).toEqual([50, 0, 30]);
    expect(mesh?.positions.slice(3, 6)).toEqual([60, 0, 30]);
  });

  it('renvoie une liste vide pour un fichier sans modèle', async () => {
    const zip = new JSZip();
    zip.file('lisezmoi.txt', 'rien');
    expect(await readThreeMf(await zip.generateAsync({ type: 'uint8array' }))).toEqual([]);
  });

  it("relève les composants d'un objet", () => {
    const parsed = parseModelXml(
      '<model><object id="1"><components><component objectid="1"/></components></object><build><item objectid="1"/></build></model>',
    );
    expect(parsed.objects.get('1')?.components).toHaveLength(1);
  });
});

describe('sceneStlBytes', () => {
  it('écrit un STL binaire : en-tête de 80 octets, compte, 50 octets par triangle', () => {
    const bytes = sceneStlBytes({ name: 'x', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] });
    expect(bytes).toHaveLength(84 + 50);
    expect(new DataView(bytes.buffer).getUint32(80, true)).toBe(1);
  });
});
