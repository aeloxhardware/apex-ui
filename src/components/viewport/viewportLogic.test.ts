import { describe, expect, it } from 'vitest';
import { cameraAnglesFacing } from './cameraAngles';
import { findFreeSpotAmong, type Disc } from './freeSpot';
import { isLabelVisible, labelDecimation } from './gridLabelLogic';
import { uniqueModelName } from './modelNaming';

describe('uniqueModelName', () => {
  it('garde le nom du fichier quand il est libre', () => {
    expect(uniqueModelName('vase.stl', new Set())).toBe('vase.stl');
    expect(uniqueModelName('vase.stl', new Set(['autre.stl']))).toBe('vase.stl');
  });
  it('suffixe (2), (3)… avant l\'extension pour les exemplaires suivants', () => {
    expect(uniqueModelName('vase.stl', new Set(['vase.stl']))).toBe('vase (2).stl');
    expect(uniqueModelName('vase.stl', new Set(['vase.stl', 'vase (2).stl']))).toBe('vase (3).stl');
  });
  it('comble le premier numéro libre', () => {
    expect(uniqueModelName('vase.stl', new Set(['vase.stl', 'vase (3).stl']))).toBe('vase (2).stl');
  });
  it('suffixe à la fin quand il n\'y a pas d\'extension', () => {
    expect(uniqueModelName('vase', new Set(['vase']))).toBe('vase (2)');
    expect(uniqueModelName('.cache', new Set(['.cache']))).toBe('.cache (2)');
  });
  it('ne coupe que sur le dernier point', () => {
    expect(uniqueModelName('a.b.stl', new Set(['a.b.stl']))).toBe('a.b (2).stl');
  });
});

describe('cameraAnglesFacing', () => {
  // Position d'une ArcRotateCamera : cible + rayon·(cosα sinβ, cosβ, sinα sinβ).
  const positionOf = ({ alpha, beta }: { alpha: number; beta: number }) =>
    [Math.cos(alpha) * Math.sin(beta), Math.cos(beta), Math.sin(alpha) * Math.sin(beta)];

  it.each([
    [{ x: 1, y: 0, z: 0 }],
    [{ x: 0, y: 0, z: 1 }],
    [{ x: 0, y: 0, z: -1 }],
    [{ x: -1, y: 0, z: 0 }],
    [{ x: 0.6, y: 0.8, z: 0 }],
    [{ x: 0, y: -0.6, z: 0.8 }],
  ])('place la caméra dans la direction de la normale %j', (n) => {
    const p = positionOf(cameraAnglesFacing(n));
    expect(p[0]).toBeCloseTo(n.x, 6);
    expect(p[1]).toBeCloseTo(n.y, 6);
    expect(p[2]).toBeCloseTo(n.z, 6);
  });

  it('traite une face horizontale à part : azimut de la vue du dessus, bêta décalé du pôle', () => {
    expect(cameraAnglesFacing({ x: 0, y: 1, z: 0 })).toEqual({ alpha: -Math.PI / 2, beta: 0.01, horizontal: true });
    expect(cameraAnglesFacing({ x: 0, y: -1, z: 0 })).toEqual({ alpha: -Math.PI / 2, beta: Math.PI - 0.01, horizontal: true });
  });

  it('ne produit pas de NaN pour une normale légèrement hors de la sphère unité', () => {
    const { beta } = cameraAnglesFacing({ x: 0.5, y: 0.98, z: 0 });
    expect(Number.isFinite(beta)).toBe(true);
    expect(cameraAnglesFacing({ x: 0, y: 1.0000001, z: 0 }).horizontal).toBe(true);
  });
});

