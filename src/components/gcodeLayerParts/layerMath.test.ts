import { describe, expect, it } from 'vitest';
import { denseScalar, denseVec3, lerpDense } from './editWeightMath';
import { pickGridDimensions } from './pickGridMath';

describe('denseScalar', () => {
  it('dépose chaque valeur sur le mouvement de son indice, 0 ailleurs', () => {
    const dense = denseScalar(6, Uint32Array.of(1, 4), Float32Array.of(0.5, 2));
    expect(Array.from(dense)).toEqual([0, 0.5, 0, 0, 2, 0]);
  });
  it('rend un tableau de la taille du fichier même sans point', () => {
    expect(denseScalar(4, [], [])).toHaveLength(4);
  });
});

describe('denseVec3', () => {
  it('échange y et z en passant du repère du noyau au repère du plateau', () => {
    const dense = denseVec3(3, [2], [1, 2, 3]);
    expect(Array.from(dense)).toEqual([0, 0, 0, 0, 0, 0, 1, 3, 2]);
  });
  it('garde les trois composantes de chaque point à leur mouvement', () => {
    const dense = denseVec3(2, [0, 1], [1, 2, 3, 4, 5, 6]);
    expect(Array.from(dense)).toEqual([1, 3, 2, 4, 6, 5]);
  });
});

describe('lerpDense', () => {
  const dense = Float32Array.of(0, 10, 20);
  it('interpole entre le point précédent et le point du mouvement', () => {
    expect(lerpDense(dense, 1, 2, 0)).toBe(10);
    expect(lerpDense(dense, 1, 2, 1)).toBe(20);
    expect(lerpDense(dense, 1, 2, 0.5)).toBe(15);
  });
  it('part de 0 au premier mouvement, faute de point précédent', () => {
    expect(lerpDense(Float32Array.of(8, 10), 1, 0, 0.5)).toBe(4);
  });
  it('lit la bonne composante quand il y en a trois par mouvement', () => {
    const vec = Float32Array.of(0, 0, 0, 3, 6, 9);
    expect(lerpDense(vec, 3, 1, 1, 0)).toBe(3);
    expect(lerpDense(vec, 3, 1, 1, 1)).toBe(6);
    expect(lerpDense(vec, 3, 1, 1, 2)).toBe(9);
    expect(lerpDense(vec, 3, 1, 0.5, 2)).toBe(4.5);
  });
  it('vaut 0 sans tableau', () => {
    expect(lerpDense(null, 1, 3, 0.5)).toBe(0);
  });
});

describe('pickGridDimensions', () => {
  it('compte les cellules de chaque axe, au moins une', () => {
    expect(pickGridDimensions(30, 6, 0.5, 3, 1000)).toEqual({ cell: 3, nx: 10, ny: 2, nz: 1 });
  });
  it('arrondit au-dessus quand la boîte ne tombe pas juste', () => {
    expect(pickGridDimensions(10, 10, 10, 3, 1000)).toMatchObject({ nx: 4, ny: 4, nz: 4 });
  });
  it('grossit la cellule de 50 % tant que la grille dépasse le plafond', () => {
    const grid = pickGridDimensions(300, 300, 300, 3, 4_000_000);
    // 100³ = 10⁶ ≤ 4×10⁶ : la cellule d'origine suffit.
    expect(grid.cell).toBe(3);
    const big = pickGridDimensions(900, 900, 900, 3, 4_000_000);
    // 300³ = 2,7×10⁷ > plafond : 4,5 → 200³ = 8×10⁶ > plafond : 6,75 → 134³ ≈ 2,4×10⁶ ≤ plafond.
    expect(big.cell).toBeCloseTo(6.75, 9);
    expect(big.nx * big.ny * big.nz).toBeLessThanOrEqual(4_000_000);
  });
});
