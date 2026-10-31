/**
 * Unité de lecture d'un modèle. « in » = le fichier est lu en pouces : ses dimensions sont multipliées par
 * 25,4 par rapport à la lecture en millimètres (cf. onSetModelUnit dans Viewport3D.tsx).
 */
export type ModelUnit = 'mm' | 'in';

export const INCH_TO_MM = 25.4;
/** Taille plausible d'un objet imprimé, en mm (plus petit : objet presque invisible ; plus grand : hors plateau). */
export const SIZE_MIN_MM = 5;
export const SIZE_MAX_MM = 1000;

/** Écart à la plage plausible, en mm (0 si la taille y est). */
function outOfRange(sizeMm: number): number {
  if (sizeMm < SIZE_MIN_MM) return SIZE_MIN_MM - sizeMm;
  if (sizeMm > SIZE_MAX_MM) return sizeMm - SIZE_MAX_MM;
  return 0;
}

/**
 * Unité à proposer quand l'autre lecture rapproche le modèle de la plage plausible, sinon null.
 * `sizeMm` est la plus grande dimension affichée, dans l'unité de lecture actuelle.
 */
export function suggestModelUnit(sizeMm: number, unit: ModelUnit): ModelUnit | null {
  const other: ModelUnit = unit === 'mm' ? 'in' : 'mm';
  const sizeInOther = unit === 'mm' ? sizeMm * INCH_TO_MM : sizeMm / INCH_TO_MM;
  return outOfRange(sizeInOther) < outOfRange(sizeMm) ? other : null;
}
