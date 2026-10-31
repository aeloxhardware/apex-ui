// Mode de tranchage (sélecteur du panneau « Réglages Apex »). Liste donnée par l'utilisateur (2026-10-29). Le choix est
// mémorisé sur la machine, un choix par mode d'axes, et dit quel algorithme du moteur tranche. Un mode dont l'algorithme
// n'est pas implémenté (Element Arva, Element Aequor) est inactif : il ne se choisit pas. Sans choix, le défaut suit le
// mode d'axes (3 axes : Element Aeolis, seul mode lançable en G-code cartésien ; 5 axes : Element Ardor).
import { useEffect, useState } from 'react';
import arva from '@/assets/elements/element-arva.svg';
import ardor from '@/assets/elements/element-ardor.svg';
import aeolis from '@/assets/elements/element-aeolis.svg';
import aequor from '@/assets/elements/element-aequor.svg';
import { isDevModeEnabled, subscribeDevMode } from '@/utils/devModePrefs';

export type AxisMode = '3-axes' | '5-axes';

export const SLICING_MODES = [
  'Planaire - Algorithme Element Arva',
  'Multiplanaire - Algorithme Element Ardor',
  'Non-planaire complet - Algorithme Element Aeolis',
  'Lissage non-planaire - Algorithme Element Aequor',
];

// Element Arva (SLICING_MODES[0]) redeviendra le défaut des 3 axes quand il sera implémenté.
export const DEFAULT_SLICING_MODE: Record<AxisMode, string> = { '3-axes': SLICING_MODES[2], '5-axes': SLICING_MODES[1] };

// Logo de l'algorithme de chaque mode (monochrome : à afficher en masque, couleur du texte).
export const SLICING_MODE_LOGOS: Record<string, string> = {
  [SLICING_MODES[0]]: arva,
  [SLICING_MODES[1]]: ardor,
  [SLICING_MODES[2]]: aeolis,
  [SLICING_MODES[3]]: aequor,
};

// Algorithme du moteur (`main.py steps --algorithm …`, contrat C3) qui réalise chaque mode, ou null quand le moteur n'en
// publie pas encore (Element Arva et Element Aequor : README seulement). La fenêtre de tranchage affiche les étapes de
// l'algorithme choisi (R-026), pas toujours celles d'Element Ardor.
export const ENGINE_ALGORITHM: Record<string, string | null> = {
  [SLICING_MODES[0]]: null,
  [SLICING_MODES[1]]: 'element-ardor',
  [SLICING_MODES[2]]: 'element-aeolis',
  [SLICING_MODES[3]]: null,
};

// Algorithmes que `main.py slice` sait lancer : Element Ardor, et Element Aeolis depuis le 2026-10-30 (R-024, moteur
// apex-engine@712ca806). Un algorithme absent d'ici est refusé par la fenêtre de tranchage avec un message.
export const RUNNABLE_ALGORITHMS: ReadonlySet<string> = new Set(['element-ardor', 'element-aeolis']);

// Seuil de sécurité (nombre de triangles du plateau) au-delà duquel la fenêtre « Lancer la découpe » prévient
// l'utilisateur, par algorithme (décision de l'utilisateur, 2026-10-31 : 200 000 pour Element Ardor, 800 000 pour les
// autres).
const TRIANGLE_THRESHOLDS: Record<string, number> = { 'element-ardor': 200_000 };
const DEFAULT_TRIANGLE_THRESHOLD = 800_000;

export function triangleSafetyThreshold(mode: string): number {
  return TRIANGLE_THRESHOLDS[ENGINE_ALGORITHM[mode] ?? ''] ?? DEFAULT_TRIANGLE_THRESHOLD;
}

/** Nom court de l'algorithme d'un mode (« Element Ardor »), pour les messages. */
export function slicingAlgorithmName(mode: string): string {
  return mode.split(' - ')[1]?.replace(/^Algorithme /, '') ?? mode;
}

/** Vrai si le moteur sait lancer l'algorithme du mode ; sinon le mode est inactif dans le sélecteur. Sans mode dev,
 *  seul Element Aeolis reste sélectionnable en 3 axes (demande de l'utilisateur, 2026-10-31). */
export function isSlicingModeAvailable(mode: string, axis: AxisMode = axisMode): boolean {
  const algorithm = ENGINE_ALGORITHM[mode];
  if (!algorithm || !RUNNABLE_ALGORITHMS.has(algorithm)) return false;
  return isDevModeEnabled() || axis !== '3-axes' || mode === DEFAULT_SLICING_MODE['3-axes'];
}

// Anciens libellés mémorisés avant le renommage (2026-10-30) : migrés vers les nouveaux.
const LEGACY_MODES: Record<string, string> = {
  'Planaire': SLICING_MODES[0],
  'Multiplanaire': SLICING_MODES[1],
  'Non-planaire complet': SLICING_MODES[2],
  'Lissage non-planaire': SLICING_MODES[3],
};

const storageKey = (axis: AxisMode) => `apex-slicing-mode:${axis}`;

// Mode d'axes courant : suivi dès le chargement du module (AxisSidebar l'annonce à son montage, avant que le panneau
// n'existe). 5 axes au départ, comme AxisSidebar.
let axisMode: AxisMode = '5-axes';
const listeners = new Set<() => void>();
subscribeDevMode(() => listeners.forEach((l) => l()));
window.addEventListener('apex-axis-changed', (e) => {
  const mode = (e as CustomEvent<{ mode?: AxisMode }>).detail?.mode;
  if (mode !== '3-axes' && mode !== '5-axes') return;
  axisMode = mode;
  listeners.forEach((l) => l());
});

export function getSlicingMode(axis: AxisMode = axisMode): string {
  try {
    const stored = localStorage.getItem(storageKey(axis));
    // Un choix mémorisé pour un mode devenu (ou resté) inactif est ignoré : retour au défaut.
    const chosen = stored && SLICING_MODES.includes(stored) ? stored : stored ? LEGACY_MODES[stored] : undefined;
    if (chosen && isSlicingModeAvailable(chosen, axis)) return chosen;
  } catch { /* localStorage indisponible */ }
  return DEFAULT_SLICING_MODE[axis];
}

export function setSlicingMode(mode: string, axis: AxisMode = axisMode) {
  if (!SLICING_MODES.includes(mode) || !isSlicingModeAvailable(mode, axis)) return;
  try { localStorage.setItem(storageKey(axis), mode); } catch { /* localStorage indisponible */ }
  listeners.forEach((l) => l());
}

/** Mode de tranchage du mode d'axes courant, remis à jour quand l'un ou l'autre change. */
export function useSlicingMode() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return { axisMode, mode: getSlicingMode(), setMode: setSlicingMode };
}
