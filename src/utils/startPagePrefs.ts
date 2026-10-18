/**
 * Page de démarrage (Paramètres) : l'espace sur lequel l'application s'ouvre. Même patron que
 * plateShadingPrefs.ts (singleton + localStorage). Lue au lancement ; « Modélisation » n'existe
 * qu'avec la valeur « dev » activée (cf. devModePrefs.ts), sinon l'Accueil est utilisé.
 */

import { useEffect, useState } from 'react';

export type StartPage = 'home' | 'prepare' | 'preview' | 'modeling';

export const START_PAGES: { id: StartPage; label: string }[] = [
  { id: 'home', label: 'Accueil' },
  { id: 'prepare', label: 'Préparation' },
  { id: 'preview', label: 'Prévisualisation' },
  { id: 'modeling', label: 'Modélisation' },
];

const STORAGE_KEY = 'apex-start-page';
// TEMPORAIRE (développement, demande de l'utilisateur 2026-10-13) : sans réglage mémorisé,
// l'application s'ouvre sur Modélisation. À remettre à 'home' avant toute version publique ;
// sans la valeur « dev », Modélisation n'existe pas et l'Accueil est utilisé de toute façon.
const DEFAULT_START_PAGE: StartPage = 'modeling';

function readStored(): StartPage {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return START_PAGES.some((p) => p.id === value) ? (value as StartPage) : DEFAULT_START_PAGE;
  } catch {
    return DEFAULT_START_PAGE; // localStorage indisponible
  }
}

let startPage = readStored();
const listeners = new Set<(page: StartPage) => void>();

export function getStartPage(): StartPage {
  return startPage;
}

export function setStartPage(next: StartPage) {
  startPage = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // no-op : localStorage indisponible.
  }
  listeners.forEach((listener) => listener(startPage));
}

export function subscribeStartPage(listener: (page: StartPage) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useStartPage() {
  const [value, setValue] = useState(getStartPage);
  useEffect(() => subscribeStartPage(setValue), []);
  return value;
}
