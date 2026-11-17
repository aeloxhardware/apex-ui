import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FRAME_ASPECT,
  cropProjection,
  frameToRect,
  moveRect,
  readFrame,
  rectToFrame,
  renderFileName,
  resizeRect,
  saveFrame,
} from './renderFrame4k';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
  clear: () => store.clear(),
});

const container = { width: 1600, height: 900 };

describe('renderFrame4k', () => {
  beforeEach(() => localStorage.clear());

  it('garde le rapport 16:9 et reste dans le conteneur', () => {
    const rect = frameToRect({ cx: 0.99, cy: 0.99, w: 5 }, container);
    expect(rect.width / rect.height).toBeCloseTo(FRAME_ASPECT);
    expect(rect.x + rect.width).toBeLessThanOrEqual(container.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(container.height);
  });

  it('aller-retour fractions ↔ pixels', () => {
    const rect = frameToRect({ cx: 0.5, cy: 0.5, w: 0.5 }, container);
    expect(rectToFrame(rect, container)).toEqual({ cx: 0.5, cy: 0.5, w: 0.5 });
  });

  it('déplacement borné par le conteneur', () => {
    const rect = frameToRect({ cx: 0.5, cy: 0.5, w: 0.5 }, container);
    const moved = moveRect(rect, 5000, -5000, container);
    expect(moved.x).toBe(container.width - rect.width);
    expect(moved.y).toBe(0);
  });

  (['nw', 'ne', 'sw', 'se'] as const).forEach((handle) =>
    it(`redimensionnement par le coin ${handle} : 16:9, coin opposé fixe`, () => {
      const rect = { x: 400, y: 200, width: 640, height: 360 };
      const out = resizeRect(
        rect,
        handle,
        {
          x: handle.endsWith('e') ? 1200 : 200,
          y: handle.startsWith('s') ? 700 : 100,
        },
        container,
      );
      expect(out.width / out.height).toBeCloseTo(FRAME_ASPECT);
      const fixedX = handle.endsWith('e') ? out.x : out.x + out.width;
      const fixedY = handle.startsWith('s') ? out.y : out.y + out.height;
      expect(fixedX).toBeCloseTo(handle.endsWith('e') ? rect.x : rect.x + rect.width);
      expect(fixedY).toBeCloseTo(handle.startsWith('s') ? rect.y : rect.y + rect.height);
      expect(out.x).toBeGreaterThanOrEqual(0);
      expect(out.x + out.width).toBeLessThanOrEqual(container.width + 1e-6);
      expect(out.y + out.height).toBeLessThanOrEqual(container.height + 1e-6);
    }),
  );

  it('la taille mémorisée est relue au prochain lancement', () => {
    saveFrame({ cx: 0.3, cy: 0.6, w: 0.4 });
    expect(readFrame()).toEqual({ cx: 0.3, cy: 0.6, w: 0.4 });
  });

  it('valeur mémorisée illisible : cadre par défaut', () => {
    localStorage.setItem('apex-render-frame-4k', '{"cx":"a"}');
    expect(readFrame()).toEqual({ cx: 0.5, cy: 0.5, w: 0.6 });
    localStorage.setItem('apex-render-frame-4k', 'pas du json');
    expect(readFrame()).toEqual({ cx: 0.5, cy: 0.5, w: 0.6 });
  });

  it('recadrage : le centre de la zone devient le centre du rendu, le point au bord de la zone au bord du rendu', () => {
    // Projection orthographique simple : clip = (x, y, z, 1).
    const base = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const region = { left: 0.25, top: 0.25, width: 0.5, height: 0.5 };
    const m = cropProjection(base, region);
    const project = (x: number, y: number) => [x * m[0]! + y * m[4]! + m[12]!, x * m[1]! + y * m[5]! + m[13]!];
    expect(project(0, 0)).toEqual([0, 0]);
    expect(project(0.5, 0.5)).toEqual([1, 1]);
    // Zone décalée vers le coin haut-gauche de l'image.
    const corner = cropProjection(base, { left: 0, top: 0, width: 0.5, height: 0.5 });
    expect(corner[0]! * -1 + corner[12]!).toBeCloseTo(-1); // bord gauche de l'image → bord gauche du rendu
    expect(corner[5]! * 1 + corner[13]!).toBeCloseTo(1); // bord haut de l'image → bord haut du rendu
  });

  it('nom de fichier daté', () => {
    expect(renderFileName(new Date(2026, 10, 17, 14, 5, 9))).toBe('apex-rendu-4k-20261117-140509.png');
  });
});
