import { describe, expect, it } from 'vitest';
import { enclosingCircle, principalAxisAlignAngle, type Pt } from './orcaArrangeGeometry';

const rect = (w: number, h: number): Pt[] => [
  { x: -w / 2, z: -h / 2 },
  { x: w / 2, z: -h / 2 },
  { x: w / 2, z: h / 2 },
  { x: -w / 2, z: h / 2 },
];
const rotate = (poly: Pt[], a: number): Pt[] =>
  poly.map((p) => ({ x: p.x * Math.cos(a) - p.z * Math.sin(a), z: p.x * Math.sin(a) + p.z * Math.cos(a) }));

describe('géométrie de la disposition automatique', () => {
  it('le cercle englobant d’un rectangle a pour diamètre sa diagonale', () => {
    const c = enclosingCircle(rect(30, 40));
    expect(c.r).toBeCloseTo(25, 6);
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.z).toBeCloseTo(0, 6);
  });

  it('le cercle englobant d’un triangle obtusangle passe par les deux sommets les plus éloignés', () => {
    const c = enclosingCircle([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 5, z: 1 },
    ]);
    expect(c.r).toBeCloseTo(5, 6);
  });

  it('le cercle englobant contient tous les points', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: Math.cos(i * 2.4) * (i % 7) * 3, z: Math.sin(i * 2.4) * (i % 5) * 4 }));
    const c = enclosingCircle(pts);
    for (const p of pts) expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeLessThanOrEqual(c.r + 1e-9);
  });

  it('l’axe principal d’un rectangle allongé couché ramène le grand côté sur Y', () => {
    const angle = principalAxisAlignAngle(rect(80, 20));
    expect(angle).not.toBeNull();
    const out = rotate(rect(80, 20), angle ?? 0);
    const xs = out.map((p) => p.x),
      zs = out.map((p) => p.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(80, 6);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(20, 6);
  });

  it('un carré n’a pas d’axe dominant : pas de rotation', () => {
    expect(principalAxisAlignAngle(rect(40, 40))).toBeNull();
  });
});
