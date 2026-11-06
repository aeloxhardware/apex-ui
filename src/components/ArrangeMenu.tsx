import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { RectangleGroupIcon } from '@heroicons/react/24/outline';
import { ApexNumberField } from './ApexNumberField';
import { usePortalRoot } from '@/components/GpuWarningFrame';
import { emitApex, onApex } from '@/events/apexEvents';
import { ARRANGE_SPACING_BOUNDS, setArrangePrefs, useArrangePrefs } from '@/utils/arrangePrefs';
import {
  ALIGN_Y_TIP,
  ARRANGE_BUTTON_TIP,
  ON_IMPORT_TIP,
  ROTATIONS_TIP,
  SPACING_TIP,
  arrangeTipFor,
  type ArrangeTip,
} from '@/utils/arrangeTooltips';
import buttonStyles from './FileSidebar.module.scss';
import styles from './ArrangeMenu.module.scss';

/** Texte dans le bandeau du bas seulement (aucune bulle de souris). */
const tip = (t: ArrangeTip) => ({
  onMouseEnter: () => emitApex('apex-set-tooltip', t),
  onMouseLeave: () => emitApex('apex-reset-tooltip'),
});

/** Nombre de modèles sélectionnés, suivi par l'événement de sélection du viewport. */
function useSelectionCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => onApex('apex-mesh-selected', (d) => setCount(d.names?.length ?? (d.name ? 1 : 0))), []);
  return count;
}

const CheckRow: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void; tipText: ArrangeTip }> = ({
  label,
  checked,
  onChange,
  tipText,
}) => (
  <label className={styles.row} {...tip(tipText)}>
    <input type="checkbox" className={styles.checkbox} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);

const ArrangeMenuBody: React.FC<{ hasSelection: boolean; onRun: () => void }> = ({ hasSelection, onRun }) => {
  const prefs = useArrangePrefs();
  return (
    <>
      <button type="button" className={clsx(styles.row, styles.action)} onClick={onRun} {...tip(arrangeTipFor(hasSelection))}>
        Organiser
      </button>
      <div className={styles.row} {...tip(SPACING_TIP)}>
        <span>Écart entre les modèles</span>
        <ApexNumberField
          className={styles.field}
          value={prefs.spacingMm}
          onChange={(v) => setArrangePrefs({ spacingMm: v ?? undefined })}
          min={ARRANGE_SPACING_BOUNDS.min}
          max={ARRANGE_SPACING_BOUNDS.max}
          step={ARRANGE_SPACING_BOUNDS.step}
          suffix="mm"
          ariaLabel="Écart entre les modèles"
        />
      </div>
      <CheckRow
        label="Autoriser les rotations"
        checked={prefs.allowRotations}
        onChange={(v) => setArrangePrefs({ allowRotations: v })}
        tipText={ROTATIONS_TIP}
      />
      <CheckRow
        label="Aligner sur l'axe Y"
        checked={prefs.alignToY}
        onChange={(v) => setArrangePrefs({ alignToY: v })}
        tipText={ALIGN_Y_TIP}
      />
      <CheckRow
        label="Disposer à l'import"
        checked={prefs.arrangeOnImport}
        onChange={(v) => setArrangePrefs({ arrangeOnImport: v })}
        tipText={ON_IMPORT_TIP}
      />
    </>
  );
};

/** Bouton « Auto-disposition » de la barre d'outils et son menu, qui s'ouvre en dessous (« Menu Barre »). */
export const ArrangeMenu: React.FC<{ tabIndex?: number }> = ({ tabIndex = 0 }) => {
  const portalRoot = usePortalRoot();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectionCount = useSelectionCount();

  const toggle = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 10, left: r.left + r.width / 2 });
    setOpen((v) => !v);
  };
  const run = () => {
    emitApex(selectionCount > 0 ? 'apex-arrange-selection' : 'apex-arrange-models');
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={clsx(buttonStyles.button)}
        onClick={toggle}
        tabIndex={tabIndex}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Auto-disposition"
        {...tip(ARRANGE_BUTTON_TIP)}
      >
        <RectangleGroupIcon width={18} height={18} />
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className={styles.menu} style={{ top: pos.top, left: pos.left }} role="menu" data-apex-chrome-panel>
            <ArrangeMenuBody hasSelection={selectionCount > 0} onRun={run} />
          </div>,
          portalRoot ?? document.body,
        )}
    </>
  );
};
