import { describe, expect, it } from 'vitest';
import { parseGCode } from './gcodeParse';
import { APEX_SIGNATURE_LINE } from '@/utils/apexSignature';

const move = (x: number, y: number, z: number, b: number, e: number) =>
  `G1 X${x} Y${y} Z${z} A0 B${b} C0 E${e} F1800`;

const body = [
  'M82', 'G90',
  move(10, 10, 0.2, 0, 0), move(20, 10, 0.2, 0, 0.5), move(20, 20, 0.2, 0, 1), move(10, 20, 0.2, 0, 1.5),
].join('\n');

describe('G-code Apex : machine déclarée par l\'en-tête (R-025)', () => {
  it('cartésien déclaré : B et C à 0 ne font pas passer le fichier en orientation d\'outil', () => {
    const text = `${APEX_SIGNATURE_LINE}\n; apex_kinematics_json {"schema":"apex-kinematics/1","machine":"cartesian"}\n${body}`;
    const parsed = parseGCode(text);
    expect(parsed.kind).toBe('cartesian');
    expect(parsed.toolOriented).toBe(false);
    expect(parsed.moves.every((m) => m.b === 0)).toBe(true);
  });

  it('sans signature, l\'ancienne heuristique reste en place (mot C = orientation d\'outil)', () => {
    const parsed = parseGCode(body);
    expect(parsed.toolOriented).toBe(true);
  });
});
