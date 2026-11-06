// Tranchage lancé depuis l'interface : exporte le plateau, appelle le moteur (sous-processus, cf.
// electron/engine-runner.cjs) et suit sa progression. La progression ne vient QUE des lignes du moteur
// (RULES §5.3) : jamais de minuterie, jamais de durée estimée. Les étapes affichées sont celles que le
// moteur publie (`main.py steps`), pas une liste écrite ici.
import { APEX_CONTRACT_VERSION } from '@/utils/engineContract';
import { buildEngineOverrides } from '@/utils/engineSettings';
import { stepLabel } from '@/utils/sliceStepLabels';
import { ENGINE_ALGORITHM, RUNNABLE_ALGORITHMS, getSlicingMode } from '@/utils/slicingMode';
import { aeolisNozzleParams } from '@/utils/aeolisNozzle';
import { DEFAULT_PRINTER_PROFILE, engineLayerLimits, engineMachineProfile, enginePivotToTip } from '@/utils/machineProfile';

import { emitApex } from '@/events/apexEvents';
interface SliceStep { slug: string; label: string }

type SlicePhase = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface SliceState {
  phase: SlicePhase;
  steps: SliceStep[];
  /** Étape en cours (index dans `steps`) et avancement réel de celle-ci, rapportés par le moteur. */
  stepIndex: number;
  fraction: number;
  message: string | null;
  warnings: string[];
  gcodeFile: File | null;
}

const IDLE: SliceState = { phase: 'idle', steps: [], stepIndex: 0, fraction: 0, message: null, warnings: [], gcodeFile: null };

let state: SliceState = IDLE;
const listeners = new Set<() => void>();

