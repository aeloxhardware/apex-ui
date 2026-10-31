// Formats acceptés par l'import de modèles (sélecteurs de fichier, dépôt, Viewport3D `onImportModel`).
export const MODEL_FILE_EXT = /\.(stl|glb|gltf)$/i;
// Garde-fou : un import qui n'aboutit jamais ne doit pas bloquer les fichiers suivants.
const MODEL_IMPORT_TIMEOUT_MS = 30000;

/**
 * Importe les modèles un par un : `onImportModel` choisit l'emplacement libre du plateau
 * APRÈS avoir chargé le fichier (asynchrone), donc deux imports lancés ensemble se poseraient au
 * même endroit. On attend sa fin (`apex-import-model-settled`, succès ou échec) avant le suivant.
 */
export async function importModelsOneByOne(files: File[]) {
  for (const file of files) {
    await new Promise<void>((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        window.removeEventListener('apex-import-model-settled', done);
        resolve();
      };
      const timer = window.setTimeout(done, MODEL_IMPORT_TIMEOUT_MS);
      window.addEventListener('apex-import-model-settled', done);
      window.dispatchEvent(new CustomEvent('apex-import-model', { detail: file }));
    });
  }
}
