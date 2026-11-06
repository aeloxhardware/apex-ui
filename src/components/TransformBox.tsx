import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ApexNumberField } from './ApexNumberField';
import { bottomTip } from './edit-node/bottomTooltip';
import styles from './TransformBox.module.scss';

import { emitApex } from '@/events/apexEvents';
/**
 * Boîte de saisie des valeurs exactes des outils Déplacer / Pivoter / Mettre à l'échelle, sous la barre d'outils.
 * Elle ne touche pas à la scène : l'état du modèle actif arrive de Viewport3D par `apex-transform-state`, une valeur
 * saisie repart par `apex-transform-set`. Axes de l'imprimante (Z vertical) ; lettres colorées comme les gizmos
 * (X rouge, Y vert, Z bleu ; A, B, C = rotations autour de X, Y, Z).
 */
type TransformTool = 'move' | 'rotate' | 'scale';
type Axis = 'x' | 'y' | 'z';
type Vec = Record<Axis, number>;

interface TransformState {
  position: Vec;
  rotation: Vec;
  size: Vec;
  scale: Vec;
}

const AXES: Axis[] = ['x', 'y', 'z'];
const AXIS_COLORS: Record<Axis, string> = { x: '#ff5a5a', y: '#4fe08a', z: '#5a9bff' };
const ZERO: Vec = { x: 0, y: 0, z: 0 };

const round = (v: number) => Math.round(v * 100) / 100;

const requestTransformState = () => emitApex('apex-transform-request');

interface RowProps {
  letters: [string, string, string];
  values: Vec;
  unit: string;
  title: string;
  desc: string;
  step: number;
  min?: number | undefined;
  onChange: (axis: Axis, value: number) => void;
}

const Row: React.FC<RowProps> = ({ letters, values, unit, title, desc, step, min, onChange }) => (
  <div className={styles.row} {...bottomTip(title, desc)}>
    {AXES.map((axis, i) => (
      <div key={axis} className={styles.cell}>
        <span className={styles.letter} style={{ color: AXIS_COLORS[axis] }}>{letters[i]}</span>
        <ApexNumberField
          value={round(values[axis])}
          suffix={unit}
          step={step}
          min={min}
          ariaLabel={`${title} ${letters[i]}`}
          onChange={(v) => { if (v !== null) onChange(axis, v); }}
        />
      </div>
    ))}
  </div>
);

const TransformBox: React.FC<{ tool: TransformTool }> = ({ tool }) => {
  const [state, setState] = useState<TransformState>({ position: ZERO, rotation: ZERO, size: ZERO, scale: ZERO });
  const [hasModel, setHasModel] = useState(false);
  const [keepProportions, setKeepProportions] = useState(true);

  useEffect(() => {
    const onState = (e: Event) => {
      setState((e as CustomEvent<TransformState>).detail);
      setHasModel(true);
    };
    const onSelected = (e: Event) => {
      const names = (e as CustomEvent<{ names?: string[] }>).detail?.names ?? [];
      if (names.length === 0) setHasModel(false);
      else requestTransformState();
    };
    window.addEventListener('apex-transform-state', onState);
    window.addEventListener('apex-mesh-selected', onSelected);
    requestTransformState();
    return () => {
      window.removeEventListener('apex-transform-state', onState);
      window.removeEventListener('apex-mesh-selected', onSelected);
    };
  }, [tool]);

  const send = (kind: 'position' | 'rotation' | 'size' | 'scale') => (axis: Axis, value: number) =>
    emitApex('apex-transform-set', { kind, axis, value, keepProportions });

  return (
    <div className={clsx(styles.box, !hasModel && styles.disabled)} {...bottomTip(
      'Valeurs exactes',
      hasModel ? 'Saisissez les valeurs exactes du modèle sélectionné.' : 'Sélectionnez un modèle pour saisir ses valeurs.',
    )}>
      {tool === 'move' && (
        <Row letters={['X', 'Y', 'Z']} values={state.position} unit="mm" step={1} onChange={send('position')}
          title="Position" desc="Position du modèle sur le plateau, en mm : X, Y, et Z pour la hauteur de sa base." />
      )}
      {tool === 'rotate' && (
        <Row letters={['A', 'B', 'C']} values={state.rotation} unit="°" step={1} onChange={send('rotation')}
          title="Rotation" desc="Rotation du modèle en degrés : A autour de X, B autour de Y, C autour de Z." />
      )}
      {tool === 'scale' && (
        <>
          <Row letters={['X', 'Y', 'Z']} values={state.size} unit="mm" step={1} min={0.01} onChange={send('size')}
            title="Taille" desc="Dimensions du modèle en mm selon ses axes X, Y et Z." />
          <Row letters={['X', 'Y', 'Z']} values={state.scale} unit="%" step={1} min={0.01} onChange={send('scale')}
            title="Échelle" desc="Échelle du modèle en pourcentage de sa taille d'origine, selon X, Y et Z." />
          <label className={styles.check} {...bottomTip(
            'Garder les proportions',
            'Coché, modifier une dimension ou une échelle applique le même facteur aux trois axes.',
          )}>
            <input type="checkbox" checked={keepProportions} onChange={(e) => setKeepProportions(e.target.checked)} />
            Garder les proportions
          </label>
        </>
      )}
    </div>
  );
};

export default TransformBox;
