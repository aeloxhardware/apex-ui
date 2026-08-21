import React, { useEffect, useState } from 'react';
import styles from './ViewCube.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { showSuccess } from '@/utils/toast';

// Extrémités des axes en coordonnées 3D unitaires, projetées ensuite en 2D selon alpha/beta caméra
const AXES: { key: string; label: string; color: string; dir: [number, number, number]; alpha: number; beta: number }[] = [
  { key: 'x+', label: 'X', color: '#ff3b3b', dir: [1, 0, 0], alpha: Math.PI / 2, beta: Math.PI / 2 },
  { key: 'x-', label: '', color: '#7a2323', dir: [-1, 0, 0], alpha: -Math.PI / 2, beta: Math.PI / 2 },
  { key: 'z+', label: 'Z', color: '#3b7bff', dir: [0, 1, 0], alpha: Math.PI / 2, beta: 0.01 },
  { key: 'z-', label: '', color: '#9db8f5', dir: [0, -1, 0], alpha: Math.PI / 2, beta: Math.PI - 0.01 },
  { key: 'y+', label: 'Y', color: '#3bff5c', dir: [0, 0, 1], alpha: Math.PI, beta: Math.PI / 2 },
  { key: 'y-', label: '', color: '#1f7a2f', dir: [0, 0, -1], alpha: 0, beta: Math.PI / 2 },
];

const SIZE = 100;
const CENTER = SIZE / 2;
const REACH = 34;
const POINT_R = 8;

// Projection orthographique simple d'un axe 3D vers l'écran 2D selon les angles de la caméra
function project(dir: [number, number, number], alpha: number, beta: number) {
  const [x, y, z] = dir;
  const rx = x * Math.cos(alpha) + z * Math.sin(alpha);
  const rz = -x * Math.sin(alpha) + z * Math.cos(alpha);
  const ry = y * Math.sin(beta) + rz * Math.cos(beta);
  const rz2 = y * Math.cos(beta) - rz * Math.sin(beta);
  return { sx: CENTER + rx * REACH, sy: CENTER - ry * REACH, depth: rz2 };
}

export const ViewCube: React.FC = () => {
  const [camAngles, setCamAngles] = useState({ alpha: Math.PI / 4, beta: Math.PI / 3 });

  useEffect(() => {
    const handleCameraUpdated = (e: CustomEvent<{ alpha: number; beta: number }>) => {
      if (e.detail) setCamAngles(e.detail);
    };
    window.addEventListener('apex-camera-updated', handleCameraUpdated as EventListener);
    return () => {
      window.removeEventListener('apex-camera-updated', handleCameraUpdated as EventListener);
    };
  }, []);

  const triggerView = (label: string, alpha: number, beta: number) => {
    window.dispatchEvent(new CustomEvent('apex-set-camera-custom', { detail: { alpha, beta } }));
    showSuccess(`Vue orientée : ${label}`);
  };

  const points = AXES.map((axis) => ({ ...axis, ...project(axis.dir, camAngles.alpha, camAngles.beta) }))
    .sort((a, b) => a.depth - b.depth);

  // L'axe centré est celui le plus proche de la caméra (dernier après tri par profondeur)
  const centeredKey = points[points.length - 1]?.key;

  const handlePointClick = (p: (typeof points)[number]) => {
    if (p.key === centeredKey) {
      const oppositeKey = p.key.endsWith('+') ? p.key.replace('+', '-') : p.key.replace('-', '+');
      const opposite = AXES.find((a) => a.key === oppositeKey);
      if (opposite) {
        triggerView(opposite.label || opposite.key.toUpperCase(), opposite.alpha, opposite.beta);
        return;
      }
    }
    triggerView(p.label || p.key.toUpperCase(), p.alpha, p.beta);
  };

  return (
    <div className={styles.container} data-apex-chrome-panel>
      <CustomTooltip content="Gizmo d'axes" description="Cliquez sur un point pour orienter la caméra 3D le long de cet axe.">
        <svg width={SIZE} height={SIZE} className={styles.gizmo}>
          {AXES.filter((axis) => axis.label).map((axis) => {
            const { sx, sy } = project(axis.dir, camAngles.alpha, camAngles.beta);
            return <line key={`line-${axis.key}`} x1={CENTER} y1={CENTER} x2={sx} y2={sy} stroke={axis.color} strokeWidth={2} />;
          })}
          {points.map((p) => (
            <g
              key={p.key}
              className={styles.point}
              onClick={() => handlePointClick(p)}
            >
              <circle cx={p.sx} cy={p.sy} r={POINT_R} fill={p.color} />
              {p.label && (
                <text x={p.sx} y={p.sy} textAnchor="middle" dominantBaseline="central" className={styles.label}>
                  {p.label}
                </text>
              )}
            </g>
          ))}
        </svg>
      </CustomTooltip>
    </div>
  );
};
