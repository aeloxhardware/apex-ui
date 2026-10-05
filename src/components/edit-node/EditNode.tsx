import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
  type Transition,
} from "framer-motion";
import { GLASS_LENS_ATTR, GLASS_PULL_ATTR, MAX_PULLS } from "./liquidGlass";
import styles from "./EditNode.module.scss";

/**
 * Nœud d'édition du G-code (second style de poignée, cf. CLAUDE.md « Bézier-editor node »).
 * Ancré en 3D sur un point de trajectoire, dessiné en 2D par-dessus la vue : `x`/`y` sont la
 * projection écran de son ancre, en pixels, dans le repère du conteneur parent.
 *
 * Inactif : un point bleu. Actif : le point GONFLE (ressort peu amorti, léger dépassement) et
 * devient une lentille « Liquid Glass » d'où sortent des poignées déplaçables. Le verre n'est PAS
 * dessiné ici : cet élément porte la forme, l'interaction et les attributs GLASS_LENS_ATTR /
 * GLASS_PULL_ATTR ; un rendu WebGL placé derrière les lit à chaque image, réfracte le fond et étire
 * le verre vers les poignées qui tirent (liquidGlass.ts). Conception dans `pnpm dev:lab-node`.
 */
export interface EditNodeProps {
  x: number;
  y: number;
  /** Nœud sélectionné : forme développée. */
  active: boolean;
  /** Rognage en cas de dépassement (bascule au double-clic). */
  trimming: boolean;
  onActivate?: () => void;
  /** Clic simple sur le nœud développé : réduction. */
  onDeactivate?: () => void;
  onToggleTrimming?: () => void;
  /** Glissement du nœud : nouvelle position voulue (même repère que `x`/`y`). */
  onMove?: (x: number, y: number) => void;
  /** Chargement en cours : les reflets du verre tournent autour du nœud développé. */
  loading?: boolean;
  /** Fin d'un glissement du nœud (relâchement). */
  onMoveEnd?: () => void;
  /** Poignées changées par l'utilisateur (glissement, ajout, suppression, verrouillage, remise
   * en place) : position relative au nœud en px, et verrouillage. */
  onHandlesChange?: (handles: EditNodeHandle[]) => void;
  /** Positions imposées des poignées (px relatifs au nœud), par identifiant — l'application les
   * tient en 3D et les reprojette quand la caméra ou le nœud bougent. */
  handleOffsets?: Readonly<Record<number, { dx: number; dy: number }>>;
}

export interface EditNodeHandle {
  id: number;
  dx: number;
  dy: number;
  locked: boolean;
}

const CORE_PX = 12;
const BUBBLE_PX = 46; // 76 × 0,6 (76 = 168 / 2,2)
const BUBBLE_R = BUBBLE_PX / 2;

// Séquence d'ouverture : la bulle gonfle (ressort peu amorti), puis les poignées sortent du noyau
// l'une après l'autre, puis le « + » se divise du noyau. Fermeture dans l'ordre inverse.
const OPEN_SPRING = { type: "spring", stiffness: 320, damping: 17, mass: 0.9 } as const;
const HANDLE_OUT_SPRING = { type: "spring", stiffness: 260, damping: 16 } as const;
const HANDLE_IN_SPRING = { type: "spring", stiffness: 300, damping: 26 } as const;
const HANDLE_OUT_DELAY_S = 0.14;
const HANDLE_STAGGER_S = 0.07;
const DIVIDE_SPRING = { type: "spring", stiffness: 120, damping: 15, mass: 1 } as const;
// Fusion inverse : assez lente pour que le col de verre se reforme, sans dépasser (pas de rebond
// du « + » au-delà du centre).
const MERGE_BACK_SPRING = { type: "spring", stiffness: 170, damping: 26 } as const;
const DIVIDE_DELAY_S = 0.3;
// Fermeture : le « + » fusionne, puis les poignées rentrent (dernière sortie, première rentrée),
// puis la bulle dégonfle.
const HANDLE_IN_DELAY_S = 0.32;
const DEFLATE_AFTER_HANDLES_S = 0.1;
const closeDelayFor = (count: number) =>
  HANDLE_IN_DELAY_S + Math.max(0, count - 1) * HANDLE_STAGGER_S + DEFLATE_AFTER_HANDLES_S;

