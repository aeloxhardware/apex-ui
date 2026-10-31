import React, { useEffect, useState } from 'react';
import styles from './ModelHoverTooltip.module.scss';
import { Box, Route } from 'lucide-react';

/** Propriétés du mouvement G-code sous le curseur (cf. Viewport3D, survol en Prévisualisation). */
interface GCodeHover {
  kind: 'polar' | 'cartesian';
  lineLabel: string;
  lineColor: string;
  move: number;
  moves: number;
  x: number;
  y: number;
  z: number;
  b: number;
  c: number;
  speedMmS: number | null;
  layer: number | null;
  layerHeightMm: number | null;
  widthMm: number | null;
  nozzleTempC: number | null;
  fanPct: number | null;
}

interface HoverDetail {
  visible: boolean;
  x: number;
  y: number;
  modelName: string;
  hasTexture: boolean;
  /** Triangles du modèle survolé (Préparation). */
  triangles?: number;
  gcode?: GCodeHover;
}

/** `x`/`y` : position écran déjà décalée du curseur. */
type HoverInfo = HoverDetail;

const EMPTY: HoverInfo = { visible: false, x: 0, y: 0, modelName: '', hasTexture: false };

const fr = (value: number, digits: number) => value.toFixed(digits).replace('.', ',');
const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Lignes du survol d'un mouvement G-code : seules les valeurs réellement connues du fichier. */
function gcodeRows(g: GCodeHover): [string, string][] {
  const rows: [string, string][] = [['Mouvement', `${g.move.toLocaleString('fr-FR')} / ${g.moves.toLocaleString('fr-FR')}`]];
  if (isNum(g.speedMmS)) rows.push(['Vitesse', `${fr(g.speedMmS, 1)} mm/s`]);
  if (isNum(g.layer)) rows.push(['Couche', String(g.layer + 1)]);
  if (isNum(g.layerHeightMm) && g.layerHeightMm > 0) rows.push(['Hauteur de couche', `${fr(g.layerHeightMm, 2)} mm`]);
  if (isNum(g.widthMm) && g.widthMm > 0) rows.push(['Largeur du cordon', `${fr(g.widthMm, 2)} mm`]);
  if (isNum(g.nozzleTempC) && g.nozzleTempC > 0) rows.push(['Buse', `${fr(g.nozzleTempC, 0)} °C`]);
  if (isNum(g.fanPct)) rows.push(['Ventilateur', `${fr(g.fanPct, 0)} %`]);
  rows.push(g.kind === 'polar'
    ? ['Position', `R ${fr(g.x, 2)} · C ${fr(g.y, 1)}° · Z ${fr(g.z, 2)}`]
    : ['Position', `X ${fr(g.x, 2)} · Y ${fr(g.y, 2)} · Z ${fr(g.z, 2)}`]);
  if (g.kind === 'polar' || g.b !== 0 || g.c !== 0) rows.push(['Inclinaison B', `${fr(g.b, 1)}°`]);
  return rows;
}

/**
 * Infobulle de survol du viewport. Préparation : le modèle du plateau sous le curseur.
 * Prévisualisation : le mouvement du G-code sous le curseur (`gcodeName` : fichier chargé).
 */
export const ModelHoverTooltip: React.FC<{ gcodeName?: string | null }> = ({ gcodeName }) => {
  const [info, setInfo] = useState<HoverInfo>(EMPTY);

  useEffect(() => {
    const handleHover = (e: CustomEvent<HoverDetail>) => {
      if (!e.detail) return;
      setInfo({ ...e.detail, x: e.detail.x + 15, y: e.detail.y + 15 });
    };
    window.addEventListener('apex-model-hover', handleHover as EventListener);
    return () => window.removeEventListener('apex-model-hover', handleHover as EventListener);
  }, []);

  if (!info.visible) return null;

  const g = info.gcode;
  return (
    <div className={styles.tooltipContainer} style={{ left: `${info.x}px`, top: `${info.y}px` }}>
      {g ? (
        <>
          <div className={styles.header}>
            <span className={styles.dot} style={{ background: g.lineColor }} />
            <span className={styles.title}>{g.lineLabel}</span>
          </div>
          {gcodeName && (
            <div className={styles.source}><Route size={11} /><span>{gcodeName}</span></div>
          )}
          <dl className={styles.body}>
            {gcodeRows(g).map(([label, value]) => (
              <div key={label} className={styles.row}>
                <dt className={styles.label}>{label}{' '}:</dt>
                <dd className={styles.value}>{value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <>
          <div className={styles.header}>
            <Box size={12} className={styles.icon} />
            <span className={styles.title}>{info.modelName}</span>
          </div>
          <dl className={styles.body}>
            <div className={styles.row}>
              <dt className={styles.label}>Type :</dt>
              <dd className={styles.value}>Modèle 3D</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.label}>Texture :</dt>
              <dd className={styles.value}>{info.hasTexture ? 'Oui' : 'Aucune'}</dd>
            </div>
            {typeof info.triangles === 'number' && (
              <div className={styles.row}>
                <dt className={styles.label}>Triangles :</dt>
                <dd className={styles.value}>{info.triangles.toLocaleString('fr-FR')}</dd>
              </div>
            )}
          </dl>
        </>
      )}
    </div>
  );
};
