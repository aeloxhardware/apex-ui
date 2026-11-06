import { describe, expect, it } from 'vitest';
import { parseGCode } from '@/components/gcodeParse';
import { writeEditedGCode } from './gcodeWriter';

// Aller-retour gcodeParse ↔ gcodeWriter sur un G-code polaire d'Element Aeolis (R-028) : une étiquette
// `;TYPE:` par changement de type, commentaires `; <layer> k`, trajets à vide, commentaires en fin de ligne.
const LINES = [
  '; apex test',
  'M82',
  'G90',
  'G00 Y0 X10 Z0.2 B0 F3000',
  '; <layer> 0',
  ';TYPE:WALL-OUTER',
  'G01 Y10 X10 Z0.2 B0 E0.5 F1800',
  'G01 Y20 X10 Z0.2 B0 E1 F1800 ; paroi',
  ';TYPE:WALL-INNER',
  'G01 Y30 X11 Z0.2 B0 E1.5 F1800',
  ';TYPE:FILL',
  'G01 Y40 X12 Z0.2 B0 E2 F1800',
  '; <layer> 1',
  ';TYPE:SKIN',
  'G00 Y50 X12 Z0.4 B0 F3000',
  'G01 Y60 X12 Z0.4 B0 E2.5 F1800',
  'G01 Y70 X13 Z0.4 B0 E3 F1800',
];
const TEXT = LINES.join('\n') + '\n';
const TYPE_LINES = LINES.filter((l) => l.startsWith(';TYPE:'));

const lineOf = (text: string, k: number) => parseGCode(text).lineIndex[k];
const indexOfLine = (parsed: ReturnType<typeof parseGCode>, line: number) => parsed.lineIndex.findIndex((l) => l === line);

function editZ(text: string, line: number, dz: number) {
  const parsed = parseGCode(text);
  const k = indexOfLine(parsed, line);
  parsed.moves[k].z += dz;
  parsed.editedMoves = new Set([k]);
  const res = writeEditedGCode(text, parsed);
  if (!res.ok) throw new Error(res.error);
  return { parsed, k, text: res.text };
}

describe('étiquettes ;TYPE: lues par le parseur (R-028)', () => {
  it('chaque dépôt prend le type de la dernière étiquette rencontrée', () => {
    const { lineStats } = parseGCode(TEXT);
    expect(lineStats.outerWall.filamentMm).toBeGreaterThan(0);
    expect(lineStats.innerWall.filamentMm).toBeGreaterThan(0);
    expect(lineStats.sparseInfill.filamentMm).toBeGreaterThan(0);
    expect(lineStats.topSurface.filamentMm).toBeGreaterThan(0); // SKIN
    expect(lineStats.custom.filamentMm).toBe(0);
  });

  it('tout le filament déposé est attribué à un type, sans perte ni doublon', () => {
    const parsed = parseGCode(TEXT);
    const byType = Object.values(parsed.lineStats).reduce((sum, s) => sum + s.filamentMm, 0);
    const deposited = Array.from(parsed.depositMm).reduce((sum, d) => sum + d, 0);
    expect(byType).toBeCloseTo(deposited, 6);
  });

  it("une étiquette reste valable jusqu'à la suivante, même à travers « ; <layer> k »", () => {
    // Sans `;TYPE:SKIN`, les dépôts de la couche 1 héritent de FILL : rien n'est remis à zéro par `; <layer>`.
    const text = LINES.filter((l) => l !== ';TYPE:SKIN').join('\n');
    const { lineStats } = parseGCode(text);
    expect(lineStats.topSurface.filamentMm).toBe(0);
    expect(lineStats.sparseInfill.filamentMm).toBeGreaterThan(parseGCode(TEXT).lineStats.sparseInfill.filamentMm);
  });

  it('sans étiquette, les dépôts sont « personnalisés »', () => {
    const { lineStats } = parseGCode(LINES.filter((l) => !l.startsWith(';TYPE:')).join('\n'));
    expect(lineStats.custom.filamentMm).toBeGreaterThan(0);
    expect(lineStats.outerWall.filamentMm).toBe(0);
  });

  it('un nom de type inconnu est rangé dans « personnalisé »', () => {
    const text = LINES.map((l) => (l === ';TYPE:FILL' ? ';TYPE:MYSTERE' : l)).join('\n');
    const { lineStats } = parseGCode(text);
    expect(lineStats.sparseInfill.filamentMm).toBe(0);
    expect(lineStats.custom.filamentMm).toBeGreaterThan(0);
  });
});

