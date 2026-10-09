/**
 * Interface classique : « Rendre le plateau avec ombres ». Décoché (défaut) : le plateau et les modèles sont dessinés à
 * plat — une seule couleur, sans éclairage ni capture floutée du plateau (cf. Viewport3D) ; coché : rendu complet (verre
 * du plateau, matériaux éclairés des modèles), plus lourd. Même patron que devModePrefs.ts (singleton + localStorage).
 * Sans effet dans l'interface LiquidGlass, qui rend toujours le plateau complet.
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'apex-plate-shaded';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false; // localStorage indisponible
  }
}

let shaded = readStored();
const listeners = new Set<(shaded: boolean) => void>();

export function isPlateShaded() {
  return shaded;
}

export function setPlateShaded(next: boolean) {
  shaded = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // no-op : localStorage indisponible.
  }
  listeners.forEach((listener) => listener(shaded));
}

export function subscribePlateShaded(listener: (shaded: boolean) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function usePlateShaded() {
  const [value, setValue] = useState(isPlateShaded);
  useEffect(() => subscribePlateShaded(setValue), []);
  return value;
}
