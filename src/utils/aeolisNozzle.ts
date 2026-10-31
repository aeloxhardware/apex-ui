// Réglages de buse d'Element Aeolis (`nozzle_angle_deg`, `nozzle_reach` de `AeolisSliceParams`, contrat 2 du 2026-10-31).
// Ce sont ceux de l'imprimante : le moteur les prend pour limites de la surface en hauteur et pour l'enveloppe de la tête
// (apex-engine, element-aeolis/README.md). Défauts très bas du moteur (10°, 2 mm) pour ne pas casser une imprimante à
// conduits de ventilation serrés ; à relever pour une tête dégagée. Mémorisés sur la machine, un seul jeu pour l'instant
// (R-027 : ils iront dans le profil d'imprimante). Même patron que devModePrefs.ts (singleton + localStorage).
import { useEffect, useState } from 'react';

export interface AeolisNozzle {
  /** Angle de la buse : pente maximale, depuis l'horizontale, de la surface déjà imprimée autour de la pointe (°). */
  angleDeg: number;
  /** Longueur maximale atteignable par la buse : dénivelé maximal toléré entre la pointe et la matière voisine plus haute (mm). */
  reachMm: number;
}

export const DEFAULT_AEOLIS_NOZZLE: AeolisNozzle = { angleDeg: 10, reachMm: 2 };
export const AEOLIS_NOZZLE_BOUNDS = { angleDeg: { min: 0, max: 89, step: 1 }, reachMm: { min: 0, max: 100, step: 0.5 } } as const;

const STORAGE_KEY = 'apex-aeolis-nozzle';

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

function read(): AeolisNozzle {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const b = AEOLIS_NOZZLE_BOUNDS;
    return {
      angleDeg: clamp(raw?.angleDeg, b.angleDeg.min, b.angleDeg.max, DEFAULT_AEOLIS_NOZZLE.angleDeg),
      reachMm: clamp(raw?.reachMm, b.reachMm.min, b.reachMm.max, DEFAULT_AEOLIS_NOZZLE.reachMm),
    };
  } catch {
    return { ...DEFAULT_AEOLIS_NOZZLE };
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getAeolisNozzle(): AeolisNozzle {
  return current;
}

export function setAeolisNozzle(patch: Partial<AeolisNozzle>) {
  const b = AEOLIS_NOZZLE_BOUNDS;
  current = {
    angleDeg: clamp(patch.angleDeg ?? current.angleDeg, b.angleDeg.min, b.angleDeg.max, current.angleDeg),
    reachMm: clamp(patch.reachMm ?? current.reachMm, b.reachMm.min, b.reachMm.max, current.reachMm),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* localStorage indisponible */ }
  listeners.forEach((l) => l());
}

export function useAeolisNozzle() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return current;
}

/** Racine de paramètres d'Element Aeolis : seulement ce qui diffère du défaut du moteur. */
export function aeolisNozzleParams(nozzle: AeolisNozzle = current): { nozzle_angle_deg?: number; nozzle_reach?: number } {
  return {
    ...(nozzle.angleDeg !== DEFAULT_AEOLIS_NOZZLE.angleDeg ? { nozzle_angle_deg: nozzle.angleDeg } : {}),
    ...(nozzle.reachMm !== DEFAULT_AEOLIS_NOZZLE.reachMm ? { nozzle_reach: nozzle.reachMm } : {}),
  };
}
