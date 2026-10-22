/**
 * Préférence « perspective en translation » (sélecteur à gauche de 3 AXES / 4 AXES) : vrai par
 * défaut (sauf en Modélisation, où la vue reste toujours en translation d'image), faux, le panoramique décale l'image et les objets restent vus sous le même angle ; vrai, la
 * caméra se déplace réellement (perspective physique). Mémorisée localement, par poste.
 */
export const PAN_PERSPECTIVE_EVENT = 'apex-pan-perspective';
const STORAGE_KEY = 'apex-pan-perspective';

export function readPanPerspective(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setPanPerspective(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // stockage indisponible : la préférence ne vaut que pour la session
  }
  window.dispatchEvent(new CustomEvent(PAN_PERSPECTIVE_EVENT, { detail: { enabled } }));
}
