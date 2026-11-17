/**
 * Réserve de fichiers temporaires pour les espaces quittés : les données (modèles du plateau,
 * G-code analysé) y sont déposées pour libérer la RAM, puis relues au retour — rien n'est effacé.
 * Application de bureau : fichiers du dossier temporaire (electron/stash.cjs, supprimés à la fermeture) ;
 * navigateur : système de fichiers privé de la page (OPFS) ; à défaut, simple table en mémoire.
 * Une écriture en cours est attendue par `stashTake`, qui relit donc toujours la dernière valeur.
 */

const memory = new Map<string, Uint8Array>();
const pending = new Map<string, Promise<void>>();

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Nom de fichier sûr (mêmes règles que electron/stash.cjs). */
const fileName = (key: string) => `apex-stash-${key.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await navigator.storage?.getDirectory?.()) ?? null;
  } catch {
    return null;
  }
}

async function writeBytes(key: string, bytes: Uint8Array): Promise<void> {
  const desktop = window.apexDesktop;
  if (desktop?.stashWrite) {
    await desktop.stashWrite(key, bytes);
    return;
  }
  const root = await opfsRoot();
  if (!root) {
    memory.set(key, bytes);
    return;
  }
  const handle = await root.getFileHandle(fileName(key), { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes as BufferSource);
  await writable.close();
}

async function readBytes(key: string): Promise<Uint8Array | null> {
  const desktop = window.apexDesktop;
  if (desktop?.stashRead) {
    const bytes = await desktop.stashRead(key);
    return bytes ? new Uint8Array(bytes) : null;
  }
  const root = await opfsRoot();
  if (!root) return memory.get(key) ?? null;
  try {
    const handle = await root.getFileHandle(fileName(key));
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  } catch {
    return null;
  }
}

async function dropBytes(key: string): Promise<void> {
  memory.delete(key);
  const desktop = window.apexDesktop;
  if (desktop?.stashDrop) {
    await desktop.stashDrop(key);
    return;
  }
  const root = await opfsRoot();
  await root?.removeEntry(fileName(key)).catch(() => undefined);
}

/** Dépose des octets sous `key` (remplace le contenu précédent). La promesse se résout une fois écrit. */
export function stashPut(key: string, bytes: Uint8Array): Promise<void> {
  const previous = pending.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => writeBytes(key, bytes));
  pending.set(key, next);
  return next;
}

/** Dépose un texte (G-code, JSON…) sous `key`. */
export const stashPutText = (key: string, text: string): Promise<void> => stashPut(key, encoder.encode(text));

/** Relit puis supprime l'entrée : la donnée repasse en mémoire, le fichier disparaît. Null si absente. */
export async function stashTake(key: string): Promise<Uint8Array | null> {
  await pending.get(key)?.catch(() => undefined);
  const bytes = await readBytes(key);
  await dropBytes(key);
  pending.delete(key);
  return bytes;
}

/** Comme `stashTake`, pour un texte. */
export async function stashTakeText(key: string): Promise<string | null> {
  const bytes = await stashTake(key);
  return bytes ? decoder.decode(bytes) : null;
}

/** Lit l'entrée sans la retirer de la réserve (enregistrement du projet à la fermeture). Null si absente. */
export async function stashPeekBytes(key: string): Promise<Uint8Array | null> {
  await pending.get(key)?.catch(() => undefined);
  return readBytes(key);
}

/** Comme `stashPeekBytes`, pour un texte. */
export async function stashPeekText(key: string): Promise<string | null> {
  const bytes = await stashPeekBytes(key);
  return bytes ? decoder.decode(bytes) : null;
}

/** Supprime l'entrée (le viewport remonté reprend la main sur ce qu'elle contenait). */
export async function stashDrop(key: string): Promise<void> {
  await pending.get(key)?.catch(() => undefined);
  await dropBytes(key);
  pending.delete(key);
}
