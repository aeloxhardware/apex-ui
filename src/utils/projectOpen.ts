/**
 * Ouverture d'un projet 3MF sur le plateau : chaque objet du fichier est converti en STL (repère de la scène) puis
 * importé comme n'importe quel modèle, l'un après l'autre, une fois Préparation affichée (le viewport est démonté sur
 * l'Accueil). La position d'origine n'est pas reprise : chaque objet prend la première place libre du plateau.
 */
import { emitApex, onApex } from '@/events/apexEvents';
import { importModelsOneByOne } from '@/utils/importModels';
import { readThreeMf, sceneStlBytes } from '@/utils/threeMfRead';

export const PROJECT_FILE_EXT = /\.3mf$/i;
/** Garde-fou : le viewport qui ne répond pas ne doit pas bloquer l'ouverture indéfiniment. */
const VIEWPORT_TIMEOUT_MS = 8000;

const safeName = (name: string) => name.replace(/[^\p{L}\p{N} _.-]/gu, '_').slice(0, 80) || 'Modèle';

function viewportReady(): { ready: Promise<void>; cancel: () => void } {
  let off: () => void = () => undefined;
  let timer = 0;
  const ready = new Promise<void>((resolve) => {
    off = onApex('apex-viewport-ready', () => resolve());
    timer = window.setTimeout(resolve, VIEWPORT_TIMEOUT_MS);
  });
  return { ready, cancel: () => (off(), window.clearTimeout(timer)) };
}

/** Ouvre Préparation et y pose les objets du projet. Renvoie leur nombre (0 : fichier sans modèle). */
export async function openProjectOnPlate(bytes: Uint8Array, fileName: string): Promise<number> {
  const base = fileName.replace(/\.3mf$/i, '');
  const meshes = await readThreeMf(bytes, base);
  if (meshes.length === 0) return 0;
  const files = meshes.map((mesh) => new File([sceneStlBytes(mesh)], `${safeName(mesh.name)}.stl`, { type: 'model/stl' }));
  const viewport = viewportReady();
  emitApex('apex-go-prepare');
  await viewport.ready;
  viewport.cancel();
  await importModelsOneByOne(files);
  return files.length;
}
