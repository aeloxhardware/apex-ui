/**
 * Espace Prévisualisation actif ou non, tel que le dernier `apex-preview-toggled` l'a annoncé.
 * Le Viewport3D est démonté sur l'Accueil / Paramètres : depuis ces espaces il est monté dans le
 * même commit que la bascule, donc APRÈS le départ de l'événement. Sans cette valeur lisible au
 * montage, il restait à « Préparation » (tracé G-code désactivé) alors que l'onglet affichait la
 * Prévisualisation. L'écouteur est posé dès l'import du module (lancement de l'application).
 */
let active = false;

if (typeof window !== 'undefined') {
  window.addEventListener('apex-preview-toggled', (e) => {
    active = !!(e as CustomEvent<{ active: boolean }>).detail?.active;
  });
}

export function isPreviewSpace(): boolean {
  return active;
}