describe('étiquettes de la grille', () => {
  const DECIMATIONS = [1, 2, 10, 20, 100];

  it('retient le plus petit pas dont les chiffres tiennent', () => {
    // Écart constant de 40 px entre graduations ; un chiffre demande 30 px.
    expect(labelDecimation(7, 30, DECIMATIONS, () => 40)).toBe(1);
    // 12 px d'écart : il faut sauter une graduation sur 3 → le pas 10 est le premier à tenir (1×12 et 2×12 < 30).
    expect(labelDecimation(7, 30, DECIMATIONS, () => 12)).toBe(10);
  });

  it('se décide sur la graduation la plus serrée du bloc, pas sur celle de l\'étiquette', () => {
    // Écart qui se resserre avec le rang : le bloc [0, 10[ est jugé sur ses bornes 0 et 9.
    const seen: number[] = [];
    const spacing = (rank: number) => { seen.push(rank); return rank === 9 ? 5 : 40; };
    expect(labelDecimation(3, 30, [1, 10], spacing)).toBe(10);
    expect(seen).toEqual([0, 9, 0, 99]);
  });

  it('rend undefined quand aucun pas ne convient', () => {
    expect(labelDecimation(3, 1e6, DECIMATIONS, () => 1)).toBeUndefined();
  });

  it('affiche une étiquette seulement sur un multiple du pas retenu', () => {
    expect(isLabelVisible(20, 10)).toBe(true);
    expect(isLabelVisible(-20, 10)).toBe(true);
    expect(isLabelVisible(15, 10)).toBe(false);
    expect(isLabelVisible(0, 100)).toBe(true);
    expect(isLabelVisible(5, undefined)).toBe(false);
  });
});

describe('findFreeSpotAmong', () => {
  const PLATE = 100;
  const dist = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);
  const clear = (p: { x: number; z: number }, d: Disc, r: number) => Math.hypot(p.x - d.x, p.z - d.z) >= r + d.r + 5 - 1e-9;

  it('pose le premier modèle au centre', () => {
    expect(findFreeSpotAmong([], 20, PLATE)).toEqual({ x: 0, z: 0 });
  });

  it('reste au centre tant que le centre est libre', () => {
    expect(findFreeSpotAmong([{ x: 70, z: 0, r: 10 }], 10, PLATE)).toEqual({ x: 0, z: 0 });
  });

  it('écarte le nouveau modèle d\'un modèle central, tangent au jeu de 5 mm près', () => {
    const spot = findFreeSpotAmong([{ x: 0, z: 0, r: 20 }], 10, PLATE);
    expect(dist(spot)).toBeCloseTo(20 + 10 + 5, 6);
  });

  it('ne chevauche aucun modèle et reste sur le plateau', () => {
    const existing: Disc[] = [
      { x: 0, z: 0, r: 25 }, { x: 40, z: 10, r: 15 }, { x: -35, z: -20, r: 18 }, { x: 5, z: 50, r: 12 },
    ];
    const spot = findFreeSpotAmong(existing, 12, PLATE);
    existing.forEach((d) => expect(clear(spot, d, 12)).toBe(true));
    expect(dist(spot) + 12).toBeLessThanOrEqual(PLATE);
  });

  it('choisit l\'emplacement libre le plus proche du centre', () => {
    const existing: Disc[] = [{ x: 0, z: 0, r: 20 }];
    const spot = findFreeSpotAmong(existing, 10, PLATE);
    // Aucun point plus proche du centre n'est libre : on balaie le plateau pour s'en assurer.
    for (let x = -90; x <= 90; x += 3) {
      for (let z = -90; z <= 90; z += 3) {
        if (Math.hypot(x, z) + 10 > PLATE - 2) continue;
        if (clear({ x, z }, existing[0], 10)) expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(dist(spot) - 1e-6);
      }
    }
  });

  it('revient au centre quand le modèle est plus grand que le plateau', () => {
    expect(findFreeSpotAmong([{ x: 0, z: 0, r: 5 }], 99, PLATE)).toEqual({ x: 0, z: 0 });
  });

  it('revient au centre quand le plateau est plein', () => {
    const full: Disc[] = [{ x: 0, z: 0, r: 90 }];
    expect(findFreeSpotAmong(full, 30, PLATE)).toEqual({ x: 0, z: 0 });
  });
});
