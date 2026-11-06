import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { CircleCheck, CircleX, TriangleAlert, Loader2, X, Layers } from 'lucide-react';
import {
  clearNotifications,
  removeNotification,
  setFrontNotification,
  subscribeToNotifications,
  type NotificationItem,
  type NotificationVariant,
} from '@/utils/notificationStore';
import styles from './NotificationStack.module.scss';

import { emitApex } from '@/events/apexEvents';
const MAX_PEEK = 3; // carte de face + jusqu'à 3 cartes qui dépassent derrière

// Décalage par carte en pile (cf. dessin de référence : coins haut/droit qui dépassent nettement,
// contours visibles plutôt qu'un fondu progressif) — décalage franc, léger rétrécissement, et une
// opacité qui reste élevée pour que chaque carte du fond reste bien lisible comme "une carte de
// plus", pas une simple ombre derrière la première.
// Décalage par carte : 20 px le long de l'axe de la pile (haut-droite, environ 37° par rapport à
// l'horizontale : cos 0,6 / sin 0,8), soit 12 px en x et 16 px en y.
const PEEK_OFFSET_X = 12;
const PEEK_OFFSET_Y = -16;
const SCALE_STEP = 0.04;
const OPACITY_STEP = 0.1;

// Glissement de sortie / d'entrée d'une carte (fondu + glissement) : 20 px, dans le sens opposé à la
// pile (vers le bas-gauche, sur le même axe). Une carte qui sort glisse vers ce point ; une carte qui
// entre part de ce point et rejoint son cran.
const EXIT_PUSH_X = -PEEK_OFFSET_X;
const EXIT_PUSH_Y = -PEEK_OFFSET_Y;

// Seules les cartes qui entrent dans la pile visible ou en sortent sont animées : fondu + glissement
// sur le trajet de sortie (EXIT_PUSH), dans les deux sens. Les autres cartes changent de cran sans
// animation : aucun déplacement dans la pile.
const FADE = { duration: 0.28, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] };
const SNAP = { duration: 0 };
// « Tout fermer » : retard de sortie entre deux cartes consécutives de la pile (face d'abord).
const CASCADE_STEP_S = 0.09;
// Durée de maintien de la pile montée une fois vide : cascade complète (MAX_PEEK retards + fondu).
const LINGER_MS = 900;
// Déplacement des cartes vers leur nouveau cran dans la pile (toutes les cartes se déplacent).
const MOVE_SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.7 } as const;

// Ressort de la pile attrapée : compression rapide à la prise, puis relâchement très rebondissant.
const GRAB_SPRING = { type: 'spring', stiffness: 700, damping: 26, mass: 0.6 } as const;
const RELEASE_SPRING = { type: 'spring', stiffness: 520, damping: 9, mass: 0.7 } as const;

// Deux modes selon le type de geste détecté :
// - cran de souris (deltaY franc et entier, évènement isolé) : exactement une carte par cran ;
// - défilement continu (pavé tactile, molette lisse : petits deltaY, flux rapproché) : inertie —
//   la vélocité s'accumule et se consomme en plusieurs pas, en décélérant.
const NOTCH_MIN_DELTA = 40; // en dessous, le deltaY est considéré comme un scroll continu
const SMOOTH_STREAM_GAP_MS = 120; // un évènement proche du précédent prolonge le mode continu
// L'élan dépend de la VITESSE du geste (px/s, deltaY / temps entre deux évènements), pas de la
// seule amplitude : un flick vif lance la pile bien plus loin qu'un défilement lent.
const SPEED_TO_VELOCITY = 0.008; // crans/s de vélocité par px/s de vitesse de scroll
const FIRST_EVENT_TO_VELOCITY = 0.025; // 1er évènement d'un geste (pas encore de vitesse mesurable)
const GESTURE_GAP_MS = 120; // au-delà, l'évènement ouvre un nouveau geste
const MAX_VELOCITY = 30; // crans/s plafond
const NOTCH_STREAM_GAP_MS = 260; // crans de molette plus rapprochés : ils lancent la pile
const NOTCH_TO_VELOCITY = 0.3; // impulsion (crans/s) ajoutée par un cran de molette, par cran/s de cadence
// Plus on défile vite, plus la pile prend de la vitesse ET d'inertie :
// - ACCEL_GAIN : tant que le geste continue dans le même sens, chaque évènement ajoute à la vélocité
//   une part de sa propre vitesse (elle monte au lieu de simplement suivre le geste) ;
// - durée de glisse après le dernier évènement : GLIDE_MIN_S pour un geste lent, GLIDE_MAX_S pour un
//   geste au plafond de vélocité (interpolée selon la pointe du geste).
const ACCEL_GAIN = 0.3;
const GLIDE_MIN_S = 1.2;
const GLIDE_MAX_S = 3.2;
const STEP_THRESHOLD = 1; // accumulation nécessaire pour avancer d'un cran
const MIN_VELOCITY = 0.4; // en dessous (moins d'un cran toutes les 2,5 s), on arrête la boucle d'inertie

