/**
 * Échelle de l'interface (Paramètres) : curseur d'échelle + mode « Apex Neutral ».
 * Appliquée par le zoom natif d'Electron (webFrame, exposé par le preload) : contrairement à un
 * CSS `zoom`, le canvas Babylon et les coordonnées du pointeur restent corrects. Sans pont
 * (navigateur), repli sur le zoom CSS du document. Même patron que editJournalPrefs.ts.
 *
 * Apex Neutral : l'échelle suit la résolution (pixels physiques) de la fenêtre pour afficher
 * autant d'éléments que sur un écran 2K (2560 × 1440) ; le curseur se multiplie à ce facteur.
 */

const SCALE_KEY = 'apex-ui-scale';
const NEUTRAL_KEY = 'apex-ui-neutral';

export const UI_SCALE_MIN = 0.5;
export const UI_SCALE_MAX = 2;
export const UI_SCALE_STEP = 0.05;
const REFERENCE_WIDTH = 2560;
const REFERENCE_HEIGHT = 1440;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

function readNumber(key: string, fallback: number): number {
  try {
    const value = parseFloat(localStorage.getItem(key) ?? '');
    return Number.isFinite(value) ? Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value)) : fallback;
  } catch {
    return fallback;
  }
}

function readNeutral(): boolean {
  try {
    return localStorage.getItem(NEUTRAL_KEY) === 'true';
  } catch {
    return false;
  }
}

let scale = readNumber(SCALE_KEY, 1);
let neutral = readNeutral();
let appliedZoom = 1;
const listeners = new Set<() => void>();

export const getUiScale = () => scale;
export const isUiNeutral = () => neutral;

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // no-op : localStorage indisponible.
  }
}

/** Facteur de zoom effectif : curseur × (Neutral : résolution physique / référence 2K). */
function effectiveZoom(): number {
  let zoom = scale;
  if (neutral) {
    // innerWidth × devicePixelRatio = pixels physiques, indépendant du zoom déjà appliqué.
    const dpr = window.devicePixelRatio || 1;
    const k = Math.min(
      (window.innerWidth * dpr) / REFERENCE_WIDTH,
      (window.innerHeight * dpr) / REFERENCE_HEIGHT,
    );
    zoom *= k;
  }
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

function applyUiScale() {
  const zoom = effectiveZoom();
  if (Math.abs(zoom - appliedZoom) < 0.001) return;
  appliedZoom = zoom;
  if (window.apexDesktop?.setZoomFactor) {
    window.apexDesktop.setZoomFactor(zoom);
  } else {
    (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(zoom);
  }
}

export function setUiScale(next: number) {
  scale = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, next));
  store(SCALE_KEY, String(scale));
  applyUiScale();
  listeners.forEach((l) => l());
}

export function setUiNeutral(next: boolean) {
  neutral = next;
  store(NEUTRAL_KEY, String(next));
  applyUiScale();
  listeners.forEach((l) => l());
}

export function subscribeUiScale(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** À appeler une fois au démarrage : applique l'échelle et suit les redimensionnements (Neutral). */
export function initUiScale() {
  applyUiScale();
  let raf = 0;
  window.addEventListener('resize', () => {
    if (!neutral) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(applyUiScale);
  });
}
