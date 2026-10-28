// Tranchage lancé depuis l'interface : exporte le plateau, appelle le moteur (sous-processus, cf.
// electron/engine-runner.cjs) et suit sa progression. La progression ne vient QUE des lignes du moteur
// (RULES §5.3) : jamais de minuterie, jamais de durée estimée. Les étapes affichées sont celles que le
// moteur publie (`main.py steps`), pas une liste écrite ici.
import { APEX_CONTRACT_VERSION } from '@/utils/engineContract';
import { buildEngineOverrides } from '@/utils/engineSettings';
import { stepLabel } from '@/utils/sliceStepLabels';
import { DEFAULT_PRINTER_PROFILE, engineMachineProfile, enginePivotToTip } from '@/utils/machineProfile';

export interface SliceStep { slug: string; label: string }

export type SlicePhase = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

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
      const { steps } = await bridge.sliceSteps();
      set({ steps: steps.map((s) => ({ ...s, label: stepLabel(s.slug, s.label) })) });

      const stl = await new Promise<Uint8Array | null>((resolve) => {
        window.dispatchEvent(new CustomEvent('apex-export-plate-stl', { detail: { resolve } }));
        setTimeout(() => resolve(null), 10000);
      });
      if (!stl) {
        set({ phase: 'failed', message: "Aucun modèle sur le plateau, ou son export a échoué." });
        return;
      }

      unsubscribe = bridge.onSliceProgress?.((event) => {
        if (event.type === 'step') {
          const index = state.steps.findIndex((s) => s.slug === event.slug);
          if (index >= 0) {
            // Dans une même étape la barre ne recule jamais (R-017) ; une nouvelle étape repart de ce que dit le moteur.
            const fraction = Math.min(1, Math.max(0, event.fraction));
            set({ stepIndex: index, fraction: index === state.stepIndex ? Math.max(state.fraction, fraction) : fraction });
          }
        }
      });

      const pivot = enginePivotToTip(DEFAULT_PRINTER_PROFILE);
      // Réglages du panneau de Préparation : seulement ce qui diffère du défaut du moteur (plus `allow_multi_mesh`, R-013).
      const overrides = buildEngineOverrides();
      const { result, gcodeText } = await bridge.slice({
        contract: APEX_CONTRACT_VERSION,
        stl,
        params: { ...overrides.params, machine_profile: engineMachineProfile(DEFAULT_PRINTER_PROFILE) },
        gcode_params: { ...overrides.gcodeParams, ...(pivot === null ? {} : { pivot_to_tip: pivot }) },
      });

      if (result.status === 'cancelled') {
        set({ phase: 'cancelled', message: 'Tranchage annulé.' });
      } else if (result.status === 'ok' && gcodeText !== null) {
        const name = (result.gcode ?? 'plateau.gcode').split(/[/\\]/).pop() ?? 'plateau.gcode';
        const warnings = (result.warnings ?? []).map((w) =>
          w.code === 'collisions_unresolved' ? `${w.count} collision${(w.count ?? 0) > 1 ? 's' : ''} de la tête non résolue${(w.count ?? 0) > 1 ? 's' : ''}` : w.code);
        set({ phase: 'done', stepIndex: Math.max(0, state.steps.length - 1), fraction: 1, warnings,
          gcodeFile: new File([gcodeText], name, { type: 'text/plain' }) });
      } else {
        set({ phase: 'failed', message: result.message ?? `Échec du tranchage (${result.status}).` });
      }
    } catch (err) {
      set({ phase: 'failed', message: err instanceof Error ? err.message : String(err) });
    } finally {
      unsubscribe?.();
    }
  },
};

// Développement seulement (tests automatisés), comme `window.__apexEdit`.
if (import.meta.env.DEV) (window as unknown as { __apexSlice?: typeof sliceController }).__apexSlice = sliceController;