// Point plein (cyan, orange si rognage) <-> verre : l'opacité de la couleur suit la taille de la
// bulle, donc le point ne se colore qu'en fin de dégonflement (et se vide dès le début du
// gonflement). Ouvert, l'ombre portée est dessinée par le shader du verre.
const CYAN = [0, 240, 255];
const ORANGE = [255, 159, 28];
const TINT_FADE_S = 0.2;
const solidity = (o: number) => clamp01(1 - Math.max(0, o) * 2.5);
const tintRgb = (t: number) => CYAN.map((c, i) => Math.round(c + (ORANGE[i] - c) * t)).join(", ");

// Chargement : durée d'un tour des reflets, et freinage jusqu'au repos.
const SPIN_TURN_S = 1.1;
const SPIN_STOP_SPRING = { type: "spring", stiffness: 40, damping: 12 } as const;

// Trois courbes empilées (trajectoires adjacentes) : repère visuel du nœud au repos.
const StackedCurvesIcon: React.FC = () => (
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
const TrimmingIcon: React.FC = () => (
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
const DeleteIcon: React.FC = () => (
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
const HANDLE_MAX_PX = BUBBLE_R + 120;
// Bouton relâché à moins de cette distance du centre : la poignée est supprimée.
const DELETE_RADIUS_PX = BUBBLE_R - 3;
// Angles initiaux (repère mathématique) : diagonale bas-gauche -> haut-droite.
const INITIAL_ANGLES = [Math.PI / 4, (5 * Math.PI) / 4];
// Tractions du noyau réservées : mitose du « + », inertie du glissement (arrière et avant).
const MAX_HANDLES = MAX_PULLS - 3;

// Glissement du nœud : seuil avant qu'un appui devienne un déplacement, et inertie du verre.
const DRAG_THRESHOLD_PX = 3;
const MOVE_STRETCH_PER_PXS = 0.00035;
const MOVE_STRETCH_MAX = 0.3;
const MOVE_LEAD_FLATTEN = 0.35;

// Bouton « + » : gouttelette de verre qui sort sous le nœud.
const ADD_SIZE_PX = 18;
const ADD_DISTANCE_PX = BUBBLE_R + 17;
const ADD_ANGLE = (3 * Math.PI) / 2;
// Portée de fusion du « + » avec le noyau : large pendant la division (col de verre), puis
// inférieure à l'écart final entre les deux (7 px) pour qu'ils se séparent nettement.
const ADD_MERGE_START_PX = 26;
const ADD_MERGE_END_PX = 5;
// Allongement du noyau vers la gouttelette au milieu de la division.
const MITOSIS_STRETCH = 0.3;

const TAU = 2 * Math.PI;
const wrapAngle = (a: number) => ((a % TAU) + TAU) % TAU;

// Milieu du plus grand secteur libre entre les angles occupés (poignées et bouton « + »).
function freeAngle(taken: number[]): number {
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
const JELLY_SPRING = { stiffness: 280, damping: 9, mass: 0.6 };
// Prise d'une poignée : impulsion brève vers elle, puis légère tension tant qu'elle est tenue.
const GRAB_PULSE = 0.14;
const GRAB_TENSION = 0.05;
const GRAB_PULSE_MS = 90;
// Double-clic sur une poignée : retour à sa position initiale.
const RESET_SPRING = { type: "spring", stiffness: 260, damping: 20 } as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type HandleRegistry = Map<
  number,
  { hx: MotionValue<number>; hy: MotionValue<number>; locked: () => boolean }
>;

interface HandleProps {
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
  anchorRef: React.RefObject<HTMLDivElement>;
  registry: React.MutableRefObject<HandleRegistry>;
  /** La poignée entre / sort de la zone de suppression (centre du nœud). */
  onDoomedChange: (id: number, doomed: boolean) => void;
  onRemove: (id: number) => void;
  /** Position imposée par l'application (px, relative au nœud), hors glissement en cours. */
  offset?: { dx: number; dy: number };
  /** Position, longueur ou verrouillage changés par l'utilisateur. */
  onChanged: () => void;
}

const Handle: React.FC<HandleProps> = ({
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
}) => {
  const startLength = spawn ? HANDLE_MIN_PX : HANDLE_REST_PX;
  const lockedRef = useRef(false);
  const animating = useRef(false);

  // Sortie du noyau : chaque poignée part du centre, après le gonflement, l'une après l'autre ;
  // à la fermeture, elles rentrent avant que la bulle ne dégonfle.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reveal]);
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
  const drag = useRef<{ x: number; y: number; t: number } | null>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  // Naissance : la poignée sort du bord en tirant brièvement le verre avec elle.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawn, angle, hx, hy, target]);

  // Position imposée par l'application (la poignée vit en 3D : la caméra ou le nœud qui bouge la
  // font glisser à l'écran), sauf pendant que l'utilisateur la tient ou qu'elle s'anime.
  useLayoutEffect(() => {
    if (!offset || drag.current || animating.current) return;
    hx.set(offset.dx);
    hy.set(offset.dy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset?.dx, offset?.dy]);

  const setDoomedState = (value: boolean) => {
    if (doomedRef.current === value) return;
    doomedRef.current = value;
    setDoomed(value);
    onDoomedChange(id, value);
  };

  // Bras : du bord (étiré) du verre jusqu'au bouton ; le bouton sort du centre avec `reveal`.
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

  // Traction lue par le rendu du verre.
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
  }, [hx, hy, stretch, reveal]);

  const moveTo = (e: React.PointerEvent) => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const x = e.clientX - a.left, y = e.clientY - a.top;
    const length = Math.hypot(x, y) || 1;
    const k = Math.min(HANDLE_MAX_PX, Math.max(HANDLE_MIN_PX, length)) / length;
    hx.set(x * k);
    hy.set(y * k);
    relockAt(x * k, y * k);

    const now = performance.now();
    const prev = drag.current;
    let kick = 0;
    if (prev && now > prev.t) {
      const speed = Math.hypot(e.clientX - prev.x, e.clientY - prev.y) / ((now - prev.t) / 1000);
      kick = Math.min(KICK_MAX, speed * SPEED_KICK);
    }
    drag.current = { x: e.clientX, y: e.clientY, t: now };
    // Dans le nœud : la poignée ne tire plus sur le verre, elle attend d'être supprimée.
    const inside = length * k < DELETE_RADIUS_PX;
    setDoomedState(inside);
    window.clearTimeout(idleTimer.current);
    if (inside) {
      target.set(0);
      return;
    }
    target.set(stretchFor(length * k) + GRAB_TENSION + kick);
    onChanged();
    // Poignée tenue immobile : plus de pointermove, la secousse doit retomber quand même.
    idleTimer.current = window.setTimeout(
      () => target.set(stretchFor(length * k) + GRAB_TENSION),
      60,
    );
  };

  const currentStretch = () => stretchFor(Math.hypot(hx.get(), hy.get()));

  // Verrouillage (clic simple, orange) : la poignée garde sa position absolue ; quand le nœud
  // bouge, son bras s'allonge ou se raccourcit, et le verre suit la nouvelle tension.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeX, nodeY]);
  const toggleLock = () => {
    lockPoint.current = lockPoint.current
      ? null
      : { x: nodePos.current.x + hx.get(), y: nodePos.current.y + hy.get() };
    lockedRef.current = lockPoint.current !== null;
    setLocked(lockedRef.current);
    onChanged();
  };
  const clickTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);
  const pressStart = useRef({ x: 0, y: 0 });
  const suppressClick = useRef(false);

  return (
    <g>
      <motion.line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        style={{ opacity }}
        className={`${styles.handleArm} ${doomed ? styles.doomed : ""}`}
      />
      <motion.circle
        ref={knobRef}
        r={4}
        cx={x2}
        cy={y2}
        style={{ opacity }}
        className={`${styles.handleKnob} ${active ? styles.live : ""} ${locked ? styles.locked : ""} ${doomed ? styles.doomed : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          // Fin d'un glissement, ou second clic d'un double-clic : pas de bascule.
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (e.detail > 1) return;
          window.clearTimeout(clickTimer.current);
          clickTimer.current = window.setTimeout(toggleLock, DOUBLE_CLICK_MS);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          window.clearTimeout(clickTimer.current);
          window.clearTimeout(idleTimer.current);
          const rx = Math.cos(angle) * HANDLE_REST_PX, ry = -Math.sin(angle) * HANDLE_REST_PX;
          animating.current = true;
          void Promise.all([animate(hx, rx, RESET_SPRING), animate(hy, ry, RESET_SPRING)]).then(() => {
            animating.current = false;
            onChanged();
          });
          relockAt(rx, ry);
          target.set(stretchFor(HANDLE_REST_PX));
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          pressStart.current = { x: e.clientX, y: e.clientY };
          drag.current = { x: e.clientX, y: e.clientY, t: performance.now() };
          target.set(currentStretch() + GRAB_PULSE);
          window.clearTimeout(idleTimer.current);
          idleTimer.current = window.setTimeout(
            () => target.set(currentStretch() + GRAB_TENSION),
            GRAB_PULSE_MS,
          );
        }}
        onPointerMove={(e) => {
          if (drag.current) moveTo(e);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          drag.current = null;
          suppressClick.current =
            Math.hypot(e.clientX - pressStart.current.x, e.clientY - pressStart.current.y) >=
            DRAG_THRESHOLD_PX;
          window.clearTimeout(idleTimer.current);
          if (doomedRef.current) {
            setDoomedState(false);
            onRemove(id);
            return;
          }
          // Relâchée, la vitesse retombe : le verre revient vers sa tension en oscillant.
          target.set(currentStretch());
        }}
      />
    </g>
  );
};

// Boîte réelle (pas 0 × 0 + overflow visible : Chromium ne peignait alors rien sous le filtre).
// Large : une poignée verrouillée peut finir loin du nœud quand celui-ci est déplacé.
const HANDLES_HALF_PX = 900;

// Un double-clic commence par un clic : la réduction attend ce délai pour ne pas se déclencher
// quand l'utilisateur voulait basculer le rognage.
const DOUBLE_CLICK_MS = 250;

const EditNode: React.FC<EditNodeProps> = ({
  x,
  y,
  active,
  trimming,
  onActivate,
  onDeactivate,
  onToggleTrimming,
  onMove,
  loading = false,
  onMoveEnd,
  onHandlesChange,
  handleOffsets,
}) => {
  // Chargement : rotation continue des reflets ; à l'arrêt, ils ralentissent jusqu'à leur position
  // de repos (les reflets sont symétriques : période π).
  const spin = useMotionValue(0);
  const spinning = loading && active;
  useEffect(() => {
    if (spinning) {
      const controls = animate(spin, spin.get() + TAU, {
        duration: SPIN_TURN_S,
        ease: "linear",
        repeat: Infinity,
      });
      return () => controls.stop();
    }
    const current = spin.get();
    const velocity = spin.getVelocity();
    let rest = Math.ceil(current / Math.PI - 1e-6) * Math.PI;
    if (Math.abs(rest - current) < 1e-3 && Math.abs(velocity) < 1e-3) return;
    // Lancé : garder au moins un quart de tour pour freiner sans à-coup.
    if (velocity > 0 && rest - current < Math.PI / 4) rest += Math.PI;
    const controls = animate(spin, rest, { ...SPIN_STOP_SPRING, velocity });
    return () => controls.stop();
  }, [spinning, spin]);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const write = () =>
      bodyRef.current?.setAttribute(GLASS_LENS_ATTR, `${CORE_PX},${BUBBLE_PX},0,${spin.get()}`);
    write();
    return spin.on("change", write);
  }, [spin]);

  const collapseTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(collapseTimer.current), []);

  const anchorRef = useRef<HTMLDivElement>(null);
  const open = useMotionValue(active ? 1 : 0);
  const divide = useMotionValue(active ? 1 : 0);
  useEffect(() => {
    const controls = active
      ? [
          animate(open, 1, OPEN_SPRING),
          animate(divide, 1, { ...DIVIDE_SPRING, delay: DIVIDE_DELAY_S }),
        ]
      : [
          animate(divide, 0, MERGE_BACK_SPRING),
          animate(open, 0, { ...OPEN_SPRING, delay: closeDelayFor(handleCount.current) }),
        ];
    return () => controls.forEach((c) => c.stop());
  }, [active, open, divide]);
  const size = useTransform(open, (o) => CORE_PX + (BUBBLE_PX - CORE_PX) * Math.max(0, o));

  const tint = useMotionValue(trimming ? 1 : 0);
  useEffect(() => {
    const controls = animate(tint, trimming ? 1 : 0, { duration: TINT_FADE_S });
    return () => controls.stop();
  }, [trimming, tint]);
  const backgroundColor = useTransform([open, tint], ([o, t]) =>
    `rgba(${tintRgb(t as number)}, ${solidity(o as number)})`,
  );
  const boxShadow = useTransform([open, tint], ([o, t]) => {
    const a = solidity(o as number);
    return `0 0 0 2px rgba(10, 15, 26, ${0.9 * a}), 0 0 10px rgba(${tintRgb(t as number)}, ${0.55 * a})`;
  });
  const iconOpacity = useTransform(open, (o) => clamp01((o - 0.5) * 3));

  const [handles, setHandles] = useState(() =>
    INITIAL_ANGLES.map((angle, id) => ({ id, angle, spawn: false })),
  );
  const nextId = useRef(INITIAL_ANGLES.length);
  const handleCount = useRef(handles.length);
  handleCount.current = handles.length;
  const registry = useRef<HandleRegistry>(new Map());
  const [doomed, setDoomed] = useState<number | null>(null);
  const onDoomedChange = useCallback((id: number, value: boolean) => {
    setDoomed((current) => (value ? id : current === id ? null : current));
  }, []);
  const onRemove = useCallback((id: number) => {
    setHandles((list) => list.filter((h) => h.id !== id));
  }, []);
  const onHandlesChangeRef = useRef(onHandlesChange);
  onHandlesChangeRef.current = onHandlesChange;
  const reportHandles = useCallback(() => {
    const report = onHandlesChangeRef.current;
    if (!report) return;
    report(
      [...registry.current.entries()].map(([id, h]) => ({
        id, dx: h.hx.get(), dy: h.hy.get(), locked: h.locked(),
      })),
    );
  }, []);
  // Ajout / suppression (les poignées viennent de s'inscrire ou de se retirer du registre).
  useEffect(() => reportHandles(), [handles, reportHandles]);
  const addHandle = () => {
    if (handles.length >= MAX_HANDLES) return;
    const taken = [...registry.current.values()].map(({ hx, hy }) => Math.atan2(-hy.get(), hx.get()));
    const angle = freeAngle([...taken, ADD_ANGLE]);
    setHandles((list) => [...list, { id: nextId.current++, angle, spawn: true }]);
  };

  // Mitose du « + » : la gouttelette naît dans le noyau, descend en étirant le noyau vers elle ; un
  // col de verre les relie (fusion de grande portée) puis s'amincit et se rompt.
  const addOffset = useTransform(divide, (d) => ADD_DISTANCE_PX * Math.max(0, d));
  const addSize = useTransform(
    divide,
    (d) => ADD_SIZE_PX * (0.6 + 0.4 * clamp01(d)) * clamp01(d * 8),
  );
  const addOpacity = useTransform(divide, (d) => clamp01(d * 2 - 0.8));
  const canAdd = handles.length < MAX_HANDLES;
  const addRef = useRef<HTMLButtonElement>(null);
  const mitosisPullRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const write = () => {
      const d = divide.get();
      const merge = ADD_MERGE_END_PX + (ADD_MERGE_START_PX - ADD_MERGE_END_PX) * (1 - clamp01(d));
      addRef.current?.setAttribute(GLASS_LENS_ATTR, `0,${ADD_SIZE_PX},${merge}`);
      const elongation = MITOSIS_STRETCH * Math.sin(Math.PI * clamp01(d));
      mitosisPullRef.current?.setAttribute(GLASS_PULL_ATTR, `0,1,${elongation}`);
    };
    write();
    return divide.on("change", write);
  }, [divide]);

  // Glissement du nœud : le verre traîne derrière le mouvement (étiré à l'arrière, aplati à
  // l'avant), proportionnellement à la vitesse, et oscille en se remettant à l'arrêt.
  const moveTargetX = useMotionValue(0);
  const moveTargetY = useMotionValue(0);
  const inertiaX = useSpring(moveTargetX, JELLY_SPRING);
  const inertiaY = useSpring(moveTargetY, JELLY_SPRING);
  const trailPullRef = useRef<HTMLSpanElement>(null);
  const leadPullRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const write = () => {
      const ix = inertiaX.get(), iy = inertiaY.get();
      const m = Math.hypot(ix, iy);
      const ux = m > 1e-4 ? ix / m : 0, uy = m > 1e-4 ? iy / m : 0;
      trailPullRef.current?.setAttribute(GLASS_PULL_ATTR, `${-ux},${-uy},${m}`);
      leadPullRef.current?.setAttribute(GLASS_PULL_ATTR, `${ux},${uy},${-m * MOVE_LEAD_FLATTEN}`);
    };
    write();
    const offs = [inertiaX, inertiaY].map((mv) => mv.on("change", write));
    return () => offs.forEach((off) => off());
  }, [inertiaX, inertiaY]);

  const nodeDrag = useRef<{
    startX: number; startY: number; nodeX: number; nodeY: number;
    lastX: number; lastY: number; lastT: number; moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const moveIdle = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(moveIdle.current), []);

  return (
    <div
      ref={anchorRef}
      className={styles.anchor}
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      <motion.div
        ref={bodyRef}
        className={styles.body}
        style={{ width: size, height: size, backgroundColor, boxShadow }}
        whileHover={active ? undefined : { scale: 1.25 }}
        onPointerDown={(e) => {
          if (!onMove || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          nodeDrag.current = {
            startX: e.clientX, startY: e.clientY, nodeX: x, nodeY: y,
            lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), moved: false,
          };
        }}
        onPointerMove={(e) => {
          const d = nodeDrag.current;
          if (!d) return;
          const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
          if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          d.moved = true;
          onMove?.(d.nodeX + dx, d.nodeY + dy);

          const now = performance.now();
          const dt = (now - d.lastT) / 1000;
          if (dt > 0) {
            const vx = (e.clientX - d.lastX) / dt, vy = (e.clientY - d.lastY) / dt;
            const speed = Math.hypot(vx, vy);
            const k = speed > 0 ? Math.min(MOVE_STRETCH_MAX, speed * MOVE_STRETCH_PER_PXS) / speed : 0;
            moveTargetX.set(vx * k);
            moveTargetY.set(vy * k);
          }
          d.lastX = e.clientX; d.lastY = e.clientY; d.lastT = now;
          // Immobile sous le doigt : plus de pointermove, l'inertie doit retomber quand même.
          window.clearTimeout(moveIdle.current);
          moveIdle.current = window.setTimeout(() => {
            moveTargetX.set(0);
            moveTargetY.set(0);
          }, 60);
        }}
        onPointerUp={(e) => {
          const d = nodeDrag.current;
          if (!d) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          nodeDrag.current = null;
          suppressClick.current = d.moved;
          if (d.moved) onMoveEnd?.();
          window.clearTimeout(moveIdle.current);
          moveTargetX.set(0);
          moveTargetY.set(0);
        }}
        onClick={(e) => {
          e.stopPropagation();
          // Fin d'un glissement : ce n'est pas un clic (ni sélection, ni réduction).
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (e.detail > 1) return;
          if (!active) {
            onActivate?.();
            return;
          }
          window.clearTimeout(collapseTimer.current);
          collapseTimer.current = window.setTimeout(() => onDeactivate?.(), DOUBLE_CLICK_MS);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          window.clearTimeout(collapseTimer.current);
          onToggleTrimming?.();
        }}
      >
        <motion.div className={styles.iconWrap} style={{ opacity: iconOpacity }}>
          <motion.div
            key={doomed !== null ? "delete" : trimming ? "trimming" : "stacked"}
            className={styles.iconWrap}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.15 }}
          >
            {doomed !== null ? <DeleteIcon /> : trimming ? <TrimmingIcon /> : <StackedCurvesIcon />}
          </motion.div>
        </motion.div>
      </motion.div>
      {/* Tractions du noyau (lues par son verre) : mitose du « + », inertie du glissement. */}
      <span ref={mitosisPullRef} hidden />
      <span ref={trailPullRef} hidden />
      <span ref={leadPullRef} hidden />
      <div className={styles.addAnchor}>
        <motion.button
          ref={addRef}
          type="button"
          aria-label="Ajouter une poignée"
          className={`${styles.add} ${active && canAdd ? styles.live : ""}`}
          style={{ y: addOffset, width: addSize, height: addSize }}
          whileHover={{ scale: 1.12 }}
          whileTap={{ scale: 0.9 }}
          onClick={(e) => {
            e.stopPropagation();
            addHandle();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <motion.svg viewBox="0 0 12 12" style={{ opacity: canAdd ? addOpacity : 0.35 }}>
            <path d="M6 2.5 V9.5 M2.5 6 H9.5" />
          </motion.svg>
        </motion.button>
      </div>
      <svg
        className={styles.handles}
        width={2 * HANDLES_HALF_PX}
        height={2 * HANDLES_HALF_PX}
        viewBox={`${-HANDLES_HALF_PX} ${-HANDLES_HALF_PX} ${2 * HANDLES_HALF_PX} ${2 * HANDLES_HALF_PX}`}
        style={{ left: -HANDLES_HALF_PX, top: -HANDLES_HALF_PX }}
      >
        {handles.map((h, index) => (
          <Handle
            key={h.id}
            id={h.id}
            angle={h.angle}
            spawn={h.spawn}
            index={index}
            count={handles.length}
            nodeX={x}
            nodeY={y}
            open={open}
            active={active}
            anchorRef={anchorRef}
            registry={registry}
            onDoomedChange={onDoomedChange}
            onRemove={onRemove}
            offset={handleOffsets?.[h.id]}
            onChanged={reportHandles}
          />
        ))}
      </svg>
    </div>
  );
};

export default React.memo(EditNode);