describe('aller-retour : étiquettes, commentaires et lignes intactes', () => {
  it('éditer un mouvement conserve toutes les étiquettes et les lignes voisines à l\'identique', () => {
    const { text } = editZ(TEXT, 11, 0.05); // ligne `Y40 X12 …` (FILL)
    const out = text.split('\n');
    expect(out.filter((l) => l.startsWith(';TYPE:'))).toEqual(TYPE_LINES);
    expect(out.filter((l) => l.startsWith('; <layer>'))).toEqual(['; <layer> 0', '; <layer> 1']);
    expect(out).toHaveLength(LINES.length + 1); // la dernière ligne vide du texte
    for (let i = 0; i < LINES.length; i++) if (i !== 11) expect(out[i]).toBe(LINES[i]);
    expect(out[11]).toMatch(/Z0\.2500/);
  });

  it('le commentaire en fin de ligne survit à la réécriture', () => {
    const { text } = editZ(TEXT, 7, 0.1);
    expect(text.split('\n')[7]).toMatch(/Z0\.3000.*; paroi$/);
  });

  it('les types par mouvement ne changent pas après réécriture', () => {
    const before = parseGCode(TEXT).lineStats;
    const after = parseGCode(editZ(TEXT, 11, 0.05).text).lineStats;
    for (const id of ['outerWall', 'innerWall', 'sparseInfill', 'topSurface', 'custom'] as const) {
      expect(after[id].filamentMm).toBeCloseTo(before[id].filamentMm, 3);
    }
  });

  it('parse → écriture → parse est stable : la valeur éditée est relue, les autres mouvements non touchés', () => {
    const edited = editZ(TEXT, 9, -0.05);
    const again = parseGCode(edited.text);
    const reference = parseGCode(TEXT);
    expect(again.moves).toHaveLength(reference.moves.length);
    expect(again.moves[edited.k].z).toBeCloseTo(reference.moves[edited.k].z - 0.05, 4);
    again.moves.forEach((m, i) => {
      if (i === edited.k) return;
      expect(m.x).toBeCloseTo(reference.moves[i].x, 4);
      expect(m.y).toBeCloseTo(reference.moves[i].y, 4);
      expect(m.z).toBeCloseTo(reference.moves[i].z, 4);
    });
  });

  it('une seconde écriture sans nouvelle édition rend le texte tel quel (idempotence)', () => {
    const once = editZ(TEXT, 9, 0.02).text;
    const second = writeEditedGCode(once, parseGCode(once));
    expect(second).toEqual({ ok: true, text: once, changedLines: 0 });
  });

  it('fins de ligne CRLF : conservées', () => {
    const crlf = LINES.join('\r\n') + '\r\n';
    const { text } = editZ(crlf, 11, 0.05);
    const lines = text.split('\n');
    expect(lines.slice(0, -1).every((l) => l.endsWith('\r'))).toBe(true);
    expect(lines.filter((l) => l.startsWith(';TYPE:')).map((l) => l.trimEnd())).toEqual(TYPE_LINES);
  });
});

describe('gcodeWriter : refus', () => {
  it('refuse une ligne qui porte plusieurs mouvements, sans rien écrire', () => {
    const parsed = parseGCode(TEXT);
    const k = indexOfLine(parsed, 6);
    parsed.editedMoves = new Set([k]);
    // Faux arc : le mouvement partage sa ligne avec son voisin.
    parsed.lineIndex[k - 1] = parsed.lineIndex[k];
    const res = writeEditedGCode(TEXT, parsed);
    expect(res.ok).toBe(false);
  });

  it('refuse un fichier cartésien', () => {
    const cart = ['M82', 'G90', 'G1 X10 Y10 Z0.2 E0.5 F1800', 'G1 X20 Y10 Z0.2 E1 F1800', 'G1 X20 Y20 Z0.2 E1.5 F1800'].join('\n');
    const parsed = parseGCode(cart);
    expect(parsed.kind).toBe('cartesian');
    parsed.editedMoves = new Set([1]);
    const res = writeEditedGCode(cart, parsed);
    expect(res).toMatchObject({ ok: false });
  });

  it('ne fait rien sans édition ni insertion', () => {
    expect(lineOf(TEXT, 3)).toBeGreaterThanOrEqual(0);
    expect(writeEditedGCode(TEXT, parseGCode(TEXT))).toEqual({ ok: true, text: TEXT, changedLines: 0 });
  });
});
