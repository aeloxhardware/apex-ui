import { useMemo } from 'react';

/**
 * Tramage global de l'interface : casse les bandes (« color banding ») des dégradés doux que le
 * navigateur quantifie sur 8 bits, surtout les ombres portées CSS (box-shadow) sur fond sombre.
 *
 * Calque plein écran, sans interaction, qui ajoute un grain blanc d'amplitude 0 à ~2/255 par pixel
 * (bruit uniforme) : l'équivalent d'un « bruit avant arrondi » appliqué après coup. Il décale le
 * niveau moyen de moins d'un niveau et n'est pas perceptible comme grain.
 */
const TILE = 256;

function makeNoiseTile(): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const image = ctx.createImageData(TILE, TILE);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
    image.data[i + 3] = Math.floor(Math.random() * 3); // alpha 0..2 sur 255
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export const DitherOverlay: React.FC = () => {
  const url = useMemo(makeNoiseTile, []);
  if (!url) return null;
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        pointerEvents: 'none',
        backgroundImage: `url(${url})`,
        backgroundSize: `${TILE}px ${TILE}px`,
        imageRendering: 'pixelated',
      }}
    />
  );
};
