import { EDIT_VALUES_PER_POINT, type EditHistoryEntry, type EditInfluence, type EditTransform } from '@/utils/editKernelClient';
import type { ApexJournalEntry } from '@/utils/apexHeader';
import type { ParsedGCode } from '../gcodeParse';

// Journal des validations de l'onglet Édition (D5) : partie sans état de gcodeEditController.ts,
// sortie du contrôleur pour pouvoir être testée telle quelle.

/** Précision de consignation des valeurs (évite que le bruit flottant change l'empreinte). */
const JOURNAL_PRECISION = 1e7;
export const roundJournal = (v: number) => Math.round(v * JOURNAL_PRECISION) / JOURNAL_PRECISION;

/** Ce qu'une validation consigne dans le journal : avant / après, transformation, influence. */
export interface JournalCommit {
  node: number;
  transform: EditTransform;
  influence: EditInfluence;
  indices: Uint32Array;
  before: Float64Array;
  after: Float64Array;
  trimmed?: Uint32Array | undefined;
  group?: string | undefined;
}

/** Valeurs courantes (R, C, Z, B, E) des points `indices` dans le G-code affiché. */
export function currentValues(parsed: ParsedGCode, indices: ArrayLike<number>): Float64Array {
  const out = new Float64Array(indices.length * EDIT_VALUES_PER_POINT);
  for (let i = 0; i < indices.length; i++) {
    const k = indices[i];
    const m = parsed.moves[k];
    out.set([m.x, m.y, m.z, m.b, parsed.eDelta[k]], i * EDIT_VALUES_PER_POINT);
  }
  return out;
}

/** Entrée du journal pour une validation ; l'empreinte reste à calculer (asynchrone). */
export function journalEntryOf(commit: JournalCommit, at: string = new Date().toISOString()): ApexJournalEntry {
  const { node, transform, influence, indices, before, after, trimmed, group } = commit;
  return {
    at,
    node,
    transform: {
      translation: Array.from(transform.translation),
      axis: Array.from(transform.axis),
      angleRad: transform.angleRad,
    },
    influence: {
      ...influence,
      directions: influence.directions ? Array.from(influence.directions, roundJournal) : [],
      anchors: influence.anchors ? Array.from(influence.anchors, roundJournal) : [],
    },
    indices: Array.from(indices),
    before: Array.from(before, roundJournal),
    after: Array.from(after, roundJournal),
    ...(trimmed && trimmed.length ? { trimmed: Array.from(trimmed) } : {}),
    ...(group !== undefined ? { group } : {}),
    fingerprint: '',
  };
}

export const toHistory = (e: ApexJournalEntry): EditHistoryEntry => ({
  indices: Uint32Array.from(e.indices),
  before: Float64Array.from(e.before),
  after: Float64Array.from(e.after),
  trimmed: e.trimmed && e.trimmed.length ? Uint32Array.from(e.trimmed) : undefined,
});

/** Tailles des groupes d'entrées consécutives de même identifiant de groupe (une validation et ses copies). */
export function groupsOf(entries: ApexJournalEntry[]): number[] {
  const out: number[] = [];
  let last: string | undefined;
  for (const e of entries) {
    if (e.group !== undefined && e.group === last) out[out.length - 1]++;
    else out.push(1);
    last = e.group;
  }
  return out;
}
