/**
 * Journal des modifications du G-code (onglet Édition, CDC D5) : écrit dans l'en-tête chiffré du
 * fichier à l'enregistrement, pour retrouver l'historique d'annulation à la réouverture. Réglage
 * global des Paramètres, activé par défaut ; désactivé, rien n'est écrit et l'annulation ne vaut
 * que pour la session. Même patron que gcodeColorByPrefs.ts (singleton + localStorage).
 */

const STORAGE_KEY = 'apex-gcode-edit-journal';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

let enabled = readStored();
const listeners = new Set<(enabled: boolean) => void>();

export function isEditJournalEnabled() {
  return enabled;
}

export function setEditJournalEnabled(next: boolean) {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // no-op : localStorage indisponible.
  }
  listeners.forEach((listener) => listener(enabled));
}

export function subscribeEditJournal(listener: (enabled: boolean) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
