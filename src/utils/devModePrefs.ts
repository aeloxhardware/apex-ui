/**
 * Mode « dev » : désactivé, l'onglet Dev disparaît de la barre d'outils et les raccourcis du
 * navigateur (Ctrl+R, Ctrl+Maj+R, F5, F12…) sont sans effet (bloqués par le process principal
 * d'Electron). Activé par défaut en développement (vite serve / build de développement) ; DÉSACTIVÉ par défaut dans
 * l'application installée (build de production, ordre de l'utilisateur 2026-10-08) : le réglage reste accessible dans
 * Paramètres et mémorisé ensuite.
 * Même patron que editJournalPrefs.ts (singleton + localStorage).
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'apex-dev-mode';

function readStored(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === 'true';
  } catch {
    // no-op : localStorage indisponible.
  }
  return import.meta.env.DEV;
}

let enabled = readStored();
const listeners = new Set<(enabled: boolean) => void>();

function syncDesktop() {
  try {
    window.apexDesktop?.setDevMode?.(enabled);
  } catch {
    // no-op : hors Electron.
  }
}
syncDesktop();

export function isDevModeEnabled() {
  return enabled;
}

export function setDevModeEnabled(next: boolean) {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // no-op : localStorage indisponible.
  }
  syncDesktop();
  listeners.forEach((listener) => listener(enabled));
}

export function subscribeDevMode(listener: (enabled: boolean) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useDevMode() {
  const [value, setValue] = useState(isDevModeEnabled);
  useEffect(() => subscribeDevMode(setValue), []);
  return value;
}

/** Texte de présentation (Accueil, infobulle du logo) : version préversion quand le mode dev est désactivé. */
export const APP_TAGLINE_DEV =
  'Openware de tranchage de modèles 3D destiné à la fabrication additive non-planaire à plan de construction dynamique.';
export const APP_TAGLINE_PREVIEW =
  "Openware de traitement de modèle 3D en préversion. Ce logiciel ne peut pas encore générer de G-Code ni modéliser des objets en 3D et ne permet pour l'instant que l'édition de G-Code. Rendez-vous dans l'Espace Prévisualisation, puis cliquez sur l'icône de Modification à droite pour en savoir plus.";
