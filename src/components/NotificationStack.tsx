import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { CircleCheck, CircleX, TriangleAlert, Loader2, X } from 'lucide-react';
import {
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

const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.7 } as const;

// Inertie du cycle à la molette : un flick ample/rapide doit continuer à faire défiler plusieurs
// crans après le relâchement, en décélérant, plutôt que de se limiter à 1 cran par tick physique.
const WHEEL_TO_VELOCITY = 0.02; // crans de vélocité gagnés par unité de deltaY
const MAX_VELOCITY = 14; // crans/s plafond, même pour un flick très violent
const FRICTION_PER_SEC = 6; // ~ combien de crans/s de vélocité sont retirés chaque seconde
const STEP_THRESHOLD = 1; // vélocité accumulée nécessaire pour avancer d'un cran
const MIN_VELOCITY = 0.05; // en dessous, on arrête la boucle d'inertie

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
  // Vélocité courante de l'inertie, en crans/s (signée : positif = avance, négatif = recule) — un
  // flick ample accumule une vélocité que la boucle d'inertie consomme ensuite en plusieurs pas,
  // en la faisant décroître par friction, plutôt qu'un unique cran par tick physique de molette.
  const velocityRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(0);
  // Vélocité accumulée mais pas encore "dépensée" en cran entier (cf. STEP_THRESHOLD) : conserve le
  // reliquat d'une frame à l'autre pour que l'avance reste fluide plutôt que par à-coups arrondis.
  const stepAccumulatorRef = useRef(0);

  useEffect(() => subscribeToNotifications((its, front) => {
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

  // Écouteur natif non passif (au lieu d'un `onWheel` React) : React attache ses gestionnaires
  // `wheel` synthétiques en mode PASSIF sur le document depuis React 17+, ce qui rend
  // `e.preventDefault()` sans effet (avertissement silencieux en console) — le geste continue de
  // remonter jusqu'au canvas Babylon (qui, lui, écoute le sien en `{ passive: false }`, cf.
  // Viewport3D.tsx `onCanvasWheel`) et zoome la caméra 3D en plus de faire défiler la pile. Un vrai
  // `addEventListener('wheel', ..., { passive: false })` ici permet un `preventDefault` qui
  // fonctionne réellement, et `stopPropagation` empêche toute fuite vers le canvas en dessous.
  //
  // Boucle d'inertie : consomme `velocityRef` frame par frame, avance d'un cran chaque fois que
  // l'accumulateur franchit STEP_THRESHOLD, et freine la vélocité par friction jusqu'à l'arrêt.
  // Démarrée par le premier événement wheel, s'auto-arrête (et libère `rafRef`) une fois la
  // vélocité retombée sous MIN_VELOCITY — jamais de boucle qui tourne pour rien en continu.
  //
  // `useCallback` avec deps vides (jamais recréée) est ESSENTIEL ici, pas juste une optimisation :
  // chaque pas d'inertie appelle `setFrontNotification`, qui déclenche un re-render — si
  // `stepInertia` (ou `stackRefCallback` plus bas) était redéfinie à chaque render, React verrait
  // une IDENTITÉ DE FONCTION différente à chaque passage et redéclencherait le cleanup + la
  // ré-invocation de la ref callback, ce qui annulait la frame de rAF déjà planifiée
  // (`cancelAnimationFrame` dans l'ancien cleanup) — la boucle s'arrêtait donc net après un seul
  // pas, pile le symptôme observé ("un seul cran puis plus rien"). Toutes les valeurs dont elle a
  // besoin viennent de refs (toujours à jour), donc aucune dépendance n'est nécessaire.
  const stepInertia = useCallback((time: number) => {
    const currentIds = idsRef.current;
    if (currentIds.length < 2 || Math.abs(velocityRef.current) < MIN_VELOCITY) {
      velocityRef.current = 0;
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
    if (steps !== 0) {
      const nextIndex = ((frontIndexRef.current + steps) % currentIds.length + currentIds.length) % currentIds.length;
      frontIndexRef.current = nextIndex; // lu par la frame suivante avant que le re-render React n'ait eu lieu
      setFrontNotification(currentIds[nextIndex]);
    }

    // Friction : réduit la vélocité vers 0 à taux constant (pas exponentiel) pour une décélération
    // qui se sent progressive puis s'arrête franchement, plutôt que de traîner indéfiniment.
    const friction = FRICTION_PER_SEC * dt;
    velocityRef.current = velocityRef.current > 0
      ? Math.max(0, velocityRef.current - friction)
      : Math.min(0, velocityRef.current + friction);

    rafRef.current = requestAnimationFrame(stepInertia);
  }, []);

  // REF CALLBACK (stable, `useCallback([])`) plutôt que `useRef` + `useEffect(..., [])` : le
  // composant retourne `null` tant qu'il n'y a aucune notif (`ids.length === 0` ci-dessous), donc
  // le tout premier montage réel du conteneur n'a lieu qu'à la PREMIÈRE notif poussée, jamais au
  // montage initial de NotificationStack lui-même. Un `useEffect(..., [])` capture `stackRef.current`
  // (encore `null`) à ce tout premier rendu et ne se réexécute plus jamais ensuite — le listener ne
  // s'attachait donc jamais. Une ref callback s'exécute à chaque fois que l'élément
  // apparaît/disparaît réellement dans le DOM ; stabilisée par `useCallback` pour ne s'exécuter que
  // sur un VRAI changement d'élément (montage/démontage), jamais à cause d'un re-render (cf. le
  // commentaire sur `stepInertia` ci-dessus pour les conséquences si ce n'était pas le cas).
  const stackRefCallback = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (idsRef.current.length < 2) return;
      e.preventDefault();
      e.stopPropagation();
      const dir = e.deltaY > 0 ? 1 : -1;
      const kick = Math.min(MAX_VELOCITY, Math.abs(e.deltaY) * WHEEL_TO_VELOCITY) * dir;
      // Un flick dans le même sens s'ADDITIONNE à la vélocité en cours (accélère l'inertie déjà en
      // route) ; un flick en sens opposé écrase la vélocité au lieu de s'y soustraire, pour changer
      // de direction immédiatement plutôt que devoir d'abord "annuler" l'élan précédent.
      velocityRef.current = Math.sign(velocityRef.current) === Math.sign(kick) || velocityRef.current === 0
        ? Math.sign(kick) * Math.min(MAX_VELOCITY, Math.abs(velocityRef.current) + Math.abs(kick))
        : kick;
      if (rafRef.current === null) {
        lastFrameTimeRef.current = 0;
        rafRef.current = requestAnimationFrame(stepInertia);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [stepInertia]);

  if (ids.length === 0) return null;

  return (
    <div className={styles.stack} ref={stackRefCallback}>
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

          return (
            <motion.div
              key={item.id}
              className={clsx(styles.card, isFront ? styles.front : styles.peek)}
              data-variant={item.variant}
              style={{ zIndex: 100 - slot }}
              initial={false}
              animate={stackTarget(slot)}
              exit={{ opacity: 0, x: EXIT_PUSH_X, y: EXIT_PUSH_Y, scale: 0.85 }}
              transition={SPRING}
            >
              {isFront && (
                <>
                  <span className={styles.icon}>{VARIANT_ICONS[item.variant]}</span>
                  <span className={styles.message}>{item.message}</span>
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
    </div>
  );
};
