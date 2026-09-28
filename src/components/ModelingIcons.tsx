import React from 'react';

/**
 * Icônes custom pour les features CAD Congé (Fillet) et Chanfrein (Chamfer) de
 * ModelingSidebar : les icônes lucide-react génériques (Spline, Triangle) ne représentent
 * pas clairement l'opération. Dessinées au même gabarit que lucide-react (viewBox 24×24,
 * stroke `currentColor`, coins arrondis) pour rester interchangeables avec les icônes
 * lucide utilisées à côté (mêmes props `className`/taille, cf. Icon.js de lucide-react).
 */
type ModelingIconProps = React.SVGProps<SVGSVGElement>;

/** Coin de carré dont l'angle est remplacé par un arrondi, avec un arc concentrique
 * suggérant le rayon du congé — repris du pictogramme de référence fourni. */
export const FilletIcon: React.FC<ModelingIconProps> = ({ className, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* Petit arc concentrique, décalé vers le coin haut-gauche : évoque le rayon de courbure. */}
    <path d="M4 11.5C4 7.5 7.5 4 11.5 4" />
    {/* Corps du coin : côté gauche → arrondi → côté haut → côté droit → côté bas → fermeture. */}
    <path d="M7 20v-6.5A6.5 6.5 0 0 1 13.5 7H20v13Z" />
  </svg>
);

/** Coin de carré dont l'angle est coupé par un biseau droit — repris du pictogramme de
 * référence fourni. */
export const ChamferIcon: React.FC<ModelingIconProps> = ({ className, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M4 20V10.5L10.5 4H20" />
  </svg>
);
