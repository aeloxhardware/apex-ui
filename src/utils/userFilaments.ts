import { useEffect, useState } from 'react';
import { filamentKey, type FilamentProfile } from './filamentCatalog';

/**
 * Profils de filament de l'utilisateur. RÈGLE : le profil d'usine (catalogue) n'est jamais écrasé et on en garde
 * toujours l'original ; une modification est enregistrée dans un NOUVEAU profil « [profil] - Copie », puis
 * « [profil] - Copie (2) », « (3) »… Un profil utilisateur existant n'est pas écrasé non plus : on le copie à son tour.
 */

const STORAGE_KEY = 'apex.userFilaments';
const COPY_SUFFIX = /\s-\sCopie(?:\s\(\d+\))?$/;

/** Nom sans suffixe de copie (« X - Copie (2) » → « X »). */
export const baseNameOf = (name: string): string => name.replace(COPY_SUFFIX, '');

/** Premier nom de copie libre : « X - Copie », « X - Copie (2) », « X - Copie (3) »… */
export function nextCopyName(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const first = `${baseNameOf(name)} - Copie`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = `${first} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Champs qu'une modification peut changer (jamais l'identité du profil). */
export type FilamentEdits = Partial<Omit<FilamentProfile, 'name' | 'vendor' | 'user' | 'baseKey' | 'orca_source'>>;

/** Copie utilisateur d'un profil, avec ses modifications ; `baseKey` pointe toujours le profil d'USINE d'origine. */
export function makeUserCopy(base: FilamentProfile, edits: FilamentEdits, existingNames: Iterable<string>): FilamentProfile {
  return {
    ...base,
    ...edits,
    name: nextCopyName(base.name, existingNames),
    user: true,
    baseKey: base.user && base.baseKey ? base.baseKey : filamentKey(base),
  };
}

function readStored(): FilamentProfile[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as FilamentProfile[]).filter((p) => p.user === true) : [];
  } catch {
    return [];
  }
}

let profiles: FilamentProfile[] = readStored();
const listeners = new Set<(list: FilamentProfile[]) => void>();

const listUserFilaments = (): FilamentProfile[] => profiles;

/** Enregistre une modification : toujours une nouvelle copie, jamais l'écrasement de `base` (usine ou utilisateur). */
export function saveUserFilament(base: FilamentProfile, edits: FilamentEdits): FilamentProfile {
  const saved = makeUserCopy(
    base,
    edits,
    profiles.map((p) => p.name),
  );
  profiles = [...profiles, saved];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    /* stockage indisponible : copie de session seulement */
  }
  listeners.forEach((l) => l(profiles));
  return saved;
}

export function useUserFilaments(): FilamentProfile[] {
  const [list, setList] = useState(listUserFilaments);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}
