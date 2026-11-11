import React, { useEffect, useRef, useState } from 'react';
import styles from './ViewCube.module.scss';
import { CustomTooltip } from './CustomTooltip';

import { emitApex } from '@/events/apexEvents';
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
// Tolérance d'alignement (~1,7°) : assez large pour absorber l'arrivée d'une transition de
// caméra animée, assez étroite pour qu'une orbite manuelle désarme aussitôt l'inversion.
const ANGLE_EPSILON = 0.03;
// Durée de la transition de caméra déclenchée par un clic (20 frames à 60 fps dans
// Viewport3D), plus une marge : tant qu'elle court, un écart d'angle ne signale pas une orbite.
const VIEW_TRANSITION_MS = 450;

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
  // Dernier axe atteint par un clic sur le gizmo, seul état qui autorise l'inversion.
  const lastClickedKeyRef = useRef<string | null>(null);
  // Angles visés par ce clic et instant où il a eu lieu, pour reconnaître la vue qu'il a
  // produite une fois la transition terminée.
  const lastClickedAnglesRef = useRef<{ alpha: number; beta: number; at: number } | null>(null);

  useEffect(() => {
    const handleCameraUpdated = (e: CustomEvent<{ alpha: number; beta: number }>) => {
      if (!e.detail) return;
      setCamAngles(e.detail);

      // `apex-camera-updated` ne dit pas d'où vient le mouvement. Un clic sur le gizmo lance une
      // transition animée : pendant celle-ci les angles diffèrent encore de la cible, et les
      // comparer désarmerait aussitôt le marqueur que le clic vient de poser. On laisse donc
      // passer la durée de l'animation avant de considérer qu'un écart vient d'une orbite
      // manuelle de l'utilisateur, seul cas où l'inversion doit être désarmée.
      const target = lastClickedAnglesRef.current;
      if (!target || performance.now() - target.at < VIEW_TRANSITION_MS) return;
      const delta = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
      if (delta(e.detail.alpha, target.alpha) > ANGLE_EPSILON || delta(e.detail.beta, target.beta) > ANGLE_EPSILON) {
        lastClickedKeyRef.current = null;
        lastClickedAnglesRef.current = null;
      }
    };
    window.addEventListener('apex-camera-updated', handleCameraUpdated as EventListener);
    return () => {
      window.removeEventListener('apex-camera-updated', handleCameraUpdated as EventListener);
    };
  }, []);

  const triggerView = (key: string, alpha: number, beta: number) => {
    lastClickedKeyRef.current = key;
    lastClickedAnglesRef.current = { alpha, beta, at: performance.now() };
    emitApex('apex-set-camera-custom', { alpha, beta });
  };

  const points = AXES.map((axis) => ({ ...axis, ...project(axis.dir, camAngles.alpha, camAngles.beta) }))
    .sort((a, b) => a.depth - b.depth);

  const handlePointClick = (p: (typeof points)[number]) => {
    // L'inversion n'est offerte que si la vue courante vient d'un clic sur CE point précis.
    // Se fier à l'axe géométriquement le plus proche de la caméra inverserait aussi une vue
    // simplement orientée « à peu près » à la souris, que l'utilisateur voulait juste cadrer.
    if (p.key === lastClickedKeyRef.current) {
      const oppositeKey = p.key.endsWith('+') ? p.key.replace('+', '-') : p.key.replace('-', '+');
      const opposite = AXES.find((a) => a.key === oppositeKey);
      if (opposite) {
        triggerView(opposite.key, opposite.alpha, opposite.beta);
        return;
      }
    }
    triggerView(p.key, p.alpha, p.beta);
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
