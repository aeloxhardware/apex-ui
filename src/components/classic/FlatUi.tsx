import { useEffect } from 'react';

/**
 * Noir et blanc pour les composants RÉUTILISÉS de l'interface principale (panneau Édition, calques du viewport) :
 * leurs feuilles de style sont faites de fonds translucides et de couleurs. À l'apparition de chaque élément (et à
 * chaque changement de classe), on lui pose en ligne :
 *   - fond noir, ou blanc s'il était plus clair que son parent (états actif / sélectionné : l'information est gardée,
 *     simplement inversée) ; fond transparent = celui du parent ;
 *   - texte et bordures de la couleur opposée au fond.
 * Les éléments dont le fond est posé en ligne par le composant (pastilles de couleur des types de ligne, dégradés de
 * coloration) sont laissés tels quels : ce sont des DONNÉES, comme les couleurs de la scène 3D.
 * Le survol (inversion) est géré par flat.css. Un seul passage par élément, aucun calcul pendant les animations
 * (il n'y en a plus).
 */

const BASE = [42, 45, 52]; // #2a2d34, fond d'origine de l'application
const lumOf = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const BASE_LUM = lumOf(BASE[0], BASE[1], BASE[2]);

function parseColor(color: string): [number, number, number, number] | null {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (p.length < 3 || p.some(Number.isNaN)) return null;
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

const SET = 'flatSet';

function reset(el: HTMLElement) {
  if (el.dataset[SET] !== '1') return;
  el.style.removeProperty('background-color');
  el.style.removeProperty('color');
  el.style.removeProperty('border-color');
  delete el.dataset[SET];
}

function flattenElement(el: HTMLElement) {
  reset(el);
  const parent = el.parentElement;
  const parentLum = parent?.dataset.flatLum ? Number(parent.dataset.flatLum) : BASE_LUM;
  const parentWhite = parent?.dataset.flatBg === 'w';
  const cs = getComputedStyle(el);
  const bg = parseColor(cs.backgroundColor);
  let white = parentWhite;
  let lum = parentLum;
  const inlineBg = el.style.backgroundColor !== '';
  if (bg && bg[3] > 0.05 && !inlineBg) {
    // Couleur propre mélangée au fond du parent.
    const a = bg[3];
    lum = lumOf(bg[0], bg[1], bg[2]) * a + parentLum * (1 - a);
    white = lum - parentLum > 0.03;
    el.style.backgroundColor = white ? '#fff' : '#000';
    el.dataset[SET] = '1';
  }
  el.dataset.flatLum = String(lum);
  el.dataset.flatBg = white ? 'w' : 'b';
  if (inlineBg) return; // pastille de données : couleur et texte laissés tels quels
  const fg = white ? '#000' : '#fff';
  el.style.color = fg;
  if (['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0)) {
    el.style.borderColor = fg;
  }
  el.dataset[SET] = '1';
}

function flattenTree(root: Element) {
  if (root instanceof HTMLElement) flattenElement(root);
  // Ordre du document : un parent est toujours traité avant ses enfants.
  root.querySelectorAll('*').forEach((el) => { if (el instanceof HTMLElement) flattenElement(el); });
}

export const FlatUi: React.FC = () => {
  useEffect(() => {
    const pending = new Set<Element>();
    let queued = false;
    const flush = () => {
      queued = false;
      const roots = [...pending].filter((el) => el.isConnected);
      pending.clear();
      // Un élément contenu dans un autre ajouté du même lot est déjà couvert par son ancêtre.
      for (const el of roots) if (!roots.some((o) => o !== el && o.contains(el))) flattenTree(el);
    };
    const queue = (el: Element) => {
      pending.add(el);
      if (!queued) { queued = true; requestAnimationFrame(flush); }
    };
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') queue(r.target as Element);
        else r.addedNodes.forEach((n) => { if (n instanceof Element) queue(n); });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    flattenTree(document.body);
    return () => observer.disconnect();
  }, []);
  return null;
};
