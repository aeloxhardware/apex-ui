import type * as BABYLON from 'babylonjs';
import type { LayerState } from './state';

/** Vitesse de défilement des bandes (unités de `diag` par seconde) — purement visuelle, à ajuster au ressenti. */
const OFF_PLATE_HAZARD_SPEED = 1.5;

export interface OffPlateBlink {
  setBlinking(blinking: boolean): void;
  dispose(): void;
}

/**
 * Clignotement des traits hors plateau pendant une conversion en cours : bascule vers le matériau
 * « chantier » (bandes diagonales défilantes) tant qu'il est actif ; jamais de trou (ni éteint ni
 * immobile). N'anime (et n'assigne le matériau chantier) que quand nécessaire, pas en permanence —
 * coût nul le reste du temps.
 */
export function createOffPlateBlink(st: LayerState): OffPlateBlink {
  let observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  let startedAt = 0;

  const stop = () => {
    if (observer) st.scene.onBeforeRenderObservable.remove(observer);
    observer = null;
  };

  return {
    setBlinking(blinking) {
      st.blinkingOffPlate = blinking;
      const { offPlateHazardMat, offPlateMat } = st.materials;
      if (blinking && !observer) {
        if (st.offPlatePath?.mesh) st.offPlatePath.mesh.material = offPlateHazardMat;
        startedAt = performance.now();
        observer = st.scene.onBeforeRenderObservable.add(() => {
          const elapsed = (performance.now() - startedAt) / 1000;
          offPlateHazardMat.setFloat('time', elapsed * OFF_PLATE_HAZARD_SPEED);
        });
      } else if (!blinking && observer) {
        stop();
        if (st.offPlatePath?.mesh) st.offPlatePath.mesh.material = offPlateMat;
      }
    },
    dispose: stop,
  };
}