// Boutons d'en-tête (survol de la pile) : même fondu-montée que les panneaux de Prévisualisation
// (fondu + glissement de 6 px, easing « standard » Material).
const TOOLBAR_VARIANTS = {
  hidden: { opacity: 0, y: 6, transition: { duration: 0.16, ease: [0.4, 0, 0.2, 1] as const } },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const } },
};
// Délai avant de masquer les boutons quand le pointeur quitte la pile : évite le clignotement quand il
// traverse l'interstice entre deux cartes ou entre la carte et les boutons.
const TOOLBAR_HIDE_DELAY_MS = 180;

const setTooltip = (title: string, desc: string) =>
  emitApex('apex-set-tooltip', { title, desc });
const resetTooltip = () => emitApex('apex-reset-tooltip');

const VARIANT_ICONS: Record<NotificationVariant, React.ReactNode> = {
  success: <CircleCheck size={18} />,
  error: <CircleX size={18} />,
  warning: <TriangleAlert size={18} />,
  loading: <Loader2 size={18} className="animate-spin" />,
};

/** Position/apparence d'une carte selon son cran dans la pile visible (0 = face, 1..MAX_PEEK = fond,
 * cf. le plafonnement de `slot` plus bas). */
function stackTarget(slot: number) {
  return {
    x: slot * PEEK_OFFSET_X,
    y: slot * PEEK_OFFSET_Y,
    scale: 1 - slot * SCALE_STEP,
    opacity: Math.max(0.55, 1 - slot * OPACITY_STEP),
  };
}

/**
 * Message de la carte de face : une seule ligne avec points de suspension s'il ne tient pas ; dans
 * ce cas il est cliquable et se déplie sur toutes ses lignes (re-clic pour replier). La troncature
 * est mesurée (scrollWidth > clientWidth) à chaque changement de texte ou de largeur de carte.
 */
const FrontMessage: React.FC<{ message: string }> = ({ message }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Mesure en mode une ligne uniquement : déplié, le texte tient par construction.
    if (!expanded) setTruncated(el.scrollWidth > el.clientWidth + 1);
    const ro = new ResizeObserver(() => {
      if (!expanded) setTruncated(el.scrollWidth > el.clientWidth + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [message, expanded]);

  const interactive = truncated || expanded;
  return (
    <span
      ref={ref}
      className={clsx(styles.message, expanded ? styles.messageExpanded : styles.messageClamped, { [styles.messageClickable]: interactive })}
      title={interactive && !expanded ? 'Cliquer pour afficher le message en entier' : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => setExpanded((v) => !v) : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v); } } : undefined}
    >
      {message}
    </span>
  );
};

/** État mutable du défilement à la molette et de son inertie (lu par les écouteurs natifs sans les réattacher). */
interface InertiaState {
  ids: string[];
  frontIndex: number;
  /** Inertie du mode continu : vélocité signée en crans/s, consommée frame par frame. */
  velocity: number;
  stepAccumulator: number;
  /** Vélocité maximale atteinte pendant le geste en cours (|crans/s|) : règle l'inertie. */
  peak: number;
  lastNotchDir: number;
  raf: number | null;
  lastFrameTime: number;
  lastWheelTime: number;
  smooth: boolean;
}

const newInertiaState = (): InertiaState => ({
  ids: [], frontIndex: 0, velocity: 0, stepAccumulator: 0, peak: 0, lastNotchDir: 0,
  raf: null, lastFrameTime: 0, lastWheelTime: 0, smooth: false,
});

