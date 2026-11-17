/**
 * Tracés des icônes d'Apex (charte : `docs/CHARTE_ICONES.md`).
 *
 * Chaque glyphe tient dans une grille 24 × 24 et se compose d'au plus deux tracés qui ne se recouvrent jamais :
 *  - `d`     : le trait (contour ouvert, épaisseur 2, extrémités coupées net, angles adoucis) ;
 *  - `solid` : la facette pleine (remplie, sans trait : ses angles adoucis sont dans le tracé).
 * Un seul tracé par nature : peinte à moins de 100 % d'opacité, l'icône ne montre aucune surépaisseur aux croisements.
 *
 * Signature reprise du logo Apex : un contour fermé reste OUVERT en bas à gauche (« la coupe »), comme le ruban du
 * triangle. Les formes pleines et les facettes inclinées viennent des emblèmes Element.
 */
export interface ApexGlyph {
  d?: string;
  solid?: string;
}

/** Pastille pleine de rayon `r`. */
const dot = (cx: number, cy: number, r = 1.75): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;

/** Anneau complet de rayon `r` (petits cercles : trop petits pour porter la coupe). */
const ring = (cx: number, cy: number, r: number): string => `M${cx} ${cy - r}a${r} ${r} 0 1 0 0 ${2 * r}a${r} ${r} 0 0 0 0 ${-2 * r}z`;

const round = (n: number): number => Math.round(n * 100) / 100;

/** Polygone plein aux angles adoucis (rayon `r`), pour les facettes : un remplissage n'a pas de trait pour les arrondir. */
const facet = (points: [number, number][], r = 1): string => {
  const toward = ([ax, ay]: [number, number], [bx, by]: [number, number]): string => {
    const k = r / Math.hypot(bx - ax, by - ay);
    return `${round(ax + (bx - ax) * k)} ${round(ay + (by - ay) * k)}`;
  };
  const corners = points.map((p, i) => {
    const before = points[(i + points.length - 1) % points.length] ?? p;
    const after = points[(i + 1) % points.length] ?? p;
    return `${toward(p, before)}Q${p[0]} ${p[1]} ${toward(p, after)}`;
  });
  return `M${corners.join('L')}z`;
};

// Formes de base partagées, toutes ouvertes en bas à gauche.
const CIRCLE = 'M8.2 20.16A9 9 0 1 0 3.84 15.8';
const FRAME = 'M9.5 20H18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8.5';
const TRIANGLE = 'M4.6 16.6 12 4l8.75 15.5H9';
const CUBE = 'M3.8 13.5V7.25L12 2.5l8.2 4.75v9.5L12 21.5 7.7 19M3.8 7.25 12 12l8.2-4.75M12 12v9.5';
const EYE = 'M7 17c1.6 1 3.3 1.5 5 1.5 3.5 0 7-2 9.5-6.5C19 7.5 15.5 5.5 12 5.5S5 7.5 2.5 12';
const SPEAKER = 'M3.5 9.5v5H7l5 4.5V5L7 9.5z';
const FUNNEL = 'M3.5 4.5h13L11.5 11v6.5l-3 1.5V11z';
const BRACKETS = 'M3.5 8V5.5a2 2 0 0 1 2-2H8M16 3.5h2.5a2 2 0 0 1 2 2V8M20.5 16v2.5a2 2 0 0 1-2 2H16';

