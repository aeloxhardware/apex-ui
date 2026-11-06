/**
 * Géométrie des morphings "verre liquide" (cf. LiquidGlassMorph) : chaque fonction renvoie, pour
 * un instant t ∈ [0, 1], le contour SVG de la forme à cet instant, utilisé comme `clip-path:
 * path(...)` d'un unique élément en `backdrop-filter`. Le flou reste donc un vrai flou CSS du fond
 * pendant toute l'animation — contrairement à un filtre SVG "goo", dont le recontraste alpha
 * rend la forme opaque et remplace le flou par un aplat.
 *
 * Toutes les formes sont des contours UNIQUES et sans chevauchement (jamais deux sous-chemins
 * superposés), pour que la même chaîne serve aussi bien en `nonzero` qu'en `evenodd` (l'ombre
 * portée de LiquidGlassMorph découpe l'extérieur de la forme en `evenodd`).
 */

export interface GlassRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round = (v: number) => Math.round(v * 100) / 100;

const ease = {
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
};

/** Chemin SVG décalé de (dx, dy) — l'ombre portée réutilise la même forme dans un repère élargi. */
class PathBuilder {
  private parts: string[] = [];
  private dx: number;
  private dy: number;

  constructor(dx: number, dy: number) {
    this.dx = dx;
    this.dy = dy;
  }

  private p(x: number, y: number) {
    return `${round(x + this.dx)} ${round(y + this.dy)}`;
  }

  M(x: number, y: number) { this.parts.push(`M${this.p(x, y)}`); }
  L(x: number, y: number) { this.parts.push(`L${this.p(x, y)}`); }
  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    this.parts.push(`C${this.p(x1, y1)} ${this.p(x2, y2)} ${this.p(x, y)}`);
  }
  /** Arc toujours dans le sens horaire à l'écran (sweep 1) ; rayon nul = segment droit (spec SVG). */
  A(rx: number, ry: number, x: number, y: number) {
    this.parts.push(`A${round(Math.max(0, rx))} ${round(Math.max(0, ry))} 0 0 1 ${this.p(x, y)}`);
  }
  Z() { this.parts.push('Z'); }
  toString() { return this.parts.join(''); }
}

const cornerRadius = (r: GlassRect) => Math.max(0, Math.min(r.r, r.w / 2, r.h / 2));

/** Renflement elliptique centré en `cx`, posé sur un bord horizontal (moignon après rupture). */
interface Bump {
  cx: number;
  rx: number;
  ry: number;
}

const bumpVisible = (b?: Bump): b is Bump => !!b && b.rx > 0.3 && b.ry > 0.3;

/** Rectangle arrondi, sens horaire, avec renflement optionnel vers le haut / vers le bas. */
function rectContour(b: PathBuilder, R: GlassRect, top?: Bump, bottom?: Bump) {
  const r = cornerRadius(R);
  const { x, y, w, h } = R;
  b.M(x + r, y);
  if (bumpVisible(top)) {
    b.L(top.cx - top.rx, y);
    b.A(top.rx, top.ry, top.cx + top.rx, y); // horaire de gauche à droite : bombé vers le haut
  }
  b.L(x + w - r, y);
  b.A(r, r, x + w, y + r);
  b.L(x + w, y + h - r);
  b.A(r, r, x + w - r, y + h);
  if (bumpVisible(bottom)) {
    b.L(bottom.cx + bottom.rx, y + h);
    b.A(bottom.rx, bottom.ry, bottom.cx - bottom.rx, y + h); // horaire de droite à gauche : bombé vers le bas
  }
  b.L(x + r, y + h);
  b.A(r, r, x, y + h - r);
  b.L(x, y + r);
  b.A(r, r, x + r, y);
  b.Z();
}

/**
 * Deux rectangles (A au-dessus, B en dessous) reliés par un col : un seul contour fermé. Le col
 * part des bords horizontaux avec des congés tangents (a = demi-largeur au raccord), se resserre
 * jusqu'à m au milieu de l'intervalle, puis s'évase à nouveau vers B — la silhouette d'une cellule
 * en fin de division.
 */
