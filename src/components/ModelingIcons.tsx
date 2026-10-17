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

/** Extrusion : une flèche qui monte au-dessus de deux barres (le profil d'esquisse, d'où la matière
 * est tirée) — pictogramme de référence, mêmes extrémités arrondies que les autres icônes. */
export const ExtrudeIcon: React.FC<ModelingIconProps> = ({ className, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* Flèche vers le haut. */}
    <path d="M12 14.5V3.5" />
    <path d="m6.5 8.5 5.5-5.5 5.5 5.5" />
    {/* Barre large, puis barre plus courte en dessous. */}
    <path d="M4 18.5h16" />
    <path d="M8 22h8" />
  </svg>
);

/** « Terminer l'esquisse » : le pictogramme de référence en DEUX morceaux — à gauche un plan en contour
 * épais arrondi au-dessus d'un plan plein (séparés par un filet vide), à droite un cube dans lequel entre
 * une flèche. Les morceaux sont rapprochés : la flèche, longue et large, naît SOUS les plans (un filet
 * vide la sépare d'eux, comme les faces du cube) et entre dans la face gauche du cube, au plus bas.
 * Dessiné en 96×48 ; tout est centré sur la ligne y = 24, à hauteur apparente égale. */
export const FinishSketchIcon: React.FC<ModelingIconProps> = ({ className, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 96 48"
    fill="currentColor"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <defs>
      {/* Filet vide autour du plan en contour (retire du plan plein sa partie cachée). */}
      <mask id="apexFinishSketchPlaneGap">
        <rect x="-20" y="-20" width="200" height="100" fill="white" stroke="none" />
        <path d="M4 17 23 7.5 42 17 23 26.5Z" fill="black" stroke="black" strokeWidth={7} />
      </mask>
      {/* Filet vide autour de la flèche, dans la face gauche du cube (repère du cube, décalé de -2). */}
      <mask id="apexFinishSketchArrowGap">
        <rect x="-20" y="-20" width="200" height="100" fill="white" stroke="none" />
        <path d="M33 29H58V25L69 33 58 41V37H33Z" fill="black" stroke="black" strokeWidth={6} />
      </mask>
      {/* Filet vide autour des plans, retiré de la flèche : elle passe dessous (repère du dessin). */}
      <mask id="apexFinishSketchUnderPlanes">
        <rect x="-20" y="-20" width="200" height="100" fill="white" stroke="none" />
        <g transform="translate(24 24) scale(1.15) translate(-23 -22)">
          <path d="M4 27 23 17.5 42 27 23 36.5Z" fill="black" stroke="black" strokeWidth={6} />
          <path d="M4 17 23 7.5 42 17 23 26.5Z" fill="black" stroke="black" strokeWidth={6} />
        </g>
      </mask>
    </defs>
    {/* Morceau de gauche (agrandi autour de son centre pour égaler la hauteur du cube). */}
    <g transform="translate(24 24) scale(1.15) translate(-23 -22)">
      <path d="M4 27 23 17.5 42 27 23 36.5Z" strokeWidth={3} mask="url(#apexFinishSketchPlaneGap)" />
      <path d="M4 17 23 7.5 42 17 23 26.5Z" fill="none" strokeWidth={3.2} />
    </g>
    {/* Morceau de droite : cube simple, en contours (hexagone et ses trois arêtes intérieures) ; le
        contour est entaillé autour de la flèche pour qu'elle s'en détache. */}
    <g transform="translate(-2 0)">
      <g fill="none" strokeWidth={2.6} mask="url(#apexFinishSketchArrowGap)">
        <path d="M73 4 91 14V34L73 44 55 34V14Z" />
        <path d="M55 14 73 24 91 14M73 24V44" />
      </g>
    </g>
    {/* Flèche : du dessous des plans (x = 26) jusque dans la face du cube. */}
    <path d="M31 29H56V25L67 33 56 41V37H31Z" strokeWidth={2} mask="url(#apexFinishSketchUnderPlanes)" />
  </svg>
);
