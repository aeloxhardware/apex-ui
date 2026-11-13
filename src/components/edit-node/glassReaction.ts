import { useEffect, useRef } from 'react';
import { DEFAULT_GLASS, type GlassParams } from './liquidGlass';

/**
 * Réaction « liquide » d'un verre (GlassPanelBackdrop) au pointeur : le verre est une goutte de liquide magnétique et le
 * pointeur un aimant. Dès que le pointeur approche (à ~90 px), la matière glisse vers lui et s'y accumule : toute la forme
 * se déforme (elle enfle près du pointeur, s'amincit et se rétracte à l'opposé), réfracte davantage, et son bord
 * s'éclaire du côté du pointeur. L'aimant suit le pointeur avec l'inertie d'un liquide visqueux (ressort amorti, sans
 * rebond) ; l'appui écrase la goutte (plus large, plus basse) et le relâchement la laisse reprendre sa forme en
 * tremblant, comme une gelée (ressort sous-amorti).
 */
export interface GlassLive {
  /** Pixels CSS ajoutés à la demi-largeur et à la demi-hauteur du verre (négatif : il se tasse). */
  gw: number;
  gh: number;
  /** Multiplie le déplacement du fond au bord. */
  distortion: number;
  /** Multiplie la largeur de la bande réfractée. */
  warp: number;
  /** 0 : bord sans éclat ; 1 : liseré et reflet pleins. */
  rim: number;
  /** Aimant : position relative au centre du verre (px CSS, y vers le bas), en retard visqueux sur le pointeur. */
  mx: number;
  my: number;
  /** Force de l'aimant : déplacement maximal de la matière, px CSS (0 : forme au repos). */
  pull: number;
  /** Direction des reflets, degrés : suit l'aimant. */
  glareAngle: number;
  /** Compteur incrémenté à chaque pas : réveille le dessin quand aucune scène 3D ne le fait. */
  tick: number;
}

type Channel = 'gw' | 'gh' | 'distortion' | 'warp' | 'rim' | 'mx' | 'my' | 'pull';
export type GlassTarget = Record<Channel, number>;

const CHANNELS: Channel[] = ['gw', 'gh', 'distortion', 'warp', 'rim', 'mx', 'my', 'pull'];
const IDLE: GlassTarget = { gw: 0, gh: 0, distortion: 1, warp: 1, rim: 0, mx: 0, my: 0, pull: 0 };
const HOVER: GlassTarget = { ...IDLE, gw: 2, gh: 2, distortion: 1.3, warp: 1.25, rim: 0.55 };
/** Appui : la goutte s'écrase (elle s'étale en largeur et se tasse en hauteur). */
const PRESS: GlassTarget = { ...IDLE, gw: 7, gh: -1.5, distortion: 1.8, warp: 1.6, rim: 1 };

/** Portée de l'attraction (px CSS, depuis le bord du bouton) : large et progressive, sans seuil visible. */
const RANGE = 90;
/** Force de l'aimant, pointeur sur le bouton (px CSS) ; ×1,5 à l'appui. */
const PULL = 12;
const PRESS_PULL = 1.5;

interface Spring {
  stiffness: number;
  damping: number;
}
/** Liquide très visqueux (ζ ≈ 1, lent) : la matière coule vers sa cible et se pose sans rebond. */
const VISCOUS: Spring = { stiffness: 70, damping: 17 };
/** Gelée (ζ ≈ 0,4) : l'écrasement et le relâchement dépassent leur cible puis tremblent un instant. */
const JELLY: Spring = { stiffness: 320, damping: 14 };
const SPRINGS: Record<Channel, Spring> = {
  gw: JELLY,
  gh: JELLY,
  distortion: VISCOUS,
  warp: VISCOUS,
  rim: VISCOUS,
  mx: VISCOUS,
  my: VISCOUS,
  pull: VISCOUS,
};
const DT = 1 / 60;
const REST = 0.01;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Portée de l'aimant (px CSS) pour un verre de demi-côtés donnés : assez large pour que toute la forme réponde. */
export const glassSigma = (halfW: number, halfH: number) => Math.max(halfW * 0.8, halfH * 1.5);