/** Lance la boucle d'inertie si elle ne tourne pas déjà. */
function startInertia(s: InertiaState, stepInertia: (time: number) => void) {
  if (s.raf === null) {
    s.lastFrameTime = 0;
    s.raf = requestAnimationFrame(stepInertia);
  }
}

/** Cran de souris : une carte par cran ; des crans rapprochés dans le même sens lancent la pile. */
function handleNotch(s: InertiaState, e: WheelEvent, now: number, advance: (steps: number) => void, stepInertia: (time: number) => void) {
  // Un cran isolé (ou un changement de sens) coupe l'inertie ; la cadence des crans donne la
  // vélocité, qui s'emballe tant que la molette continue.
  const notchDir = e.deltaY > 0 ? 1 : -1;
  const dtNotch = now - s.lastWheelTime;
  const v0 = s.velocity;
  advance(notchDir);
  if (dtNotch < NOTCH_STREAM_GAP_MS && (v0 === 0 ? s.lastNotchDir === notchDir : Math.sign(v0) === notchDir)) {
    const rate = 1000 / Math.max(dtNotch, 16); // crans/s
    // Chaque cran est une impulsion proportionnelle à la cadence, ajoutée à l'élan acquis :
    // la vélocité s'accumule (quadratique en cadence) au lieu de seulement suivre la molette.
    const next = Math.abs(v0) * 0.97 + rate * NOTCH_TO_VELOCITY;
    s.velocity = notchDir * Math.min(MAX_VELOCITY, next);
    s.peak = Math.max(s.peak, Math.abs(s.velocity));
    startInertia(s, stepInertia);
  } else {
    s.velocity = 0;
    s.stepAccumulator = 0;
    s.peak = 0;
  }
  s.lastNotchDir = notchDir;
}

/** Défilement continu (pavé tactile, molette lisse) : la vélocité suit la vitesse du geste et s'emballe. */
function handleSmooth(s: InertiaState, e: WheelEvent, now: number, inStream: boolean, stepInertia: (time: number) => void) {
  const dir = e.deltaY > 0 ? 1 : -1;
  // Vitesse instantanée du geste (px/s) ; le 1er évènement d'un geste n'a pas d'évènement
  // précédent proche, on se rabat sur son amplitude.
  const dtMs = now - s.lastWheelTime;
  const kick = dir * Math.min(MAX_VELOCITY, dtMs < GESTURE_GAP_MS
    ? (Math.abs(e.deltaY) / Math.max(dtMs, 6)) * 1000 * SPEED_TO_VELOCITY
    : Math.abs(e.deltaY) * FIRST_EVENT_TO_VELOCITY);
  const v = s.velocity;
  // Même sens : la vélocité suit la vitesse du geste (lissée, et jamais réduite par un
  // évènement plus lent tant que l'élan acquis est plus grand) ; sens opposé : écrase.
  const sameDir = v === 0 || Math.sign(v) === dir;
  if (sameDir) {
    const base = Math.max(Math.abs(v) * 0.85, Math.abs(v) * 0.5 + Math.abs(kick) * 0.5, Math.abs(kick) * 0.7);
    // Geste qui se poursuit : la vélocité s'emballe en plus de suivre la vitesse du geste.
    const boost = inStream ? Math.abs(kick) * ACCEL_GAIN : 0;
    s.velocity = dir * Math.min(MAX_VELOCITY, base + boost);
  } else {
    s.velocity = kick;
    s.peak = 0; // changement de sens : nouveau geste
  }
  s.peak = Math.max(s.peak, Math.abs(s.velocity));
  startInertia(s, stepInertia);
}

