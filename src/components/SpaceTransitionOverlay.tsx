import React, { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './SpaceTransitionOverlay.module.scss';

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

const BLUR_MS = 320;      // 1. montée du flou seul, doit être TERMINÉE avant la moindre tuile
// Tuiles 3× plus petites (en aire) que la grille précédente (8×5) : même ratio, dimensions
// multipliées par √3.
const TILE_COLS = 14;
const TILE_ROWS = 9;
// Réduit par rapport à la grille précédente (8×5, pas 28ms) pour garder une durée de balayage
// comparable malgré la diagonale plus longue (14+9 vs 8+5 pas).
const TILE_STEP_MS = 15;  // délai entre deux tuiles consécutives dans l'ordre de balayage
const TILE_ANIM_MS = 260; // durée d'apparition d'une tuile individuelle
// Le dernier délai + sa propre durée d'anim = durée totale de la phase "paint".
const PAINT_MS = (TILE_COLS + TILE_ROWS - 2) * TILE_STEP_MS + TILE_ANIM_MS;
// 3. texte affiché, voile plein écran (switch réel ici). La barre sous le nom de l'espace
// (.scanline) rejoue SCANLINE_REPEAT fois, une fois par seconde, avant que l'espace ne soit
// dévoilé — le texte reste donc affiché au moins le temps que ces répétitions se terminent.
// Seule la destination "Modélisation" a droit à 6 répétitions ; toutes les autres (Préparation,
// Prévisualisation, Dev...) gardent le nombre par défaut.
const SCANLINE_CYCLE_MS = 1000;
const SCANLINE_REPEAT_DEFAULT = 1;
const SCANLINE_REPEAT_MODELING = 6;
const getScanlineRepeat = (label: string) => (label === 'Modélisation' ? SCANLINE_REPEAT_MODELING : SCANLINE_REPEAT_DEFAULT);
const getTextMs = (label: string) => SCANLINE_CYCLE_MS * getScanlineRepeat(label);
const FADEOUT_MS = PAINT_MS; // 4. même effet de tuiles que l'apparition, même durée totale

type Phase = 'blur' | 'paint' | 'text' | 'fadeout';

interface SpaceTransitionDetail {
  label: string;
  onCovered?: () => void;
}

// Grille de tuiles avec leur délai de balayage : distance (en pas de grille) au coin haut-droit,
// donc la tuile (col=COLS-1, row=0) part la première et (col=0, row=ROWS-1) la dernière — un
// vrai balayage diagonal plutôt qu'un simple décalage ligne par ligne.
const TILES = Array.from({ length: TILE_COLS * TILE_ROWS }, (_, i) => {
  const col = i % TILE_COLS;
  const row = Math.floor(i / TILE_COLS);
  const distance = (TILE_COLS - 1 - col) + row;
  return { col, row, delayMs: distance * TILE_STEP_MS };
});

// Largeur cible (en px) que le nom de l'espace doit occuper, quel que soit le nombre de
// lettres — c'est ce qui fait que "DEV" et "PRÉVISUALISATION" remplissent tous les deux le
// même cadre plutôt que d'avoir un espacement de lettres fixe (donc une largeur qui varie
// avec la longueur du mot).
const SPACE_NAME_TARGET_WIDTH_PX = 260;

export const SpaceTransitionOverlay: React.FC = () => {
  const [label, setLabel] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('blur');
  const timeoutsRef = useRef<number[]>([]);
  // Change à chaque déclenchement pour forcer framer-motion à rejouer l'apparition des tuiles
  // (sans clé, une 2e transition juste après la 1re les laisserait déjà toutes posées).
  const [runId, setRunId] = useState(0);
  const spaceNameRef = useRef<HTMLSpanElement>(null);
  // Espacement de lettres recalculé pour chaque `label` afin que le texte remplisse toujours
  // SPACE_NAME_TARGET_WIDTH_PX, au lieu d'un `letter-spacing` fixe qui laisse un mot court
  // (« Dev ») loin de remplir le cadre et un mot long (« Prévisualisation ») le déborder.
  const [spaceNameLetterSpacing, setSpaceNameLetterSpacing] = useState(0.5);
  const painted = phase === 'text' || phase === 'fadeout';

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
    const spacingEm = extraPx / gapCount / fontSize;

    setSpaceNameLetterSpacing(spacingEm);
    // Dépend aussi de `painted` : le <span> n'existe dans le DOM qu'une fois les tuiles posées
    // (rendu conditionnel plus bas), donc au moment où `label` change seul le ref est encore
    // null — il faut remesurer une fois le nœud monté.
  }, [label, painted]);

  // Chargement lourd (G-code) : `apex-gcode-loading { active }` affiche le rideau s'il n'est pas déjà
  // là et le MAINTIENT, texte affiché et barre blanche qui tourne en boucle, jusqu'à `active: false`.
  // Le rideau n'est qu'un overlay d'attente : le chargement se fait hors du thread de l'interface
  // (cf. gcodeParseAsync.ts), l'application ne gèle jamais derrière.
  const loadingRef = useRef(false);
  // Le texte est affiché, la fin de la phase "text" est atteinte mais le chargement n'est pas fini.
  const waitingRef = useRef(false);
  // Le rideau est à l'écran ou en train de s'y installer (de `blur` jusqu'à la fin de `fadeout`).
  const runningRef = useRef(false);
  const fadingRef = useRef(false);
  const [holding, setHolding] = useState(false);

  useEffect(() => {
    const clearTimeouts = () => {
      timeoutsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutsRef.current = [];
    };

    const beginFadeout = () => {
      fadingRef.current = true;
      setPhase('fadeout');
      timeoutsRef.current.push(window.setTimeout(() => {
        runningRef.current = false;
        fadingRef.current = false;
        setLabel(null);
      }, FADEOUT_MS));
    };

    const run = (labelText: string, onCovered?: () => void) => {
      const textMs = getTextMs(labelText);

      clearTimeouts();
      waitingRef.current = false;
      fadingRef.current = false;
      runningRef.current = true;
      setLabel(labelText);
      setPhase('blur');
      setRunId((id) => id + 1);

      timeoutsRef.current.push(
        window.setTimeout(() => setPhase('paint'), BLUR_MS),
        window.setTimeout(() => {
          // Le contenu change une fois toutes les tuiles posées, jamais visible.
          onCovered?.();
          setPhase('text');
        }, BLUR_MS + PAINT_MS),
        window.setTimeout(() => {
          // Chargement encore en cours : le rideau reste en place jusqu'à sa fin.
          if (loadingRef.current) { waitingRef.current = true; return; }
          beginFadeout();
        }, BLUR_MS + PAINT_MS + textMs),
      );
    };

    const handleTransition = (e: Event) => {
      const detail = (e as CustomEvent<SpaceTransitionDetail>).detail;
      if (!detail?.label) return;
      run(detail.label, detail.onCovered);
    };

    const handleLoading = (e: Event) => {
      const detail = (e as CustomEvent<{ active: boolean; label?: string }>).detail;
      if (!detail) return;
      if (detail.active) {
        loadingRef.current = true;
        setHolding(true);
        // Rideau absent, ou déjà en train de se retirer : on en (re)lance un. Sinon (déjà là, ou en
        // train de s'installer) il est simplement maintenu — pas de second rideau par-dessus.
        if (!runningRef.current || fadingRef.current) run(detail.label ?? 'Chargement');
      } else {
        loadingRef.current = false;
        setHolding(false);
        if (waitingRef.current) {
          waitingRef.current = false;
          beginFadeout();
        }
      }
    };

    window.addEventListener('apex-space-transition', handleTransition);
    window.addEventListener('apex-gcode-loading', handleLoading);
    return () => {
      window.removeEventListener('apex-space-transition', handleTransition);
      window.removeEventListener('apex-gcode-loading', handleLoading);
      clearTimeouts();
    };
  }, []);

  const fadingOut = phase === 'fadeout';

  return (
    <AnimatePresence>
      {label && (
        <div className={styles.overlay}>
          {/* Étape 1 : flou seul, sans teinte — entièrement monté avant la moindre tuile. */}
          <motion.div
            className={styles.blurLayer}
            initial={{ backdropFilter: 'blur(0px)' }}
            animate={{ backdropFilter: fadingOut ? 'blur(0px)' : 'blur(18px)' }}
            transition={{ duration: (fadingOut ? FADEOUT_MS : BLUR_MS) / 1000, ease: [0.4, 0, 0.2, 1] }}
          />

          {/* Étape 2 (paint) / 4 (fadeout) : mêmes tuiles, même balayage et mêmes délais dans les
              deux sens — seule la cible (posée vs. retirée) change avec `fadingOut`. */}
          <div className={styles.tileGrid}>
            {phase !== 'blur' && TILES.map(({ col, row, delayMs }) => (
              <motion.div
                key={`${runId}-${col}-${row}`}
                className={styles.tile}
                style={{
                  left: `${(col / TILE_COLS) * 100}%`,
                  top: `${(row / TILE_ROWS) * 100}%`,
                  width: `${100 / TILE_COLS}%`,
                  height: `${100 / TILE_ROWS}%`,
                }}
                initial={{ opacity: 0, scale: 1.3 }}
                animate={fadingOut ? { opacity: 0, scale: 1.3 } : { opacity: 1, scale: 1 }}
                transition={{ duration: TILE_ANIM_MS / 1000, delay: delayMs / 1000, ease: [0.16, 1, 0.3, 1] }}
              />
            ))}
          </div>

          <AnimatePresence>
            {painted && (
              <motion.div
                className={styles.textBlock}
                initial={{ opacity: 0, scale: 0.85, letterSpacing: '0.4em' }}
                animate={{ opacity: fadingOut ? 0 : 1, scale: 1, letterSpacing: '0.15em' }}
                exit={{ opacity: 0, scale: 1.08, letterSpacing: '0.5em' }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className={styles.brand}>APEX</span>
                <span
                  ref={spaceNameRef}
                  className={styles.spaceName}
                  style={{ letterSpacing: `${spaceNameLetterSpacing}em` }}
                >
                  {label}
                </span>
                {!fadingOut && (
                  <motion.span
                    key={holding ? 'loading' : 'once'}
                    className={styles.scanline}
                    initial={{ scaleX: 0, opacity: 0.9 }}
                    animate={{ scaleX: 1, opacity: 0 }}
                    transition={{
                      duration: 0.5,
                      ease: 'easeOut',
                      repeat: holding ? Infinity : getScanlineRepeat(label) - 1,
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
  );
};
