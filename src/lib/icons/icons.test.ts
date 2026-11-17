import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createApexIcon } from './ApexIcon';
import { GLYPHS, type ApexGlyph, type ApexGlyphName } from './glyphs';
import * as icons from './index';

const names = Object.keys(GLYPHS) as ApexGlyphName[];
const glyphs: Record<string, ApexGlyph> = GLYPHS;

/** Coordonnées absolues extrêmes d'un tracé, calculées sur ses points d'ancrage (suffisant pour la marge de la grille). */
function anchors(d: string): number[] {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (const [, cmd = '', args = ''] of d.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)) {
    const n = (args.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    const rel = cmd === cmd.toLowerCase();
    const step = { m: 2, l: 2, h: 1, v: 1, a: 7, q: 4, c: 6, s: 4, z: 0 }[cmd.toLowerCase()] ?? 0;
    for (let i = 0; step > 0 && i + step <= n.length; i += step) {
      const lower = cmd.toLowerCase();
      const px = lower === 'v' ? null : (n[lower === 'h' ? i : i + step - 2] ?? 0);
      const py = lower === 'h' ? null : (n[i + step - 1] ?? 0);
      if (px !== null) x = rel ? x + px : px;
      if (py !== null) y = rel ? y + py : py;
      out.push(x, y);
    }
  }
  return out;
}

describe('jeu d’icônes Apex', () => {
  it('chaque glyphe a au moins un tracé et tient dans la grille 24 × 24', () => {
    for (const name of names) {
      const { d, solid } = glyphs[name] ?? {};
      expect(d ?? solid, name).toBeTruthy();
      for (const v of anchors(`${d ?? ''}${solid ?? ''}`)) {
        expect(v, name).toBeGreaterThanOrEqual(1.5);
        expect(v, name).toBeLessThanOrEqual(22.5);
      }
    }
  });

  it('chaque glyphe est exporté une fois, et rien d’autre', () => {
    const exported = Object.values(icons).map((icon) => icon.displayName);
    expect([...exported].sort()).toEqual(names.map((name) => `ApexIcon(${name})`).sort());
  });

  it('applique la charte : grille 24, extrémités coupées net, angles adoucis, facette sans trait', () => {
    const html = renderToStaticMarkup(createElement(createApexIcon('space-prepare'), { size: 16, className: 'extra' }));
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('width="16"');
    expect(html).toContain('stroke-linecap="butt"');
    expect(html).toContain('stroke-linejoin="round"');
    expect(html).toContain('class="apex-icon apex-icon-space-prepare extra"');
    expect(html).toMatch(/<path d="[^"]+" fill="currentColor" stroke="none"/);
  });

  it('laisse l’appelant régler l’épaisseur du trait', () => {
    const html = renderToStaticMarkup(createElement(createApexIcon('x'), { strokeWidth: 3 }));
    expect(html).toContain('stroke-width="3"');
  });
});
