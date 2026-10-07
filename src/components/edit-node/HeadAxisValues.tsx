import React, { useEffect, useState } from 'react';
import { stateAt, type GCodeMove, type ParsedGCode } from '@/components/gcodeParse';
import { bottomTip } from './bottomTooltip';
import styles from './EditionPanel.module.scss';

/**
 * Valeurs de chaque axe au point de trajectoire où se trouve la tête (lecture / curseur de temps),
 * partagées par les onglets Coloration et Édition. `parsed.moves` est modifié en place par les
 * validations d'édition : l'affichage suit les modifications.
 */

/** Dernier fichier et dernière position de lecture, gardés au niveau du module : le panneau peut
 * être monté (changement d'onglet) bien après `apex-gcode-loaded`. */
const HEAD_CACHE_EVENT = 'apex-edit-head-cache';
const lastHead: { source: { moves: GCodeMove[]; polar: boolean } | null; t: number } = { source: null, t: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('apex-gcode-loaded', (e) => {
    const parsed = (e as CustomEvent<{ parsed?: ParsedGCode }>).detail?.parsed;
    lastHead.source = parsed && parsed.moves.length > 0 ? { moves: parsed.moves, polar: parsed.kind === 'polar' } : null;
    lastHead.t = parsed ? parsed.moves.length - 1 : 0;
    window.dispatchEvent(new Event(HEAD_CACHE_EVENT));
  });
  window.addEventListener('apex-gcode-time', (e) => {
    const t = (e as CustomEvent<{ t: number }>).detail?.t;
    if (typeof t !== 'number') return;
    lastHead.t = t;
    window.dispatchEvent(new Event(HEAD_CACHE_EVENT));
  });
}

export const HeadAxisValues: React.FC = () => {
  const [, refresh] = useState(0);
  useEffect(() => {
    const onHead = () => refresh((n) => n + 1);
    window.addEventListener(HEAD_CACHE_EVENT, onHead);
    onHead();
    return () => window.removeEventListener(HEAD_CACHE_EVENT, onHead);
  }, []);

  const { source, t } = lastHead;
  const head = source ? stateAt(source.moves, t) : null;
  const fields: readonly (readonly [string, number | undefined, number, string, string])[] = source?.polar
    ? [
      ['R', head?.x, 3, 'mm', 'Rayon de la buse au point de trajectoire où se trouve la tête.'],
      ['C', head?.y, 2, '°', 'Angle du plateau au point où se trouve la tête.'],
      ['Z', head?.z, 3, 'mm', 'Hauteur au point où se trouve la tête.'],
      ['B', head?.b, 2, '°', 'Inclinaison de la tête au point où se trouve la tête.'],
    ]
    : [
      ['X', head?.x, 3, 'mm', 'Position X de la buse au point où se trouve la tête.'],
      ['Y', head?.y, 3, 'mm', 'Position Y de la buse au point où se trouve la tête.'],
      ['Z', head?.z, 3, 'mm', 'Hauteur au point où se trouve la tête.'],
      ['B', head?.b, 2, '°', 'Inclinaison de la tête au point où se trouve la tête.'],
      ['C', head?.c, 2, '°', 'Azimut de l’outil au point où se trouve la tête.'],
    ];

  return (
    <div className={styles.delta}>
      {fields.map(([name, v, digits, unit, tip]) => (
        <div key={name} className={styles.field} {...bottomTip(`${name} de la tête`, tip)}>
          <span className={styles.fieldName}>{name}</span>
          <span className={styles.fieldValue}>
            {v === undefined ? '—' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`}
          </span>
          <span className={styles.unit}>{unit}</span>
        </div>
      ))}
    </div>
  );
};
