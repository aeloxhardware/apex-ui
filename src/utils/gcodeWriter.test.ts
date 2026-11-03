import { describe, expect, it } from 'vitest';
import { parseGCode } from '@/components/gcodeParse';
import { writeEditedGCode } from './gcodeWriter';

// G-code polaire (Y = C, X = R, B), extrusion absolue, avec étiquettes `;TYPE:` (R-028).
const LINES = [
  '; fichier de test',
  'M82',
  'G90',
  'G00 Y0 X10 Z0.2 B0 F3000',
  ';TYPE:WALL-OUTER',
  'G01 Y10 X10 Z0.2 B0 E0.5 F1800',
  'G01 Y20 X10 Z0.2 B0 E1 F1800',
  ';TYPE:FILL',
  'G01 Y30 X12 Z0.2 B5 E1.5 F1800',
  'G01 Y40 X12 Z0.2 B5 E2 F1800 ; fin',
];
const TEXT = LINES.join('\n') + '\n';

describe('gcodeParse ↔ gcodeWriter', () => {
  it('sans modification, le texte est rendu à l\'identique', () => {
    const parsed = parseGCode(TEXT);
    const res = writeEditedGCode(TEXT, parsed);
    expect(res).toEqual({ ok: true, text: TEXT, changedLines: 0 });
  });

  it('une édition ne réécrit que les lignes touchées et garde étiquettes et commentaires', () => {
    const parsed = parseGCode(TEXT);
    expect(parsed.kind).toBe('polar');
    const k = parsed.lineIndex.findIndex((l) => l === 8); // ligne `Y30 X12 …`
    const kc = parsed.lineIndex.findIndex((l) => l === 9); // ligne `… ; fin` (commentaire en fin de ligne)
    expect(k).toBeGreaterThanOrEqual(0);
    parsed.moves[k].z += 0.1;
    parsed.moves[kc].z += 0.1;
    parsed.editedMoves = new Set([k, kc]);
    const res = writeEditedGCode(TEXT, parsed);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = res.text.split('\n');
    expect(out.filter((l) => l.startsWith(';TYPE:'))).toEqual([';TYPE:WALL-OUTER', ';TYPE:FILL']);
    expect(out[9]).toMatch(/Z0\.3000.*; fin$/);
    expect(out[8]).toMatch(/Z0\.3000/);
    // Les lignes non éditées sont inchangées.
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7]) expect(out[i]).toBe(LINES[i]);
  });

  it('le texte réécrit se relit avec la valeur modifiée', () => {
    const parsed = parseGCode(TEXT);
    const k = parsed.lineIndex.findIndex((l) => l === 8);
    parsed.moves[k].z += 0.1;
    parsed.editedMoves = new Set([k]);
    const res = writeEditedGCode(TEXT, parsed);
    if (!res.ok) throw new Error(res.error);
    const again = parseGCode(res.text);
    expect(again.moves[k].z).toBeCloseTo(0.3, 4);
    expect(again.moves[k - 1].z).toBeCloseTo(0.2, 4);
  });
});
