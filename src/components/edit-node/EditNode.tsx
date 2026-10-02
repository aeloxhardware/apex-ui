import React, { useId } from 'react';
import { motion, type Transition } from 'framer-motion';
import styles from './EditNode.module.scss';

/**
 * Nœud d'édition du G-code (second style de poignée, cf. CLAUDE.md « Bézier-editor node »).
 * Ancré en 3D sur un point de trajectoire, dessiné en 2D par-dessus la vue : `x`/`y` sont la
 * projection écran de son ancre, en pixels, dans le repère du conteneur parent.
 *
 * Inactif : un point bleu. Actif : le point GONFLE (ressort peu amorti, léger dépassement) et
 * devient une lentille « Liquid Glass » : l'arrière-plan est réfracté par un filtre SVG appliqué
 * en backdrop-filter (Chromium, donc Electron), presque intact au centre et fortement courbé au
 * bord, avec une légère dispersion des couleurs et des reflets. Le contenu du nœud développé est
 * en cours de conception dans le banc d'essai `pnpm dev:lab-node` (src/lab/edit-node).
 */
export interface EditNodeProps {
  x: number;
  y: number;
  /** Nœud sélectionné : forme développée. */
  active: boolean;
  /** Rognage en cas de dépassement (bascule au double-clic). */
  trimming: boolean;
  onActivate?: () => void;
  onToggleTrimming?: () => void;
}

const CORE_PX = 12;
const BUBBLE_PX = 76; // 168 / 2,2

// Réfraction, en fraction de la taille du nœud (le filtre est en objectBoundingBox : il suit le
// gonflement). Trois échelles proches = dispersion rouge / vert / bleu sur le bord.
const REFRACTION = { r: 0.3, g: 0.275, b: 0.25 };
// Petit flou de l'arrière-plan vu à travers le verre, même unité (~1,9 px sur 76 px).
const SOFTEN = 0.025;

// Taille : ressort (gonflement fluide). Couleurs : fondu court, sans dépassement (un ressort
// ferait « rebondir » la couleur au-delà de sa valeur finale).
const transition: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 17,
  mass: 0.9,
  backgroundColor: { duration: 0.22 },
  boxShadow: { duration: 0.3 },
};

const variants = {
  closed: {
    width: CORE_PX,
    height: CORE_PX,
    backgroundColor: 'rgba(0, 240, 255, 1)',
    boxShadow: '0 0 0 2px rgba(10, 15, 26, 0.9), 0 0 10px rgba(0, 240, 255, 0.55)',
  },
  open: {
    width: BUBBLE_PX,
    height: BUBBLE_PX,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    boxShadow: '0 0 0 0px rgba(10, 15, 26, 0), 0 6px 22px rgba(0, 0, 0, 0.4)',
  },
};

/**
 * Carte de déplacement d'une lentille ronde (R = x, G = y, 128 = aucun déplacement) : nulle au
 * centre, croissante vers le bord (profil de biseau), orientée vers l'INTÉRIEUR : le bord montre
 * le contenu plus central, comprimé et courbé comme par un verre épais. Vers l'extérieur, les
 * échantillons sortiraient de la zone du filtre et le bord se remplirait de vide (carré sombre
 * mesuré en capture). Calculée une fois.
 */
const MAP_PX = 128;
let lensMap: string | null = null;
function getLensMap(): string {
  if (lensMap) return lensMap;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MAP_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(MAP_PX, MAP_PX);
  for (let y = 0; y < MAP_PX; y++) {
    for (let x = 0; x < MAP_PX; x++) {
      const nx = ((x + 0.5) / MAP_PX) * 2 - 1;
      const ny = ((y + 0.5) / MAP_PX) * 2 - 1;
      const r = Math.hypot(nx, ny);
      let dx = 0, dy = 0;
      if (r > 0 && r <= 1) {
        const t = Math.max(0, (r - 0.45) / 0.55);
        const bend = t * t * (3 - 2 * t); // biseau lisse
        dx = -(nx / r) * bend;
        dy = -(ny / r) * bend;
      }
      const o = (y * MAP_PX + x) * 4;
      img.data[o] = Math.round(128 + 127 * dx);
      img.data[o + 1] = Math.round(128 + 127 * dy);
      img.data[o + 2] = 128;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  lensMap = canvas.toDataURL();
  return lensMap;
}

const channel = (row: number) => {
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0];
  m[row * 6] = 1;
  return m.join(' ');
};

const LiquidGlassFilter: React.FC<{ id: string }> = ({ id }) => (
  <svg className={styles.defs} aria-hidden="true">
    <filter
      id={id}
      filterUnits="objectBoundingBox"
      primitiveUnits="objectBoundingBox"
      x="0"
      y="0"
      width="1"
      height="1"
      colorInterpolationFilters="sRGB"
    >
      <feImage href={getLensMap()} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
      <feGaussianBlur in="SourceGraphic" stdDeviation={SOFTEN} result="soft" />
      {(['r', 'g', 'b'] as const).map((c, row) => (
        <React.Fragment key={c}>
          <feDisplacementMap in="soft" in2="map" scale={REFRACTION[c]} xChannelSelector="R" yChannelSelector="G" result={`d${c}`} />
          <feColorMatrix in={`d${c}`} type="matrix" values={channel(row)} result={c} />
        </React.Fragment>
      ))}
      <feBlend in="r" in2="g" mode="screen" result="rg" />
      <feBlend in="rg" in2="b" mode="screen" result="rgb" />
      <feColorMatrix in="rgb" type="saturate" values="1.25" />
    </filter>
  </svg>
);

const EditNode: React.FC<EditNodeProps> = ({ x, y, active, trimming, onActivate, onToggleTrimming }) => {
  const filterId = `apex-liquid-glass-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <div className={styles.anchor} style={{ transform: `translate(${x}px, ${y}px)` }}>
      <LiquidGlassFilter id={filterId} />
      <motion.div
        className={`${styles.body} ${trimming ? styles.trimming : ''}`}
        style={{ backdropFilter: `url(#${filterId})` }}
        initial={false}
        animate={active ? 'open' : 'closed'}
        variants={variants}
        transition={transition}
        whileHover={active ? undefined : { scale: 1.25 }}
        onClick={(e) => {
          e.stopPropagation();
          onActivate?.();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onToggleTrimming?.();
        }}
      >
        <motion.div
          className={styles.shine}
          initial={false}
          animate={{ opacity: active ? 1 : 0 }}
          transition={{ duration: 0.25 }}
        />
      </motion.div>
    </div>
  );
};

export default React.memo(EditNode);
