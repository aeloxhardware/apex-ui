/**
 * Orientation des flèches de l'outil Déplacer (sélecteur de TransformBox) : « relative » = les flèches suivent la
 * rotation du modèle (ses axes propres), « absolute » = elles restent sur les axes X, Y, Z de la machine.
 * Mémorisée sur la machine ; même patron que arrangePrefs.ts (singleton + localStorage). Le viewport la lit à
 * chaque image (viewportGizmos.ts), le sélecteur s'y abonne.
 */
import { useEffect, useState } from 'react';

export type GizmoOrientation = 'relative' | 'absolute';

export const DEFAULT_GIZMO_ORIENTATION: GizmoOrientation = 'relative';

const STORAGE_KEY = 'apex-gizmo-orientation';

export const sanitizeGizmoOrientation = (raw: unknown): GizmoOrientation =>
  raw === 'relative' || raw === 'absolute' ? raw : DEFAULT_GIZMO_ORIENTATION;

function readStored(): GizmoOrientation {
  try {
    return sanitizeGizmoOrientation(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_GIZMO_ORIENTATION;
  }
}

let current = readStored();
const listeners = new Set<() => void>();

export function getGizmoOrientation(): GizmoOrientation {
  return current;
}

export function setGizmoOrientation(next: GizmoOrientation) {
  current = sanitizeGizmoOrientation(next);
  try {
    localStorage.setItem(STORAGE_KEY, current);
  } catch {
    /* localStorage indisponible */
  }
  listeners.forEach((l) => l());
}

export function useGizmoOrientation(): GizmoOrientation {
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
