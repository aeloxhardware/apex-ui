import type { EditMachineLimits } from '@/utils/editKernelClient';

/**
 * Limites de la machine pour la validation de l'édition (limites de B, collisions de la tête).
 *
 * Aucun profil d'imprimante n'est lisible par l'interface aujourd'hui : on part de la machine actuelle
 * (slicer_engine/main.py::_default_machine_profile, fichier RRF actif config.g — B de 0 à 185°,
 * M203 B100000 = 1667 °/s, M201 B1300 = 1300 °/s², plateau de 300 mm) et l'utilisateur peut les
 * régler dans l'onglet Édition ; le réglage est conservé. Quand un profil d'imprimante existera dans
 * l'interface, c'est ici qu'il se branchera.
 */
export interface MachineLimits {
  bMinDeg: number;
  bMaxDeg: number;
  bSpeedDegS: number;
  bAccelDegS2: number;
  plateRadiusMm: number;
  collisionMarginMm: number;
  /** Marge tête / matière déjà déposée, à la surface du cordon. Négative : la pointe peut effleurer ou mordre un peu la couche. */
  partMarginMm: number;
}

export const DEFAULT_MACHINE_LIMITS: MachineLimits = {
  bMinDeg: 0,
  bMaxDeg: 185,
  bSpeedDegS: 1666.7,
  bAccelDegS2: 1300,
  plateRadiusMm: 150,
  collisionMarginMm: 1,
  partMarginMm: -0.15,
};

const STORAGE_KEY = 'apex-edit-machine-limits';

export function loadMachineLimits(): MachineLimits {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MACHINE_LIMITS };
    const parsed = JSON.parse(raw) as Partial<MachineLimits>;
    const out = { ...DEFAULT_MACHINE_LIMITS };
    for (const key of Object.keys(out) as (keyof MachineLimits)[]) {
      const v = parsed[key];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = v;
      // B minimal et marge sur la matière peuvent être négatifs.
      if ((key === 'bMinDeg' || key === 'partMarginMm') && typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    }
    return out;
  } catch {
    return { ...DEFAULT_MACHINE_LIMITS };
  }
}

export function saveMachineLimits(limits: MachineLimits) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(limits));
  } catch {
    /* stockage indisponible : le réglage ne survit pas à la session */
  }
}

export function toKernelLimits(limits: MachineLimits): EditMachineLimits {
  return { ...limits };
}
