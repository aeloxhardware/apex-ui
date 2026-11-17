import { forwardRef, type ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './ApexToggle.module.scss';

export interface ApexToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Posé seul sur la scène : verre au lieu du fond de champ. */
  glass?: boolean;
  /** Gélule verticale (pastille qui monte quand il est actif). */
  vertical?: boolean;
}

/** L'interrupteur d'Apex (marche / arrêt). Pour une case à cocher dans une liste, voir `ApexCheckbox`. */
export const ApexToggle = forwardRef<HTMLButtonElement, ApexToggleProps>(({ checked, onChange, glass, vertical, className, ...rest }, ref) => (
  <button
    ref={ref}
    type="button"
    role="switch"
    aria-checked={checked}
    className={clsx(styles.toggle, glass && styles.glass, vertical && styles.vertical, checked && styles.on, className)}
    onClick={() => onChange(!checked)}
    {...rest}
  >
    <span className={styles.knob} />
  </button>
));
ApexToggle.displayName = 'ApexToggle';
