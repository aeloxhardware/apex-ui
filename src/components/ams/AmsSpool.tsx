import React, { useId } from 'react';
import type { FilamentFinish } from '@/utils/filamentCatalog';

// Joues de la bobine : translucides ; bleues (bleu de l'interface) quand le profil a été modifié par l'utilisateur.
const FLANGE = {
  fill: 'rgba(255,255,255,0.14)',
  stroke: 'rgba(255,255,255,0.4)',
  strokeWidth: 1,
  vectorEffect: 'non-scaling-stroke',
} as const;
const FLANGE_EDITED = { fill: 'rgba(245,158,11,0.3)', stroke: '#f59e0b', strokeWidth: 1.4, vectorEffect: 'non-scaling-stroke' } as const;

const STRANDS = [14, 19, 24, 29, 34, 39, 44];

/** Reflet = bande horizontale sur le cylindre (axe horizontal) : position et hauteur en unités du viewBox, opacité. */
interface Band {
  y: number;
  h: number;
  a: number;
  dark?: true;
}
type FinishKey = FilamentFinish | 'standard';

// Éclat de chaque aspect. `standard` = aspect non renseigné dans le profil : reflet discret, sans rien promettre.
const BANDS: Record<FinishKey, Band[]> = {
  matte: [],
  standard: [{ y: 18, h: 22, a: 0.14 }],
  satin: [{ y: 16, h: 28, a: 0.24 }],
  glossy: [
    { y: 19, h: 9, a: 0.8 },
    { y: 72, h: 5, a: 0.28 },
  ],
  silk: [
    { y: 12, h: 42, a: 0.42 },
    { y: 60, h: 24, a: 0.2 },
  ],
  metallic: [
    { y: 12, h: 10, a: 0.6 },
    { y: 38, h: 16, a: 0.32, dark: true },
    { y: 60, h: 9, a: 0.45 },
    { y: 76, h: 10, a: 0.3, dark: true },
  ],
  sparkle: [{ y: 18, h: 22, a: 0.14 }],
};
// Éclat du haut du cylindre (dégradé d'ombrage) : nul pour un filament mat.
const SHADE_LIGHT: Record<FinishKey, number> = {
  matte: 0,
  standard: 0.2,
  satin: 0.22,
  glossy: 0.24,
  silk: 0.3,
  metallic: 0.28,
  sparkle: 0.2,
};
const GLINTS = [
  [14, 20],
  [30, 33],
  [41, 14],
  [22, 52],
  [37, 66],
  [12, 78],
  [44, 44],
  [27, 84],
  [34, 24],
] as const;

const FinishLayers: React.FC<{ finish: FinishKey; uid: string }> = ({ finish, uid }) => (
  <>
    {BANDS[finish].map((b) => (
      <rect key={b.y} x="7" y={b.y} width="41" height={b.h} fill={`url(#${uid}-${b.dark ? 'dark' : 'light'})`} opacity={b.a} />
    ))}
    {finish === 'matte' && <rect x="7" y="9" width="41" height="82" rx="3" fill="rgba(128,128,128,0.12)" />}
    {finish === 'sparkle' && GLINTS.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.9" fill="#fff" opacity="0.9" />)}
  </>
);

/**
 * Une bobine vue de face dans l'AMS, axe à l'horizontale (viewBox 55 × 100, étirée en largeur seulement quand elle est
 * réduite : la hauteur ne change jamais) : deux joues translucides de part et d'autre, le filament enroulé entre elles
 * (spires en traits verticaux, cylindre ombré) ; joues bleues si le profil est modifié par l'utilisateur. L'éclat du filament dépend de l'aspect du profil (`finish`, cf.
 * FilamentFinish) : mat sans reflet, brillant à reflet net, soyeux à reflet large, métallisé rayé, pailleté ponctué.
 */
export const AmsSpool: React.FC<{ color: string; finish: FilamentFinish | null; edited?: boolean }> = ({
  color,
  finish,
  edited = false,
}) => {
  const uid = `ams-${useId().replace(/:/g, '')}`; // les « : » de useId gênent url(#…)
  const key: FinishKey = finish ?? 'standard';
  const flange = edited ? FLANGE_EDITED : FLANGE;
  return (
    <svg viewBox="0 0 55 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden>
      <defs>
        <linearGradient id={`${uid}-shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.5" />
          <stop offset="0.3" stopColor="#fff" stopOpacity={SHADE_LIGHT[key]} />
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={`${uid}-light`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${uid}-dark`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="0.5" stopColor="#000" stopOpacity="1" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="7" y="9" width="41" height="82" rx="3" fill={color} />
      {STRANDS.map((x) => (
        <line key={x} x1={x} y1="9" x2={x} y2="91" stroke="rgba(0,0,0,0.16)" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
      ))}
      <rect x="7" y="9" width="41" height="82" rx="3" fill={`url(#${uid}-shade)`} />
      <FinishLayers finish={key} uid={uid} />
      <rect x="0.6" y="0.6" width="7" height="98.8" rx="3" {...flange} />
      <rect x="47.4" y="0.6" width="7" height="98.8" rx="3" {...flange} />
    </svg>
  );
};
