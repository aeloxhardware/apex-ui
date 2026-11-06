import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGCode } from './gcodeParse';

/**
 * Test « golden » (caractérisation) du parseur : l'empreinte du résultat complet pour des fichiers fixes. Il garantit
 * qu'un refactor de gcodeParse*.ts ne change rien (octet pour octet) ; si le comportement doit changer, mettre à jour
 * l'empreinte dans le même changement, en expliquant pourquoi.
 */
function digest(value: unknown): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(value, (_key, v) => {
    if (ArrayBuffer.isView(v)) return `${v.constructor.name}:${Array.from(v as unknown as ArrayLike<number>).join(',')}`;
    if (typeof v === 'number' && !Number.isFinite(v)) return `n:${v}`;
    if (v instanceof Set) return [...v];
    return v;
  }));
  return hash.digest('hex');
}

const SYNTHETIC = [
  'G21\nG90\nM82\nM104 S200\nM106 S128\n;TYPE:Outer wall\n;WIDTH:0.4\nG1 X10 Y10 Z0.2 F3000\nG1 X20 Y10 E1 F1200\nG2 X30 Y20 I10 J0 E2\nG3 X20 Y30 R10 E3\nG10\nG1 X0 Y0 E3\nG11\nG92 E0\nG91\nG1 X1 Y1 Z0.1 E0.5\nM204 P500 T1000\nM205 X8\nG28\n;WIPE_START\nG1 X5 Y5\n;WIPE_END\nG20\nG1 X1 Y1 E.1\n',
  'G1 Y0 X50 Z1 B10 F1000\nG1 Y90 X50 Z1.2 B20 E1\nG1 Y450 X60 Z1.3 B30 E2\n',
  'G1 X0 Y0 Z0.2 B-90 C10 E1\n; TOOL_AXIS:0,0,1\nG1 X5 Y5 Z0.2 B-45 C20 E2\n',
];

const FILES = [
  'src/utils/__fixtures__/sample_apex_nonplanar_cartesian.gcode',
  'src/utils/__fixtures__/sample_apex_polar_4axis.gcode',
  'scripts/e2e-edit/thin.gcode',
  'scripts/e2e-edit/towers.gcode',
];

describe('parseGCode : empreintes golden', () => {
  it('est déterministe', () => {
    expect(digest(parseGCode(SYNTHETIC[0]))).toBe(digest(parseGCode(SYNTHETIC[0])));
  });
  it('distingue deux entrées différentes', () => {
    expect(digest(parseGCode(SYNTHETIC[0]))).not.toBe(digest(parseGCode(SYNTHETIC[1])));
  });
  it('garde les empreintes de référence', () => {
    const actual = {
      files: FILES.map((f) => digest(parseGCode(readFileSync(f, 'utf8')))),
      synthetic: SYNTHETIC.map((t) => digest(parseGCode(t))),
    };
    expect(actual).toEqual(GOLDEN);
  });
});

const GOLDEN = {
  files: [
    '10903c0e76e923dd1f6fee14efc075f08126c78a399be20368a17986bc3d1dee',
    '0715f2a40af9fd3d8ef36b79118442a8eebea165acebb413e26668eaf760c800',
    'de297c55600dc7624f8a10088831a97c651b27b24aacba491bab900a5f3a5450',
    '94a63623136d81cdb18ebb38a9da4a874218c010dfa9860b87f9c522c2e879a0',
  ],
  synthetic: [
    '654e685879738f21bcd9fee9a4f328bfccdcb5b6ab53d093b28cb770932dc2e2',
    'd324bb54243c4a9e02bd44a3ac27dd03f7051a8f9c75390eb5a5893a2de1b5c0',
    '6b47ebb95d77d1ec837ab058bc390c34a333987a4ecc100ee4864252d0518475',
  ],
};
