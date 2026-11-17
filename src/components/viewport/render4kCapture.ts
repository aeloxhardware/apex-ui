// Rendu 4K d'une zone du viewport : la scène est redessinée hors écran (cible de rendu 3840 × 2160) avec une
// projection recadrée sur la zone, donc sans agrandir une image déjà rasterisée : le détail est réel.
import * as BABYLON from 'babylonjs';
import { RENDER_4K, cropProjection, renderFileName } from '@/utils/renderFrame4k';

/** Zone du canevas en fractions 0…1 (origine en haut à gauche). */
export interface CaptureRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MSAA_SAMPLES = 4;

/** Rend `region` en 4K et renvoie l'image PNG (URL de données). La caméra et le moteur sont rendus tels qu'ils étaient. */
export async function renderRegion4k(engine: BABYLON.AbstractEngine, camera: BABYLON.Camera, region: CaptureRegion): Promise<string> {
  // Le rapport de l'image « normale » (celui du canevas) sert de référence au recadrage : on le fige pendant le rendu,
  // sinon la cible 16:9 en imposerait un autre et la zone serait déformée.
  const canvasAspect = engine.getAspectRatio(camera);
  const baseProjection = camera.getProjectionMatrix.bind(camera);
  const baseAspect = engine.getAspectRatio;
  engine.getAspectRatio = () => canvasAspect;
  camera.getProjectionMatrix = (force?: boolean) =>
    BABYLON.Matrix.FromArray(Array.from(cropProjection(baseProjection(force ?? true).m, region)));
  try {
    return await BABYLON.Tools.CreateScreenshotUsingRenderTargetAsync(
      engine,
      camera,
      { width: RENDER_4K.width, height: RENDER_4K.height },
      'image/png',
      MSAA_SAMPLES,
      true,
    );
  } finally {
    camera.getProjectionMatrix = baseProjection;
    engine.getAspectRatio = baseAspect;
    camera.getProjectionMatrix(true);
  }
}

/** Enregistre l'image (téléchargement) sous un nom daté. */
export function saveRender(dataUrl: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = renderFileName(new Date());
  document.body.appendChild(link);
  link.click();
  link.remove();
}
