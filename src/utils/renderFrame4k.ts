/**
 * Cadre « Rendu et export en 4K » : géométrie pure (testable sans DOM ni GPU).
 *
 * Le cadre est toujours 16:9. Il est mémorisé en FRACTIONS du conteneur (centre + largeur), pas en pixels :
 * il retrouve la même place si la fenêtre change de taille. Mémorisé localement, par poste.
 */
export const FRAME_ASPECT = 16 / 9;
export const RENDER_4K = { width: 3840, height: 2160 } as const;

const STORAGE_KEY = 'apex-render-frame-4k';
const MIN_WIDTH_PX = 160;

/** Cadre en fractions du conteneur : `cx`/`cy` = centre (0…1), `w` = largeur / largeur du conteneur. */
export interface FrameFraction {
  cx: number;
  cy: number;
  w: number;
}

/** Cadre en pixels, relatif au conteneur. La hauteur vaut toujours `width · 9/16`. */
export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FrameHandle = 'nw' | 'ne' | 'sw' | 'se';

export const DEFAULT_FRAME: FrameFraction = { cx: 0.5, cy: 0.5, w: 0.6 };

/** Largeur maximale (px) d'un cadre 16:9 qui tient dans le conteneur. */
function maxWidthPx(container: { width: number; height: number }): number {
  return Math.max(MIN_WIDTH_PX, Math.min(container.width, container.height * FRAME_ASPECT));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Cadre en pixels, ramené dans le conteneur (taille bornée, position gardée à l'intérieur). */
export function frameToRect(frame: FrameFraction, container: { width: number; height: number }): FrameRect {
  const width = clamp(frame.w * container.width, MIN_WIDTH_PX, maxWidthPx(container));
  const height = width / FRAME_ASPECT;
  const x = clamp(frame.cx * container.width - width / 2, 0, Math.max(0, container.width - width));
  const y = clamp(frame.cy * container.height - height / 2, 0, Math.max(0, container.height - height));
  return { x, y, width, height };
}

export function rectToFrame(rect: FrameRect, container: { width: number; height: number }): FrameFraction {
  if (container.width <= 0 || container.height <= 0) return { ...DEFAULT_FRAME };
  return {
    cx: (rect.x + rect.width / 2) / container.width,
    cy: (rect.y + rect.height / 2) / container.height,
    w: rect.width / container.width,
  };
}

/** Déplace le cadre de (dx, dy) pixels, sans le laisser sortir du conteneur. */
export function moveRect(rect: FrameRect, dx: number, dy: number, container: { width: number; height: number }): FrameRect {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, Math.max(0, container.width - rect.width)),
    y: clamp(rect.y + dy, 0, Math.max(0, container.height - rect.height)),
  };
}

/** Coin opposé à `handle` : le point qui reste fixe pendant le redimensionnement. */
function anchorOf(rect: FrameRect, handle: FrameHandle): { x: number; y: number } {
  return {
    x: handle === 'nw' || handle === 'sw' ? rect.x + rect.width : rect.x,
    y: handle === 'nw' || handle === 'ne' ? rect.y + rect.height : rect.y,
  };
}

/**
 * Redimensionne en tirant le coin `handle` jusqu'au pointeur : le coin opposé reste fixe, le rapport 16:9 est
 * conservé (la largeur suit le plus grand des deux déplacements), la taille reste dans le conteneur.
 */
export function resizeRect(
  rect: FrameRect,
  handle: FrameHandle,
  pointer: { x: number; y: number },
  container: { width: number; height: number },
): FrameRect {
  const anchor = anchorOf(rect, handle);
  const sx = handle === 'nw' || handle === 'sw' ? -1 : 1;
  const sy = handle === 'nw' || handle === 'ne' ? -1 : 1;
  const wanted = Math.max((pointer.x - anchor.x) * sx, (pointer.y - anchor.y) * sy * FRAME_ASPECT);
  // Place disponible entre le coin fixe et le bord du conteneur dans la direction du tirage.
  const room = Math.min(sx > 0 ? container.width - anchor.x : anchor.x, (sy > 0 ? container.height - anchor.y : anchor.y) * FRAME_ASPECT);
  const width = clamp(wanted, MIN_WIDTH_PX, Math.max(MIN_WIDTH_PX, room));
  const height = width / FRAME_ASPECT;
  return { x: sx > 0 ? anchor.x : anchor.x - width, y: sy > 0 ? anchor.y : anchor.y - height, width, height };
}

/** Lit le cadre mémorisé ; une valeur absente, illisible ou absurde redonne le cadre par défaut. */
export function readFrame(): FrameFraction {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FRAME };
    const parsed = JSON.parse(raw) as Partial<FrameFraction>;
    const { cx, cy, w } = parsed;
    const valid = [cx, cy, w].every((v) => typeof v === 'number' && Number.isFinite(v));
    if (!valid) return { ...DEFAULT_FRAME };
    return { cx: clamp(cx as number, 0, 1), cy: clamp(cy as number, 0, 1), w: clamp(w as number, 0.05, 1) };
  } catch {
    return { ...DEFAULT_FRAME };
  }
}

export function saveFrame(frame: FrameFraction): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(frame));
  } catch {
    // stockage indisponible : le cadre ne vaut que pour la session
  }
}

/**
 * Recadre une matrice de projection (16 flottants, convention Babylon : vecteur ligne × matrice) sur la zone `region`
 * (fractions 0…1 de l'image, origine en haut à gauche) : la zone remplit alors tout le rendu. Pur écrêtage dans
 * l'espace de découpe, valable en perspective comme en orthographique.
 */
export function cropProjection(
  base: ArrayLike<number>,
  region: { left: number; top: number; width: number; height: number },
): Float32Array {
  const sx = 1 / region.width;
  const sy = 1 / region.height;
  // Centre de la zone en coordonnées normalisées (x à droite, y vers le haut).
  const cx = (region.left + region.width / 2) * 2 - 1;
  const cy = 1 - (region.top + region.height / 2) * 2;
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row++) {
    const w = base[row * 4 + 3] ?? 0;
    out[row * 4] = ((base[row * 4] ?? 0) - cx * w) * sx;
    out[row * 4 + 1] = ((base[row * 4 + 1] ?? 0) - cy * w) * sy;
    out[row * 4 + 2] = base[row * 4 + 2] ?? 0;
    out[row * 4 + 3] = w;
  }
  return out;
}

/** Nom de fichier du rendu, ex. « apex-rendu-4k-20261117-141530.png ». */
export function renderFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `apex-rendu-4k-${day}-${time}.png`;
}
