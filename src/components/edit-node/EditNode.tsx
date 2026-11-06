import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { GLASS_LENS_ATTR, GLASS_PULL_ATTR } from "./liquidGlass";
import styles from "./EditNode.module.scss";
import { NODE_TIPS, hideBottomTip, showBottomTip } from "./bottomTooltip";

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
interface EditNodeProps {
  x: number;
  y: number;
  /** Nœud sélectionné : forme développée. */
  active: boolean;
  /** Rognage en cas de dépassement (bascule au double-clic). */
  trimming: boolean;
  onActivate?: (() => void) | undefined;
  /** Clic simple sur le nœud développé : réduction. */
  onDeactivate?: (() => void) | undefined;
  onToggleTrimming?: (() => void) | undefined;
  /** Glissement du nœud : nouvelle position voulue (même repère que `x`/`y`). */
  onMove?: ((x: number, y: number) => void) | undefined;
  /** Chargement en cours : les reflets du verre tournent autour du nœud développé. */
  loading?: boolean;
  /** Fin d'un glissement du nœud (relâchement). */
  onMoveEnd?: (() => void) | undefined;
  /** Poignées changées par l'utilisateur (glissement, ajout, suppression, verrouillage, remise
   * en place) : position relative au nœud en px, et verrouillage. */
  onHandlesChange?: (handles: EditNodeHandle[]) => void;
  /** Positions imposées des poignées (px relatifs au nœud), par identifiant — l'application les
   * tient en 3D et les reprojette quand la caméra ou le nœud bougent. */
  handleOffsets?: Readonly<Record<number, { dx: number; dy: number }>>;
  /** Position du nœud verrouillée sur son point d'attache (contour rouge). Déverrouillé, le
   * glisser choisit le point ; verrouillé, le glisser déforme. */
  positionLocked?: boolean;
  /** Bouton cadenas (gouttelette au-dessus du nœud développé) ; sans ce rappel, pas de cadenas. */
  onTogglePositionLock?: () => void;
  /** Glissement d'une poignée (début, mouvements, fin) avec son mode (rotation / influence). */
  onHandleDrag?: (e: HandleDragEvent) => void;
  /** Point du nœud masqué par la pièce (vu de la caméra) : le nœud s'estompe, sans cesser d'être utilisable. */
  occluded?: boolean;
  /** Mode d'influence Auto : poignées violettes, à leur écartement par défaut, que l'on ne peut plus
   * changer (seule leur orientation se règle) ; pas de verrouillage. */
  fixedHandles?: boolean;
}

export interface EditNodeHandle {
  id: number;
  dx: number;
  dy: number;
  locked: boolean;
}

/**
 * Glissement d'une poignée. Glisser seul : la poignée fait tourner la déformation ET règle
 * l'influence ; Ctrl (⌘ sur Mac) : rotation seule ; Alt : influence seule. Le mode suit les touches
 * tenues à chaque mouvement.
 */
export type { HandleDragMode, HandleDragEvent } from './editNodeTypes';
import type { HandleDragEvent } from './editNodeTypes';
import {
  CORE_PX, BUBBLE_PX, OPEN_SPRING, DIVIDE_SPRING, MERGE_BACK_SPRING, DIVIDE_DELAY_S, closeDelayFor, TINT_FADE_S, solidity, tintRgb, SPIN_TURN_S, SPIN_STOP_SPRING, StackedCurvesIcon, TrimmingIcon, DeleteIcon, INITIAL_ANGLES, MAX_HANDLES, DRAG_THRESHOLD_PX, MOVE_STRETCH_PER_PXS, MOVE_STRETCH_MAX, MOVE_LEAD_FLATTEN, ADD_ANGLE, LOCK_ANGLE, TAU, freeAngle, JELLY_SPRING, clamp01, HandleRegistry, Handle, Droplet, LockIcon, HANDLES_HALF_PX, DOUBLE_CLICK_MS,
} from './editNodeParts';

/**
 * Chargement : rotation continue des reflets ; à l'arrêt, ils ralentissent jusqu'à leur position
 * de repos (les reflets sont symétriques : période π). Écrit l'angle sur l'élément du verre.
 */
function useGlassSpin(spinning: boolean, bodyRef: React.RefObject<HTMLDivElement | null>) {
  const spin = useMotionValue(0);
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
  useEffect(() => {
    const write = () =>
      bodyRef.current?.setAttribute(GLASS_LENS_ATTR, `${CORE_PX},${BUBBLE_PX},0,${spin.get()}`);
    write();
    return spin.on("change", write);
  }, [spin, bodyRef]);
}

