import { useEffect, useState } from 'react';
import { getSelectedFilamentKey, setSelectedFilamentKey } from '@/utils/filamentCatalog';
import { entryFor, type AmsEntry } from './amsSpoolsState';

/**
 * Contenu de l'AMS, partagé par tous les écrans qui l'affichent et mémorisé dans le navigateur. LIEN avec la découpe :
 * le filament actif d'Apex (`apex.filament`, lu par l'espace Préparation et la découpe) est celui du SLOT 1 de l'AMS ;
 * changer, déplacer, ajouter ou modifier la bobine n° 1 met donc à jour le filament actif.
 */

const STORAGE_KEY = 'apex.ams';

const isEntry = (e: unknown): e is AmsEntry =>
  typeof e === 'object' && e !== null && ['id', 'key', 'color'].every((k) => typeof (e as Record<string, unknown>)[k] === 'string');

function readStored(): AmsEntry[] | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(isEntry) ? parsed : null;
  } catch {
    return null;
  }
}

/** Clé du filament actif à écrire pour ces bobines (celle du slot 1), ou `null` s'il n'y a rien à changer. */
export function activeKeyToSet(entries: readonly AmsEntry[], currentKey: string): string | null {
  const first = entries[0]?.key;
  return first && first !== currentKey ? first : null;
}

let entries: AmsEntry[] = readStored() ?? [entryFor(getSelectedFilamentKey(), null, 0)];
const listeners = new Set<(list: AmsEntry[]) => void>();

function syncActiveFilament() {
  const key = activeKeyToSet(entries, getSelectedFilamentKey());
  if (key) setSelectedFilamentKey(key);
}
syncActiveFilament();

/** Remplace le contenu de l'AMS (mémorisé, avec mise à jour du filament actif). */
export function updateAmsEntries(update: (list: AmsEntry[]) => AmsEntry[]): void {
  const next = update(entries);
  if (next === entries || next.length === 0) return;
  entries = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* stockage indisponible : contenu de session seulement */
  }
  syncActiveFilament();
  listeners.forEach((l) => l(entries));
}

export function useAmsEntries(): AmsEntry[] {
  const [list, setList] = useState(entries);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}
