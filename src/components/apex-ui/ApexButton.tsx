import { forwardRef, type ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './ApexButton.module.scss';

export interface ApexButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `ghost` : sans fond (défaut) ; `glass` : verre posé seul sur la scène ; `field` : fond de champ ; `accent` : verre + mise en valeur orange, pour l'action principale (une par écran). */
  variant?: 'ghost' | 'glass' | 'field' | 'accent';
  /** Hauteur : 22 (compact), 30 (défaut), 44 (barre d'espaces). */
  size?: 'sm' | 'md' | 'lg';
  /** Bouton carré portant une seule icône (pense à `aria-label`). */
  icon?: boolean;
  /** État actif / choisi : teinte ambre, annoncé aux lecteurs d'écran (`aria-pressed`). */
  active?: boolean;
}

/**
 * LE bouton d'Apex. Aucun autre style de bouton n'est écrit ailleurs : on choisit une variante, une taille et, au besoin,
 * l'état `active`. Couleurs, survol, focus clavier et désactivé viennent de `styles/_apex-ui.scss` (ADR 0006).
 */
export const ApexButton = forwardRef<HTMLButtonElement, ApexButtonProps>(
  ({ variant = 'ghost', size = 'md', icon = false, active, className, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={active}
      className={clsx(styles.button, styles[variant], styles[size], icon && styles.icon, active && styles.active, className)}
      {...rest}
    />
  ),
);
ApexButton.displayName = 'ApexButton';
