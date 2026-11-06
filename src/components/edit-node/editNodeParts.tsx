import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { GLASS_LENS_ATTR, GLASS_PULL_ATTR, MAX_PULLS } from "./liquidGlass";
import styles from "./EditNode.module.scss";
import { NODE_TIPS, bottomTip, type BottomTip } from "./bottomTooltip";
import type { HandleDragMode, HandleDragEvent } from './editNodeTypes';

const dragModeOf = (e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): HandleDragMode =>
  e.ctrlKey || e.metaKey ? "rotate" : e.altKey ? "influence" : "both";

export const CORE_PX = 12;
export const BUBBLE_PX = 46; // 76 × 0,6 (76 = 168 / 2,2)
const BUBBLE_R = BUBBLE_PX / 2;

// Séquence d'ouverture : la bulle gonfle (ressort peu amorti), puis les poignées sortent du noyau
// l'une après l'autre, puis le « + » se divise du noyau. Fermeture dans l'ordre inverse.
export const OPEN_SPRING = { type: "spring", stiffness: 320, damping: 17, mass: 0.9 } as const;
const HANDLE_OUT_SPRING = { type: "spring", stiffness: 260, damping: 16 } as const;
const HANDLE_IN_SPRING = { type: "spring", stiffness: 300, damping: 26 } as const;
const HANDLE_OUT_DELAY_S = 0.14;
const HANDLE_STAGGER_S = 0.07;
export const DIVIDE_SPRING = { type: "spring", stiffness: 120, damping: 15, mass: 1 } as const;
// Fusion inverse : assez lente pour que le col de verre se reforme, sans dépasser (pas de rebond
// du « + » au-delà du centre).
export const MERGE_BACK_SPRING = { type: "spring", stiffness: 170, damping: 26 } as const;
export const DIVIDE_DELAY_S = 0.3;
// Fermeture : le « + » fusionne, puis les poignées rentrent (dernière sortie, première rentrée),
// puis la bulle dégonfle.
const HANDLE_IN_DELAY_S = 0.32;
const DEFLATE_AFTER_HANDLES_S = 0.1;
export const closeDelayFor = (count: number) =>
  HANDLE_IN_DELAY_S + Math.max(0, count - 1) * HANDLE_STAGGER_S + DEFLATE_AFTER_HANDLES_S;

// Point plein (cyan, orange si rognage) <-> verre : l'opacité de la couleur suit la taille de la
// bulle, donc le point ne se colore qu'en fin de dégonflement (et se vide dès le début du
// gonflement). Ouvert, l'ombre portée est dessinée par le shader du verre.
const CYAN = [0, 240, 255];
const ORANGE = [255, 159, 28];
export const TINT_FADE_S = 0.2;
export const solidity = (o: number) => clamp01(1 - Math.max(0, o) * 2.5);
export const tintRgb = (t: number) => CYAN.map((c, i) => Math.round(c + (ORANGE[i] - c) * t)).join(", ");

// Chargement : durée d'un tour des reflets, et freinage jusqu'au repos.
export const SPIN_TURN_S = 1.1;
export const SPIN_STOP_SPRING = { type: "spring", stiffness: 40, damping: 12 } as const;

// Trois courbes empilées (trajectoires adjacentes) : repère visuel du nœud au repos.
export const StackedCurvesIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" className={styles.icon}>
    <path
      d="M3 8 Q8 3, 13 8 T21 8"
      stroke="rgba(255,255,255,0.9)"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M3 13 Q8 8, 13 13 T21 13"
      stroke="rgba(255,159,28,0.95)"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path
      d="M3 18 Q8 13, 13 18 T21 18"
      stroke="rgba(255,159,28,0.95)"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