function neckContour(b: PathBuilder, A: GlassRect, B: GlassRect, cx: number, a: number, m: number) {
  const rA = cornerRadius(A);
  const rB = cornerRadius(B);
  const yTop = A.y + A.h;
  const yBot = B.y;
  const yMid = (yTop + yBot) / 2;
  const gh = yMid - yTop;
  const k = (a - m) * 0.6;

  b.M(A.x + rA, A.y);
  b.L(A.x + A.w - rA, A.y);
  b.A(rA, rA, A.x + A.w, A.y + rA);
  b.L(A.x + A.w, yTop - rA);
  b.A(rA, rA, A.x + A.w - rA, yTop);
  b.L(cx + a, yTop);
  b.C(cx + a - k, yTop, cx + m, yTop + gh * 0.45, cx + m, yMid);
  b.C(cx + m, yMid + gh * 0.55, cx + a - k, yBot, cx + a, yBot);
  b.L(B.x + B.w - rB, yBot);
  b.A(rB, rB, B.x + B.w, yBot + rB);
  b.L(B.x + B.w, yBot + B.h - rB);
  b.A(rB, rB, B.x + B.w - rB, yBot + B.h);
  b.L(B.x + rB, yBot + B.h);
  b.A(rB, rB, B.x, yBot + B.h - rB);
  b.L(B.x, yBot + rB);
  b.A(rB, rB, B.x + rB, yBot);
  b.L(cx - a, yBot);
  b.C(cx - a + k, yBot, cx - m, yMid + gh * 0.55, cx - m, yMid);
  b.C(cx - m, yTop + gh * 0.45, cx - a + k, yTop, cx - a, yTop);
  b.L(A.x + rA, yTop);
  b.A(rA, rA, A.x, yTop - rA);
  b.L(A.x, A.y + rA);
  b.A(rA, rA, A.x + rA, A.y);
  b.Z();
}

/** Simple rectangle arrondi (état figé d'un morphing). */
export function rectPath(R: GlassRect, dx = 0, dy = 0) {
  const b = new PathBuilder(dx, dy);
  rectContour(b, R);
  return b.toString();
}

/**
 * Étirement d'un rectangle vers un autre (la pilule qui devient panneau). La hauteur dépasse
 * légèrement sa cible avant de s'y poser (outBack), comme une matière qui s'écoule puis se fige ;
 * la largeur suit avec un temps de retard.
 */
export function stretchPath(from: GlassRect, to: GlassRect, t: number, dx = 0, dy = 0) {
  const e = ease.inOutCubic(clamp01(t));
  const eh = ease.outBack(clamp01(t), 1.2);
  const ew = ease.inOutCubic(clamp01((t - 0.12) / 0.88));
  return rectPath(
    {
      x: lerp(from.x, to.x, e),
      y: lerp(from.y, to.y, e),
      w: lerp(from.w, to.w, ew),
      h: lerp(from.h, to.h, eh),
      r: lerp(from.r, to.r, e),
    },
    dx,
    dy,
  );
}

// Jalons de la division, en fraction de sa durée.
const NECK_START = 0.12; // B a commencé à sortir de A, le col commence à se creuser
const SPLIT = 0.7;       // le col, réduit à un fil, se rompt

/**
 * Division : A reste en place, B naît de son bord inférieur (d'abord collé, en croissant), le
 * sillon se creuse, le col s'amincit jusqu'à se rompre, puis B se pose à sa place finale avec un
 * léger rebond tandis que les deux moignons se résorbent. t = 0 : A seul ; t = 1 : A et B finaux.
 * Joué à l'envers (t de 1 à 0), c'est une fusion : B remonte se refondre dans A.
 */
export function mitosisPath(A: GlassRect, Bfinal: GlassRect, t: number, dx = 0, dy = 0) {
  const b = new PathBuilder(dx, dy);
  const yTop = A.y + A.h;
  const gapFinal = Bfinal.y - yTop;
  const gMax = Math.max(gapFinal + 26, 34);

  // Col centré sur la partie commune des deux bords horizontaux, sans jamais empiéter sur les coins.
  const cx = (Math.max(A.x, Bfinal.x) + Math.min(A.x + A.w, Bfinal.x + Bfinal.w)) / 2;
  const straight0 = Math.max(A.x + cornerRadius(A), Bfinal.x + cornerRadius(Bfinal));
  const straight1 = Math.min(A.x + A.w - cornerRadius(A), Bfinal.x + Bfinal.w - cornerRadius(Bfinal));
  const aMax = Math.max(0, Math.min(cx - straight0, straight1 - cx));
  const aSplit = aMax * 0.32;

  const h = Bfinal.h * ease.outCubic(clamp01(t / 0.55));

  if (t < SPLIT) {
    const p = clamp01((t - NECK_START) / (SPLIT - NECK_START));
    const g = gMax * ease.inOutSine(p);
    const a = lerp(aMax, aSplit, ease.inOutSine(p));
    const m = a * (1 - Math.pow(p, 1.6));
    neckContour(b, A, { x: Bfinal.x, y: yTop + g, w: Bfinal.w, h, r: Bfinal.r }, cx, a, m);
  } else {
    const q = clamp01((t - SPLIT) / (1 - SPLIT));
    const g = lerp(gMax, gapFinal, ease.outBack(q, 2.2));
    const nub = 1 - ease.outCubic(clamp01(q / 0.45));
    const bump = { cx, rx: aSplit * 0.75, ry: (gMax / 2) * 0.7 * nub };
    rectContour(b, A, undefined, bump);
    rectContour(b, { x: Bfinal.x, y: yTop + g, w: Bfinal.w, h: Bfinal.h, r: Bfinal.r }, bump);
  }
  return b.toString();
}

