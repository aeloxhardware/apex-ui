import { parseGCode, type ParsedGCode } from '@/components/gcodeParse';
import { setActiveKinematics } from '@/utils/kinematics';
import { unpackParsedGCode, type PackedParsedGCode } from '@/utils/gcodeParseTransfer';
import GCodeParseWorker from '@/workers/gcodeParse.worker?worker&inline';

/**
 * Analyse un G-code sans bloquer l'interface (worker dédié). `?worker&inline` embarque le worker
 * en Blob : fonctionne aussi depuis `file://` (application de bureau packagée). Si le worker ne
 * peut pas démarrer, repli sur l'analyse dans le thread principal (bloquante, mais fonctionnelle).
 */
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (p: PackedParsedGCode) => void; reject: (e: Error) => void }>();

const failAll = (message: string) => {
  for (const { reject } of pending.values()) reject(new Error(message));
  pending.clear();
  worker?.terminate();
  worker = null;
};

/** Fermeture de l'application : annule toute analyse en cours et arrête le Worker. */
export const cancelAllParsing = () => failAll('Application en cours de fermeture.');

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    const w = new GCodeParseWorker();
    w.onmessage = (e: MessageEvent<{ id: number; payload?: PackedParsedGCode; error?: string }>) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      pending.delete(e.data.id);
      if (e.data.payload) entry.resolve(e.data.payload);
      else entry.reject(new Error(e.data.error ?? 'Analyse impossible.'));
    };
    w.onerror = () => failAll('Le worker d’analyse a échoué.');
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

export async function parseGCodeAsync(text: string): Promise<ParsedGCode> {
  const parsed = await parseGCodeOnWorker(text);
  // Le worker a sa propre copie du module : la cinématique du fichier est installée ici, côté fenêtre.
  setActiveKinematics(parsed.kinematics);
  return parsed;
}

async function parseGCodeOnWorker(text: string): Promise<ParsedGCode> {
  const w = getWorker();
  if (!w) return parseGCode(text);
  try {
    const payload = await new Promise<PackedParsedGCode>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, text });
    });
    return await unpackParsedGCode(payload);
  } catch (err) {
    // Une erreur de syntaxe propre au fichier vient du parseur lui-même : pas de repli (il
    // échouerait pareil) ; seule une panne du worker justifie de retenter dans le thread principal.
    if (err instanceof Error && err.message === 'Le worker d’analyse a échoué.') return parseGCode(text);
    throw err;
  }
}
