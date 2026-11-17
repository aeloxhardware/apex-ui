import { describe, expect, it } from 'vitest';
import { FLASH_AREA_FRACTION, FlashMeter, isSaturatedRed, maxInWindow, relativeLuminance, stepPixel } from './photosensitivity';

const W = 64;
const H = 36;
const FPS = 60;
const AREA = FLASH_AREA_FRACTION * W * H;

/** Image unie, avec un carré de `size` px de côté peint en `inner`. */
function frame(outer: number[], inner = outer, size = 0): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = x < size && y < size ? inner : outer;
      px.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], (y * W + x) * 4);
    }
  }
  return px;
}

/** Fait tourner `seconds` s d'une animation dont `at(i)` donne l'image i. */
function run(seconds: number, at: (i: number) => Uint8Array) {
  const meter = new FlashMeter(W * H, AREA, FPS);
  for (let i = 0; i < seconds * FPS; i++) meter.push(at(i));
  return meter.report();
}

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
/** Alterne noir et blanc `hz` fois par seconde (un flash par période). */
const square = (hz: number) => (i: number) => frame(Math.floor((i * hz * 2) / FPS) % 2 ? WHITE : BLACK);

describe('relativeLuminance', () => {
  it('va de 0 (noir) à 1 (blanc) et pèse le vert plus que le bleu', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1);
    expect(relativeLuminance(0, 255, 0)).toBeGreaterThan(relativeLuminance(0, 0, 255));
  });
});

describe('isSaturatedRed', () => {
  it('reconnaît le rouge pur, pas le bleu ni le violet', () => {
    expect(isSaturatedRed(255, 0, 0)).toBe(true);
    expect(isSaturatedRed(0, 0, 255)).toBe(false);
    expect(isSaturatedRed(160, 80, 255)).toBe(false);
  });
});

describe('stepPixel', () => {
  it('note une transition à 0,1 de luminance, puis la suivante dans l’autre sens', () => {
    const ref = new Float32Array([0]);
    const dir = new Int8Array(1);
    expect(stepPixel(ref, dir, 0, 0.05)).toBe(0);
    expect(stepPixel(ref, dir, 0, 0.12)).toBe(1);
    expect(stepPixel(ref, dir, 0, 0.5)).toBe(0); // l'extrême monte encore
    expect(stepPixel(ref, dir, 0, 0.45)).toBe(0);
    expect(stepPixel(ref, dir, 0, 0.39)).toBe(-1);
  });

  it('ignore les variations entre deux états clairs (au-dessus de 0,8)', () => {
    const ref = new Float32Array([0.85]);
    const dir = new Int8Array(1);
    expect(stepPixel(ref, dir, 0, 1)).toBe(0);
  });
});

describe('maxInWindow', () => {
  it('trouve la fenêtre la plus chargée', () => {
    expect(maxInWindow([0, 10, 20, 70, 75, 80, 85], 60)).toEqual({ count: 4, start: 70 });
    expect(maxInWindow([], 60)).toEqual({ count: 0, start: 0 });
  });
});

describe('FlashMeter', () => {
  it('une image fixe ne flashe pas', () => {
    const still = frame([20, 40, 120]);
    const report = run(3, () => still);
    expect(report.maxTransitionsPerSecond).toBe(0);
    expect(report.passes).toBe(true);
  });

  it('échoue sur un écran entier qui flashe 5 fois par seconde', () => {
    const report = run(3, square(5));
    expect(report.maxFlashesPerSecond).toBeGreaterThan(3);
    expect(report.passes).toBe(false);
  });

  it('accepte un écran entier qui flashe 2 fois par seconde', () => {
    const report = run(3, square(2));
    expect(report.maxFlashesPerSecond).toBeLessThanOrEqual(2.5);
    expect(report.passes).toBe(true);
  });

  it('accepte un flash rapide sur une zone plus petite que le seuil', () => {
    const small = Math.floor(Math.sqrt(AREA)) - 1;
    const report = run(3, (i) => frame(BLACK, Math.floor((i * 20) / FPS) % 2 ? WHITE : BLACK, small));
    expect(report.maxTransitionsPerSecond).toBe(0);
    expect(report.passes).toBe(true);
  });

  it('refuse le même flash dès qu’il dépasse le seuil de surface', () => {
    const big = Math.ceil(Math.sqrt(AREA)) + 1;
    const report = run(3, (i) => frame(BLACK, Math.floor((i * 20) / FPS) % 2 ? WHITE : BLACK, big));
    expect(report.passes).toBe(false);
  });

  it('compte une montée puis une extinction lentes comme un seul flash', () => {
    // Noir → blanc en 0,5 s, puis blanc → noir en 0,5 s : chaque pixel franchit plusieurs paliers de 0,1.
    const level = (i: number) => Math.round(255 * Math.min(1, Math.max(0, i < 30 ? i / 30 : (60 - i) / 30)));
    const report = run(1, (i) => frame([level(i), level(i), level(i)]));
    expect(report.maxTransitionsPerSecond).toBe(2);
    expect(report.passes).toBe(true);
  });

  it('signale une grande surface de rouge saturé', () => {
    const red = frame([255, 0, 0]);
    const report = run(1, () => red);
    expect(report.maxRedArea).toBe(W * H);
    expect(report.passes).toBe(false);
  });
});
