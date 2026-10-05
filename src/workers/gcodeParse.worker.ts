import { parseGCode } from '@/components/gcodeParse';
import { packParsedGCode } from '@/utils/gcodeParseTransfer';

/**
 * Analyse d'un G-code hors du thread de l'interface : un fichier très lourd ne fige plus l'UI.
 * Les mouvements sont renvoyés en tableaux typés TRANSFÉRÉS (zéro copie), jamais en un tableau de
 * millions d'objets dont la désérialisation bloquerait le thread principal — celui-ci les
 * reconstruit par tranches (cf. gcodeParseTransfer.ts).
 */
self.onmessage = (e: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = e.data;
  try {
    const { payload, transfer } = packParsedGCode(parseGCode(text));
    (self as unknown as Worker).postMessage({ id, payload }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