/** Écouteur de molette : choisit entre cran de souris et défilement continu. */
function makeWheelHandler(s: InertiaState, advance: (steps: number) => void, stepInertia: (time: number) => void) {
  return (e: WheelEvent) => {
    if (s.ids.length < 2) return;
    e.preventDefault();
    e.stopPropagation();

    const now = performance.now();
    const inStream = now - s.lastWheelTime < SMOOTH_STREAM_GAP_MS;

    // Mode continu : deltaY faible/non entier, ou flux déjà engagé en continu (un flick de pavé
    // tactile peut produire de gros deltaY, mais toujours à la suite de petits).
    // Avec une mise à l'échelle Windows (125 %, 150 %…) un cran de 100 px arrive en deltaY non
    // entier (80, 66,67…) : on teste l'entier en pixels physiques (deltaY × devicePixelRatio).
    const physical = e.deltaY * window.devicePixelRatio;
    const isWholeStep = Number.isInteger(e.deltaY) || Math.abs(physical - Math.round(physical)) < 0.02;
    const isDiscrete = e.deltaMode !== 0 || (isWholeStep && Math.abs(e.deltaY) >= NOTCH_MIN_DELTA);
    s.smooth = !isDiscrete || (s.smooth && inStream && Math.abs(e.deltaY) < NOTCH_MIN_DELTA * 3);

    if (s.smooth) handleSmooth(s, e, now, inStream, stepInertia);
    else handleNotch(s, e, now, advance, stepInertia);
    s.lastWheelTime = now;
  };
}

/**
 * Défilement de la pile à la molette, avec inertie. Renvoie la ref callback du conteneur (écouteur natif
 * non passif) et l'arrêt net de l'inertie (pile attrapée).
 */
function useStackInertia(ids: string[], frontIndex: number) {
  const s = useRef<InertiaState>(newInertiaState()).current;
  s.ids = ids;
  s.frontIndex = frontIndex;

  const advance = useCallback((steps: number) => {
    const n = s.ids.length;
    if (n < 2 || steps === 0) return;
    const nextIndex = (((s.frontIndex + steps) % n) + n) % n;
    s.frontIndex = nextIndex; // lu avant que le re-render React n'ait eu lieu
    setFrontNotification(s.ids[nextIndex]);
  }, [s]);

  // Boucle d'inertie (mode continu uniquement). `useCallback` à identité stable est ESSENTIEL : une
  // identité changeante re-déclencherait la ref callback ci-dessous et annulerait le rAF planifié.
  // Elle s'auto-arrête sous MIN_VELOCITY.
  const stepInertia = useCallback((time: number) => {
    if (s.ids.length < 2 || Math.abs(s.velocity) < MIN_VELOCITY) {
      s.velocity = 0;
      s.stepAccumulator = 0;
      s.peak = 0;
      s.raf = null;
      return;
    }
    const dt = s.lastFrameTime ? (time - s.lastFrameTime) / 1000 : 1 / 60;
    s.lastFrameTime = time;

    s.stepAccumulator += s.velocity * dt;
    let steps = 0;
    while (Math.abs(s.stepAccumulator) >= STEP_THRESHOLD) {
      const dir = s.stepAccumulator > 0 ? 1 : -1;
      steps += dir;
      s.stepAccumulator -= dir * STEP_THRESHOLD;
    }
    advance(steps);

    const v = s.velocity;
    // Décroissance exponentielle calibrée sur la durée de glisse : la vélocité de pointe du geste
    // retombe à MIN_VELOCITY en exactement GLIDE_MIN_S … GLIDE_MAX_S secondes (selon cette pointe).
    const peak = Math.max(s.peak, MIN_VELOCITY * 2);
    const glideS = GLIDE_MIN_S + (GLIDE_MAX_S - GLIDE_MIN_S) * Math.min(1, peak / MAX_VELOCITY);
    const rate = Math.log(peak / MIN_VELOCITY) / glideS;
    s.velocity = Math.sign(v) * Math.abs(v) * Math.exp(-rate * dt);

    s.raf = requestAnimationFrame(stepInertia);
  }, [s, advance]);

  // Écouteur natif non passif (le `onWheel` React est passif : `preventDefault` sans effet, et le
  // geste zoomerait aussi le canvas Babylon). REF CALLBACK stable : le conteneur n'est monté qu'à
  // la première notif, un `useEffect(..., [])` ne le verrait jamais.
  const stackRefCallback = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const onWheel = makeWheelHandler(s, advance, stepInertia);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (s.raf !== null) {
        cancelAnimationFrame(s.raf);
        s.raf = null;
      }
    };
  }, [s, advance, stepInertia]);

  const stopInertia = useCallback(() => {
    s.velocity = 0;
    s.peak = 0;
    s.stepAccumulator = 0;
    if (s.raf !== null) {
      cancelAnimationFrame(s.raf);
      s.raf = null;
    }
  }, [s]);

  return { stackRefCallback, stopInertia };
}

