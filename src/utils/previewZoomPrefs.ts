/**
 * Zoom molette de la Prévisualisation (hors Modélisation). Singleton + localStorage, même patron que
 * editJournalPrefs.ts ; Viewport3D le lit à chaque cran, le panneau « Fonction » le modifie.
 *
 * Automatique : le pas en mm suit la distance caméra → point visé sous le curseur selon une loi de
 * puissance douce, pas = base · (d / 300 mm)^exposant. Avec un exposant < 1 (0,5 par défaut), le pas
 * diminue en approchant mais bien moins vite que la distance (en Modélisation il lui est
 * proportionnel, d'où le ralentissement brutal) : on ne « rame » jamais. Désactivé : pas fixe.
 * La vitesse est un multiplicateur de l'ensemble, dans les deux cas.
 */

export const PREVIEW_ZOOM_SPEED_MIN = 0.25;
export const PREVIEW_ZOOM_SPEED_MAX = 4;
const PREVIEW_ZOOM_REF_DISTANCE_MM = 300;
const PREVIEW_ZOOM_EXPONENT = 0.5;
/** Plancher de la distance prise en compte : évite un pas quasi nul au contact de la pièce. */
const PREVIEW_ZOOM_MIN_DISTANCE_MM = 5;

export interface PreviewZoomPrefs {
  auto: boolean;
  speed: number;
}

const STORAGE_KEY = 'apex-preview-zoom';

function readStored(): PreviewZoomPrefs {
  const out: PreviewZoomPrefs = { auto: true, speed: 1 };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<PreviewZoomPrefs> | null;
    if (parsed) {
      if (typeof parsed.auto === 'boolean') out.auto = parsed.auto;
      if (typeof parsed.speed === 'number' && Number.isFinite(parsed.speed)) {
        out.speed = Math.min(Math.max(parsed.speed, PREVIEW_ZOOM_SPEED_MIN), PREVIEW_ZOOM_SPEED_MAX);
      }
    }
  } catch {
    // no-op : valeurs par défaut.
  }
  return out;
}

let prefs = readStored();
const listeners = new Set<(prefs: PreviewZoomPrefs) => void>();

export function getPreviewZoomPrefs() {
  return prefs;
}

export function setPreviewZoomPrefs(patch: Partial<PreviewZoomPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // no-op : localStorage indisponible.
  }
  listeners.forEach((listener) => listener(prefs));
}

export function subscribePreviewZoomPrefs(listener: (prefs: PreviewZoomPrefs) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Multiplicateur du pas de base (30 mm / cran) pour une distance au point visé. */
export function previewZoomStepFactor(distanceMm: number) {
  const { auto, speed } = prefs;
  if (!auto) return speed;
  const d = Math.max(distanceMm, PREVIEW_ZOOM_MIN_DISTANCE_MM);
  return speed * Math.pow(d / PREVIEW_ZOOM_REF_DISTANCE_MM, PREVIEW_ZOOM_EXPONENT);
}
