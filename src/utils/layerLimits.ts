/**
 * Épaisseurs de couche admises pour l'édition par nœuds (profil d'imprimante : pas encore lisible par
 * l'interface, comme machineLimits.ts). Le maximum suit en général 75 % du diamètre de buse ; la
 * largeur variable laisse une couche descendre sous le minimum en élargissant son cordon.
 */
export interface LayerLimits {
  minMm: number;
  maxMm: number;
  /** Largeur variable : plancher = minMm / widthFactor (1 : bornes strictes). */
  widthFactor: number;
}

export const DEFAULT_LAYER_LIMITS: LayerLimits = { minMm: 0.06, maxMm: 0.3, widthFactor: 1 };

const STORAGE_KEY = 'apex-edit-layer-limits';

export function sanitizeLayerLimits(value: Partial<LayerLimits>): LayerLimits {
  const out = { ...DEFAULT_LAYER_LIMITS };
  if (typeof value.minMm === 'number' && Number.isFinite(value.minMm) && value.minMm > 0) out.minMm = value.minMm;
  if (typeof value.maxMm === 'number' && Number.isFinite(value.maxMm) && value.maxMm > out.minMm) out.maxMm = value.maxMm;
  if (typeof value.widthFactor === 'number' && Number.isFinite(value.widthFactor)) {
    out.widthFactor = Math.min(3, Math.max(1, value.widthFactor));
  }
  return out;
}

export function loadLayerLimits(): LayerLimits {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeLayerLimits(JSON.parse(raw) as Partial<LayerLimits>) : { ...DEFAULT_LAYER_LIMITS };
  } catch {
    return { ...DEFAULT_LAYER_LIMITS };
  }
}

export function saveLayerLimits(limits: LayerLimits) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(limits));
  } catch {
    /* stockage indisponible : le réglage ne survit pas à la session */
  }
}

/** Épaisseur plancher effective (largeur variable comprise). */
export const layerFloorMm = (limits: LayerLimits) => limits.minMm / Math.max(1, limits.widthFactor);
