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

const MAX_PEEK = 3; // carte de face + jusqu'à 3 cartes qui dépassent derrière

// Décalage par carte en pile (cf. dessin de référence : coins haut/droit qui dépassent nettement,
// contours visibles plutôt qu'un fondu progressif) — décalage franc, léger rétrécissement, et une
// opacité qui reste élevée pour que chaque carte du fond reste bien lisible comme "une carte de
// plus", pas une simple ombre derrière la première.
const PEEK_OFFSET_X = 14;
const PEEK_OFFSET_Y = -14;
const SCALE_STEP = 0.04;
const OPACITY_STEP = 0.1;

// Course de sortie/entrée d'une carte qui quitte ou rejoint le premier plan (molette) : au-delà du
// coin d'ancrage, vers le bas-droite — jamais un simple fondu sur place.
const EXIT_PUSH_X = 60;
const EXIT_PUSH_Y = 40;

// Carte qui change de place entre la face et le fond (celle qui « voyage ») : trajet en trois points
// (départ → au-delà du coin d'ancrage → arrivée), joué à l'identique dans les deux sens — au
// défilement avant, la carte de face part vers le fond ; en sens inverse, c'est la même trajectoire
// parcourue à l'envers, la carte du fond remontant vers la face. L'ordre d'empilement bascule à
// mi-course (TRAVEL_Z_FLIP_S) pour que la carte passe derrière/devant au bon moment.
// Court et vif : le retour derrière la pile ne doit laisser aucune latence perceptible. L'ordre
// d'empilement bascule pile au passage du point extrême (40 % de la durée).
const TRAVEL_S = 0.32;
const TRAVEL = { duration: TRAVEL_S, ease: [0.3, 0.7, 0.4, 1] as [number, number, number, number], times: [0, 0.4, 1] };
const TRAVEL_Z_FLIP_S = TRAVEL_S * 0.4;
// Niveau d'empilement de la carte qui revient derrière la pile : STRICTEMENT sous toutes les autres
// (les cartes au-delà de MAX_PEEK partagent le même cran 100 - MAX_PEEK, d'où le −1).
const Z_BEHIND_ALL = 100 - MAX_PEEK - 1;

// Ressort de la pile attrapée : compression rapide à la prise, puis relâchement très rebondissant.
const GRAB_SPRING = { type: 'spring', stiffness: 700, damping: 26, mass: 0.6 } as const;
const RELEASE_SPRING = { type: 'spring', stiffness: 520, damping: 9, mass: 0.7 } as const;

const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.7 } as const;

// Deux modes selon le type de geste détecté :
// - cran de souris (deltaY franc et entier, évènement isolé) : exactement une carte par cran ;
// - défilement continu (pavé tactile, molette lisse : petits deltaY, flux rapproché) : inertie —
//   la vélocité s'accumule et se consomme en plusieurs pas, en décélérant.
const NOTCH_MIN_DELTA = 40; // en dessous, le deltaY est considéré comme un scroll continu
const SMOOTH_STREAM_GAP_MS = 120; // un évènement proche du précédent prolonge le mode continu
// L'élan dépend de la VITESSE du geste (px/s, deltaY / temps entre deux évènements), pas de la
// seule amplitude : un flick vif lance la pile bien plus loin qu'un défilement lent.
const SPEED_TO_VELOCITY = 0.009; // crans/s de vélocité par px/s de vitesse de scroll
const FIRST_EVENT_TO_VELOCITY = 0.03; // 1er évènement d'un geste (pas encore de vitesse mesurable)
const GESTURE_GAP_MS = 120; // au-delà, l'évènement ouvre un nouveau geste
const MAX_VELOCITY = 34; // crans/s plafond
// Freinage : exponentiel (une pile lancée vite glisse longtemps, en ralentissant progressivement)
// plus un terme linéaire qui l'arrête franchement au lieu de la laisser traîner.
const FRICTION_EXP_PER_SEC = 1.7;
const FRICTION_LINEAR_PER_SEC = 0.9;
const STEP_THRESHOLD = 1; // accumulation nécessaire pour avancer d'un cran
const MIN_VELOCITY = 0.05; // en dessous, on arrête la boucle d'inertie

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
  window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: { title, desc } }));
const resetTooltip = () => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));

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