export const GLYPHS = {
  // Navigation et commandes élémentaires
  x: { d: 'M6 6l12 12M18 6 6 18' },
  check: { d: 'M4.5 12.5l5 5L19.5 7' },
  'chevron-right': { d: 'M9 5.5l6.5 6.5L9 18.5' },
  'chevron-left': { d: 'M15 5.5 8.5 12l6.5 6.5' },
  'chevron-down': { d: 'M5.5 9l6.5 6.5L18.5 9' },
  'chevron-up': { d: 'M5.5 15 12 8.5l6.5 6.5' },
  'arrow-left': { d: 'M20 12H4.5M11 5.5 4.5 12l6.5 6.5' },
  'arrow-right': { d: 'M4 12h15.5M13 5.5l6.5 6.5-6.5 6.5' },
  plus: { d: 'M12 4.5v15M4.5 12h15' },
  minus: { d: 'M4.5 12h15' },
  'more-horizontal': { solid: dot(5, 12) + dot(12, 12) + dot(19, 12) },
  'grip-vertical': { solid: [5, 12, 19].map((y) => dot(9, y) + dot(15, y)).join('') },
  dot: { solid: dot(12, 12, 2) },
  'circle-solid': { solid: ring(12, 12, 9.5) },
  'panel-left': { d: `${FRAME}M9.5 4v16` },
  search: { d: `${ring(10.5, 10.5, 6.5)}M15.5 15.5l5 5` },
  'scan-search': { d: `${BRACKETS}M8 20.5H6.5M3.5 16v2${ring(11.5, 11.5, 3.5)}M14 14l2.5 2.5` },
  maximize: { d: 'M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5' },

  // États et lecture
  'circle-check': { d: `${CIRCLE}M8 12.2l3 3 5-6` },
  'circle-x': { d: `${CIRCLE}M9 9l6 6M15 9l-6 6` },
  'triangle-alert': { d: `${TRIANGLE}M12 9.5V14`, solid: dot(12, 16.6, 1.3) },
  info: { d: `${CIRCLE}M12 11v5.5`, solid: dot(12, 7.9, 1.3) },
  loader: { d: 'M12 3a9 9 0 1 0 9 9' },
  play: {
    solid: facet(
      [
        [6.5, 4.2],
        [6.5, 19.8],
        [19.8, 12],
      ],
      1.2,
    ),
  },
  pause: {
    solid: [6.5, 13.5]
      .map((x) =>
        facet([
          [x, 4.5],
          [x + 4, 4.5],
          [x + 4, 19.5],
          [x, 19.5],
        ]),
      )
      .join(''),
  },
  'volume-on': { d: `${SPEAKER}M15.5 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12` },
  'volume-off': { d: `${SPEAKER}M16 9.5l5 5M21 9.5l-5 5` },
  eye: { d: EYE, solid: dot(12, 12, 2.5) },
  'eye-off': { d: `${EYE}M4.5 3.5l15 17` },
  lock: { d: 'M10 21h7a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v4M8 11V7.5a4 4 0 0 1 8 0V11' },
  'lock-open': { d: 'M10 21h7a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v4M8 11V7.5a4 4 0 0 1 7.6-1.7' },
  user: { d: `${ring(12, 8, 3.5)}M5 20.5c0-4 3-6.5 7-6.5s7 2.5 7 6.5` },

  // Fichiers et édition
  save: { d: 'M8.5 20.5H18a2 2 0 0 0 2-2V8l-4.5-4.5h-10a2 2 0 0 0-2 2V15M8 3.5V8h6.5M11 20.5V14h6v6.5' },
  download: { d: 'M12 3.5V16M6.5 10.5 12 16l5.5-5.5M4 20.5h16' },
  upload: { d: 'M12 16V4M6.5 9.5 12 4l5.5 5.5M4 20.5h16' },
  folder: { d: 'M8 19.5h11a1.5 1.5 0 0 0 1.5-1.5V8.5A1.5 1.5 0 0 0 19 7h-7L9.5 4.5h-5A1.5 1.5 0 0 0 3 6v9' },
  trash: { d: 'M4 6.5h16M9.5 6.5V4h5v2.5M18 6.5l-.8 12.2a2 2 0 0 1-2 1.8H10.5M6 6.5l.6 9M10 11v4.5M14 11v4.5' },
  copy: {
    d:
      'M12.5 20.5h6A1.5 1.5 0 0 0 20 19v-8.5A1.5 1.5 0 0 0 18.5 9h-8A1.5 1.5 0 0 0 9 10.5V17' +
      'M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v.5',
  },
  'clipboard-paste': {
    d: 'M9 4.5H6.5A1.5 1.5 0 0 0 5 6v9M15 4.5h2.5A1.5 1.5 0 0 1 19 6v13a1.5 1.5 0 0 1-1.5 1.5H10M9 3h6v3.5H9zM9 13.5h6.5M13 10.5l3 3-3 3',
  },
  undo: { d: 'M9 14.5 4 9.5l5-5M4 9.5h10.5a5 5 0 0 1 0 10H11' },
  redo: { d: 'M15 14.5l5-5-5-5M20 9.5H9.5a5 5 0 0 0 0 10H13' },
  'rotate-ccw': { d: 'M3.5 4.5V10H9M3.8 10A8.5 8.5 0 1 1 5.5 17.5' },
  'rotate-cw': { d: 'M20.5 4.5V10H15M20.2 10A8.5 8.5 0 1 0 18.5 17.5' },
  pencil: { d: 'M4 20l1-4.5L16.5 4 20 7.5 8.5 19zM14 6.5l3.5 3.5' },
  'pen-line': { d: 'M4 20l.9-4L15.5 5.4l3.1 3.1L8 19.1zM13 20.5h7.5' },
  palette: {
    d: 'M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.9 2-2 0-1.4-1.2-1.7-1.2-3 0-1.1.9-2 2.2-2h2.5a3 3 0 0 0 3-3c0-3.9-3.8-7-8.5-7z',
    solid: dot(7.8, 11.8, 1.3) + dot(10.4, 7.9, 1.3) + dot(15, 7.9, 1.3),
  },

  // Espaces de travail : chacun dit ce qu'on y fait
  // Préparation : une pièce posée sur le plateau.
  'space-prepare': {
    d: 'M8 13V5h8.5v8',
    solid: facet([
      [5.5, 16],
      [22, 16],
      [18.5, 21],
      [2, 21],
    ]),
  },
  // Prévisualisation : la pièce tranchée, couche par couche, et le point de dépose sur la couche en cours.
  'space-preview': { d: 'M4 19h16M6.5 15h11M9 11h6M9.5 7H12', solid: dot(14.3, 7, 1.7) },
  // Modélisation : un profil d'esquisse que le point en cours de pose vient fermer.
  'space-model': { d: 'M8.2 19.5h11.3V13h-7V4.5H5v11.8', solid: dot(5, 19.5) },
  // Dev : une invite de commande.
  'space-dev': { d: `${FRAME}M8.5 8.5 12 11.5l-3.5 3M13.5 15.5H17` },
  // Paramètres : un écrou, la pièce qu'on serre pour régler une machine.
  'space-settings': { d: `M4.6 14.8 3 12l4.5-7.8h9L21 12l-4.5 7.8h-6.2${ring(12, 12, 3)}` },

  // Tracé : onglets de Prévisualisation et catégories du moteur
  // Édition : un nœud du tracé et ses deux poignées.
  'node-edit': {
    d: 'M6.2 6.5h3.4M14.4 6.5h3.4M3.5 19C7 19 8 10.5 10.4 8.4M13.6 8.4C16 10.5 17 19 20.5 19',
    solid:
      facet(
        [
          [10.1, 4.6],
          [13.9, 4.6],
          [13.9, 8.4],
          [10.1, 8.4],
        ],
        0.6,
      ) +
      dot(4.6, 6.5, 1.5) +
      dot(19.4, 6.5, 1.5),
  },
  // Fonction : le « f » des fonctions.
  function: { d: 'M16.5 5c-3-1.5-5.5 0-5.5 3.5V16c0 3-1.5 4.5-4.5 3.5M7.5 11.5h8' },
  // Lissage des couches : l'escalier des couches et la pente qu'il doit suivre.
  'layer-smoothing': { d: 'M5 20.5h4.5V16H14v-4.5h4.5V7M3.5 15 14.5 4' },
  // Orientation de la tête : la buse inclinée, à côté de la verticale en pointillé.
  'head-tilt': { d: 'M7.5 20.5 7 14.4l4-6.9 6 3.5-4 6.9zM7.5 11V8M7.5 5.5V3' },
  // Collisions : la buse qui vient heurter la pièce.
  collision: {
    d: 'M5 3.5h7V8l-3.5 4L5 8zM13 11.5l3-2.5M15.5 14.5H19',
    solid: facet([
      [3, 14.5],
      [13, 14.5],
      [13, 21],
      [3, 21],
    ]),
  },
  // Déplacements : le saut à vide (pointillé) entre deux dépôts de matière.
  travel: {
    d: 'M6.5 13.5 8.3 10M10.5 7.5h3M15.7 10l1.8 3.5',
    solid: [2, 16]
      .map((x) =>
        facet([
          [x, 16.5],
          [x + 6, 16.5],
          [x + 6, 20.5],
          [x, 20.5],
        ]),
      )
      .join(''),
  },

  // Réglages et moteur
  sliders: { d: `M4 7.5h8.7M17.7 7.5H20${ring(15.2, 7.5, 2.5)}M4 16.5h2.3M11.3 16.5H20${ring(8.8, 16.5, 2.5)}` },
  route: { d: `M8.5 19H18v-7H6V5h9.5${ring(6, 19, 2.5)}${ring(18, 5, 2.5)}` },
  crosshair: { d: 'M8.83 18.8A7.5 7.5 0 1 0 5.2 15.17M12 2v5M12 17v5M2 12h5M17 12h5' },
  printer: { d: 'M4 20.5V5a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 5v15.5M4 9h16M10 9v3l2 2 2-2V9M7.5 18h9' },

  // Modèles, plateau et sélection
  box: { d: CUBE },
  'cube-plus': {
    d: 'M3.8 13.5V7.25L12 2.5l8.2 4.75V12M3.8 7.25 12 12l8.2-4.75M12 12v9.5L7.7 19M18 15v6M15 18h6',
  },
  'select-all': { d: `${BRACKETS}M8 20.5H6.5M3.5 16v2` },
  'layout-grid': { d: 'M4 4h6v6H4zM14 4h6v6h-6zM14 14h6v6h-6zM4 17v-3h6v6H7' },
  arrange: { d: `${FRAME}M8 8h4v4H8zM13.5 13h3v3h-3z` },
  // Couper : la pièce (cadre ouvert en bas à gauche) traversée par le trait de coupe en pointillés.
  cut: { d: 'M7.5 19.5H19a2 2 0 0 0 2-2v-11a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2V16M3 12h3M8 12h3M13 12h3M18 12h3' },
  pointer: { d: 'M5 4l5.5 15 2.3-6.2L19 10.5z' },
  'pointer-select': {
    d: 'M12 12l3 8.5 1.6-3.9 3.9-1.6zM4 9V6a2 2 0 0 1 2-2h3M13 4h3a2 2 0 0 1 2 2v2M4 13v3a2 2 0 0 0 2 2h2',
  },
  'axes-absolute': { d: 'M6 18V4M2.5 7.5 6 4l3.5 3.5M6 18h14M16.5 14.5 20 18l-3.5 3.5M6 18l6-6' },
  'axes-relative': {
    d: 'M6.5 15.5 9.64 3.4M5.37 5.91 9.64 3.4l2.51 4.27M6.5 15.5l11.62 3.01M15.61 14.24l2.51 4.27-4.27 2.51M6.5 15.5l6-3.5',
  },
  'filter-plus': { d: `${FUNNEL}M18 14v6M15 17h6` },
  'filter-check': { d: `${FUNNEL}M14.5 17l2.3 2.3 4.2-4.6` },
  'filter-x': { d: `${FUNNEL}M15.5 14.5l5 5M20.5 14.5l-5 5` },
  bricks: { d: `${FRAME}M4 9.5h16M4.5 14.5H20M10 4v5.5M15 9.5v5M10.5 14.5V20` },

  // Esquisse et modélisation
  circle: { d: CIRCLE },
  square: { d: FRAME },
  triangle: { d: TRIANGLE },
  waves: { d: 'M3 9.5c3-3 6-3 9 0s6 3 9 0M3 15.5c3-3 6-3 9 0s6 3 9 0' },
  // Accueil : la maison, ouverte en bas à gauche (coupe) ; la porte est une facette pleine qui ne touche pas le trait.
  home: {
    d: 'M4.5 15V10.5L12 3.5l7.5 7V20.5h-3',
    solid: facet(
      [
        [8.5, 20.5],
        [8.5, 14.5],
        [13.5, 14.5],
        [13.5, 20.5],
      ],
      0.8,
    ),
  },
  'orbit-view': { d: 'M6.4 18.6C3.4 17.6 3.3 13.7 6.6 9.9 10.4 5.5 16 3.1 19 4.4c2.2 1 2 3.8-.2 6.6', solid: dot(12, 12, 2.6) },
  mirror: {
    d: 'M15 6.5v11l5.5-5.5zM12 3v3M12 10.5v3M12 18v3',
    solid: facet(
      [
        [10, 5.5],
        [10, 18.5],
        [2.8, 12],
      ],
      1.2,
    ),
  },
} satisfies Record<string, ApexGlyph>;

export type ApexGlyphName = keyof typeof GLYPHS;