/** Contenu de la pile (abonnement au magasin), carte sortante et maintien de la pile une fois vide. */
function useNotificationFeed() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [frontId, setFrontIdState] = useState<string | null>(null);
  // Carte qui quitte le premier plan : elle garde son contenu pendant son fondu de sortie.
  const [outgoingId, setOutgoingId] = useState<string | null>(null);
  const storeFrontIdRef = useRef<string | null>(null);
  const hadItemsRef = useRef(false);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lingering, setLingering] = useState(false);

  useEffect(() => subscribeToNotifications((its, front) => {
    const prev = storeFrontIdRef.current;
    if (prev && prev !== front && its.some((n) => n.id === prev)) setOutgoingId(prev);
    storeFrontIdRef.current = front;
    // Pile qui se vide : elle reste montée le temps des fondus de sortie (sinon la dernière carte,
    // ou toute la cascade de « tout fermer », serait coupée net par le démontage du conteneur).
    if (its.length === 0 && hadItemsRef.current) {
      setLingering(true);
      if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current);
      lingerTimerRef.current = setTimeout(() => setLingering(false), LINGER_MS);
    }
    hadItemsRef.current = its.length > 0;
    setItems(its);
    setFrontIdState(front);
  }), []);
  useEffect(() => () => { if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current); }, []);
  return { items, frontId, outgoingId, setOutgoingId, lingering };
}

/**
 * Au rendu précédent : visibilité de chaque carte, et dernier cran où elle était visible. Sert à
 * repérer les cartes qui entrent dans la pile visible ou en sortent (les seules animées), et à les
 * laisser sur leur dernier cran pendant leur fondu de sortie.
 */
function useFadeTracking(items: NotificationItem[], frontIndex: number) {
  const visibleRef = useRef<Map<string, boolean>>(new Map());
  const lastSlotRef = useRef<Map<string, number>>(new Map());
  // Cartes en cours de fondu (entrée ou sortie) : leur animation continue même si le rendu change.
  const [fading, setFading] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const started: string[] = [];
    const nowVisible = new Map<string, boolean>();
    items.forEach((n, idx) => {
      let rawSlot = idx - frontIndex;
      if (rawSlot < 0) rawSlot += items.length;
      const visible = rawSlot <= MAX_PEEK;
      const was = visibleRef.current.get(n.id);
      if (was !== undefined && was !== visible) started.push(n.id);
      nowVisible.set(n.id, visible);
      if (visible) lastSlotRef.current.set(n.id, Math.min(rawSlot, MAX_PEEK));
    });
    visibleRef.current = nowVisible;
    if (started.length) setFading((prev) => new Set([...prev, ...started]));
  });
  const settleFade = useCallback((id: string) => {
    setFading((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);
  return { visibleRef, lastSlotRef, fading, settleFade };
}

/** Hauteur de la carte de face (variable : message sur plusieurs lignes une fois déplié). */
function useFrontHeight() {
  // La colonne de boutons est centrée verticalement sur elle. Callback ref stable : la carte change
  // d'identité quand on fait défiler la pile, l'ancien observateur est alors remplacé.
  const [frontHeight, setFrontHeight] = useState<number | null>(null);
  const frontObserverRef = useRef<ResizeObserver | null>(null);
  const frontCardRef = useCallback((el: HTMLDivElement | null) => {
    frontObserverRef.current?.disconnect();
    frontObserverRef.current = null;
    if (!el) return;
    setFrontHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setFrontHeight(el.offsetHeight));
    ro.observe(el);
    frontObserverRef.current = ro;
  }, []);
  return { frontHeight, frontCardRef };
}

/** Survol de la pile : boutons d'en-tête affichés tout de suite, masqués avec un délai. */
function useToolbarHover() {
  const [hovered, setHovered] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToolbar = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setHovered(true);
  }, []);
  const hideToolbar = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHovered(false), TOOLBAR_HIDE_DELAY_MS);
  }, []);
  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); }, []);
  return { hovered, setHovered, showToolbar, hideToolbar };
}