// Rognage activé : une seule courbe (la trajectoire) passant par-dessus des paliers plats
// (les trajectoires rognées), en orange.
export const TrimmingIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" className={styles.icon}>
    <path
      d="M4 8.5 C5.5 11.5, 6.5 13, 8 13 C11 13, 12.5 7, 16 7 C19 7, 20.5 9, 21 11.5"
      stroke="rgba(255,255,255,0.95)"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <g stroke="rgba(255,159,28,0.95)" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3 13 H4.5" />
      <path d="M14.5 10 H18.5" />
      <path d="M12 13 H19.5" />
      <path d="M3 16 H21" />
    </g>
  </svg>
);

// Poignée glissée dans le nœud : la relâcher la supprime.
export const DeleteIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" className={styles.icon}>
    <path
      d="M7 7 L17 17 M17 7 L7 17"
      stroke="rgba(255, 70, 70, 1)"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);

// Poignées (style éditeur de Bézier), distances depuis le centre du nœud, en px.
const HANDLE_REST_PX = BUBBLE_R + 20;
const HANDLE_MIN_PX = 1;
// Bouton relâché à moins de cette distance du centre : la poignée est supprimée.
const DELETE_RADIUS_PX = BUBBLE_R - 3;
// Angles initiaux (repère mathématique) : diagonale bas-gauche -> haut-droite.
export const INITIAL_ANGLES = [Math.PI / 4, (5 * Math.PI) / 4];
// Tractions du noyau réservées : mitose des deux gouttelettes (« + » et cadenas), inertie du
// glissement (arrière et avant).
export const MAX_HANDLES = MAX_PULLS - 4;

// Glissement du nœud : seuil avant qu'un appui devienne un déplacement, et inertie du verre.
export const DRAG_THRESHOLD_PX = 3;
export const MOVE_STRETCH_PER_PXS = 0.00035;
export const MOVE_STRETCH_MAX = 0.3;
export const MOVE_LEAD_FLATTEN = 0.35;

// Gouttelettes de verre qui se divisent du nœud : « + » dessous, cadenas dessus.
const ADD_SIZE_PX = 18;
const ADD_DISTANCE_PX = BUBBLE_R + 17;
export const ADD_ANGLE = (3 * Math.PI) / 2;
export const LOCK_ANGLE = Math.PI / 2;
// Portée de fusion du « + » avec le noyau : large pendant la division (col de verre), puis
// inférieure à l'écart final entre les deux (7 px) pour qu'ils se séparent nettement.
const ADD_MERGE_START_PX = 26;
const ADD_MERGE_END_PX = 5;
// Allongement du noyau vers la gouttelette au milieu de la division.
const MITOSIS_STRETCH = 0.3;

export const TAU = 2 * Math.PI;
const wrapAngle = (a: number) => ((a % TAU) + TAU) % TAU;

// Milieu du plus grand secteur libre entre les angles occupés (poignées et bouton « + »).
export function freeAngle(taken: number[]): number {
  const sorted = taken.map(wrapAngle).sort((a, b) => a - b);
  let best = 0, bestGap = -1;
  sorted.forEach((a, i) => {
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + TAU;
    if (next - a > bestGap) {
      bestGap = next - a;
      best = a + (next - a) / 2;
    }
  });
  return wrapAngle(best);
}

// Allongement du verre vers une poignée : croît avec la tension (poignée tirée au-delà du repos),
// sature en douceur ; une poignée rapprochée creuse légèrement le bord.
const STRETCH_MAX = 0.22;
const DENT_MAX = 0.08;
const stretchFor = (length: number) => {
  const u = (length - HANDLE_REST_PX) / 45;
  return u >= 0 ? STRETCH_MAX * Math.tanh(u) : DENT_MAX * Math.tanh(u);
};
// Secousse due à la vitesse du glissement (px/s -> allongement), et ressort « gelée » du verre.
const SPEED_KICK = 0.00004;
const KICK_MAX = 0.1;
export const JELLY_SPRING = { stiffness: 280, damping: 9, mass: 0.6 };
// Prise d'une poignée : impulsion brève vers elle, puis légère tension tant qu'elle est tenue.
const GRAB_PULSE = 0.14;
const GRAB_TENSION = 0.05;
const GRAB_PULSE_MS = 90;
// Double-clic sur une poignée : retour à sa position initiale.
const RESET_SPRING = { type: "spring", stiffness: 260, damping: 20 } as const;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export type HandleRegistry = Map<
  number,
  { hx: MotionValue<number>; hy: MotionValue<number>; locked: () => boolean }
