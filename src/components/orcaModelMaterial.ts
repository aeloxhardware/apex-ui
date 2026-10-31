/**
 * Rendu des modèles à la OrcaSlicer : ombrage de Gouraud à deux sources directionnelles, fixées à la caméra.
 *
 * Portage vers Babylon.js des shaders `gouraud.vs` / `gouraud.fs` d'OrcaSlicer (`resources/shaders/110/`,
 * AGPL-3.0, https://github.com/OrcaSlicer/OrcaSlicer ; issus de PrusaSlicer, AGPL-3.0). Sont repris à l'identique :
 * la correction d'intensité 0,6, la lumière du haut (direction (-0,6 ; 0,6 ; 1)/1,31, diffuse 0,8, spéculaire 0,125,
 * brillance 20), la lumière de face (direction (1 ; 0,2 ; 1)/1,43, diffuse 0,3, sans spéculaire), l'ambiante 0,3, et
 * la formule finale `spéculaire + couleur × intensité`, calculée par sommet. Non repris : détection de pente,
 * hors-volume d'impression, plans de coupe. Crédit : `src/utils/credits.ts`.
 *
 * Repère : Orca éclaire dans l'espace œil de OpenGL (Z vers l'observateur) ; Babylon est main gauche (Z s'éloigne).
 * Les directions des lumières ont donc leur composante Z inversée.
 */
import * as BABYLON from 'babylonjs';

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 worldView;
uniform mat4 worldViewProjection;
uniform mat3 viewNormalMatrix;
varying vec2 intensity;

const float INTENSITY_CORRECTION = 0.6;
const vec3 LIGHT_TOP_DIR = vec3(-0.4574957, 0.4574957, -0.7624929);
const float LIGHT_TOP_DIFFUSE = 0.8 * INTENSITY_CORRECTION;
const float LIGHT_TOP_SPECULAR = 0.125 * INTENSITY_CORRECTION;
const float LIGHT_TOP_SHININESS = 20.0;
const vec3 LIGHT_FRONT_DIR = vec3(0.6985074, 0.1397015, -0.6985074);
const float LIGHT_FRONT_DIFFUSE = 0.3 * INTENSITY_CORRECTION;
const float INTENSITY_AMBIENT = 0.3;

void main() {
  vec3 eyeNormal = normalize(viewNormalMatrix * normal);
  float NdotL = max(dot(eyeNormal, LIGHT_TOP_DIR), 0.0);
  intensity.x = INTENSITY_AMBIENT + NdotL * LIGHT_TOP_DIFFUSE;
  vec4 eyePosition = worldView * vec4(position, 1.0);
  intensity.y = LIGHT_TOP_SPECULAR * pow(max(dot(-normalize(eyePosition.xyz), reflect(-LIGHT_TOP_DIR, eyeNormal)), 0.0), LIGHT_TOP_SHININESS);
  NdotL = max(dot(eyeNormal, LIGHT_FRONT_DIR), 0.0);
  intensity.x += NdotL * LIGHT_FRONT_DIFFUSE;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
uniform vec3 color;
varying vec2 intensity;

void main() {
  gl_FragColor = vec4(vec3(intensity.y) + color * intensity.x, 1.0);
}
`;

BABYLON.Effect.ShadersStore['orcaGouraudVertexShader'] = VERTEX;
BABYLON.Effect.ShadersStore['orcaGouraudFragmentShader'] = FRAGMENT;

export function createOrcaModelMaterial(name: string, scene: BABYLON.Scene, color: BABYLON.Color3): BABYLON.ShaderMaterial {
  const material = new BABYLON.ShaderMaterial(name, scene, { vertex: 'orcaGouraud', fragment: 'orcaGouraud' }, {
    attributes: ['position', 'normal'],
    uniforms: ['worldView', 'worldViewProjection', 'viewNormalMatrix', 'color'],
  });
  material.setColor3('color', color);
  // Les fiches du modèle (pastille de couleur de la liste, éditeur de texture) lisent `diffuseColor` : on l'expose.
  Object.assign(material, { diffuseColor: color });
  // Comme avant : les STL aux normales inversées restent visibles (cf. l'import dans Viewport3D).
  material.backFaceCulling = false;

  // Matrice des normales en espace œil, par maillage : transposée de l'inverse de worldView (reste juste avec une
  // mise à l'échelle non uniforme). Babylon range les matrices en lignes ; GLSL lit les colonnes, d'où la copie directe.
  const worldView = new BABYLON.Matrix();
  const inverse = new BABYLON.Matrix();
  const normalMatrix = new BABYLON.Matrix();
  const packed = new Float32Array(9);
  material.onBindObservable.add((mesh) => {
    const effect = material.getEffect();
    if (!effect) return;
    mesh.getWorldMatrix().multiplyToRef(scene.getViewMatrix(), worldView);
    worldView.invertToRef(inverse);
    inverse.transposeToRef(normalMatrix);
    const m = normalMatrix.m;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) packed[row * 3 + col] = m[row * 4 + col];
    effect.setMatrix3x3('viewNormalMatrix', packed);
  });
  return material;
}
