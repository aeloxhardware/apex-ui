/**
 * Espace Modélisation actif ou non, tel que l'affiche l'interface : change quand l'onglet change,
 * c'est-à-dire une fois le rideau de transition fermé (Index.tsx). Lisible à tout moment — un
 * composant monté plus tard (le chrome 3D est démonté sur l'Accueil) part de la bonne valeur.
 * Le changement bascule aussi la « perspective en translation » (voir setModelingSpace).
 */
import { setPanPerspective } from '@/utils/panPerspectivePrefs';

let active = false;

export function setModelingSpace(next: boolean) {
  if (next === active) return;
  active = next;
  // Bascule automatique, pas une contrainte : perspective désactivée en Modélisation, activée
  // ailleurs, et l'utilisateur peut la changer à tout moment avec l'interrupteur.
  setPanPerspective(!next);
}