>;

export interface HandleProps {
  id: number;
  angle: number;
  /** Ajoutée par « + » : sort du bord du verre au lieu d'apparaître en place. */
  spawn: boolean;
  /** Rang d'apparition (décale la sortie de chaque poignée, et la rentrée en sens inverse). */
  index: number;
  count: number;
  /** Gonflement de la bulle (bord du verre, d'où part le bras). */
  open: MotionValue<number>;
  active: boolean;
  /** Position du nœud : une poignée verrouillée garde sa position absolue quand il bouge. */
  nodeX: number;
  nodeY: number;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  registry: React.MutableRefObject<HandleRegistry>;
  /** La poignée entre / sort de la zone de suppression (centre du nœud). */
  onDoomedChange: (id: number, doomed: boolean) => void;
  onRemove: (id: number) => void;
  /** Position imposée par l'application (px, relative au nœud), hors glissement en cours. */
  offset?: { dx: number; dy: number } | undefined;
  /** Position, longueur ou verrouillage changés par l'utilisateur. */
  onChanged: () => void;
  onDrag?: ((e: HandleDragEvent) => void) | undefined;
  /** Poignée sélectionnée (la dernière saisie) : anneau blanc. */
  selected?: boolean;
  onSelect?: ((id: number) => void) | undefined;
  /** Mode Auto : longueur fixée à HANDLE_REST_PX, seule l'orientation se règle ; violette, sans verrouillage. */
  fixed?: boolean;
}

type Num = MotionValue<number>;
type Flag = React.MutableRefObject<boolean>;
type DragState = React.MutableRefObject<{ x: number; y: number; t: number } | null>;
type Timer = React.MutableRefObject<number | undefined>;

/**
 * Sortie du noyau : chaque poignée part du centre, après le gonflement, l'une après l'autre ;
 * à la fermeture, elles rentrent avant que la bulle ne dégonfle.
 */