function set(next: Partial<SliceState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** Demande l'export STL du plateau au viewport (null si vide ou sans réponse sous 10 s). */
function exportPlateStl(): Promise<Uint8Array | null> {
  return new Promise<Uint8Array | null>((resolve) => {
    emitApex('apex-export-plate-stl', { resolve });
    setTimeout(() => resolve(null), 10000);
  });
}

/** Avancement rapporté par le moteur (jamais estimé ici). */
function applyProgress(event: ApexSliceEvent) {
  if (event.type !== 'step') return;
  const index = state.steps.findIndex((s) => s.slug === event.slug);
  if (index < 0) return;
  // Dans une même étape la barre ne recule jamais (R-017) ; une nouvelle étape repart de ce que dit le moteur.
  const fraction = Math.min(1, Math.max(0, event.fraction));
  set({ stepIndex: index, fraction: index === state.stepIndex ? Math.max(state.fraction, fraction) : fraction });
}

/** Requête du moteur selon l'algorithme choisi. */
function buildRequest(algorithm: string | null, stl: Uint8Array): ApexSliceRequest {
  if (algorithm === 'element-aeolis') {
    // Element Aeolis (R-024) : racine de paramètres propre (`AeolisSliceParams`), seulement le plancher et le plafond
    // d'épaisseur du profil et les deux réglages de buse du panneau (angle, longueur) ; les réglages d'Element Ardor lui sont inconnus (le moteur refuserait la requête), et
    // `gcode_params` aussi (G-code cartésien, pas de pivot). Un seul modèle : le moteur le pose à z = 0.
    return { contract: APEX_CONTRACT_VERSION, stl, algorithm, params: { ...engineLayerLimits(DEFAULT_PRINTER_PROFILE), ...aeolisNozzleParams() } };
  }
  const pivot = enginePivotToTip(DEFAULT_PRINTER_PROFILE);
  // Réglages du panneau de Préparation : seulement ce qui diffère du défaut du moteur (plus `allow_multi_mesh`, R-013).
  const overrides = buildEngineOverrides();
  return {
    contract: APEX_CONTRACT_VERSION,
    stl,
    params: { ...overrides.params, machine_profile: engineMachineProfile(DEFAULT_PRINTER_PROFILE) },
    gcode_params: { ...overrides.gcodeParams, ...(pivot === null ? {} : { pivot_to_tip: pivot }) },
  };
}

function warningText(w: NonNullable<ApexSliceResult['warnings']>[number]): string {
  const plural = (w.count ?? 0) > 1 ? 's' : '';
  if (w.code === 'collisions_unresolved') return `${w.count} collision${plural} de la tête non résolue${plural}`;
  // Element Aeolis : la tête touche la matière déjà déposée (signalé, pas évité).
  if (w.code === 'head_collisions') return `${w.count} point${plural} de dépôt où la tête touche la matière déjà déposée`;
  return w.code;
}

/** Issue du moteur → état final. */
function applyResult(result: ApexSliceResult, gcodeText: string | null) {
  if (result.status === 'cancelled') {
    set({ phase: 'cancelled', message: 'Tranchage annulé.' });
  } else if (result.status === 'ok' && gcodeText !== null) {
    const name = (result.gcode ?? 'plateau.gcode').split(/[/\\]/).pop() ?? 'plateau.gcode';
    set({ phase: 'done', stepIndex: Math.max(0, state.steps.length - 1), fraction: 1, warnings: (result.warnings ?? []).map(warningText),
      gcodeFile: new File([gcodeText], name, { type: 'text/plain' }) });
  } else if (result.status === 'not_a_heightfield') {
    // Refus d'Element Aeolis (code 3) : le maillage n'est pas une surface en hauteur ; le message du moteur est lisible.
    set({ phase: 'failed', message: result.message ?? "Ce modèle n'est pas une surface en hauteur : Element Aeolis ne peut pas le trancher." });
  } else {
    set({ phase: 'failed', message: result.message ?? `Échec du tranchage (${result.status}).` });
  }
}

export const sliceController = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getState: () => state,
  /** Remet à zéro (fenêtre fermée). */
  reset() {
    if (state.phase !== 'running') set({ ...IDLE });
  },
  async cancel() {
    if (state.phase !== 'running') return;
    await window.apexDesktop?.cancelSlice?.();
  },

  /** Plateau → STL → moteur. Ne lève pas : l'issue est dans l'état (`done` / `failed` / `cancelled`). */
  async start() {
    if (state.phase === 'running') return;
    const bridge = window.apexDesktop;
    set({ ...IDLE, phase: 'running' });
    if (!bridge?.slice || !bridge.sliceSteps) {
      set({ phase: 'failed', message: "Le tranchage demande l'application de bureau (moteur lancé en sous-processus)." });
      return;
    }
    let unsubscribe: (() => void) | undefined;
    try {
      // Étapes de l'algorithme choisi dans « Réglages Apex » (R-026). Element Ardor est le chemin par défaut du
      // moteur : sans option, comme avant. Un algorithme que `slice` ne sait pas lancer est refusé ici, plutôt que
      // d'afficher ses étapes puis de trancher avec Ardor (barre figée).
      const mode = getSlicingMode();
      const algorithm = ENGINE_ALGORITHM[mode] ?? null;
      if (algorithm && !RUNNABLE_ALGORITHMS.has(algorithm)) {
        set({ phase: 'failed', message: `${mode} ne peut pas encore être lancé depuis l'interface : le moteur ne sait pas le lancer. Choisissez un autre mode dans « Réglages Apex ».` });
        return;
      }
      const { steps } = await bridge.sliceSteps(algorithm && algorithm !== 'element-ardor' ? algorithm : undefined);
      set({ steps: steps.map((s) => ({ ...s, label: stepLabel(s.slug, s.label) })) });

      const stl = await exportPlateStl();
      if (!stl) {
        set({ phase: 'failed', message: "Aucun modèle sur le plateau, ou son export a échoué." });
        return;
      }
      unsubscribe = bridge.onSliceProgress?.(applyProgress);
      const { result, gcodeText } = await bridge.slice(buildRequest(algorithm, stl));
      applyResult(result, gcodeText);
    } catch (err) {
      set({ phase: 'failed', message: err instanceof Error ? err.message : String(err) });
    } finally {
      unsubscribe?.();
    }
  },
};

// Développement seulement (tests automatisés), comme `window.__apexEdit`.
if (import.meta.env.DEV) (window as unknown as { __apexSlice?: typeof sliceController }).__apexSlice = sliceController;
