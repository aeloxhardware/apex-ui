import * as BABYLON from 'babylonjs';
import type { ViewportCtx } from './context';

/** Vues prédéfinies et personnalisées de la caméra. */
export function setupCameraViews(c: ViewportCtx) {
  const { camera, resetLensShift, GRID_ALIGNED_VIEW, scene, flat, HEIGHT, hlRef } = c;


  const handleSetView = (e: Event) => {
    const customEvent = e as CustomEvent<{ view: string }>;
    const view = customEvent.detail?.view;
    if (!camera) return;

    const targetRadius = 300;
    const targetLookAt = new BABYLON.Vector3(0, HEIGHT / 2, 0);
    resetLensShift();
    camera.target = targetLookAt;
    camera.radius = targetRadius;

    let targetAlpha = camera.alpha;
    let targetBeta = camera.beta;

    // Hors esquisse, en Modélisation : cliquer une face du ViewCube aligne la grille sur le plan
    // regardé (face/arrière -> XY, gauche/droite -> YZ, dessus/dessous -> XZ).
    let alignedPlane: 'XZ' | 'XY' | 'YZ' | null = null;
    if (c.modelingActive && !c.sketchOrbitLocked) {
      if (view === 'front' || view === 'back') alignedPlane = 'XY';
      else if (view === 'left' || view === 'right') alignedPlane = 'YZ';
      else if (view === 'top' || view === 'bottom') alignedPlane = 'XZ';
      if (alignedPlane) c.setGridStandardPlane(alignedPlane);
    }

    switch (view) {
      case 'front':
        targetAlpha = Math.PI / 2;
        targetBeta = Math.PI / 2;
        break;
      case 'back':
        targetAlpha = -Math.PI / 2;
        targetBeta = Math.PI / 2;
        break;
      case 'right':
        targetAlpha = 0;
        targetBeta = Math.PI / 2;
        break;
      case 'left':
        targetAlpha = Math.PI;
        targetBeta = Math.PI / 2;
        break;
      case 'top':
        targetBeta = 0.01;
        break;
      case 'bottom':
        targetBeta = Math.PI - 0.01;
        break;
    }

    if (alignedPlane) {
      targetAlpha = GRID_ALIGNED_VIEW[alignedPlane].alpha;
      targetBeta = view === 'bottom' ? Math.PI - 0.01 : GRID_ALIGNED_VIEW[alignedPlane].beta;
    }

    const animAlpha = new BABYLON.Animation("animAlpha", "alpha", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    animAlpha.setKeys([{ frame: 0, value: camera.alpha }, { frame: 20, value: targetAlpha }]);

    const animBeta = new BABYLON.Animation("animBeta", "beta", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    animBeta.setKeys([{ frame: 0, value: camera.beta }, { frame: 20, value: targetBeta }]);

    scene.beginDirectAnimation(camera, [animAlpha, animBeta], 0, 20, false);
  };
  c.handleSetView = handleSetView;


  const handleCustomView = (e: Event) => {
    const customEvent = e as CustomEvent<{ alpha: number; beta: number }>;
    let { alpha, beta } = customEvent.detail;
    if (!camera) return;
    // Comme les autres vues prédéfinies : le décalage de lentille du panoramique est remis à zéro, sinon la vue « de face »
    // reste oblique (perspective déformée, angle incohérent avec le gizmo).
    resetLensShift();

    // Hors esquisse, en Modélisation : cliquer une FACE du ViewCube (pas une arête ni un coin)
    // aligne la grille sur ce plan et oriente la vue pour que ses axes suivent ceux de l'écran.
    if (c.modelingActive && !c.sketchOrbitLocked) {
      const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.03;
      let plane: 'XZ' | 'XY' | 'YZ' | null = null;
      if (beta < 0.05 || beta > Math.PI - 0.05) plane = 'XZ';
      else if (near(beta, Math.PI / 2)) {
        if (near(alpha, Math.PI / 2) || near(alpha, -Math.PI / 2)) plane = 'XY';
        else if (near(alpha, 0) || near(alpha, Math.PI)) plane = 'YZ';
      }
      if (plane) {
        c.setGridStandardPlane(plane);
        alpha = GRID_ALIGNED_VIEW[plane].alpha;
        beta = plane === 'XZ' && customEvent.detail.beta > Math.PI / 2
          ? Math.PI - 0.01
          : GRID_ALIGNED_VIEW[plane].beta;
      }
    }

    const animAlpha = new BABYLON.Animation("animAlpha", "alpha", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    animAlpha.setKeys([{ frame: 0, value: camera.alpha }, { frame: 20, value: alpha }]);

    const animBeta = new BABYLON.Animation("animBeta", "beta", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    animBeta.setKeys([{ frame: 0, value: camera.beta }, { frame: 20, value: beta }]);

    scene.beginDirectAnimation(camera, [animAlpha, animBeta], 0, 20, false);
  };
  c.handleCustomView = handleCustomView;


  window.addEventListener('apex-set-camera-view', handleSetView);

  window.addEventListener('apex-set-camera-custom', handleCustomView);


  new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);

  // Interface classique : sélection par contour (cf. updateFlatOutline), donc pas de HighlightLayer (cible de rendu + flou).
  if (!flat) {
    const hl = new BABYLON.HighlightLayer("hl1", scene);
    hl.blurHorizontalSize = 0.5;
    hl.blurVerticalSize = 0.5;
    hlRef.current = hl;
  }
}