export const NotificationStack: React.FC = () => {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [frontId, setFrontIdState] = useState<string | null>(null);
  // La pile change de contenu/ordre à chaque notif ou tick de molette : le listener natif doit
  // toujours voir la dernière valeur sans se réattacher (voir l'effet ci-dessous, tableau de deps
  // vide) — sinon détacher/rattacher le listener à chaque render créerait exactement le genre de
  // fenêtre "la molette ne répond plus tant qu'on n'a pas bougé la souris" observée avec le handler
  // React synthétique (React réattache alors AUSSI son propre listener passif sur le document, qui
  // peut regagner la main entre deux détachements du nôtre).
  const idsRef = useRef<string[]>([]);
  const frontIndexRef = useRef(0);
  // Inertie du mode continu : vélocité signée en crans/s, consommée frame par frame.
  const velocityRef = useRef(0);
  const stepAccumulatorRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(0);
  const lastWheelTimeRef = useRef(0);
  const smoothModeRef = useRef(false);
  // Pile « attrapée » (clic maintenu) : l'inertie est stoppée net, la pile se comprime puis
  // rebondit en ressort au relâchement.
  const [grabbed, setGrabbed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hauteur de la carte de face (variable : message sur plusieurs lignes une fois déplié) : la
  // colonne de boutons est centrée verticalement sur elle. Callback ref stable : la carte change
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

  // Carte qui voyage entre face et fond au dernier cran (cf. TRAVEL) ; remise à zéro quand la liste
  // change (ajout/fermeture), pour ne pas rejouer un trajet périmé.
  const travelIdRef = useRef<string | null>(null);
  const travelForwardRef = useRef(true);
  const lastCountRef = useRef(0);

  useEffect(() => subscribeToNotifications((its, front) => {
    if (its.length !== lastCountRef.current) travelIdRef.current = null;
    lastCountRef.current = its.length;
    setItems(its);
    setFrontIdState(front);
  }), []);

  // Ordre de cycle STABLE : toujours l'ordre de poussée (push order), jamais reconstruit autour de
  // la carte actuellement au premier plan — c'est ce qui garantit qu'avancer d'un cran à la molette
  // puis reculer d'un cran ramène exactement la même carte, dans les deux sens.
  const ids = useMemo(() => items.map((n) => n.id), [items]);

  // Index de la carte au premier plan DANS ce cycle stable (pas un id reconstruit à chaque
  // notification poussée par ailleurs : `frontId` ne fait que pointer dedans).
  const frontIndex = useMemo(() => {
    if (ids.length === 0) return 0;
    const idx = frontId ? ids.indexOf(frontId) : -1;
    return idx >= 0 ? idx : ids.length - 1;
  }, [ids, frontId]);

  idsRef.current = ids;
  frontIndexRef.current = frontIndex;

  const advance = useCallback((steps: number) => {
    const currentIds = idsRef.current;
    const n = currentIds.length;
    if (n < 2 || steps === 0) return;
    const nextIndex = (((frontIndexRef.current + steps) % n) + n) % n;
    // Avant : la carte de face part vers le fond. Arrière : la carte qui devient face en vient.
    travelForwardRef.current = steps > 0;
    travelIdRef.current = steps > 0 ? currentIds[frontIndexRef.current] : currentIds[nextIndex];
    frontIndexRef.current = nextIndex; // lu avant que le re-render React n'ait eu lieu
    setFrontNotification(currentIds[nextIndex]);
  }, []);

  // Boucle d'inertie (mode continu uniquement). `useCallback([])` est ESSENTIEL : une identité
  // changeante re-déclencherait la ref callback ci-dessous et annulerait le rAF planifié. Elle
  // s'auto-arrête sous MIN_VELOCITY.
  const stepInertia = useCallback((time: number) => {
    if (idsRef.current.length < 2 || Math.abs(velocityRef.current) < MIN_VELOCITY) {
      velocityRef.current = 0;
      stepAccumulatorRef.current = 0;
      rafRef.current = null;
      return;
    }
    const dt = lastFrameTimeRef.current ? (time - lastFrameTimeRef.current) / 1000 : 1 / 60;
    lastFrameTimeRef.current = time;

    stepAccumulatorRef.current += velocityRef.current * dt;
    let steps = 0;
    while (Math.abs(stepAccumulatorRef.current) >= STEP_THRESHOLD) {
      const dir = stepAccumulatorRef.current > 0 ? 1 : -1;
      steps += dir;
      stepAccumulatorRef.current -= dir * STEP_THRESHOLD;
    }
    advance(steps);

    const v = velocityRef.current;
    const decayed = Math.abs(v) * Math.exp(-FRICTION_EXP_PER_SEC * dt) - FRICTION_LINEAR_PER_SEC * dt;
    velocityRef.current = Math.sign(v) * Math.max(0, decayed);

    rafRef.current = requestAnimationFrame(stepInertia);
  }, [advance]);

  // Écouteur natif non passif (le `onWheel` React est passif : `preventDefault` sans effet, et le
  // geste zoomerait aussi le canvas Babylon). REF CALLBACK stable : le conteneur n'est monté qu'à
  // la première notif, un `useEffect(..., [])` ne le verrait jamais.
  const stackRefCallback = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (idsRef.current.length < 2) return;
      e.preventDefault();
      e.stopPropagation();

      const now = performance.now();
      const prevWheelTime = lastWheelTimeRef.current;
      const inStream = now - prevWheelTime < SMOOTH_STREAM_GAP_MS;
      lastWheelTimeRef.current = now;

      // Mode continu : deltaY faible/non entier, ou flux déjà engagé en continu (un flick de pavé
      // tactile peut produire de gros deltaY, mais toujours à la suite de petits).
      const isDiscrete = e.deltaMode !== 0 || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= NOTCH_MIN_DELTA);
      smoothModeRef.current = !isDiscrete || (smoothModeRef.current && inStream && Math.abs(e.deltaY) < NOTCH_MIN_DELTA * 3);

      if (!smoothModeRef.current) {
        // Cran de souris : une carte, et on coupe toute inertie résiduelle.
        velocityRef.current = 0;
        stepAccumulatorRef.current = 0;
        advance(e.deltaY > 0 ? 1 : -1);
        return;
      }

      const dir = e.deltaY > 0 ? 1 : -1;
      // Vitesse instantanée du geste (px/s) ; le 1er évènement d'un geste n'a pas d'évènement
      // précédent proche, on se rabat sur son amplitude.
      const dtMs = now - prevWheelTime;
      const kick = dir * Math.min(MAX_VELOCITY, dtMs < GESTURE_GAP_MS
        ? (Math.abs(e.deltaY) / Math.max(dtMs, 6)) * 1000 * SPEED_TO_VELOCITY
        : Math.abs(e.deltaY) * FIRST_EVENT_TO_VELOCITY);
      const v = velocityRef.current;
      // Même sens : la vélocité suit la vitesse du geste (lissée, et jamais réduite par un
      // évènement plus lent tant que l'élan acquis est plus grand) ; sens opposé : écrase.
      velocityRef.current = v === 0 || Math.sign(v) === dir
        ? dir * Math.min(MAX_VELOCITY, Math.max(Math.abs(v) * 0.85, Math.abs(v) * 0.5 + Math.abs(kick) * 0.5, Math.abs(kick) * 0.7))
        : kick;
      if (rafRef.current === null) {
        lastFrameTimeRef.current = 0;
        rafRef.current = requestAnimationFrame(stepInertia);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [advance, stepInertia]);

  const handleGrab = useCallback(() => {
    velocityRef.current = 0;
    stepAccumulatorRef.current = 0;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setGrabbed(true);
    const release = () => {
      setGrabbed(false);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }, []);

  const showToolbar = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setHovered(true);
  }, []);
  const hideToolbar = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHovered(false), TOOLBAR_HIDE_DELAY_MS);
  }, []);
  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); }, []);

  if (ids.length === 0) return null;

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
        {items.map((item, idx) => {
          // Cran relatif de cette carte par rapport au premier plan, dans le cycle stable (0 =
          // face, positif = vers le fond). `ids.length` peut dépasser largement MAX_PEEK (l'appli
          // tourne longtemps, beaucoup de notifs s'accumulent) : sans plafond, une carte qui vient
          // de quitter la face se retrouverait à un cran ~= ids.length, bien au-delà de la fenêtre
          // visible, et sauterait donc directement en hors-champ au lieu de glisser JUSQU'AU FOND
          // DE LA PILE VISIBLE (MAX_PEEK) — c'est ce plafond qui fait qu'elle "revient tout
          // derrière" (dernier cran affiché), pas juste un cran derrière la nouvelle face.
          let rawSlot = idx - frontIndex;
          if (rawSlot < 0) rawSlot += ids.length;
          const slot = Math.min(rawSlot, MAX_PEEK);

          const isFront = slot === 0;
          const target = stackTarget(slot);
          const travels = travelIdRef.current === item.id;
          // Carte qui retourne au fond : tout derrière, y compris les cartes déjà au dernier cran.
          const z = travels && travelForwardRef.current ? Z_BEHIND_ALL : 100 - slot;

          return (
            <motion.div
              key={item.id}
              ref={isFront ? frontCardRef : undefined}
              className={clsx(styles.card, isFront ? styles.front : styles.peek)}
              data-variant={item.variant}
              initial={false}
              animate={travels
                ? { ...target, x: [null, EXIT_PUSH_X, target.x], y: [null, EXIT_PUSH_Y, target.y], zIndex: z }
                : { ...target, zIndex: z }}
              exit={{ opacity: 0, x: EXIT_PUSH_X, y: EXIT_PUSH_Y, scale: 0.85 }}
              transition={travels
                ? { ...TRAVEL, zIndex: { duration: 0, delay: TRAVEL_Z_FLIP_S } }
                : { ...SPRING, zIndex: { duration: 0 } }}
            >
              {isFront && (
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
              {!isFront && <div className={styles.peekFill} />}
            </motion.div>
          );
        })}
      </AnimatePresence>

      <AnimatePresence>
        {hovered && (
          <motion.div
            key="toolbar"
            className={styles.toolbar}
            style={frontHeight ? { height: frontHeight } : undefined}
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
              onClick={() => { resetTooltip(); setHovered(false); clearNotifications(); }}
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
