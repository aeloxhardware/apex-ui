import { describe, expect, it } from 'vitest';
import { ArrangeCancelled, arrange, arrangeAsync, arrangeSteps, convexHull, minkowskiSum, polygonArea, type Pt } from './orcaArrange';

const rect = (w: number, h: number): Pt[] => [
  { x: -w / 2, z: -h / 2 }, { x: w / 2, z: -h / 2 }, { x: w / 2, z: h / 2 }, { x: -w / 2, z: h / 2 },
];

describe('disposition automatique (Orca)', () => {
  it("la somme de Minkowski de deux carrés est un carré de côtés additionnés", () => {
    const s = minkowskiSum(convexHull(rect(10, 10)), convexHull(rect(4, 6)));
    expect(polygonArea(s)).toBeCloseTo(14 * 16, 6);
  });

  it("place plusieurs pièces sans chevauchement ni débord, avec l'écart demandé", () => {
    const sizes = [60, 40, 40, 30, 20, 20, 15, 10];
    const res = arrange(sizes.map((s) => ({ outline: rect(s, s) })), { binRadius: 125, spacing: 5, allowRotations: false });
    res.forEach((r) => expect(r.center).not.toBeNull());
    for (let i = 0; i < sizes.length; i++) {
      const a = res[i].center!;
      const h = sizes[i] / 2;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        expect(Math.hypot(a.x + sx * h, a.z + sz * h)).toBeLessThanOrEqual(125 + 1e-3);
      }
      for (let j = i + 1; j < sizes.length; j++) {
        const b = res[j].center!;
        const gap = Math.max(Math.abs(a.x - b.x) - (sizes[i] + sizes[j]) / 2, Math.abs(a.z - b.z) - (sizes[i] + sizes[j]) / 2);
        expect(gap).toBeGreaterThanOrEqual(5 - 1e-3);
      }
    }
  });

  it("laisse sans position une pièce plus grande que le plateau", () => {
    const res = arrange([{ outline: rect(400, 400) }, { outline: rect(10, 10) }], { binRadius: 125, spacing: 5, allowRotations: false });
    expect(res[0].center).toBeNull();
    expect(res[1].center).not.toBeNull();
  });

  it("redresse une pièce inclinée à 30° grâce à la graine de rotation", () => {
    const a = (30 * Math.PI) / 180;
    const tilted = rect(80, 20).map((p) => ({ x: p.x * Math.cos(a) - p.z * Math.sin(a), z: p.x * Math.sin(a) + p.z * Math.cos(a) }));
    const [r] = arrange([{ outline: tilted }], { binRadius: 125, spacing: 0, allowRotations: true });
    const k = Math.abs(((r.angle + a) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    expect(Math.min(k, Math.PI / 2 - k)).toBeLessThan(1e-6);
  });
});

describe('disposition : pièces fixes, avancement, annulation', () => {
  const at = (cx: number, cz: number, w: number): Pt[] => rect(w, w).map((p) => ({ x: p.x + cx, z: p.z + cz }));

  it("une pièce fixe ne bouge pas et les autres l'évitent avec l'écart demandé", () => {
    const inputs = [{ outline: at(0, 0, 60), fixed: true }, { outline: at(100, 100, 40) }, { outline: at(-100, 100, 40) }];
    const res = arrange(inputs, { binRadius: 125, spacing: 5, allowRotations: false });
    expect(res[0]).toEqual({ center: null, angle: 0, fixed: true });
    for (const r of res.slice(1)) {
      expect(r.center).not.toBeNull();
      const gap = Math.max(Math.abs(r.center?.x ?? 0) - (60 + 40) / 2, Math.abs(r.center?.z ?? 0) - (60 + 40) / 2);
      expect(gap).toBeGreaterThanOrEqual(5 - 1e-3);
    }
  });

  it("range la pièce mobile contre la fixe, à l'écart demandé, sans recentrer le tas", () => {
    const res = arrange([{ outline: at(60, 0, 40), fixed: true }, { outline: at(0, 0, 20) }], { binRadius: 125, spacing: 4, allowRotations: false });
    const c = res[1]?.center;
    expect(c).not.toBeNull();
    // Contact avec la fixe (40 mm de large, centrée en x = 60) : écart de 4 mm sur au moins un axe.
    const gap = Math.max(Math.abs((c?.x ?? 0) - 60) - (40 + 20) / 2, Math.abs(c?.z ?? 0) - (40 + 20) / 2);
    expect(gap).toBeGreaterThanOrEqual(4 - 1e-3);
    expect(gap).toBeLessThan(4 + 1e-2);
  });

  it("rend l'avancement après chaque pièce mobile seulement", () => {
    const steps = arrangeSteps([{ outline: at(0, 0, 30), fixed: true }, { outline: at(0, 0, 20) }, { outline: at(0, 0, 10) }], { binRadius: 125, spacing: 5, allowRotations: false });
    const seen: number[] = [];
    for (let s = steps.next(); !s.done; s = steps.next()) seen.push(s.value.done * 10 + s.value.total);
    expect(seen).toEqual([12, 22]);
  });

  it("arrangeAsync donne le même résultat que arrange et signale l'avancement", async () => {
    const inputs = [{ outline: rect(60, 60) }, { outline: rect(30, 30) }, { outline: rect(20, 20) }];
    const params = { binRadius: 125, spacing: 5, allowRotations: true };
    const seen: number[] = [];
    const res = await arrangeAsync(inputs, params, { onProgress: (p) => seen.push(p.done) });
    expect(res).toEqual(arrange(inputs, params));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("s'arrête quand on annule", async () => {
    const controller = new AbortController();
    const inputs = [{ outline: rect(60, 60) }, { outline: rect(30, 30) }, { outline: rect(20, 20) }];
    const run = arrangeAsync(inputs, { binRadius: 125, spacing: 5, allowRotations: false }, { onProgress: () => controller.abort(), signal: controller.signal });
    await expect(run).rejects.toBeInstanceOf(ArrangeCancelled);
  });
});

describe("disposition : objectif et options d'Orca", () => {
  it("centre une pièce seule sur le plateau (alignement final)", () => {
    const res = arrange([{ outline: rect(40, 40) }], { binRadius: 125, spacing: 5, allowRotations: false });
    expect(res[0]?.center?.x).toBeCloseTo(0, 6);
    expect(res[0]?.center?.z).toBeCloseTo(0, 6);
  });

  it("refuse une pièce dont le cercle englobant dépasse le plateau, même si sa boîte semble tenir", () => {
    // Carré de 190 mm : boîte dans [-125, 125]² mais diagonale 269 mm > 250 mm.
    const res = arrange([{ outline: rect(190, 190) }], { binRadius: 125, spacing: 0, allowRotations: false });
    expect(res[0]?.center).toBeNull();
  });

  it("garde tout le tas dans le disque du plateau", () => {
    const sizes = [90, 70, 60, 50, 40, 40, 30, 25, 20, 20];
    const res = arrange(sizes.map((w) => ({ outline: rect(w, w) })), { binRadius: 125, spacing: 5, allowRotations: true });
    res.forEach((r, i) => {
      if (!r.center) return;
      const half = (sizes[i] ?? 0) / 2;
      const a = r.angle;
      const reach = Math.abs(Math.cos(a)) * half + Math.abs(Math.sin(a)) * half;
      expect(Math.hypot(Math.abs(r.center.x) + reach, Math.abs(r.center.z) + reach)).toBeLessThanOrEqual(125 * Math.SQRT2 + 1e-3);
      expect(Math.hypot(r.center.x, r.center.z)).toBeLessThanOrEqual(125);
    });
  });

  it("aligne le grand axe d'une pièce allongée sur Y quand on le demande et que les rotations sont refusées", () => {
    const a = (30 * Math.PI) / 180;
    const tilted = rect(80, 20).map((p) => ({ x: p.x * Math.cos(a) - p.z * Math.sin(a), z: p.x * Math.sin(a) + p.z * Math.cos(a) }));
    const params = { binRadius: 125, spacing: 0, allowRotations: false };
    const plain = arrange([{ outline: tilted }], params)[0];
    const aligned = arrange([{ outline: tilted }], { ...params, alignToY: true })[0];
    expect(plain?.angle).toBe(0);
    const rotated = tilted.map((p) => ({ x: p.x * Math.cos(aligned?.angle ?? 0) - p.z * Math.sin(aligned?.angle ?? 0), z: p.x * Math.sin(aligned?.angle ?? 0) + p.z * Math.cos(aligned?.angle ?? 0) }));
    const xs = rotated.map((p) => p.x), zs = rotated.map((p) => p.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan((Math.max(...xs) - Math.min(...xs)) * 3);
  });

  it("n'oriente pas une pièce sans axe dominant", () => {
    const res = arrange([{ outline: rect(40, 40) }], { binRadius: 125, spacing: 0, allowRotations: false, alignToY: true });
    expect(res[0]?.angle).toBe(0);
  });

  it("range trois copies identiques en tas compact, à l'écart demandé (terme d'alignement)", () => {
    const res = arrange([{ outline: rect(50, 30) }, { outline: rect(50, 30) }, { outline: rect(50, 30) }], { binRadius: 125, spacing: 4, allowRotations: false });
    const cs = res.map((r) => r.center ?? { x: NaN, z: NaN });
    expect(cs.every((c) => Number.isFinite(c.x))).toBe(true);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const gap = Math.max(Math.abs((cs[i]?.x ?? 0) - (cs[j]?.x ?? 0)) - 50, Math.abs((cs[i]?.z ?? 0) - (cs[j]?.z ?? 0)) - 30);
        expect(gap).toBeGreaterThanOrEqual(4 - 1e-3);
      }
    }
    // Tas compact : deux en rangée et une dessous tiennent dans 104 × 64 mm (2 × 50 + 4 ; 2 × 30 + 4).
    const xs = cs.map((c) => c.x), zs = cs.map((c) => c.z);
    expect(Math.max(...xs) - Math.min(...xs) + 50).toBeLessThanOrEqual(104 + 1e-3);
    expect(Math.max(...zs) - Math.min(...zs) + 30).toBeLessThanOrEqual(64 + 1e-3);
  });
});
