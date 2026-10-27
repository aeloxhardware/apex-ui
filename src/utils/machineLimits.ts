import type { EditMachineLimits } from '@/utils/editKernelClient';
import { DEFAULT_PRINTER_PROFILE, machineFacts } from '@/utils/machineProfile';

/**
 * Limites de la machine pour la validation de l'édition (limites de B, collisions de la tête).
 *
 * Les valeurs par défaut viennent du profil d'imprimante (profiles/, via machineProfile.ts) : B, vitesse
 * et accélération de B, rayon du plateau. Le même profil alimente le `machine_profile` envoyé au moteur.
 * L'utilisateur peut les régler dans l'onglet Édition ; le réglage est conservé. Les marges de collision
 * et tolérances ci-dessous sont des réglages de l'édition, pas des données de la machine.
 */
export interface MachineLimits {
  bMinDeg: number;
  bMaxDeg: number;
  bSpeedDegS: number;
  bAccelDegS2: number;
  plateRadiusMm: number;
  collisionMarginMm: number;
  /** Recouvrement toléré avec la matière déjà déposée : buse (mm) puis reste de la tête (mm, sur la marge de sécurité). */
  nozzleToleranceMm: number;
  bodyToleranceMm: number;
}

const FACTS = machineFacts(DEFAULT_PRINTER_PROFILE);

export const DEFAULT_MACHINE_LIMITS: MachineLimits = {
  bMinDeg: FACTS.bRangeDeg?.[0] ?? 0,
  bMaxDeg: FACTS.bRangeDeg?.[1] ?? 185,
  bSpeedDegS: FACTS.bSpeedDegS ?? 1666.7,
  bAccelDegS2: FACTS.bAccelDegS2 ?? 1300,
  plateRadiusMm: FACTS.plateRadiusMm ?? 150,
  collisionMarginMm: 1,
  nozzleToleranceMm: 0.18,
  bodyToleranceMm: 0.7,
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
      // B minimal peut être négatif (axe de tête réglé autrement).
      if ((key === 'bMinDeg') && typeof v === 'number' && Number.isFinite(v)) out[key] = v;
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
