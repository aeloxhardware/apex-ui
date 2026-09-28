/**
 * Réglage de performance de la coloration « colorer par » (cf. gcodeLayer.ts, GCodeLineTypeLegend
 * et ParamsPanel) : par défaut, le tampon de couleurs par sommet des cordons est recalculé de façon
 * synchrone au changement de mode — sur les fichiers vus jusqu'ici, ce recalcul est indissociable
 * d'une bascule instantanée. Sur un fichier extrêmement volumineux, ce recalcul (proportionnel au
 * nombre de sommets) pourrait redevenir perceptible ; ce réglage permet alors de le différer d'une
 * image (`requestAnimationFrame`) pour ne jamais bloquer la frame en cours au clic, au prix d'un
 * demi-battement avant que la nouvelle coloration apparaisse. Suit le même patron que
 * `utils/uiSound.ts` (singleton + `localStorage`, jamais bloquant si indisponible).
 */

const DEFER_STORAGE_KEY = 'apex-gcode-colorby-defer';

function readStoredDefer(): boolean {
  try {
    return localStorage.getItem(DEFER_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

let deferred = readStoredDefer();
const listeners = new Set<(deferred: boolean) => void>();

/** Recalcul du tampon de couleurs différé d'une image (true) ou synchrone au clic (false, défaut). */
export function isColorByDeferred() {
  return deferred;
}

export function setColorByDeferred(next: boolean) {
  deferred = next;
  try {
    localStorage.setItem(DEFER_STORAGE_KEY, String(next));
  } catch {
    // no-op : localStorage indisponible (navigation privée, quota...).
  }
  listeners.forEach((listener) => listener(deferred));
}

export function subscribeColorByDeferred(listener: (deferred: boolean) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
