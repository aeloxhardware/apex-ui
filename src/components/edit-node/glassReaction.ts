import { useEffect, useRef } from 'react';
import { DEFAULT_GLASS, type GlassParams } from './liquidGlass';

/**
 * Réaction « liquide » d'un verre (GlassPanelBackdrop) au pointeur : au lieu de teinter un bouton, c'est la matière qui
 * répond, d'ensemble et en douceur. Dès que le pointeur approche (à ~80 px), tout le verre glisse un peu vers lui, gonfle,
 * réfracte davantage et son bord s'éclaire du côté du pointeur, de plus en plus à mesure qu'il s'approche. Appui : le
 * verre s'enfle franchement. Chaque grandeur
 * suit un ressort sous-amorti : la matière dépasse sa cible puis se pose, comme une goutte.
 */
export interface GlassLive {
  /** Pixels CSS ajoutés à chaque demi-côté du verre (il déborde du bouton). */
  grow: number;
  /** Multiplie le déplacement du fond au bord. */
  distortion: number;
  /** Multiplie la largeur de la bande réfractée. */
  warp: number;
  /** 0 : bord sans éclat ; 1 : liseré et reflet pleins. */
  rim: number;
  /** Glissement d'ensemble du verre vers le pointeur, px CSS (le bord côté pointeur avance, l'autre suit à moitié). */
  dx: number;
  dy: number;
  /** Renflement diffus sous le pointeur, partie séparée du verre : centre relatif au centre du bouton (px CSS) et intensité
   * (0 : absent). Il reste toujours sur le bouton. */
  ex: number;
  ey: number;
  es: number;
  /** Direction des reflets, degrés : suit le pointeur. */
  glareAngle: number;
  /** Compteur incrémenté à chaque pas : réveille le dessin quand aucune scène 3D ne le fait. */
  tick: number;
}

type Channel = 'grow' | 'distortion' | 'warp' | 'rim' | 'dx' | 'dy' | 'ex' | 'ey' | 'es';
type Target = Record<Channel, number>;

const CHANNELS: Channel[] = ['grow', 'distortion', 'warp', 'rim', 'dx', 'dy', 'ex', 'ey', 'es'];
const IDLE: Target = { grow: 0, distortion: 1, warp: 1, rim: 0, dx: 0, dy: 0, ex: 0, ey: 0, es: 0 };
const HOVER: Target = { ...IDLE, grow: 2, distortion: 1.3, warp: 1.25, rim: 0.55 };
const PRESS: Target = { ...IDLE, grow: 4, distortion: 2, warp: 1.6, rim: 1 };

/** Portée de l'attraction (px CSS, depuis le bord du bouton) : large et progressive, sans seuil visible. */
const RANGE = 80;
/** Glissement maximal du verre vers le pointeur (px CSS), pointeur au bord du bouton ; ×1,3 à l'appui. */
const LEAN_X = 2;
const LEAN_Y = 1;
const PRESS_LEAN = 1.3;
/** Renflement sous le pointeur : intensité maximale (faible : très subtil). Son rayon est celui du verre (GlassPanelBackdrop). */
const BULGE_STRENGTH = 0.35;

// Ressort sous-amorti (ζ ≈ 0,5) : un seul dépassement, net.
const STIFFNESS = 260;
const DAMPING = 16;
const DT = 1 / 60;
const REST = 0.01;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Cible du ressort pour un pointeur en (px, py) (px CSS, écran) et un bouton de rectangle `r`. */
function targetFor(enabled: boolean, pressed: boolean, r: DOMRect, px: number, py: number): Target {
  if (!enabled) return IDLE;
  const hw = r.width / 2;
  const hh = r.height / 2;
  const qx = px - (r.left + hw);
  const qy = py - (r.top + hh);
  // Point du bouton le plus proche du pointeur, et distance à ce point (0 si le pointeur est dessus).
  const nx = clamp(qx, -hw, hw);
  const ny = clamp(qy, -hh, hh);
  const d = Math.hypot(qx - nx, qy - ny);
  const near = smooth(clamp(1 - d / RANGE, 0, 1));
  if (near <= 0) return IDLE;
  // Toute la matière répond, en douceur : état (repos → survol, fondu selon la proximité) et glissement d'ensemble
  // vers le pointeur, sans forme séparée.
  const base = pressed ? PRESS : mix(IDLE, HOVER, near);
  const lean = near * (pressed ? PRESS_LEAN : 1);
  return {
    ...base,
    dx: clamp(qx / hw, -1, 1) * LEAN_X * lean,
    dy: clamp(qy / hh, -1, 1) * LEAN_Y * lean,
    // Le renflement suit le pointeur mais ne quitte jamais le bouton : il se dilue dans le verre, sans s'allonger.
    ex: clamp(qx, -hw * 0.85, hw * 0.85),
    ey: clamp(qy, -hh * 0.4, hh * 0.4),
    es: near * BULGE_STRENGTH,
  };
}

