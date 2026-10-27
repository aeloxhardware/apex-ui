/**
 * Réglages avancés de l'algorithme, réservés au développeur (Paramètres, visibles en mode dev) : ils
 * ne font pas partie des « Paramètres de tranchage » de l'utilisateur (R-013). Chaque valeur est
 * envoyée explicitement au moteur dans `params`, donc ne dépend pas du défaut du moteur.
 * Même patron que devModePrefs.ts (singleton + localStorage).
 */

import { useEffect, useState } from 'react';

export interface EngineAdvancedPrefs {
  /** `PipelineParams.allow_multi_mesh` : l'interface assemble le plateau en un seul maillage (décision R-013 : vrai). */
  allowMultiMesh: boolean;
  /** `FieldSolverParams.heat_method_time_factor` : temps de diffusion de la méthode de la chaleur (× arête médiane²). */
  heatMethodTimeFactor: number;
}

export const ENGINE_ADVANCED_DEFAULTS: EngineAdvancedPrefs = {
  allowMultiMesh: true,
  // Le défaut du moteur est 100, mesuré insuffisant (décision de l'utilisateur, 2026-10-27).
  heatMethodTimeFactor: 3000,
};

const STORAGE_KEY = 'apex-engine-advanced';

function readStored(): EngineAdvancedPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<EngineAdvancedPrefs>;
      return {
        allowMultiMesh: typeof parsed.allowMultiMesh === 'boolean' ? parsed.allowMultiMesh : ENGINE_ADVANCED_DEFAULTS.allowMultiMesh,
        heatMethodTimeFactor: Number.isFinite(parsed.heatMethodTimeFactor) && (parsed.heatMethodTimeFactor as number) > 0
          ? (parsed.heatMethodTimeFactor as number) : ENGINE_ADVANCED_DEFAULTS.heatMethodTimeFactor,
      };
    }
  } catch {
    // no-op : localStorage indisponible ou valeur illisible.
  }
  return { ...ENGINE_ADVANCED_DEFAULTS };
}

let prefs = readStored();
const listeners = new Set<(prefs: EngineAdvancedPrefs) => void>();

export function getEngineAdvancedPrefs(): EngineAdvancedPrefs {
  return prefs;
}

export function setEngineAdvancedPrefs(next: Partial<EngineAdvancedPrefs>) {
  prefs = { ...prefs, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // no-op : localStorage indisponible.
  }
  listeners.forEach((listener) => listener(prefs));
}

export function resetEngineAdvancedPrefs() {
  setEngineAdvancedPrefs({ ...ENGINE_ADVANCED_DEFAULTS });
}

export function subscribeEngineAdvancedPrefs(listener: (prefs: EngineAdvancedPrefs) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useEngineAdvancedPrefs() {
  const [value, setValue] = useState(getEngineAdvancedPrefs);
  useEffect(() => subscribeEngineAdvancedPrefs(setValue), []);
  return value;
}
