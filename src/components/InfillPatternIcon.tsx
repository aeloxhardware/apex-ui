import React from 'react';

/**
 * Icônes des motifs de remplissage (clés d'`sparse_infill_pattern` d'OrcaSlicer, voir utils/orcaInfillPatterns.ts).
 * Chaque icône est un petit dessin du motif, tracé en trait `currentColor` dans une grille de 24 × 24, calculé ici :
 * des familles de droites découpées au carré, des alvéoles hexagonales, des courbes.
 */

type Seg = [number, number, number, number];
const LO = 3;
const HI = 21;
const MID = 12;

/** Découpe un segment au carré [LO, HI]² (Liang–Barsky) ; null s'il est entièrement dehors. */
const clip = (x0: number, y0: number, x1: number, y1: number, box = { x0: LO, y0: LO, x1: HI, y1: HI }): Seg | null => {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const edges: [number, number][] = [[-dx, x0 - box.x0], [dx, box.x1 - x0], [-dy, y0 - box.y0], [dy, box.y1 - y0]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
};

/** Famille de droites parallèles d'angle `deg`, espacées de `step`, décalées de `shift`, découpées au carré. */
const family = (deg: number, step: number, shift = 0, box?: { x0: number; y0: number; x1: number; y1: number }): Seg[] => {
  const a = (deg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const out: Seg[] = [];
  for (let k = -20; k <= 20; k++) {
    const off = k * step + shift;
    const cx = MID - dy * off;
    const cy = MID + dx * off;
    const s = clip(cx - dx * 40, cy - dy * 40, cx + dx * 40, cy + dy * 40, box);
    if (s) out.push(s);
  }
  return out;
};

const polyline = (pts: [number, number][]): Seg[] => {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const s = clip(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (s) out.push(s);
  }
  return out;
};

const polygon = (pts: [number, number][]): Seg[] => polyline([...pts, pts[0]]);

/** Alvéoles hexagonales de rayon `r` ; `flat` : sommets à gauche/droite (sinon sommets en haut/bas). */
const hexGrid = (r: number, flat: boolean, spokes = false): Seg[] => {
  const out: Seg[] = [];
  const w = flat ? 1.5 * r : Math.sqrt(3) * r;
  const h = flat ? Math.sqrt(3) * r : 1.5 * r;
  for (let row = -6; row <= 6; row++) {
    for (let col = -6; col <= 6; col++) {
      const cx = MID + col * w + (flat ? 0 : (row % 2 ? w / 2 : 0));
      const cy = MID + row * h + (flat && col % 2 ? h / 2 : 0);
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + (flat ? 0 : Math.PI / 6);
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      out.push(...polygon(pts));
      if (spokes) for (let i = 0; i < 6; i += 2) out.push(...polyline([[cx, cy], pts[i]]));
    }
  }
  return out;
};

const curve = (f: (t: number) => [number, number], n = 28): Seg[] => polyline(Array.from({ length: n + 1 }, (_, i) => f(i / n)));

const hilbert = (order: number): [number, number][] => {
  const n = 2 ** order;
  const pts: [number, number][] = [];
  for (let d = 0; d < n * n; d++) {
    let x = 0;
    let y = 0;
    let t = d;
    for (let s = 1; s < n; s *= 2) {
      const rx = 1 & (t / 2);
      const ry = 1 & (t ^ rx);
      if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
      x += s * rx;
      y += s * ry;
      t = Math.floor(t / 4);
    }
    pts.push([LO + ((x + 0.5) * (HI - LO)) / n, LO + ((y + 0.5) * (HI - LO)) / n]);
  }
  return pts;
};

const spiral = (sides: number, turns: number): Seg[] => {
  const total = sides * turns;
  const pts: [number, number][] = [];
  for (let i = 0; i <= total; i++) {
    const a = (i / sides) * Math.PI * 2;
    const r = ((HI - LO) / 2) * (i / total);
    pts.push([MID + r * Math.cos(a), MID + r * Math.sin(a)]);
  }
  return polyline(pts);
};

const zig = (flip: boolean): Seg[] =>
  polyline(Array.from({ length: 7 }, (_, i): [number, number] => [LO + i * 3, (i % 2 === 0) !== flip ? 6 : 18]));

const rects = (): Seg[] => [0, 3, 6].flatMap((inset) => polygon([[LO + inset, LO + inset], [HI - inset, LO + inset], [HI - inset, HI - inset], [LO + inset, HI - inset]]));

const lower = { x0: LO, y0: MID, x1: HI, y1: HI };

const PATTERNS: Record<string, { segs: () => Seg[]; dash?: string }> = {
  rectilinear: { segs: () => family(45, 4) },
  alignedrectilinear: { segs: () => family(90, 4) },
  line: { segs: () => family(0, 4) },
  zigzag: { segs: () => zig(false) },
  crosszag: { segs: () => [...zig(false), ...zig(true)] },
  lockedzag: { segs: () => [...zig(false), ...[0, 1, 2, 3].flatMap((i) => polyline([[LO + 3 + i * 4.5, 6], [LO + 3 + i * 4.5, 10]]))] },
  grid: { segs: () => [...family(0, 6), ...family(90, 6)] },
  triangles: { segs: () => [...family(0, 5), ...family(60, 5), ...family(120, 5)] },
  'tri-hexagon': { segs: () => [...family(0, 8), ...family(60, 8), ...family(120, 8)] },
  cubic: { segs: () => [...family(0, 6, 1), ...family(60, 6, 2), ...family(120, 6, 3)] },
  adaptivecubic: {
    segs: () => [
      ...polygon([[LO, LO], [HI, LO], [HI, HI], [LO, HI]]),
      ...polyline([[MID, LO], [MID, HI]]), ...polyline([[LO, MID], [HI, MID]]),
      ...polyline([[16.5, MID], [16.5, HI]]), ...polyline([[MID, 16.5], [HI, 16.5]]),
    ],
  },
  quartercubic: { segs: () => [...family(0, 5), ...family(60, 5), ...family(120, 5)], dash: '2 1.6' },
  supportcubic: { segs: () => [...family(0, 5, 0, lower), ...family(60, 5, 0, lower), ...family(120, 5, 0, lower)] },
  lightning: {
    segs: () => polyline([[MID, LO], [MID, 10], [8, 14], [6, HI]])
      .concat(polyline([[MID, 10], [16, 14], [18, HI]]), polyline([[8, 14], [11, HI]]), polyline([[16, 14], [14, 18]])),
  },
  honeycomb: { segs: () => hexGrid(4.5, false) },
  '3dhoneycomb': { segs: () => hexGrid(5.5, false, true) },
  'lateral-honeycomb': { segs: () => hexGrid(4.5, true) },
  'lateral-lattice': { segs: () => [...family(45, 7), ...family(135, 7), ...family(90, 7, 3.5)] },
  crosshatch: {
    segs: () => [
      ...family(45, 2.4, 0, { x0: LO, y0: LO, x1: MID, y1: HI }),
      ...family(135, 2.4, 0, { x0: MID, y0: LO, x1: HI, y1: HI }),
    ],
  },
  tpmsd: {
    segs: () => [
      ...curve((t) => [MID + 4 * Math.cos(t * Math.PI * 2), 7.5 + 4 * Math.sin(t * Math.PI * 2)]),
      ...curve((t) => [MID + 4 * Math.cos(t * Math.PI * 2), 16.5 + 4 * Math.sin(t * Math.PI * 2)]),
      ...curve((t) => [LO + t * 18, MID + 3 * Math.sin(t * Math.PI * 2)]),
    ],
  },
  tpmsfk: {
    segs: () => [
      ...curve((t) => [LO + t * 18, 8 + 3 * Math.sin(t * Math.PI * 3)]),
      ...curve((t) => [LO + t * 18, 16 + 3 * Math.sin(t * Math.PI * 3 + Math.PI)]),
      ...curve((t) => [8 + 3 * Math.sin(t * Math.PI * 3 + Math.PI / 2), LO + t * 18]),
      ...curve((t) => [16 + 3 * Math.sin(t * Math.PI * 3 - Math.PI / 2), LO + t * 18]),
    ],
  },
  gyroid: {
    segs: () => [0, 1, 2].flatMap((k) => curve((t) => [LO + t * 18, 6 + k * 6 + 2.8 * Math.sin(t * Math.PI * 2 + (k % 2) * Math.PI)])),
  },
  concentric: { segs: rects },
  hilbertcurve: { segs: () => polyline(hilbert(2)) },
  archimedeanchords: { segs: () => spiral(24, 3) },
  octagramspiral: { segs: () => spiral(8, 3) },
};

export const InfillPatternIcon: React.FC<{ pattern: string; size?: number }> = ({ pattern, size = 20 }) => {
  const def = PATTERNS[pattern];
  if (!def) return null;
  const d = def.segs().map(([x0, y0, x1, y1]) => `M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}`).join('');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2}
      strokeLinecap="round" strokeLinejoin="round" strokeDasharray={def.dash} aria-hidden className="shrink-0">
      <rect x={LO - 1} y={LO - 1} width={HI - LO + 2} height={HI - LO + 2} rx={2} strokeOpacity={0.35} strokeDasharray="none" />
      <path d={d} />
    </svg>
  );
};