function mix(a: Target, b: Target, t: number): Target {
  const out = { ...a };
  for (const k of CHANNELS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Un pas du ressort ; renvoie vrai tant que la matière bouge. */
function stepSpring(live: GlassLive, vel: Target, target: Target): boolean {
  let moving = false;
  for (const k of CHANNELS) {
    vel[k] += ((target[k] - live[k]) * STIFFNESS - vel[k] * DAMPING) * DT;
    live[k] += vel[k] * DT;
    if (Math.abs(target[k] - live[k]) > REST || Math.abs(vel[k]) > REST) moving = true;
  }
  if (!moving) for (const k of CHANNELS) { live[k] = target[k]; vel[k] = 0; }
  live.tick++;
  return moving;
}

export const newGlassLive = (): GlassLive => ({ ...IDLE, glareAngle: DEFAULT_GLASS.glareAngle, tick: 0 });

/** Réglages du verre pour l'état vivant : éclat du bord proportionnel à `rim`, reflets tournés vers le pointeur. */
export function reactiveGlassParams(base: GlassParams, live: GlassLive, distortion: number, whiteRim: boolean): GlassParams {
  const distance = base.distance * distortion * live.distortion;
  if (whiteRim) return { ...base, distance };
  return {
    ...base,
    distance,
    fresnelFactor: base.fresnelFactor * live.rim,
    glareFactor: base.glareFactor * live.rim,
    glareAngle: live.glareAngle,
    edgeShade: 1 - live.rim * 0.5,
  };
}

/**
 * Rend vivant le verre posé sous `ref` : renvoie l'état que GlassPanelBackdrop lit à chaque image (`live`). Le pointeur
 * est suivi sur toute la fenêtre (l'attraction agit avant même le survol). Hors `enabled`, le verre reste au repos.
 */
export function useGlassReaction(ref: React.RefObject<HTMLElement | null>, enabled: boolean): React.RefObject<GlassLive> {
  const live = useRef<GlassLive>(newGlassLive());

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const vel: Target = { grow: 0, distortion: 0, warp: 0, rim: 0, dx: 0, dy: 0, ex: 0, ey: 0, es: 0 };
    let target = IDLE;
    let raf = 0;
    let pressed = false;
    let px = -1e6;
    let py = -1e6;
    const step = () => {
      raf = stepSpring(live.current, vel, target) ? requestAnimationFrame(step) : 0;
      // Le contenu (icône, texte) suit la matière : mêmes valeurs, en variables CSS (cf. .sliceButton).
      const l = live.current;
      el.style.setProperty('--glass-dx', `${l.dx}px`);
      el.style.setProperty('--glass-dy', `${l.dy}px`);
      el.style.setProperty('--glass-grow', `${l.grow}`);
    };
    const refresh = () => {
      target = targetFor(enabled, pressed, el.getBoundingClientRect(), px, py);
      if (!raf) raf = requestAnimationFrame(step);
    };
    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      const r = el.getBoundingClientRect();
      live.current.glareAngle = (Math.atan2(py - (r.top + r.height / 2), px - (r.left + r.width / 2)) * 180) / Math.PI;
      refresh();
    };
    const onDown = (e: PointerEvent) => { pressed = e.target instanceof Node && el.contains(e.target); refresh(); };
    const onUp = () => { pressed = false; refresh(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    refresh();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [ref, enabled]);

  return live;
}
