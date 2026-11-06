import React, { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './SpaceTransitionOverlay.module.scss';
import { ShutdownLoaders } from './ShutdownLoaders';
import VeilWorker from '@/workers/veil.worker?worker&inline';
import { BLUR_MS, TILE_ANIM_MS, TILE_COLS, TILE_ROWS, TILE_STEP_MS, veilNow, veilState, type VeilClock } from '@/utils/veilTimeline';

import { emitApex } from '@/events/apexEvents';
/**
 * Rideau plein écran joué à chaque changement d'espace (Préparation / Prévisualisation /
 * Modélisation / Dev), en 4 étapes STRICTEMENT séquentielles (le flou est entièrement terminé
 * avant que le voile ne commence à apparaître — jamais les deux à la fois) :
 *   1. blur    — flou de l'interface, sans aucune teinte de couleur.
 *   2. paint   — une fois le flou installé, le voile bleu opaque est « peint » par grosses tuiles
 *                (grille TILE_COLS × TILE_ROWS), chacune apparaissant avec un délai croissant
 *                selon sa distance au coin haut-droit, façon touches de pinceau qui balaient
 *                l'écran en diagonale vers le coin bas-gauche.
 *   3. text    — le texte apparaît une fois toutes les tuiles posées ("APEX" en Ethnocentric, le
 *                nom de l'espace en Orbitron) ; c'est aussi à ce moment que le switch réel a lieu.
 *   4. fadeout — même effet de tuiles que l'apparition, rejoué à l'identique (mêmes délais, même
 *                balayage diagonal) mais en disparition ; le flou se dissipe en même temps,
 *                révélant le nouvel espace.
 *
 * Aussi utilisé comme rideau d'attente d'un chargement lourd (`apex-gcode-loading`) : voir plus bas.
 *
 * Piloté par l'événement `apex-space-transition` (voir Sidebar.tsx, seul émetteur) plutôt qu'un
 * state React partagé, pour rester cohérent avec le bus d'événements global du reste de l'app
 * (cf. CLAUDE.md).
 */

// Chronologie des tuiles (BLUR_MS, TILE_*) : src/utils/veilTimeline.ts, partagée avec le Worker qui les peint.
// Le dernier délai + sa propre durée d'anim = durée totale de la phase "paint".
const PAINT_MS = (TILE_COLS + TILE_ROWS - 2) * TILE_STEP_MS + TILE_ANIM_MS;
// 3. texte affiché, voile plein écran (switch réel ici). La barre sous le nom de l'espace
// (.scanline) s'étend une fois (SCANLINE_CYCLE_MS) avant que l'espace ne soit dévoilé : c'est le
// délai minimal, le même pour tous les espaces. Aucun délai obligatoire supplémentaire : si un
// chargement est en cours (`apex-gcode-loading`), le rideau est maintenu jusqu'à sa fin, et
// seulement jusque-là. (Modélisation avait 6 répétitions imposées ; retirées à la demande de
// l'utilisateur, 2026-10-13.)
const SCANLINE_CYCLE_MS = 1000;
const SCANLINE_REPEAT = 1;
const getScanlineRepeat = (_label: string) => SCANLINE_REPEAT;
const getTextMs = (label: string) => SCANLINE_CYCLE_MS * getScanlineRepeat(label);
const FADEOUT_MS = PAINT_MS; // 4. même effet de tuiles que l'apparition, même durée totale

type Phase = 'blur' | 'paint' | 'text' | 'fadeout';

interface SpaceTransitionDetail {
  label: string;
  onCovered?: () => void;
}

// Tuiles peintes par un Worker (OffscreenCanvas, cf. veil.worker.ts) : l'animation ne dépend pas du thread
// principal, qui peut être occupé (initialisation du viewport, montage d'un espace, maillage).
// Singleton : `transferControlToOffscreen` ne peut être appelé qu'une fois par canevas (StrictMode
// monte les effets deux fois en développement).
let veilWorker: Worker | null = null;
let veilCanvas: HTMLCanvasElement | null = null;
const sendVeil = (msg: unknown) => veilWorker?.postMessage(msg);
const startVeil = (dir: VeilClock['dir']) => {
  const clock: VeilClock = { dir, start: veilNow() };
  veilState.clock = clock;
  sendVeil({ type: 'play', clock });
};
const clearVeil = () => {
  veilState.clock = null;
  sendVeil({ type: 'clear' });
};

// Largeur cible (en px) que le nom de l'espace doit occuper, quel que soit le nombre de
// lettres — c'est ce qui fait que "DEV" et "PRÉVISUALISATION" remplissent tous les deux le
// même cadre plutôt que d'avoir un espacement de lettres fixe (donc une largeur qui varie
// avec la longueur du mot).
const SPACE_NAME_TARGET_WIDTH_PX = 260;

/** État et actions partagés par le rideau : refs de la machine à phases et setters React. */
interface CurtainCtl {
  timeouts: { current: number[] };
  loading: { current: boolean };
  /** Le texte est affiché, la fin de la phase "text" est atteinte mais le chargement n'est pas fini. */
  waiting: { current: boolean };
  /** Le rideau est à l'écran ou en train de s'y installer (de `blur` jusqu'à la fin de `fadeout`). */
  running: { current: boolean };
  fading: { current: boolean };
  setLabel: (label: string | null) => void;
  setPhase: (phase: Phase) => void;
  setHolding: (holding: boolean) => void;
  setShutdown: (shutdown: boolean) => void;
  setShutdownMsg: (message: string) => void;
}

// Rendu 3D en pause tant que le voile est opaque (phase « text » et attente de chargement) :
// voir `apex-render-pause` dans Viewport3D.
const pauseRender = (paused: boolean) => emitApex('apex-render-pause', { paused });

/** Déroulé du rideau : annulation des minuteries, sortie en fondu, installation (flou, tuiles, texte). */
function createCurtainRunner(c: CurtainCtl) {
  const clearTimeouts = () => {
    c.timeouts.current.forEach((id) => window.clearTimeout(id));
    c.timeouts.current = [];
  };

  const beginFadeout = () => {
    pauseRender(false);
    c.fading.current = true;
    startVeil('out');
    c.setPhase('fadeout');
    c.timeouts.current.push(window.setTimeout(() => {
      c.running.current = false;
      c.fading.current = false;
      clearVeil();
      c.setLabel(null);
    }, FADEOUT_MS));
  };

  const run = (labelText: string, onCovered?: () => void) => {
    const textMs = getTextMs(labelText);

    clearTimeouts();
    pauseRender(false);
    c.waiting.current = false;
    c.fading.current = false;
    c.running.current = true;
    c.setLabel(labelText);
    c.setPhase('blur');
    startVeil('in');

    c.timeouts.current.push(
      window.setTimeout(() => c.setPhase('paint'), BLUR_MS),
      window.setTimeout(() => {
        // Le contenu change une fois toutes les tuiles posées, jamais visible.
        pauseRender(true);
        onCovered?.();
        c.setPhase('text');
      }, BLUR_MS + PAINT_MS),
      window.setTimeout(() => {
        // Chargement encore en cours : le rideau reste en place jusqu'à sa fin.
        if (c.loading.current) { c.waiting.current = true; return; }
        beginFadeout();
      }, BLUR_MS + PAINT_MS + textMs),
    );
  };

  return { clearTimeouts, beginFadeout, run };
}

/** Écouteurs d'événements du rideau : changement d'espace, chargement lourd, fermeture de l'application. */
function createCurtainHandlers(c: CurtainCtl, runner: ReturnType<typeof createCurtainRunner>) {
  const { clearTimeouts, beginFadeout, run } = runner;

  const handleTransition = (e: Event) => {
    const detail = (e as CustomEvent<SpaceTransitionDetail>).detail;
    if (!detail?.label) return;
    run(detail.label, detail.onCovered);
  };

  const handleLoading = (e: Event) => {
    const detail = (e as CustomEvent<{ active: boolean; label?: string }>).detail;
    if (!detail) return;
    if (detail.active) {
      c.loading.current = true;
      c.setHolding(true);
      // Rideau absent, ou déjà en train de se retirer : on en (re)lance un. Sinon (déjà là, ou en
      // train de s'installer) il est simplement maintenu — pas de second rideau par-dessus.
      if (!c.running.current || c.fading.current) run(detail.label ?? 'Chargement');
    } else {
      c.loading.current = false;
      c.setHolding(false);
      if (c.waiting.current) {
        c.waiting.current = false;
        beginFadeout();
      }
    }
  };

  // Fermeture : même installation du rideau (flou, tuiles), puis il reste en place jusqu'à la sortie de l'application.
  const handleShutdownBegin = () => {
    clearTimeouts();
    pauseRender(false);
    c.waiting.current = false;
    c.fading.current = false;
    c.running.current = true;
    c.setShutdown(true);
    c.setLabel('Fermeture');
    c.setPhase('blur');
    startVeil('in');
    c.timeouts.current.push(
      window.setTimeout(() => c.setPhase('paint'), BLUR_MS),
      window.setTimeout(() => {
        pauseRender(true);
        c.setPhase('text');
        window.dispatchEvent(new Event('apex-shutdown-curtain-ready'));
      }, BLUR_MS + PAINT_MS),
    );
  };
  const handleShutdownMessage = (e: Event) => c.setShutdownMsg(String((e as CustomEvent<{ text?: string }>).detail?.text ?? ''));

  return { handleTransition, handleLoading, handleShutdownBegin, handleShutdownMessage };
}

/** Branche le rideau sur les événements `apex-*` ; renvoie le démontage. */
function attachCurtain(c: CurtainCtl): () => void {
  const runner = createCurtainRunner(c);
  const h = createCurtainHandlers(c, runner);
  window.addEventListener('apex-space-transition', h.handleTransition);
  window.addEventListener('apex-gcode-loading', h.handleLoading);
  window.addEventListener('apex-shutdown-begin', h.handleShutdownBegin);
  window.addEventListener('apex-shutdown-message', h.handleShutdownMessage);
  return () => {
    window.removeEventListener('apex-shutdown-begin', h.handleShutdownBegin);
    window.removeEventListener('apex-shutdown-message', h.handleShutdownMessage);
    window.removeEventListener('apex-space-transition', h.handleTransition);
    window.removeEventListener('apex-gcode-loading', h.handleLoading);
    runner.clearTimeouts();
    pauseRender(false);
  };
}

/** Canevas du voile : confié au Worker une fois pour toutes, redimensionné avec la fenêtre. */
function useVeilCanvas(veilCanvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = veilCanvasRef.current;
    if (!canvas) return;
    const size = () => sendVeil({ type: 'size', w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });
    if (!veilWorker) {
      try {
        veilWorker = new VeilWorker();
        veilCanvas = canvas;
        const offscreen = canvas.transferControlToOffscreen();
        veilWorker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);
      } catch (error) {
        console.warn('Voile hors thread indisponible :', error);
        veilWorker = null;
        return;
      }
    } else if (veilCanvas !== canvas) {
      return;
    }
    size();
    window.addEventListener('resize', size);
    return () => window.removeEventListener('resize', size);
  }, [veilCanvasRef]);
}

