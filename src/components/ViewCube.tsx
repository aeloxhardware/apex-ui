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

/**
 * Flèches de roulis ±45°, en haut à droite du gizmo, hors du cercle des axes. Chaque icône est
 * dessinée dans son propre repère local (centré en 0,0, rayon `R`) façon icône "refresh" — un
 * arc à ¾ de tour avec une pointe à une extrémité — puis simplement translatée à sa position
 * finale. `mirror` inverse l'axe X du repère local pour obtenir le sens antihoraire à partir du
 * même tracé que le sens horaire, sans dupliquer la géométrie de l'arc.
 */
const ROLL_ARROW_R = 8;
const ROLL_ARROW_GAP = 6; // espace entre les deux icônes, pour ne pas qu'elles se touchent
const ROLL_ARROWS: { degrees: number; cx: number; cy: number; mirror: boolean }[] = [
  { degrees: -45, cx: SIZE - (2 * ROLL_ARROW_R + ROLL_ARROW_GAP / 2) - 2, cy: ROLL_ARROW_R + 2, mirror: true },
  { degrees: 45, cx: SIZE - ROLL_ARROW_R - 2, cy: ROLL_ARROW_R + 2, mirror: false },
];
// Arc horaire de -200° à 20° (240° de tour) dans le repère local de rayon R, pointe à 20°.
const ROLL_ARC_START = -200;
const ROLL_ARC_END = 20;
const localPolar = (r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
};
const rollArrowGeometry = (mirror: boolean) => {
  const mx = mirror ? -1 : 1;
  const start = localPolar(ROLL_ARROW_R, ROLL_ARC_START);
  const tip = localPolar(ROLL_ARROW_R, ROLL_ARC_END);
  const path = `M ${start.x * mx} ${start.y} A ${ROLL_ARROW_R} ${ROLL_ARROW_R} 0 1 ${mirror ? 0 : 1} ${tip.x * mx} ${tip.y}`;
  // Triangle de pointe centré sur `tip`, sa base perpendiculaire à la tangente de l'arc en ce
  // point (donc alignée avec le rayon local à `ROLL_ARC_END`) pour pointer dans le sens du tracé.
  const tangentDeg = ROLL_ARC_END + (mirror ? -90 : 90);
  const baseCenter = { x: tip.x - localPolar(5, tangentDeg + 180).x, y: tip.y - localPolar(5, tangentDeg + 180).y };
  const side1 = { x: baseCenter.x + localPolar(3, tangentDeg + 90).x, y: baseCenter.y + localPolar(3, tangentDeg + 90).y };
  const side2 = { x: baseCenter.x + localPolar(3, tangentDeg - 90).x, y: baseCenter.y + localPolar(3, tangentDeg - 90).y };
  const flip = (p: { x: number; y: number }) => ({ x: p.x * mx, y: p.y });
  const f = [tip, side1, side2].map(flip);
  return { path, triangle: `${f[0].x},${f[0].y} ${f[1].x},${f[1].y} ${f[2].x},${f[2].y}` };
};

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

  // L'inversion n'a lieu que si la caméra est EXACTEMENT sur la vue prédéfinie de l'axe
  // (i.e. on a déjà cliqué dessus) : un ajustement manuel proche ne compte pas.
  // L'animation se termine sur la valeur exacte de la clé, donc l'égalité stricte tient
  // (alpha comparé modulo 2π car la caméra peut avoir tourné d'un tour complet).
  const TWO_PI = Math.PI * 2;
  const isExactlyOnAxis = (axis: (typeof AXES)[number]) => {
    const dAlpha = (((camAngles.alpha - axis.alpha) % TWO_PI) + TWO_PI) % TWO_PI;
    return camAngles.beta === axis.beta && (dAlpha === 0 || dAlpha === TWO_PI);
  };

  const handlePointClick = (p: (typeof points)[number]) => {
    if (isExactlyOnAxis(p)) {
      const oppositeKey = p.key.endsWith('+') ? p.key.replace('+', '-') : p.key.replace('-', '+');
      const opposite = AXES.find((a) => a.key === oppositeKey);
      if (opposite) {
        triggerView(opposite.label || opposite.key.toUpperCase(), opposite.alpha, opposite.beta);
        return;
      }
    }
    triggerView(p.label || p.key.toUpperCase(), p.alpha, p.beta);
  };

  // Les flèches de roulis n'ont de sens que face à un plan précisément sélectionné (comme
  // dans Fusion 360) : un axe survolé/proche mais pas exactement centré ne les affiche pas.
  const rollAxis = AXES.find((axis) => isExactlyOnAxis(axis));

  const rollView = (degrees: number) => {
    window.dispatchEvent(new CustomEvent('apex-roll-view', { detail: { degrees } }));
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
          {rollAxis && ROLL_ARROWS.map(({ degrees, cx, cy, mirror }) => {
            const { path, triangle } = rollArrowGeometry(mirror);
            return (
              <g
                key={`roll-${degrees}`}
                className={styles.rollArrow}
                transform={`translate(${cx}, ${cy})`}
                onClick={() => rollView(degrees)}
              >
                <title>{`Tourner la vue de ${degrees > 0 ? '+' : ''}${degrees}°`}</title>
                {/* Cible de clic généreuse, invisible, pour compenser la petite taille de l'icône. */}
                <circle r={ROLL_ARROW_R + 4} fill="transparent" />
                <path d={path} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" />
                <polygon points={triangle} fill="currentColor" />
              </g>
            );
          })}
        </svg>
      </CustomTooltip>
    </div>
  );
};
