/**
 * Réglages de la disposition automatique (Paramètres › Disposition automatique) : écart minimal entre deux modèles,
 * rotations autorisées, disposition à l'import. Valeurs de départ = celles de la première version de la disposition
 * (écart 5 mm, rotations permises). Mémorisés sur la machine ; même patron que editJournalPrefs.ts (singleton + localStorage).
 */
import { useEffect, useState } from 'react';

export interface ArrangePrefs {
  /** Écart minimal entre deux modèles (mm). */
  spacingMm: number;
  /** Autorise les rotations autour de l'axe vertical (0°, 45°, 90°, 135° à partir de l'angle de la boîte minimale). */
  allowRotations: boolean;
  /** « Aligner sur l'axe Y » d'Orca : redresse le grand axe de chaque pièce sur Y (sans effet quand les rotations sont permises). */
  alignToY: boolean;
  /** Dispose automatiquement les modèles à chaque import. */
  arrangeOnImport: boolean;
}

export const DEFAULT_ARRANGE_PREFS: ArrangePrefs = { spacingMm: 5, allowRotations: true, alignToY: false, arrangeOnImport: false };
export const ARRANGE_SPACING_BOUNDS = { min: 0, max: 50, step: 1 } as const;

const STORAGE_KEY = 'apex-arrange-prefs';

const sanitize = (raw: Partial<Record<keyof ArrangePrefs, unknown>> | null): ArrangePrefs => {
  const b = ARRANGE_SPACING_BOUNDS;
  const spacing = raw?.spacingMm;
  return {
    spacingMm:
      typeof spacing === 'number' && Number.isFinite(spacing) ? Math.min(b.max, Math.max(b.min, spacing)) : DEFAULT_ARRANGE_PREFS.spacingMm,
    allowRotations: typeof raw?.allowRotations === 'boolean' ? raw.allowRotations : DEFAULT_ARRANGE_PREFS.allowRotations,
    alignToY: typeof raw?.alignToY === 'boolean' ? raw.alignToY : DEFAULT_ARRANGE_PREFS.alignToY,
    arrangeOnImport: typeof raw?.arrangeOnImport === 'boolean' ? raw.arrangeOnImport : DEFAULT_ARRANGE_PREFS.arrangeOnImport,
  };
};

function readStored(): ArrangePrefs {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_ARRANGE_PREFS };
  }
}

let current = readStored();
const listeners = new Set<() => void>();

export function getArrangePrefs(): ArrangePrefs {
  return current;
}

export function setArrangePrefs(patch: { [K in keyof ArrangePrefs]?: ArrangePrefs[K] | undefined }) {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  current = sanitize({ ...current, ...defined });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* localStorage indisponible */
  }
  listeners.forEach((l) => l());
}

export function useArrangePrefs(): ArrangePrefs {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return current;
}