/**
 * Espacement de lettres recalculé pour chaque `label` afin que le texte remplisse toujours
 * SPACE_NAME_TARGET_WIDTH_PX, au lieu d'un `letter-spacing` fixe qui laisse un mot court
 * (« Dev ») loin de remplir le cadre et un mot long (« Prévisualisation ») le déborder.
 */
function useSpaceNameSpacing(label: string | null, painted: boolean, spaceNameRef: React.RefObject<HTMLSpanElement | null>) {
  const [spacing, setSpacing] = useState(0.5);
  useLayoutEffect(() => {
    const el = spaceNameRef.current;
    if (!label || !el) return;

    // Mesure la largeur du texte SANS espacement de lettres ajouté, pour en déduire combien
    // en ajouter par intervalle afin d'atteindre la largeur cible.
    el.style.letterSpacing = '0px';
    const naturalWidth = el.getBoundingClientRect().width;
    const gapCount = Math.max(label.length - 1, 1);
    const extraPx = Math.max(SPACE_NAME_TARGET_WIDTH_PX - naturalWidth, 0);
    const fontSize = parseFloat(getComputedStyle(el).fontSize) || 15;
    setSpacing(extraPx / gapCount / fontSize);
    // Dépend aussi de `painted` : le <span> n'existe dans le DOM qu'une fois les tuiles posées
    // (rendu conditionnel plus bas), donc au moment où `label` change seul le ref est encore
    // null — il faut remesurer une fois le nœud monté.
  }, [label, painted, spaceNameRef]);
  return spacing;
}


