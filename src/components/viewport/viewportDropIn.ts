import type * as BABYLON from 'babylonjs';
import { isFlatUi } from '@/utils/interfaceMode';

/** Durée totale de l'apparition d'une primitive (chute + rebonds) — doit rester sous la seconde. */
export const DROP_IN_MS = 900;

const DROP_HEIGHT_MM = 18; // point de départ, juste au-dessus du plateau
const FADE_END = 0.22; // fin du fondu d'entrée (part de la durée totale)
const FALL_END = 0.45; // fin de la chute (impact)
const BOUNCE1_END = 0.78; // fin du premier rebond
const BOUNCE1_MM = 3.5;
const BOUNCE2_MM = 1;

/** Décalage vertical (mm, ≥ 0) au-dessus de la position finale à l'instant normalisé `t` ∈ [0, 1]. */
export function dropInOffset(t: number): number {
  if (t >= 1) return 0;
  if (t < FALL_END) {
    const k = t / FALL_END;
    return DROP_HEIGHT_MM * (1 - k * k); // accélération de la chute
  }
  if (t < BOUNCE1_END) {
    const k = (t - FALL_END) / (BOUNCE1_END - FALL_END);
    return BOUNCE1_MM * 4 * k * (1 - k); // arc parabolique : rebond
  }
  const k = (t - BOUNCE1_END) / (1 - BOUNCE1_END);
  return BOUNCE2_MM * 4 * k * (1 - k); // petit second rebond
}

/**
 * Fait apparaître `mesh` en fondu légèrement au-dessus de sa position finale, puis le fait tomber
 * et rebondir un peu. `mesh.position.y` au moment de l'appel est la position d'arrivée.
 * `onDone` est appelé une fois le mesh posé (aussitôt en interface classique, sans animation).
 */
export function dropInMesh(scene: BABYLON.Scene, mesh: BABYLON.Mesh, onDone: () => void) {
  if (isFlatUi()) {
    mesh.visibility = 1;
    onDone();
    return;
  }
  const finalY = mesh.position.y;
  const start = performance.now();
  mesh.visibility = 0;
  mesh.position.y = finalY + DROP_HEIGHT_MM;

  const observer = scene.onBeforeRenderObservable.add(() => {
    if (mesh.isDisposed()) {
      scene.onBeforeRenderObservable.remove(observer);
      return;
    }
    const t = Math.min(1, (performance.now() - start) / DROP_IN_MS);
    mesh.position.y = finalY + dropInOffset(t);
    mesh.visibility = Math.min(1, t / FADE_END);
    if (t >= 1) {
      scene.onBeforeRenderObservable.remove(observer);
      mesh.position.y = finalY;
      mesh.visibility = 1;
      onDone();
    }
  });
}
