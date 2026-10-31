/**
 * Signature en clair des G-code du moteur Apex (R-025) : une ligne, en tête de fichier, qui dit « fichier
 * Apex » et déclenche la lecture du bloc d'en-tête chiffré (utils/apexHeader.ts).
 *
 * Même valeur que `file_io/apex_signature.py` du moteur (apex-engine). Elle ne signifie rien et ne
 * prouve rien : le dépôt est public, n'importe qui peut l'écrire dans un fichier. Repère, jamais sécurité.
 */
export const APEX_SIGNATURE_LINE = '; 85Ejj-sV6dI-NXTGl-JiodA-0b8aZ';

/** Nombre de lignes de tête où la signature est cherchée. */
export const APEX_SIGNATURE_SCAN_LINES = 40;

/** Vrai si la ligne exacte de signature figure dans les 40 premières lignes (un `\r` final est ignoré). */
export function hasApexSignature(text: string): boolean {
  let start = 0;
  for (let n = 0; n < APEX_SIGNATURE_SCAN_LINES && start <= text.length; n++) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    let line = text.slice(start, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line === APEX_SIGNATURE_LINE) return true;
    start = end + 1;
  }
  return false;
}
