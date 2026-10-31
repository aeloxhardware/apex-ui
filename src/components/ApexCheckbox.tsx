import React from 'react';
import clsx from 'clsx';
import styles from './ApexCheckbox.module.scss';

/**
 * Case à cocher de l'interface : celle du panneau de l'espace Prévisualisation (légende des types de ligne, tête
 * complète), reprise en composant partagé. Case arrondie, fond translucide, cochée en cyan avec une coche dessinée
 * en CSS. Accepte toutes les props d'un `<input>` (checked, onChange, disabled, aria-label…) ; `className` sert à la
 * placer (`justify-self`, marges…) et non à la restyler.
 */
export const ApexCheckbox = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} type="checkbox" className={clsx(styles.checkbox, className)} {...props} />
  ),
);
ApexCheckbox.displayName = 'ApexCheckbox';