interface StackCardProps {
  item: NotificationItem;
  idx: number;
  count: number;
  frontIndex: number;
  clearing: boolean;
  outgoingId: string | null;
  setOutgoingId: (id: string | null) => void;
  frontCardRef: (el: HTMLDivElement | null) => void;
  fade: ReturnType<typeof useFadeTracking>;
}

/** Une carte de la pile : conteneur de position (cran) et carte qui porte le fondu. */
const StackCard: React.FC<StackCardProps> = ({ item, idx, count, frontIndex, clearing, outgoingId, setOutgoingId, frontCardRef, fade }) => {
  const { visibleRef, lastSlotRef, fading, settleFade } = fade;
  // Cran relatif de cette carte par rapport au premier plan, dans le cycle stable (0 = face,
  // positif = vers le fond). Au-delà de MAX_PEEK la carte reste montée mais hors de la pile
  // visible (invisible, sans pointeur) jusqu'à y revenir ; le plafond fait qu'une carte qui vient
  // de quitter la face glisse JUSQU'AU FOND DE LA PILE VISIBLE (MAX_PEEK) plutôt que hors champ.
  let rawSlot = idx - frontIndex;
  if (rawSlot < 0) rawSlot += count;
  const visibleNow = rawSlot <= MAX_PEEK;
  const slot = Math.min(rawSlot, MAX_PEEK);
  const isFront = slot === 0;

  // Entrée / sortie de la pile visible : fondu + glissement de 20 px. Une carte qui sort reste
  // sur son dernier cran pendant son fondu ; une carte qui entre part de 20 px en retrait de son
  // cran. Les autres cartes changent de cran sans animation.
  const wasVisible = visibleRef.current.get(item.id);
  const changed = wasVisible !== undefined && wasVisible !== visibleNow;
  const animating = changed || fading.has(item.id);
  const leaving = changed && !visibleNow;
  const outerSlot = visibleNow
    ? slot
    : animating ? (lastSlotRef.current.get(item.id) ?? MAX_PEEK) : MAX_PEEK;
  const outerTarget = stackTarget(outerSlot);
  const showContent = isFront || item.id === outgoingId;

  return (
    // Conteneur de position (cran dans la pile, changé sans animation) ; la carte à l'intérieur
    // porte seule le fondu et le glissement, relatifs à son cran.
    <motion.div
      className={styles.slot}
      initial={false}
      animate={outerTarget}
      transition={MOVE_SPRING}
      exit={{
        x: outerTarget.x + EXIT_PUSH_X,
        y: outerTarget.y + EXIT_PUSH_Y,
        opacity: 0,
        transition: clearing
          ? visibleNow ? { ...FADE, delay: slot * CASCADE_STEP_S } : SNAP
          : FADE,
      }}
      style={{
        // La carte qui sort reste au-dessus pendant son fondu, pas sous la nouvelle face.
        zIndex: leaving ? 101 : visibleNow ? 100 - slot : 0,
        pointerEvents: visibleNow || animating ? 'auto' : 'none',
      }}
    >
      <motion.div
        ref={isFront ? frontCardRef : undefined}
        className={clsx(styles.card, !showContent && styles.peek)}
        data-variant={item.variant}
        initial={false}
        animate={visibleNow ? { x: 0, y: 0, opacity: 1 } : { x: EXIT_PUSH_X, y: EXIT_PUSH_Y, opacity: 0 }}
        transition={animating ? FADE : SNAP}
        style={{ pointerEvents: visibleNow || animating ? 'auto' : 'none' }}
        onAnimationComplete={() => {
          settleFade(item.id);
          if (item.id === outgoingId) setOutgoingId(null);
        }}
      >
        {showContent && (
          <>
            <span className={styles.icon}>{VARIANT_ICONS[item.variant]}</span>
            <FrontMessage key={item.id} message={item.message} />
            <button
              type="button"
              className={styles.close}
              aria-label="Fermer"
              onClick={() => removeNotification(item.id)}
            >
              <X size={14} />
            </button>
          </>
        )}
        {!showContent && <div className={styles.peekFill} />}
      </motion.div>
    </motion.div>
  );
};