/** Gonflement du noyau, mitose des gouttelettes, teinte du rognage : valeurs animées du corps. */
function useNodeMotion(active: boolean, trimming: boolean, handleCount: React.MutableRefObject<number>) {
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
  }, [active, open, divide, handleCount]);
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
  return { open, divide, size, backgroundColor, boxShadow, iconOpacity };
}

/** Liste des poignées du nœud : ajout, suppression, suppression en cours et compte rendu à l'application. */
function useHandleList(onHandlesChange: EditNodeProps["onHandlesChange"], hasPositionLock: boolean) {
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
    const angle = freeAngle([...taken, ADD_ANGLE, ...(hasPositionLock ? [LOCK_ANGLE] : [])]);
    setHandles((list) => [...list, { id: nextId.current++, angle, spawn: true }]);
  };
  return {
    handles, handleCount, registry, doomed, onDoomedChange, onRemove, reportHandles, addHandle,
    canAdd: handles.length < MAX_HANDLES,
  };
}

/**
 * Glissement du nœud : le verre traîne derrière le mouvement (étiré à l'arrière, aplati à
 * l'avant), proportionnellement à la vitesse, et oscille en se remettant à l'arrêt.
 */
function useNodeInertia() {
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
  return { moveTargetX, moveTargetY, trailPullRef, leadPullRef };
}

type NodeDrag = {
  startX: number; startY: number; nodeX: number; nodeY: number;
  lastX: number; lastY: number; lastT: number; moved: boolean;
};

/** Ce dont les gestes du corps du nœud ont besoin (glissement, clic simple ou double). */
interface BodyCtx {
  x: number;
  y: number;
  active: boolean;
  nodeDrag: React.MutableRefObject<NodeDrag | null>;
  suppressClick: React.MutableRefObject<boolean>;
  moveIdle: React.MutableRefObject<number | undefined>;
  collapseTimer: React.MutableRefObject<number | undefined>;
  moveTargetX: MotionValue<number>;
  moveTargetY: MotionValue<number>;
  onMove?: ((x: number, y: number) => void) | undefined;
  onMoveEnd?: (() => void) | undefined;
  onActivate?: (() => void) | undefined;
  onDeactivate?: (() => void) | undefined;
  onToggleTrimming?: (() => void) | undefined;
}

