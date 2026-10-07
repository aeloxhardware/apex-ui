import { apexDecrypt, apexEncrypt } from './apexCipher';

/**
 * Bloc d'en-tête chiffré Apex d'un G-code (CDC D4, D5, D7 ; format : docs/APEX_HEADER_FORMAT.md) :
 *
 *   ; apex_block_begin v1
 *   ; apex_data:<base64, 100 caractères par ligne>
 *   ; apex_block_end
 *
 * Contenu (JSON, chiffré par apexCipher) : métadonnées de tranchage (écrites par le moteur),
 * marqueur « tranché par Apex », et journal des modifications de l'onglet Édition. Les commandes du
 * G-code restent en clair (le firmware les lit) ; le bloc n'est que des commentaires.
 */

export interface ApexJournalEntry {
  /** Date ISO de la validation. */
  at: string;
  /** Point du nœud (indice de mouvement). */
  node: number;
  /** Transformation validée, repère du noyau. */
  transform: { translation: number[]; axis: number[]; angleRad: number };
  /** Réglages d'influence, poignées comprises (directions, portées, ancrages). */
  influence: unknown;
  /** Points modifiés, et leurs valeurs avant / après (R, C, Z, B, E par point). */
  indices: number[];
  before: number[];
  after: number[];
  /** Points dont le dépôt a été rogné par cette modification (sous-ensemble de `indices`). */
  trimmed?: number[];
  /** Identifiant du groupe : une validation et ses copies par symétrie s'annulent d'un coup. */
  group?: string;
  /** Empreinte SHA-256 (hex) des valeurs après : contrôle du rejeu à la réouverture. */
  fingerprint: string;
}

export interface ApexJournal {
  undo: ApexJournalEntry[];
  redo: ApexJournalEntry[];
}

export interface ApexHeaderPayload {
  format: 1;
  /** Tranché par le moteur Apex (modification en place permise). */
  sliced?: boolean;
  /** Métadonnées de tranchage, libres (écrites par le moteur). */
  meta?: Record<string, unknown>;
  journal?: ApexJournal;
}

const BEGIN = '; apex_block_begin v1';
const DATA = '; apex_data:';
const END = '; apex_block_end';
const CHUNK = 100;

/** Lignes [début, fin] du bloc, ou null. */
function findBlock(lines: string[]): [number, number] | null {
  const start = lines.findIndex((l) => l.trimEnd() === BEGIN);
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === END) return [start, i];
  }
  return null;
}

/** Contenu déchiffré du bloc d'en-tête Apex, null s'il n'y en a pas (erreur s'il est illisible). */
export async function readApexHeader(text: string): Promise<ApexHeaderPayload | null> {
  // Le bloc est en tête de fichier : inutile de découper tout le texte.
  const end = text.indexOf(END);
  if (end < 0 || text.indexOf(BEGIN) < 0) return null;
  const lines = text.slice(0, end + END.length + 2).split('\n');
  const range = findBlock(lines);
  if (!range) return null;
  const data = lines
    .slice(range[0] + 1, range[1])
    .map((l) => l.trimEnd())
    .filter((l) => l.startsWith(DATA))
    .map((l) => l.slice(DATA.length))
    .join('');
  return JSON.parse(await apexDecrypt(data)) as ApexHeaderPayload;
}

/**
 * Texte avec le bloc d'en-tête remplacé (ou retiré si `payload` est null). Le bloc est placé en
 * tête du fichier ; les fins de ligne du fichier (\n ou \r\n) sont conservées.
 */
export async function writeApexHeader(text: string, payload: ApexHeaderPayload | null): Promise<string> {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split('\n');
  const range = findBlock(lines);
  if (range) lines.splice(range[0], range[1] - range[0] + 1);
  let body = lines.join('\n');
  if (!payload) return body;
  const encoded = await apexEncrypt(JSON.stringify(payload));
  const block = [BEGIN];
  for (let i = 0; i < encoded.length; i += CHUNK) block.push(DATA + encoded.slice(i, i + CHUNK));
  block.push(END);
  if (body.length && !body.startsWith(eol)) body = eol + body;
  return block.join(eol) + body;
}

/**
 * Empreinte SHA-256 (hex) de points et de leurs R, C, Z, B TELS QU'ÉCRITS dans le fichier (4
 * décimales, cf. gcodeWriter.ts) : à la réouverture, l'empreinte recalculée sur le fichier relu doit
 * être identique. E n'y entre pas (relu comme différence de positions absolues arrondies).
 * `values` : 5 valeurs par point (R, C, Z, B, E).
 */
export async function fingerprintOf(indices: ArrayLike<number>, values: ArrayLike<number>): Promise<string> {
  const buffer = new Float64Array(indices.length * 5);
  for (let i = 0; i < indices.length; i++) {
    buffer[5 * i] = indices[i];
    // « + 0 » : −0 et 0 doivent donner la même empreinte.
    for (let v = 0; v < 4; v++) buffer[5 * i + 1 + v] = Number(values[5 * i + v].toFixed(4)) + 0;
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
