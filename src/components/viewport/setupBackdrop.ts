import { isFlatUi } from '@/utils/interfaceMode';
import * as BABYLON from 'babylonjs';
import type { ViewportCtx } from './context';

/** Rendu (pipeline), fond quadrillé. */
export function setupBackdrop(c: ViewportCtx) {
  const { scene, camera, engine, cameraRef } = c;


  // Le MSAA du contexte WebGL (2ᵉ argument `true` de BABYLON.Engine) ne couvre que le
  // rendu direct — les contours (LinesMesh, edgesRendering des voxels) et le compositing
  // via blurRT restent crénelés sans une passe FXAA sur la sortie finale du pipeline.
  // Interface classique : pas de pipeline (MSAA ×8 + FXAA), le MSAA du contexte suffit (cf. utils/interfaceMode.ts).
  const flat = isFlatUi();
  c.flat = flat;

  const renderPipeline = flat ? null : new BABYLON.DefaultRenderingPipeline("apexRenderPipeline", false, scene, [camera]);
  c.renderPipeline = renderPipeline;

  if (renderPipeline) {
    renderPipeline.fxaaEnabled = true;
    renderPipeline.samples = 8;
  }

  // Les verres DOM (GlassPanelBackdrop) se dessinent en fin d'image (post-traitements du pipeline inclus : plus tôt, le canevas n'a pas encore l'image finale).
  engine.onEndFrameObservable.add(() => window.dispatchEvent(new Event('apex-scene-rendered')));


  camera.angularSensibilityX = 3500;

  camera.angularSensibilityY = 3500;

  // Recalculée à chaque image (cf. observer plus bas) : le pan doit suivre l'échelle du zoom.
  camera.panningSensibility = 40;

  camera.maxZ = 10000;

  cameraRef.current = camera;


  // Pan sans inertie, comme en CAO : le sol colle au curseur. L'inertie de Babylon s'arrête sur
  // des seuils ABSOLUS (≈ 0,001 unité monde, et une vitesse plancher de 1e-6) : à petite échelle
  // tout le mouvement passe sous ces seuils et la glissade était tronquée, pas à grande échelle
  // — le même geste déplaçait alors la vue de 1× ou de 1,4× selon le zoom.
  camera.panningInertia = 0;

  camera.movement.panInertia = 0;

  // Pan proportionnel au zoom : Babylon déplace la cible de `pixels / panningSensibility` ; avec
  // cette valeur, un glisser de N px la déplace de N × (taille monde d'un pixel au niveau de la
  // cible), qu'on soit à 0,001 mm ou à 1 m.
  scene.onBeforeRenderObservable.add(() => {
    const worldPerPixel = (2 * camera.radius * Math.tan(camera.fov / 2)) / engine.getRenderHeight();
    if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0) return;
    camera.panningSensibility = 1 / worldPerPixel;
  });


  // Fond 3D : un sol infini (pas de murs ni de plafond), fixe dans le monde (pas parenté à la
  // caméra) pour que la grille affiche une vraie perspective en fonction de l'angle de vue.
  // Un shader procédural dessine la grille et l'estompe radialement vers la couleur de fond à
  // mesure qu'on s'éloigne du centre, pour donner l'impression d'une étendue sans limite
  // visible plutôt qu'une pièce fermée. Contrairement à l'ancien fond CSS derrière le canvas,
  // cette géométrie réelle peut être capturée et floutée par le disque "verre dépoli" du plateau.
  const backdropColor = "#2A2D33";
  c.backdropColor = backdropColor;

  const backdropSize = 20000;

  BABYLON.Effect.ShadersStore["backdropGridVertexShader"] = `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      uniform mat4 world;
      varying vec3 vWorldPos;
      void main(void) {
        vec4 worldPos = world * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = worldViewProjection * vec4(position, 1.0);
      }
    `;

  BABYLON.Effect.ShadersStore["backdropGridFragmentShader"] = `
      precision highp float;
      varying vec3 vWorldPos;
      uniform vec3 uBgColor;
      uniform vec3 uLineColor;
      uniform vec3 uCenter;
      uniform float uStep;
      uniform float uLineWidth;
      uniform float uFadeStart;
      uniform float uFadeEnd;
      void main(void) {
        vec2 p = vWorldPos.xz - uCenter.xz;
        vec2 g = abs(fract(p / uStep - 0.5) - 0.5) * uStep;
        vec2 derivative = fwidth(p);
        vec2 lineAA = smoothstep(uLineWidth - derivative, uLineWidth + derivative, g);
        float line = 1.0 - min(lineAA.x, lineAA.y);
        float dist = length(p);
        float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
        float alpha = line * fade;
        gl_FragColor = vec4(uLineColor, alpha);
      }
    `;

  const backdropMat = new BABYLON.ShaderMaterial("backdropMat", scene, { vertex: "backdropGrid", fragment: "backdropGrid" }, {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "world", "uBgColor", "uLineColor", "uCenter", "uStep", "uLineWidth", "uFadeStart", "uFadeEnd"],
    needAlphaBlending: true,
  });

  backdropMat.setColor3("uBgColor", BABYLON.Color3.FromHexString(backdropColor));

  // Lignes discrètes : léger éclaircissement du gris de fond, pas un blanc pur.
  backdropMat.setColor3("uLineColor", BABYLON.Color3.FromHexString(backdropColor).add(new BABYLON.Color3(0.05, 0.05, 0.05)));

  backdropMat.setVector3("uCenter", BABYLON.Vector3.Zero());

  backdropMat.setFloat("uStep", 25);

  backdropMat.setFloat("uLineWidth", 0.5);

  // La grille s'estompe bien avant le bord réel du plan, pour qu'aucune limite ne soit visible.
  backdropMat.setFloat("uFadeStart", 600);

  backdropMat.setFloat("uFadeEnd", 3500);

  backdropMat.backFaceCulling = false;

  // Seules les lignes claires sont opaques : le reste du plan est transparent pour qu'on
  // voie au travers (plateau, grille de modélisation) plutôt qu'un fond plein superposé.
  backdropMat.alpha = 0.999;


  const backdrop = BABYLON.MeshBuilder.CreateGround("backdrop", { width: backdropSize, height: backdropSize }, scene);
  c.backdrop = backdrop;

  backdrop.position.y = -0.05;

  backdrop.isPickable = false;

  backdrop.material = backdropMat;

  // Interface classique : ni grille ni sol (le fond de la page est noir).
  if (flat) backdrop.setEnabled(false);


  // Broadcast camera position on move
  scene.onBeforeRenderObservable.add(() => {
    if (camera && !flat) { // interface classique : pas de ViewCube, personne n'écoute
      window.dispatchEvent(
        new CustomEvent('apex-camera-updated', {
          detail: { alpha: camera.alpha, beta: camera.beta }
        })
      );
    }
  });
}