/** Gestes du corps du nœud : glissement avec inertie du verre, clic (réduction) et double-clic (rognage). */
function makeBodyHandlers(b: BodyCtx) {
  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!b.onMove || e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      b.nodeDrag.current = {
        startX: e.clientX, startY: e.clientY, nodeX: b.x, nodeY: b.y,
        lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), moved: false,
      };
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = b.nodeDrag.current;
      if (!d) return;
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      b.onMove?.(d.nodeX + dx, d.nodeY + dy);

      const now = performance.now();
      const dt = (now - d.lastT) / 1000;
      if (dt > 0) {
        const vx = (e.clientX - d.lastX) / dt, vy = (e.clientY - d.lastY) / dt;
        const speed = Math.hypot(vx, vy);
        const k = speed > 0 ? Math.min(MOVE_STRETCH_MAX, speed * MOVE_STRETCH_PER_PXS) / speed : 0;
        b.moveTargetX.set(vx * k);
        b.moveTargetY.set(vy * k);
      }
      d.lastX = e.clientX; d.lastY = e.clientY; d.lastT = now;
      // Immobile sous le doigt : plus de pointermove, l'inertie doit retomber quand même.
      window.clearTimeout(b.moveIdle.current);
      b.moveIdle.current = window.setTimeout(() => {
        b.moveTargetX.set(0);
        b.moveTargetY.set(0);
      }, 60);
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = b.nodeDrag.current;
      if (!d) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      b.nodeDrag.current = null;
      b.suppressClick.current = d.moved;
      if (d.moved) b.onMoveEnd?.();
      window.clearTimeout(b.moveIdle.current);
      b.moveTargetX.set(0);
      b.moveTargetY.set(0);
    },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      // Fin d'un glissement : ce n'est pas un clic (ni sélection, ni réduction).
      if (b.suppressClick.current) {
        b.suppressClick.current = false;
        return;
      }
      if (e.detail > 1) return;
      if (!b.active) {
        b.onActivate?.();
        return;
      }
      window.clearTimeout(b.collapseTimer.current);
      b.collapseTimer.current = window.setTimeout(() => b.onDeactivate?.(), DOUBLE_CLICK_MS);
    },
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      window.clearTimeout(b.collapseTimer.current);
      b.onToggleTrimming?.();
    },
  };
}

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
  positionLocked = false,
  onTogglePositionLock,
  onHandleDrag,
  occluded = false,
  fixedHandles = false,
}) => {
  // Poignée sélectionnée : la dernière saisie ; l'anneau disparaît quand le nœud se réduit.
  const [selectedHandle, setSelectedHandle] = useState<number | null>(null);
  useEffect(() => {
    if (!active) setSelectedHandle(null);
  }, [active]);
  const bodyRef = useRef<HTMLDivElement>(null);
  useGlassSpin(loading && active, bodyRef);

  const collapseTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(collapseTimer.current), []);

  const anchorRef = useRef<HTMLDivElement>(null);
  const list = useHandleList(onHandlesChange, !!onTogglePositionLock);
  const { handles, registry, doomed, onDoomedChange, onRemove, reportHandles, addHandle, canAdd } = list;
  const { open, divide, size, backgroundColor, boxShadow, iconOpacity } = useNodeMotion(active, trimming, list.handleCount);
  const { moveTargetX, moveTargetY, trailPullRef, leadPullRef } = useNodeInertia();

  const nodeDrag = useRef<NodeDrag | null>(null);
  const suppressClick = useRef(false);
  // Infobulle du noyau : dépend de l'état (réduit, développé libre ou verrouillé) ; remise à jour si
  // l'état change sous le pointeur.
  const bodyTip = !active ? NODE_TIPS.collapsed : positionLocked ? NODE_TIPS.expandedLocked : NODE_TIPS.expandedFree;
  const bodyHovered = useRef(false);
  useEffect(() => {
    if (bodyHovered.current) showBottomTip(bodyTip);
  }, [bodyTip]);
  const moveIdle = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(moveIdle.current), []);
  const bodyHandlers = makeBodyHandlers({
    x, y, active, nodeDrag, suppressClick, moveIdle, collapseTimer, moveTargetX, moveTargetY,
    onMove, onMoveEnd, onActivate, onDeactivate, onToggleTrimming,
  });

  return (
    <div
      ref={anchorRef}
      className={styles.anchor}
      style={{ transform: `translate(${x}px, ${y}px)`, opacity: occluded ? 0.28 : 1, transition: "opacity 0.18s ease" }}
    >
      <motion.div
        ref={bodyRef}
        className={styles.body}
        style={{ width: size, height: size, backgroundColor, boxShadow }}
        {...(active ? {} : { whileHover: { scale: 1.25 } })}
        onPointerEnter={() => {
          bodyHovered.current = true;
          showBottomTip(bodyTip);
        }}
        onPointerLeave={() => {
          bodyHovered.current = false;
          hideBottomTip();
        }}
        {...bodyHandlers}
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
        {/* Position verrouillée : contour rouge, nœud développé ou réduit. */}
        <div className={`${styles.lockRing} ${positionLocked ? styles.lockRingOn : ""}`} />
      </motion.div>
      {/* Tractions du noyau (lues par son verre) : inertie du glissement ; celles des mitoses
          sont portées par chaque gouttelette. */}
      <span ref={trailPullRef} hidden />
      <span ref={leadPullRef} hidden />
      <Droplet
        angle={ADD_ANGLE}
        divide={divide}
        live={active && canAdd}
        dim={!canAdd}
        label="Ajouter une poignée"
        tip={NODE_TIPS.add}
        onPress={addHandle}
      >
        <path d="M6 2.5 V9.5 M2.5 6 H9.5" />
      </Droplet>
      {onTogglePositionLock && (
        <Droplet
          angle={LOCK_ANGLE}
          divide={divide}
          live={active}
          label={positionLocked ? "Déverrouiller la position du nœud" : "Verrouiller la position du nœud"}
          tip={positionLocked ? NODE_TIPS.unlock : NODE_TIPS.lock}
          onPress={onTogglePositionLock}
        >
          <LockIcon closed={positionLocked} />
        </Droplet>
      )}
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
            fixed={fixedHandles}
            anchorRef={anchorRef}
            registry={registry}
            onDoomedChange={onDoomedChange}
            onRemove={onRemove}
            offset={handleOffsets?.[h.id]}
            onChanged={reportHandles}
            onDrag={onHandleDrag}
            selected={selectedHandle === h.id}
            onSelect={setSelectedHandle}
          />
        ))}
      </svg>
    </div>
  );
};

export default React.memo(EditNode);
