import { AMS_SAMPLE_SPOOLS } from './amsSamples';

/** Une bobine posée dans l'AMS : son identité (stable quand on la déplace), son profil de filament et sa couleur. */
export interface AmsEntry {
  id: string;
  /** Clé `vendor|name` du profil (usine ou utilisateur). */
  key: string;
  color: string;
}

let counter = 0;
// Préfixe horaire : les identifiants mémorisés d'une session précédente ne doivent jamais entrer en collision avec les nouveaux.
const SESSION = Date.now().toString(36);
const nextId = () => `ams-${SESSION}-${++counter}`;

/** Bobine d'exemple n° `index` (les exemples se répètent au-delà de leur nombre). */
export function sampleEntry(index: number): AmsEntry {
  const sample = AMS_SAMPLE_SPOOLS[index % AMS_SAMPLE_SPOOLS.length] ?? { key: '', color: '#888888' };
  return { id: nextId(), key: sample.key, color: sample.color };
}

/** Bobine ajoutée depuis la bibliothèque : couleur du profil si elle existe, sinon une couleur d'exemple. */
export function entryFor(key: string, profileColor: string | null, index: number): AmsEntry {
  return { id: nextId(), key, color: profileColor ?? sampleEntry(index).color };
}

/** Garde les `n` premières bobines, ou en ajoute d'exemple jusqu'à `n`. */
export function resizeEntries(list: AmsEntry[], n: number): AmsEntry[] {
  if (n <= list.length) return list.slice(0, n);
  return [...list, ...Array.from({ length: n - list.length }, (_, i) => sampleEntry(list.length + i))];
}

export function insertEntry(list: AmsEntry[], at: number, entry: AmsEntry): AmsEntry[] {
  const index = Math.min(Math.max(at, 0), list.length);
  return [...list.slice(0, index), entry, ...list.slice(index)];
}

/** Remet les bobines dans l'ordre des identifiants donnés (glisser-déposer : leur numéro suit leur position). */
export function reorderByIds(list: AmsEntry[], ids: string[]): AmsEntry[] {
  const byId = new Map(list.map((e) => [e.id, e]));
  const ordered = ids.map((id) => byId.get(id)).filter((e): e is AmsEntry => e !== undefined);
  return ordered.length === list.length ? ordered : list;
}

export const replaceKey = (list: AmsEntry[], id: string, key: string): AmsEntry[] => list.map((e) => (e.id === id ? { ...e, key } : e));
