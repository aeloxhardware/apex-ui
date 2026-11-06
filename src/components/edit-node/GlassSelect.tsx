import { useState } from 'react';
import clsx from 'clsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { hideBottomTip, showBottomTip } from './bottomTooltip';
import styles from './GlassSelect.module.scss';

export interface GlassSelectOption<T extends string> {
  value: T;
  label: string;
  /** Explication pour un novice, affichée dans l'infobulle de bas d'écran au survol de l'option. */
  tip?: string;
}

/**
 * Liste déroulante assortie à l'interface (verre flouté, sans contour, actif en cyan) : remplace le
 * `<select>` natif, dont le menu est dessiné par le système. Même vocabulaire que le menu
 * « Coloration » de la légende (GCodeLineTypeLegend).
 */
export function GlassSelect<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  className,
  ariaLabel,
  ...hover
}: {
  value: T;
  options: readonly GlassSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string | undefined;
  ariaLabel?: string | undefined;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = options.find((o) => o.value === value);
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={clsx(styles.trigger, className)}
          disabled={disabled}
          aria-label={ariaLabel}
          {...hover}
        >
          <span className={styles.value}>{active?.label ?? ''}</span>
          <svg className={styles.chevron} width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden>
            <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={styles.menu}
        align="end"
        sideOffset={6}
        collisionPadding={12}
      >
        <ul className={styles.list}>
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                className={clsx(styles.item, o.value === value && styles.itemActive)}
                onPointerEnter={() => (o.tip ? showBottomTip({ title: o.label, desc: o.tip }) : hideBottomTip())}
                onPointerLeave={hideBottomTip}
                onClick={() => {
                  // Le menu se ferme sous le pointeur, sans pointerleave : effacer l'explication.
                  hideBottomTip();
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
