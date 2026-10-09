/**
 * Interface au lancement : « liquid » (l'interface LiquidGlass d'Apex) ou « classic » : LA MÊME application
 * (mêmes espaces, onglets et fonctionnement) mais à plat — noir et blanc, sans sons, animations,
 * transparence, verre ni flou (cf. FlatUi.tsx et styles/flat.css). Moins belle, pour que l'on préfère l'autre.
 *
 * La valeur est LUE UNE SEULE FOIS, au chargement de ce module (donc au lancement de l'application) ; la
 * changer ne prend effet qu'au lancement suivant (`relaunchApp`). Ordre de priorité :
 *   1. ligne de commande / environnement d'Electron : `--ui=classic` ou `APEX_UI=classic` (relayé par le preload) ;
 *   2. paramètre d'adresse `?ui=classic` (serveur de développement Vite, navigateur) ;
 *   3. réglage mémorisé (Paramètres, localStorage) ;
 *   4. « liquid ».
 * Toute valeur inconnue est ignorée (on passe à la source suivante).
 */

import { MotionGlobalConfig } from 'framer-motion';

export type InterfaceMode = 'liquid' | 'classic';

const STORAGE_KEY = 'apex-interface-mode';

function parse(value: unknown): InterfaceMode | null {
  const v = String(value ?? '').trim().toLowerCase();
  return v === 'liquid' || v === 'classic' ? v : null;
}

function readFromAddress(): InterfaceMode | null {
  try {
    const fromSearch = new URLSearchParams(window.location.search).get('ui');
    if (fromSearch) return parse(fromSearch);
    // HashRouter : le paramètre peut aussi se trouver après le « # ».
    const hash = window.location.hash;
    const q = hash.indexOf('?');
    return q >= 0 ? parse(new URLSearchParams(hash.slice(q + 1)).get('ui')) : null;
  } catch {
    return null;
  }
}

function readStored(): InterfaceMode | null {
  try {
    return parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null; // localStorage indisponible
  }
}

/** Réglage mémorisé (celui de Paramètres), indépendamment de ce que le lancement a imposé. */
export function getStoredInterfaceMode(): InterfaceMode {
  return readStored() ?? 'liquid';
}

const launchMode: InterfaceMode =
  parse(window.apexDesktop?.launchUi) ?? readFromAddress() ?? readStored() ?? 'liquid';

/** Interface chargée à ce lancement (constante pour toute la session). */
export function getLaunchInterfaceMode(): InterfaceMode {
  return launchMode;
}

/** Mémorise l'interface du PROCHAIN lancement ; ne change rien à la session en cours. */
export function setStoredInterfaceMode(mode: InterfaceMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // no-op : localStorage indisponible.
  }
}

/** Recharge l'interface pour appliquer le réglage mémorisé. */
export function relaunchApp() {
  // Un `--ui=` / `?ui=` explicite l'emporterait sur le réglage : on le retire de l'adresse avant de recharger.
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('ui');
    const hash = url.hash;
    const q = hash.indexOf('?');
    if (q >= 0) {
      const params = new URLSearchParams(hash.slice(q + 1));
      params.delete('ui');
      const rest = params.toString();
      url.hash = hash.slice(0, q) + (rest ? `?${rest}` : '');
    }
    window.history.replaceState(null, '', url.toString());
  } catch {
    // no-op
  }
  window.location.reload();
}

/** Cadence maximale du rendu 3D dans l'interface classique (images/s) : économie de ressources, décision de l'utilisateur. */
export const FLAT_MAX_FPS = 25;

/** Interface « à plat » (noir et blanc, sans effets) pour toute cette session. */
export const isFlatUi = () => launchMode === 'classic';

if (isFlatUi()) {
  document.documentElement.dataset.uiFlat = '1';
  // Toutes les animations framer-motion sautent directement à leur état final (les rappels de fin sont tenus).
  MotionGlobalConfig.skipAnimations = true;
}
