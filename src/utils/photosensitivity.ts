/**
 * Mesure du risque photosensible d'une animation, d'après le « seuil général de flash » des WCAG 2.3.1 :
 * pas plus de 3 flashs par seconde dès que la zone qui flashe dépasse 25 % d'un champ visuel de 10°
 * (341 x 256 px vus sur un écran de 1024 x 768). Un flash est une paire de variations opposées de la
 * luminance relative d'au moins 0,1, l'état le plus sombre étant sous 0,8.
 *
 * Méthode (simplifiée, prudente) : chaque pixel suit sa luminance et note une transition quand elle s'écarte
 * d'au moins 0,1 de son dernier extrême dans l'autre sens. Une transition d'écran est comptée quand la surface
 * des pixels qui viennent de transiter dans le même sens, cumulée sur 100 ms, franchit le seuil de surface.
 * Les flashs qui se chevauchent en des endroits différents comptent chacun. Utilisé par
 * scripts/check-photosensitivity.cjs ; importé tel quel par Electron, d'où le TypeScript sans syntaxe non effaçable.
 */

const FLASH_LUMINANCE_STEP = 0.1;
const FLASH_DARK_LIMIT = 0.8;
/** Plus de 3 flashs (6 transitions) dans une seconde quelconque : échec. */
const MAX_TRANSITIONS_PER_SECOND = 6;
/** Seuil de surface absolu à l'échelle d'un écran de 1024 x 768 : 25 % de 341 x 256 px. */
const FLASH_AREA_PX_1024 = 0.25 * 341 * 256;
/** Le même seuil en fraction d'un écran entier. */
export const FLASH_AREA_FRACTION = FLASH_AREA_PX_1024 / (1024 * 768);

const LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const linear = (channel: number) => LINEAR[channel] ?? 0;

/** Luminance relative (0 à 1) d'une couleur sRGB 8 bits. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Rouge saturé au sens des WCAG : R / (R + G + B) ≥ 0,8 et (R - G - B) x 320 > 20, en valeurs linéaires. */
export function isSaturatedRed(r: number, g: number, b: number): boolean {
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);
  return R + G + B > 0 && R / (R + G + B) >= 0.8 && (R - G - B) * 320 > 20;
}

/**
 * Fait avancer un pixel à la luminance `l` ; renvoie +1 ou -1 s'il vient d'achever une transition, 0 sinon.
 * `ref` garde le dernier extrême, `dir` le sens de la dernière transition (0 : aucune encore).
 */
export function stepPixel(ref: Float32Array, dir: Int8Array, i: number, l: number): number {
  const r = ref[i] ?? l;
  const d = dir[i] ?? 0;
  if ((d === 1 && l > r) || (d === -1 && l < r)) {
    ref[i] = l; // l'extrême continue de monter (ou de descendre)
    return 0;
  }
  const delta = l - r;
  if (Math.abs(delta) < FLASH_LUMINANCE_STEP || Math.min(l, r) >= FLASH_DARK_LIMIT) return 0;
  const next = delta > 0 ? 1 : -1;
  ref[i] = l;
  dir[i] = next;
  return next;
}

export interface FlashReport {
  frames: number;
  /** Transitions d'écran dans la pire seconde. */
  maxTransitionsPerSecond: number;
  /** Flashs (paires de transitions) dans la pire seconde. */
  maxFlashesPerSecond: number;
  /** Début de la pire seconde (s). */
  worstAt: number;
  /** Plus grande surface de rouge saturé dans une image (px). */
  maxRedArea: number;
  /** Seuil de surface utilisé (px). */
  areaPx: number;
  passes: boolean;
}

/** Plus grand nombre d'événements (indices d'image triés) dans une fenêtre de `span` images. */
export function maxInWindow(events: number[], span: number): { count: number; start: number } {
  let best = { count: 0, start: 0 };
  let lo = 0;
  events.forEach((frame, hi) => {
    while ((events[lo] ?? frame) <= frame - span) lo++;
    if (hi - lo + 1 > best.count) best = { count: hi - lo + 1, start: events[lo] ?? frame };
  });
  return best;
}

/** Compteur de flashs, nourri image par image (RVBA 8 bits, toutes de même taille). */
export class FlashMeter {
  private readonly ref: Float32Array;
  private readonly dir: Int8Array;
  private readonly areaPx: number;
  private readonly fps: number;
  private readonly span: number;
  /** Surfaces des transitions des dernières images (100 ms), par sens ; vidées dès qu'elles comptent. */
  private readonly recent = { up: [] as number[], down: [] as number[] };
  private readonly events: number[] = [];
  /** Sens de la dernière transition d'écran comptée (0 : aucune). */
  private lastSense = 0;
  private frame = 0;
  private maxRed = 0;

  constructor(pixels: number, areaPx: number, fps: number) {
    this.ref = new Float32Array(pixels);
    this.dir = new Int8Array(pixels);
    this.areaPx = areaPx;
    this.fps = fps;
    this.span = Math.max(1, Math.round(fps * 0.1));
  }

  /** Ajoute une image. */
  push(rgba: Uint8Array | Uint8ClampedArray): void {
    const counts = this.frame === 0 ? this.seed(rgba) : this.scan(rgba);
    this.accumulate(this.recent.up, counts.up, 1);
    this.accumulate(this.recent.down, counts.down, -1);
    this.frame++;
  }

  /**
   * Cumule la surface d'un sens sur 100 ms ; au seuil, repart de zéro (un scintillement rapide franchit ainsi le
   * seuil à chaque alternance). Une transition d'écran n'est comptée que si elle change de sens : un flash est une
   * paire de variations opposées, et une montée (ou une extinction) lente, étalée sur plusieurs images, n'en est qu'une.
   */
  private accumulate(history: number[], area: number, sense: number) {
    history.push(area);
    if (history.length > this.span) history.shift();
    if (history.reduce((sum, a) => sum + a, 0) < this.areaPx) return;
    history.length = 0;
    if (sense === this.lastSense) return;
    this.lastSense = sense;
    this.events.push(this.frame);
  }

  private seed(rgba: Uint8Array | Uint8ClampedArray) {
    for (let i = 0; i < this.ref.length; i++) {
      const o = i * 4;
      this.ref[i] = relativeLuminance(rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0);
    }
    this.countRed(rgba);
    return { up: 0, down: 0 };
  }

  private scan(rgba: Uint8Array | Uint8ClampedArray) {
    let up = 0;
    let down = 0;
    for (let i = 0; i < this.ref.length; i++) {
      const o = i * 4;
      const step = stepPixel(this.ref, this.dir, i, relativeLuminance(rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0));
      if (step > 0) up++;
      else if (step < 0) down++;
    }
    this.countRed(rgba);
    return { up, down };
  }

  private countRed(rgba: Uint8Array | Uint8ClampedArray) {
    let red = 0;
    for (let o = 0; o < rgba.length; o += 4) if (isSaturatedRed(rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0)) red++;
    this.maxRed = Math.max(this.maxRed, red);
  }

  /** Bilan sur toutes les images reçues. */
  report(): FlashReport {
    const worst = maxInWindow(this.events, this.fps);
    return {
      frames: this.frame,
      maxTransitionsPerSecond: worst.count,
      maxFlashesPerSecond: worst.count / 2,
      worstAt: worst.start / this.fps,
      maxRedArea: this.maxRed,
      areaPx: this.areaPx,
      passes: worst.count <= MAX_TRANSITIONS_PER_SECOND && this.maxRed < this.areaPx,
    };
  }
}
