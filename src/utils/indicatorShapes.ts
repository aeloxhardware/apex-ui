/**
 * Formes du surlignage de la barre d'onglets, sous forme de `clip-path: polygon(...)` de même
 * nombre de points : CSS n'interpole deux polygones que s'ils en ont autant, ce qui permet de
 * faire passer le surlignage d'un rectangle arrondi à un triangle aux bords arrondis (et
 * inversement) par une simple transition.
 *
 * Le rectangle s'exprime en % + px (il s'adapte à la largeur de chaque onglet) ; le triangle en px,
 * dans la boîte du logo (BOX_W × BOX_H), où il est toujours affiché.
 */

const ARC_STEPS = 8; // points par arc de coin ; le sommet du triangle en reçoit le double (deux « coins » du rectangle)
const RECT_RADIUS = 14;
/** Boîte du surlignage sur le logo : le bouton (42 px) élargi de LOGO_PAD_X / LOGO_PAD_Y de chaque côté, pour que le triangle déborde du logo. */
export const LOGO_PAD_X = 8;
export const LOGO_PAD_Y = 12;
const BOX_W = 42 + 2 * LOGO_PAD_X;
const BOX_H = 42 + 2 * LOGO_PAD_Y;

type Pt = readonly [string, string];

const lerpAngle = (a0: number, a1: number, i: number, n: number) => a0 + ((a1 - a0) * i) / (n - 1);

/** Rectangle arrondi, sens horaire à partir du coin haut-gauche : 4 arcs de ARC_STEPS points. */
function roundedRect(): Pt[] {
  const r = RECT_RADIUS;
  const pts: Pt[] = [];
  // [centre x (gauche ou droite), centre y (haut ou bas), angle de départ] pour chaque coin, sens horaire.
  const corners: Array<[boolean, boolean, number]> = [
    [false, false, 180], // haut-gauche
    [true, false, 270], // haut-droit
    [true, true, 0], // bas-droit
    [false, true, 90], // bas-gauche
  ];
  for (const [right, bottom, start] of corners) {
    for (let i = 0; i < ARC_STEPS; i++) {
      const a = (lerpAngle(start, start + 90, i, ARC_STEPS) * Math.PI) / 180;
      const dx = r + r * Math.cos(a); // décalage depuis le bord extérieur, côté intérieur positif
      const dy = r + r * Math.sin(a);
      const x = right ? `calc(100% - ${(r * 2 - dx).toFixed(2)}px)` : `${dx.toFixed(2)}px`;
      const y = bottom ? `calc(100% - ${(r * 2 - dy).toFixed(2)}px)` : `${dy.toFixed(2)}px`;
      pts.push([x, y]);
    }
  }
  return pts;
}

/** Triangle isocèle pointe en haut, coins arrondis (rayon r), sens horaire : sommet 2 × ARC_STEPS points, puis 2 autres coins. */
function roundedTriangle(): Pt[] {
  const r = 7;
  const V = [
    [(2 + BOX_W) / 2, 2], // sommet
    [BOX_W, BOX_H - 13], // bas droit
    [2, BOX_H - 13], // bas gauche
  ] as const;
  const arc = (i: number, n: number): Array<[number, number]> => {
    const p = V[i];
    const prev = V[(i + 2) % 3];
    const next = V[(i + 1) % 3];
    const unit = (a: readonly number[], b: readonly number[]) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy);
      return [dx / l, dy / l];
    };
    const u1 = unit(p, prev);
    const u2 = unit(p, next);
    // Demi-angle au sommet, distance de coupe pour un congé de rayon r.
    const half = Math.acos(u1[0] * u2[0] + u1[1] * u2[1]) / 2;
    const cut = r / Math.tan(half);
    const t1 = [p[0] + u1[0] * cut, p[1] + u1[1] * cut];
    const t2 = [p[0] + u2[0] * cut, p[1] + u2[1] * cut];
    const bis = unit([0, 0], [u1[0] + u2[0], u1[1] + u2[1]]);
    const cd = r / Math.sin(half);
    const c = [p[0] + bis[0] * cd, p[1] + bis[1] * cd];
    const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    let a2 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    // Arc court, dans le sens horaire de l'écran (angles croissants).
    while (a2 < a1) a2 += Math.PI * 2;
    if (a2 - a1 > Math.PI) a2 -= Math.PI * 2;
    const out: Array<[number, number]> = [];
    for (let k = 0; k < n; k++) {
      const a = lerpAngle(a1, a2, k, n);
      out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
    return out;
  };
  const px = (v: number) => `${v.toFixed(2)}px`;
  return [...arc(0, ARC_STEPS * 2), ...arc(1, ARC_STEPS), ...arc(2, ARC_STEPS)].map(([x, y]) => [px(x), px(y)] as const);
}

const toClip = (pts: Pt[]) => `polygon(${pts.map(([x, y]) => `${x} ${y}`).join(', ')})`;

export const PILL_CLIP = toClip(roundedRect());
export const TRIANGLE_CLIP = toClip(roundedTriangle());