/** Cible des ressorts pour un pointeur en (px, py) (px CSS, écran) et un bouton de rectangle `r`. */
export function glassTarget(enabled: boolean, pressed: boolean, r: Box, px: number, py: number): GlassTarget {
  if (!enabled) return IDLE;
  const hw = r.width / 2;
  const hh = r.height / 2;
  const qx = px - (r.left + hw);
  const qy = py - (r.top + hh);
  // Distance du pointeur au bouton (0 s'il est dessus) : l'attraction croît en douceur à mesure qu'il approche.
  const d = Math.hypot(qx - clamp(qx, -hw, hw), qy - clamp(qy, -hh, hh));
  const near = smooth(clamp(1 - d / RANGE, 0, 1));
  // L'aimant reste près du bouton même pointeur au loin : il revient par où le pointeur arrive, pas depuis le centre.
  const mx = clamp(qx, -hw - RANGE, hw + RANGE);
  const my = clamp(qy, -hh - RANGE, hh + RANGE);
  if (near <= 0) return { ...IDLE, mx, my };
  const base = pressed ? PRESS : mix(IDLE, HOVER, near);
  return { ...base, mx, my, pull: near * PULL * (pressed ? PRESS_PULL : 1) };
}

function mix(a: GlassTarget, b: GlassTarget, t: number): GlassTarget {
  const out = { ...a };
  for (const k of CHANNELS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Un pas des ressorts ; renvoie vrai tant que la matière bouge. */
function stepSpring(live: GlassLive, vel: GlassTarget, target: GlassTarget): boolean {
  let moving = false;
  for (const k of CHANNELS) {
    const { stiffness, damping } = SPRINGS[k];
    vel[k] += ((target[k] - live[k]) * stiffness - vel[k] * damping) * DT;
    live[k] += vel[k] * DT;
    if (Math.abs(target[k] - live[k]) > REST || Math.abs(vel[k]) > REST) moving = true;
  }
  if (!moving)
    for (const k of CHANNELS) {
      live[k] = target[k];
      vel[k] = 0;
    }
  if (Math.hypot(live.mx, live.my) > 1) live.glareAngle = (Math.atan2(live.my, live.mx) * 180) / Math.PI;
  live.tick++;
  return moving;
}

export const newGlassLive = (): GlassLive => ({ ...IDLE, glareAngle: DEFAULT_GLASS.glareAngle, tick: 0 });

/**
 * Déplacement de la matière au centre du verre (px CSS) : celui que le shader applique en ce point (liquidGlass.ts,
 * `lensSd`), pour que le contenu (icône, texte) flotte avec elle.
 */
export function glassContentShift(live: Pick<GlassLive, 'mx' | 'my' | 'pull'>, sigma: number): { x: number; y: number } {
  const r2 = live.mx * live.mx + live.my * live.my;
  const s2 = sigma * sigma;
  const k = (live.pull * (s2 / (s2 + r2))) / Math.sqrt(r2 + s2);
  return { x: live.mx * k, y: live.my * k };
}

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
    const vel: GlassTarget = { gw: 0, gh: 0, distortion: 0, warp: 0, rim: 0, mx: 0, my: 0, pull: 0 };
    let target = IDLE;
    let raf = 0;
    let pressed = false;
    let px = -1e6;
    let py = -1e6;
    const step = () => {
      raf = stepSpring(live.current, vel, target) ? requestAnimationFrame(step) : 0;
      // Le contenu (icône, texte) flotte avec la matière et suit son écrasement, en variables CSS (cf. .sliceButton).
      const l = live.current;
      const shift = glassContentShift(l, glassSigma(el.offsetWidth / 2, el.offsetHeight / 2));
      el.style.setProperty('--glass-dx', `${shift.x}px`);
      el.style.setProperty('--glass-dy', `${shift.y}px`);
      el.style.setProperty('--glass-grow', `${l.gh}`);
    };
    const refresh = () => {
      target = glassTarget(enabled, pressed, el.getBoundingClientRect(), px, py);
      if (!raf) raf = requestAnimationFrame(step);
    };
    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      refresh();
    };
    const onDown = (e: PointerEvent) => {
      pressed = e.target instanceof Node && el.contains(e.target);
      refresh();
    };
    const onUp = () => {
      pressed = false;
      refresh();
    };
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