export const SpaceTransitionOverlay: React.FC = () => {
  const [label, setLabel] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('blur');
  const timeoutsRef = useRef<number[]>([]);
  const veilCanvasRef = useRef<HTMLCanvasElement>(null);
  const spaceNameRef = useRef<HTMLSpanElement>(null);
  const painted = phase === 'text' || phase === 'fadeout';
  const spaceNameLetterSpacing = useSpaceNameSpacing(label, painted, spaceNameRef);

  // Chargement lourd (G-code) : `apex-gcode-loading { active }` affiche le rideau s'il n'est pas déjà
  // là et le MAINTIENT, texte affiché et barre blanche qui tourne en boucle, jusqu'à `active: false`.
  // Le rideau n'est qu'un overlay d'attente : le chargement se fait hors du thread de l'interface
  // (cf. gcodeParseAsync.ts), l'application ne gèle jamais derrière.
  const loadingRef = useRef(false);
  const waitingRef = useRef(false);
  const runningRef = useRef(false);
  const fadingRef = useRef(false);
  const [holding, setHolding] = useState(false);
  // Fermeture de l'application (src/utils/shutdownSequence.ts) : rideau au-dessus de tout, messages successifs à la place du texte habituel.
  const [shutdown, setShutdown] = useState(false);
  const [shutdownMsg, setShutdownMsg] = useState('');

  useVeilCanvas(veilCanvasRef);
  useEffect(() => attachCurtain({
    timeouts: timeoutsRef, loading: loadingRef, waiting: waitingRef, running: runningRef, fading: fadingRef,
    setLabel, setPhase, setHolding, setShutdown, setShutdownMsg,
  }), []);

  const fadingOut = phase === 'fadeout';

  return (
    <>
      {/* Flou (étape 1) : un seul élément animé en CSS par le compositeur, sans jointure possible. Il est
          sous le canevas des tuiles, lui-même sous le texte (même z-index, ordre du DOM). `data-veil-blur`
          est lu par GlassPanelBackdrop. */}
      <div
        data-veil-blur
        className={`${styles.blurLayer} ${shutdown ? styles.onTop : ''} ${!label ? styles.blurOff : fadingOut ? styles.blurOut : styles.blurIn}`}
        style={{ animationDuration: `${fadingOut ? FADEOUT_MS : BLUR_MS}ms` }}
      />
      {/* Tuiles (étapes 2 et 4) : peintes par un Worker dans ce canevas, voir veil.worker.ts. */}
      <canvas ref={veilCanvasRef} className={`${styles.veilCanvas} ${shutdown ? styles.onTop : ''}`} />
    <AnimatePresence>
      {label && (
        // data-veil-root : posé tant que le rideau est affiché. Le verre des panneaux, qui réfracte le canevas
        // 3D et non le DOM, redessine le voile lui-même (veilState) pour ne pas montrer la scène cachée.
        <div className={`${styles.overlay} ${shutdown ? styles.onTop : ''}`} data-veil-root>

          <AnimatePresence>
            {painted && (
              <motion.div
                className={styles.textBlock}
                initial={{ opacity: 0, scale: 0.85, letterSpacing: '0.4em' }}
                animate={{ opacity: fadingOut ? 0 : 1, scale: 1, letterSpacing: '0.15em' }}
                exit={{ opacity: 0, scale: 1.08, letterSpacing: '0.5em' }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                {shutdown ? (
                  <>
                    <ShutdownLoaders />
                    <span className={styles.shutdownMessage}>{shutdownMsg}</span>
                  </>
                ) : (
                  <>
                    <span className={styles.brand}>APEX</span>
                    <span
                      ref={spaceNameRef}
                      className={styles.spaceName}
                      style={{ letterSpacing: `${spaceNameLetterSpacing}em` }}
                    >
                      {label}
                    </span>
                  </>
                )}
                {!fadingOut && (
                  <motion.span
                    key={holding || shutdown ? 'loading' : 'once'}
                    className={styles.scanline}
                    initial={{ scaleX: 0, opacity: 0.9 }}
                    animate={{ scaleX: 1, opacity: 0 }}
                    transition={{
                      duration: 0.5,
                      ease: 'easeOut',
                      repeat: holding || shutdown ? Infinity : getScanlineRepeat(label) - 1,
                      repeatDelay: (SCANLINE_CYCLE_MS - 500) / 1000,
                    }}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </AnimatePresence>
    </>
  );
};