function useHandleReveal(active: boolean, index: number, count: number): Num {
  const reveal = useMotionValue(active ? 1 : 0);
  useEffect(() => {
    const controls = active
      ? animate(reveal, 1, { ...HANDLE_OUT_SPRING, delay: HANDLE_OUT_DELAY_S + index * HANDLE_STAGGER_S })
      : animate(reveal, 0, {
          ...HANDLE_IN_SPRING,
          delay: HANDLE_IN_DELAY_S + (count - 1 - index) * HANDLE_STAGGER_S,
        });
    return () => controls.stop();
    // `count` / `index` ne relancent pas l'animation : seule la bascule ouverture / fermeture compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [active, reveal]);
  return reveal;
}

/** Naissance : la poignée sort du bord en tirant brièvement le verre avec elle. */
function useHandleSpawn(c: { spawn: boolean; angle: number; hx: Num; hy: Num; target: Num; animating: Flag; onChanged: () => void }) {
  const { spawn, angle, hx, hy, target, animating, onChanged } = c;
  useEffect(() => {
    if (!spawn) return;
    animating.current = true;
    const a = animate(hx, Math.cos(angle) * HANDLE_REST_PX, RESET_SPRING);
    const b = animate(hy, -Math.sin(angle) * HANDLE_REST_PX, RESET_SPRING);
    let live = true;
    void Promise.all([a, b]).then(() => {
      animating.current = false;
      if (live) onChanged();
    });
    target.set(GRAB_PULSE);
    const t = window.setTimeout(() => target.set(0), GRAB_PULSE_MS * 2);
    return () => {
      live = false;
      a.stop();
      b.stop();
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [spawn, angle, hx, hy, target]);
}

/**
 * Bascule du mode : la poignée rentre à son écartement par défaut (Auto) ou reprend sa longueur
 * tenue par l'application (Portée), en ressort.
 */
function useHandleFixedSwitch(c: {
  fixed: boolean; hx: Num; hy: Num; target: Num; animating: Flag;
  offset?: { dx: number; dy: number } | undefined; atRest: (x: number, y: number) => { x: number; y: number };
}) {
  const { fixed, hx, hy, target, animating, offset, atRest } = c;
  const firstFixed = useRef(true);
  useEffect(() => {
    if (firstFixed.current) {
      firstFixed.current = false;
      return;
    }
    const p = fixed
      ? atRest(hx.get(), hy.get())
      : offset ? { x: offset.dx, y: offset.dy } : { x: hx.get(), y: hy.get() };
    animating.current = true;
    const a = animate(hx, p.x, RESET_SPRING);
    const b = animate(hy, p.y, RESET_SPRING);
    let live = true;
    void Promise.all([a, b]).then(() => {
      animating.current = false;
      if (live) target.set(stretchFor(Math.hypot(hx.get(), hy.get())));
    });
    return () => {
      live = false;
      a.stop();
      b.stop();
      animating.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [fixed]);
}

/** Bras : du bord (étiré) du verre jusqu'au bouton ; le bouton sort du centre avec `reveal`. */
function useArmGeometry(hx: Num, hy: Num, open: Num, stretch: Num, reveal: Num) {
  const geometry = (values: unknown[]) => {
    const [x, y, o, s, r] = values as number[];
    const length = Math.hypot(x, y) || 1;
    const knob = length * Math.max(0, r);
    const start = Math.min(BUBBLE_R * Math.max(0, o) * (1 + s) + 2, knob);
    return { ux: x / length, uy: y / length, knob, start };
  };
  const inputs = [hx, hy, open, stretch, reveal];
  const x1 = useTransform(inputs, (v) => { const g = geometry(v); return g.ux * g.start; });
  const y1 = useTransform(inputs, (v) => { const g = geometry(v); return g.uy * g.start; });
  const x2 = useTransform(inputs, (v) => { const g = geometry(v); return g.ux * g.knob; });
  const y2 = useTransform(inputs, (v) => { const g = geometry(v); return g.uy * g.knob; });
  // Le bouton s'efface juste avant d'atteindre le centre (pas de point sombre résiduel).
  const opacity = useTransform(reveal, (r) => clamp01((r - 0.1) * 4));
  return { x1, y1, x2, y2, opacity };
}

/** Traction lue par le rendu du verre. */
function useGlassPull(knobRef: React.RefObject<SVGCircleElement | null>, hx: Num, hy: Num, stretch: Num, reveal: Num) {
  useEffect(() => {
    const write = () => {
      const el = knobRef.current;
      if (!el) return;
      const x = hx.get(), y = hy.get();
      const length = Math.hypot(x, y) || 1;
      el.setAttribute(GLASS_PULL_ATTR, `${x / length},${y / length},${stretch.get() * clamp01(reveal.get())}`);
    };
    write();
    const offs = [hx, hy, stretch, reveal].map((mv) => mv.on("change", write));
    return () => offs.forEach((off) => off());
  }, [knobRef, hx, hy, stretch, reveal]);
}

/**
 * Verrouillage (clic simple, orange) : la poignée garde sa position absolue ; quand le nœud
 * bouge, son bras s'allonge ou se raccourcit, et le verre suit la nouvelle tension.
 */
function useHandleLock(c: {
  lockedRef: Flag; hx: Num; hy: Num; target: Num; drag: DragState;
  offset?: { dx: number; dy: number } | undefined; nodeX: number; nodeY: number;
  onChanged: () => void; currentStretch: () => number;
}) {
  const { lockedRef, hx, hy, target, drag, offset, nodeX, nodeY, onChanged, currentStretch } = c;
  const [locked, setLocked] = useState(false);
  const lockPoint = useRef<{ x: number; y: number } | null>(null);
  const nodePos = useRef({ x: nodeX, y: nodeY });
  nodePos.current = { x: nodeX, y: nodeY };
  const relockAt = (rx: number, ry: number) => {
    if (lockPoint.current) lockPoint.current = { x: nodePos.current.x + rx, y: nodePos.current.y + ry };
  };
  useLayoutEffect(() => {
    const p = lockPoint.current;
    // Dans l'application, l'ancrage est tenu en 3D par l'appelant (`offset`).
    if (!p || offset) return;
    hx.set(p.x - nodeX);
    hy.set(p.y - nodeY);
    if (!drag.current) target.set(currentStretch());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [nodeX, nodeY]);
  const toggleLock = () => {
    lockPoint.current = lockPoint.current
      ? null
      : { x: nodePos.current.x + hx.get(), y: nodePos.current.y + hy.get() };
    lockedRef.current = lockPoint.current !== null;
    setLocked(lockedRef.current);
    onChanged();
  };
  return { locked, relockAt, toggleLock };
}

/** Tout ce dont les gestes du bouton d'une poignée ont besoin (refs, valeurs animées, rappels). */
interface KnobCtx {
  id: number;
  angle: number;
  fixed: boolean;
  offset?: { dx: number; dy: number } | undefined;
  fixedRef: Flag;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  hx: Num;
  hy: Num;
  target: Num;
  drag: DragState;
  idleTimer: Timer;
  clickTimer: Timer;
  animating: Flag;
  pressStart: React.MutableRefObject<{ x: number; y: number }>;
  suppressClick: Flag;
  lockedRef: Flag;
  doomedRef: Flag;
  setDoomedState: (value: boolean) => void;
  relockAt: (rx: number, ry: number) => void;
  toggleLock: () => void;
  currentStretch: () => number;
  onDrag?: ((e: HandleDragEvent) => void) | undefined;
  onSelect?: ((id: number) => void) | undefined;
  onRemove: (id: number) => void;
  onChanged: () => void;
}

/** Glissement du bouton : suit le pointeur, calcule la secousse du verre et l'entrée dans la zone de suppression. */
function makeKnobMove(k: KnobCtx) {
  return (e: React.PointerEvent) => {
    const anchor = k.anchorRef.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const x = e.clientX - a.left, y = e.clientY - a.top;
    const length = Math.hypot(x, y) || 1;
    // Aucune longueur maximale : la poignée suit le pointeur aussi loin qu'il va. Mode Auto :
    // écartement par défaut, seule l'orientation suit le pointeur.
    const scale = (k.fixedRef.current ? HANDLE_REST_PX : Math.max(HANDLE_MIN_PX, length)) / length;
    k.hx.set(x * scale);
    k.hy.set(y * scale);
    k.relockAt(x * scale, y * scale);
    // Avant onChanged : l'application doit connaître le mode avant la nouvelle position.
    k.onDrag?.({ id: k.id, phase: "move", mode: dragModeOf(e), dx: x * scale, dy: y * scale, locked: k.lockedRef.current });

    const now = performance.now();
    const prev = k.drag.current;
    let kick = 0;
    if (prev && now > prev.t) {
      const speed = Math.hypot(e.clientX - prev.x, e.clientY - prev.y) / ((now - prev.t) / 1000);
      kick = Math.min(KICK_MAX, speed * SPEED_KICK);
    }
    k.drag.current = { x: e.clientX, y: e.clientY, t: now };
    // Dans le nœud : la poignée ne tire plus sur le verre, elle attend d'être supprimée.
    const inside = length * scale < DELETE_RADIUS_PX;
    k.setDoomedState(inside);
    window.clearTimeout(k.idleTimer.current);
    if (inside) {
      k.target.set(0);
      return;
    }
    k.target.set(stretchFor(length * scale) + GRAB_TENSION + kick);
    k.onChanged();
    // Poignée tenue immobile : plus de pointermove, la secousse doit retomber quand même.
    k.idleTimer.current = window.setTimeout(
      () => k.target.set(stretchFor(length * scale) + GRAB_TENSION),
      60,
    );
  };
}

/** Clic (verrouillage), double-clic (retour au repos) et glissement du bouton d'une poignée. */
function makeKnobHandlers(k: KnobCtx) {
  const moveTo = makeKnobMove(k);
  return {
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      // Fin d'un glissement, ou second clic d'un double-clic : pas de bascule.
      if (k.suppressClick.current) {
        k.suppressClick.current = false;
        return;
      }
      if (e.detail > 1 || k.fixed) return;
      window.clearTimeout(k.clickTimer.current);
      k.clickTimer.current = window.setTimeout(k.toggleLock, DOUBLE_CLICK_MS);
    },
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      window.clearTimeout(k.clickTimer.current);
      window.clearTimeout(k.idleTimer.current);
      const rx = Math.cos(k.angle) * HANDLE_REST_PX, ry = -Math.sin(k.angle) * HANDLE_REST_PX;
      k.animating.current = true;
      void Promise.all([animate(k.hx, rx, RESET_SPRING), animate(k.hy, ry, RESET_SPRING)]).then(() => {
        k.animating.current = false;
        k.onChanged();
      });
      k.relockAt(rx, ry);
      k.target.set(stretchFor(HANDLE_REST_PX));
    },
    onPointerDown: (e: React.PointerEvent<SVGCircleElement>) => {
      e.stopPropagation();
      // Alt maintenu : pas de menu de la fenêtre ni de comportement natif.
      if (e.altKey) e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      k.pressStart.current = { x: e.clientX, y: e.clientY };
      k.drag.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      k.onSelect?.(k.id);
      k.onDrag?.({ id: k.id, phase: "start", mode: dragModeOf(e), dx: k.hx.get(), dy: k.hy.get(), locked: k.lockedRef.current });
      k.target.set(k.currentStretch() + GRAB_PULSE);
      window.clearTimeout(k.idleTimer.current);
      k.idleTimer.current = window.setTimeout(
        () => k.target.set(k.currentStretch() + GRAB_TENSION),
        GRAB_PULSE_MS,
      );
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (k.drag.current) moveTo(e);
    },
    onPointerUp: (e: React.PointerEvent<SVGCircleElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      k.drag.current = null;
      k.suppressClick.current =
        Math.hypot(e.clientX - k.pressStart.current.x, e.clientY - k.pressStart.current.y) >=
        DRAG_THRESHOLD_PX;
      window.clearTimeout(k.idleTimer.current);
      k.onDrag?.({ id: k.id, phase: "end", mode: dragModeOf(e), dx: k.hx.get(), dy: k.hy.get(), locked: k.lockedRef.current });
      if (k.doomedRef.current) {
        k.setDoomedState(false);
        k.onRemove(k.id);
        return;
      }
      // Position tenue par l'application (rotation seule : l'influence n'a pas bougé, la
      // poignée revient à sa place en ressort).
      if (k.offset) {
        void Promise.all([animate(k.hx, k.offset.dx, RESET_SPRING), animate(k.hy, k.offset.dy, RESET_SPRING)]);
      }
      // Relâchée, la vitesse retombe : le verre revient vers sa tension en oscillant.
      k.target.set(k.currentStretch());
    },
  };
}

export const Handle: React.FC<HandleProps> = ({
  id,
  angle,
  spawn,
  index,
  count,
  open,
  active,
  nodeX,
  nodeY,
  anchorRef,
  registry,
  onDoomedChange,
  onRemove,
  offset,
  onChanged,
  onDrag,
  selected = false,
  onSelect,
  fixed = false,
}) => {
  const fixedRef = useRef(fixed);
  fixedRef.current = fixed;
  /** Mode Auto : même direction, écartement par défaut. */
  const atRest = (x: number, y: number) => {
    const length = Math.hypot(x, y);
    return length > 1e-6 ? { x: (x / length) * HANDLE_REST_PX, y: (y / length) * HANDLE_REST_PX } : { x, y };
  };
  const startLength = spawn ? HANDLE_MIN_PX : HANDLE_REST_PX;
  const lockedRef = useRef(false);
  const animating = useRef(false);

  const reveal = useHandleReveal(active, index, count);
  const hx = useMotionValue(Math.cos(angle) * startLength);
  const hy = useMotionValue(-Math.sin(angle) * startLength);
  const [doomed, setDoomed] = useState(false);
  const doomedRef = useRef(false);

  useEffect(() => {
    const reg = registry.current;
    reg.set(id, { hx, hy, locked: () => lockedRef.current });
    return () => {
      reg.delete(id);
    };
  }, [id, hx, hy, registry]);

  const target = useMotionValue(0);
  const stretch = useSpring(target, JELLY_SPRING);
  const knobRef = useRef<SVGCircleElement>(null);
  const drag: DragState = useRef(null);
  const idleTimer: Timer = useRef(undefined);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  useHandleSpawn({ spawn, angle, hx, hy, target, animating, onChanged });

  // Position imposée par l'application (la poignée vit en 3D : la caméra ou le nœud qui bouge la
  // font glisser à l'écran), sauf pendant que l'utilisateur la tient ou qu'elle s'anime.
  useLayoutEffect(() => {
    if (!offset || drag.current || animating.current) return;
    const p = fixedRef.current ? atRest(offset.dx, offset.dy) : { x: offset.dx, y: offset.dy };
    hx.set(p.x);
    hy.set(p.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [offset?.dx, offset?.dy]);

  useHandleFixedSwitch({ fixed, hx, hy, target, animating, offset, atRest });

  const setDoomedState = (value: boolean) => {
    if (doomedRef.current === value) return;
    doomedRef.current = value;
    setDoomed(value);
    onDoomedChange(id, value);
  };

  const { x1, y1, x2, y2, opacity } = useArmGeometry(hx, hy, open, stretch, reveal);
  useGlassPull(knobRef, hx, hy, stretch, reveal);

  const currentStretch = () => stretchFor(Math.hypot(hx.get(), hy.get()));
  const { locked, relockAt, toggleLock } = useHandleLock({
    lockedRef, hx, hy, target, drag, offset, nodeX, nodeY, onChanged, currentStretch,
  });
  const clickTimer: Timer = useRef(undefined);
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);
  const pressStart = useRef({ x: 0, y: 0 });
  const suppressClick = useRef(false);

  const knobHandlers = makeKnobHandlers({
    id, angle, fixed, offset, fixedRef, anchorRef, hx, hy, target, drag, idleTimer, clickTimer, animating,
    pressStart, suppressClick, lockedRef, doomedRef, setDoomedState, relockAt, toggleLock, currentStretch,
    onDrag, onSelect, onRemove, onChanged,
  });

  return (
    <g>
      <motion.line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        style={{ opacity }}
        className={`${styles.handleArm} ${fixed ? styles.auto : ""} ${doomed ? styles.doomed : ""}`}
      />
      {selected && (
        <motion.circle
          r={7.5}
          cx={x2}
          cy={y2}
          style={{ opacity }}
          className={styles.handleRing}
        />
      )}
      <motion.circle
        ref={knobRef}
        r={4}
        cx={x2}
        cy={y2}
        style={{ opacity }}
        className={`${styles.handleKnob} ${active ? styles.live : ""} ${fixed ? styles.auto : locked ? styles.locked : ""} ${doomed ? styles.doomed : ""}`}
        {...bottomTip(NODE_TIPS.handle.title, NODE_TIPS.handle.desc)}
        {...knobHandlers}
      />
    </g>
  );
};

export interface DropletProps {
  /** Direction de sortie (repère mathématique). */
  angle: number;
  /** Division (0 : dans le noyau, 1 : séparée). */
  divide: MotionValue<number>;
  /** Cliquable. */
  live: boolean;
  /** Indisponible (icône estompée). */
  dim?: boolean;
  label: string;
  /** Infobulle de bas d'écran. */
  tip: BottomTip;
  onPress: () => void;
  /** Icône, dessinée dans un viewBox 0 0 12 12. */
  children: React.ReactNode;
}

/**
 * Bouton gouttelette (« + », cadenas) : seconde lentille de verre qui naît dans le noyau et s'en
 * divise par mitose. Pendant la division, le noyau s'allonge vers elle (traction lue par son verre)
 * et un col de verre les relie (fusion de grande portée) puis s'amincit et se rompt.
 */
export const Droplet: React.FC<DropletProps> = ({ angle, divide, live, dim, label, tip, onPress, children }) => {
  const ux = Math.cos(angle), uy = -Math.sin(angle);
  const x = useTransform(divide, (d) => ux * ADD_DISTANCE_PX * Math.max(0, d));
  const y = useTransform(divide, (d) => uy * ADD_DISTANCE_PX * Math.max(0, d));
  const size = useTransform(divide, (d) => ADD_SIZE_PX * (0.6 + 0.4 * clamp01(d)) * clamp01(d * 8));
  const iconOpacity = useTransform(divide, (d) => clamp01(d * 2 - 0.8));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pullRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const write = () => {
      const d = divide.get();
      const merge = ADD_MERGE_END_PX + (ADD_MERGE_START_PX - ADD_MERGE_END_PX) * (1 - clamp01(d));
      buttonRef.current?.setAttribute(GLASS_LENS_ATTR, `0,${ADD_SIZE_PX},${merge}`);
      const elongation = MITOSIS_STRETCH * Math.sin(Math.PI * clamp01(d));
      pullRef.current?.setAttribute(GLASS_PULL_ATTR, `${ux},${uy},${elongation}`);
    };
    write();
    return divide.on("change", write);
  }, [divide, ux, uy]);

  return (
    <>
      <span ref={pullRef} hidden />
      <div className={styles.addAnchor}>
        <motion.button
          ref={buttonRef}
          type="button"
          aria-label={label}
          {...bottomTip(tip.title, tip.desc)}
          className={`${styles.add} ${live ? styles.live : ""}`}
          style={{ x, y, width: size, height: size }}
          whileHover={{ scale: 1.12 }}
          whileTap={{ scale: 0.9 }}
          onClick={(e) => {
            e.stopPropagation();
            onPress();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <motion.svg viewBox="0 0 12 12" style={{ opacity: dim ? 0.35 : iconOpacity }}>
            {children}
          </motion.svg>
        </motion.button>
      </div>
    </>
  );
};

/** Cadenas ouvert (position libre) ou fermé (position verrouillée). */
export const LockIcon: React.FC<{ closed: boolean }> = ({ closed }) => (
  <>
    <rect x="2.75" y="5.5" width="6.5" height="4.75" rx="1" />
    <path d={closed ? "M4.25 5.5 V4 a1.75 1.75 0 0 1 3.5 0 V5.5" : "M4.25 5.5 V3 a1.75 1.75 0 0 1 3.5 0 V3.4"} />
  </>
);

// Boîte réelle (pas 0 × 0 + overflow visible : Chromium ne peignait alors rien sous le filtre).
// Les poignées n'ont pas de longueur maximale : ce qui dépasse la boîte reste peint (overflow
// visible, cf. .handles).
export const HANDLES_HALF_PX = 900;

// Un double-clic commence par un clic : la réduction attend ce délai pour ne pas se déclencher
// quand l'utilisateur voulait basculer le rognage.
export const DOUBLE_CLICK_MS = 250;