/** Colonne de boutons affichée au survol de la pile. */
const StackToolbar: React.FC<{ frontHeight: number | null; onClear: () => void }> = ({ frontHeight, onClear }) => (
  <motion.div
    key="toolbar"
    className={styles.toolbar}
    style={frontHeight ? { height: frontHeight } : {}}
    variants={TOOLBAR_VARIANTS}
    initial="hidden"
    animate="visible"
    exit="hidden"
    // Cliquer un bouton ne doit pas « attraper » (comprimer) la pile.
    onPointerDown={(e) => e.stopPropagation()}
  >
    <button
      type="button"
      className={clsx(styles.toolbarButton, styles.toolbarButtonSoon)}
      aria-label="Calques de notifications (arrive bientôt)"
      aria-disabled="true"
      onMouseEnter={() => setTooltip('Calques', 'Arrive bientôt')}
      onMouseLeave={resetTooltip}
    >
      <Layers size={14} />
    </button>
    <button
      type="button"
      className={styles.toolbarButton}
      aria-label="Fermer toutes les notifications"
      onMouseEnter={() => setTooltip('Tout fermer', 'Ferme toutes les notifications.')}
      onMouseLeave={resetTooltip}
      onClick={onClear}
    >
      <X size={14} />
    </button>
  </motion.div>
);

export const NotificationStack: React.FC = () => {
  const { items, frontId, outgoingId, setOutgoingId, lingering } = useNotificationFeed();
  // Pile « attrapée » (clic maintenu) : l'inertie est stoppée net, la pile se comprime puis
  // rebondit en ressort au relâchement.
  const [grabbed, setGrabbed] = useState(false);
  const { hovered, setHovered, showToolbar, hideToolbar } = useToolbarHover();
  const { frontHeight, frontCardRef } = useFrontHeight();

  // « Tout fermer » : les cartes sont retirées d'un coup, mais chacune sort avec un retard croissant
  // de la face vers le fond (cascade fondu + glissement). Le retard est posé dans la prop `exit` au
  // rendu qui précède le retrait ; la pile n'est vidée qu'une fois ce rendu validé.
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    if (!clearing) return;
    clearNotifications();
    setClearing(false);
  }, [clearing]);

  // Ordre de cycle STABLE : toujours l'ordre de poussée (push order), jamais reconstruit autour de
  // la carte actuellement au premier plan — c'est ce qui garantit qu'avancer d'un cran à la molette
  // puis reculer d'un cran ramène exactement la même carte, dans les deux sens.
  const ids = useMemo(() => items.map((n) => n.id), [items]);
  // Index de la carte au premier plan DANS ce cycle stable (`frontId` ne fait que pointer dedans).
  const frontIndex = useMemo(() => {
    if (ids.length === 0) return 0;
    const idx = frontId ? ids.indexOf(frontId) : -1;
    return idx >= 0 ? idx : ids.length - 1;
  }, [ids, frontId]);

  const fade = useFadeTracking(items, frontIndex);
  const { stackRefCallback, stopInertia } = useStackInertia(ids, frontIndex);

  const handleGrab = useCallback(() => {
    stopInertia();
    setGrabbed(true);
    const release = () => {
      setGrabbed(false);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }, [stopInertia]);

  if (ids.length === 0 && !lingering) return null;

  return (
    <motion.div
      className={styles.stack}
      ref={stackRefCallback}
      onPointerDown={handleGrab}
      onMouseEnter={showToolbar}
      onMouseLeave={hideToolbar}
      animate={{ scale: grabbed ? 0.94 : 1 }}
      transition={grabbed ? GRAB_SPRING : RELEASE_SPRING}
    >
      <AnimatePresence initial={false}>
        {items.map((item, idx) => (
          <StackCard
            key={item.id}
            item={item}
            idx={idx}
            count={ids.length}
            frontIndex={frontIndex}
            clearing={clearing}
            outgoingId={outgoingId}
            setOutgoingId={setOutgoingId}
            frontCardRef={frontCardRef}
            fade={fade}
          />
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {hovered && (
          <StackToolbar
            frontHeight={frontHeight}
            onClear={() => { resetTooltip(); setHovered(false); setClearing(true); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};
