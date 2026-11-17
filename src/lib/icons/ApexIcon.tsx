import { forwardRef } from 'react';
import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from 'react';
import { GLYPHS, type ApexGlyph, type ApexGlyphName } from './glyphs';

/** Propriétés communes à toutes les icônes d'Apex : celles d'un `<svg>`, plus la taille (côté, en px). */
interface ApexIconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: number | string;
}

export type ApexIconComponent = ForwardRefExoticComponent<ApexIconProps & RefAttributes<SVGSVGElement>>;

/**
 * Fabrique le composant d'une icône du jeu maison. La charte (grille 24, trait de 2, extrémités coupées net, angles
 * adoucis, contour ouvert en bas à gauche) est fixée ici, une fois pour toutes : un glyphe n'apporte que ses tracés.
 * La classe `apex-icon-<nom>` sert de repère aux tests de bout en bout.
 */
export function createApexIcon(name: ApexGlyphName): ApexIconComponent {
  const glyph: ApexGlyph = GLYPHS[name];
  const Icon = forwardRef<SVGSVGElement, ApexIconProps>(({ size = 24, strokeWidth = 2, className, ...rest }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="butt"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ? `apex-icon apex-icon-${name} ${className}` : `apex-icon apex-icon-${name}`}
      {...rest}
    >
      {glyph.d && <path d={glyph.d} />}
      {glyph.solid && <path d={glyph.solid} fill="currentColor" stroke="none" />}
    </svg>
  ));
  Icon.displayName = `ApexIcon(${name})`;
  return Icon;
}
