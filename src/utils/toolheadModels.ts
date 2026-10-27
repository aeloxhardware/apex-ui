// Modèle 3D de la tête d'outil : lié au profil d'imprimante (bloc `apex.toolhead_model`, identifiant du
// fichier `src/assets/models/<identifiant>.glb`), jamais choisi en dur dans le code d'affichage.
// Ce dépôt est la source du modèle commun (apex/integration/RULES.md §3, C6) : le moteur le copie par script.
import { machineFacts } from '@/utils/machineProfile';

const MODEL_URLS = import.meta.glob('../assets/models/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** URL du modèle de tête du profil, `null` si le profil n'en désigne aucun ou si le fichier manque. */
export function toolheadModelUrl(profile: unknown): string | null {
  const id = machineFacts(profile).toolheadModel;
  return id ? MODEL_URLS[`../assets/models/${id}.glb`] ?? null : null;
}
