import * as BABYLON from 'babylonjs';
import { LINE_TYPES, type LineTypeId } from '../gcodeLineTypes';
import { attachEditDeform } from '../gcodeEditDeform';
import { GCODE_MESH_PREFIX } from './constants';

export interface LayerMaterials {
  colors: Record<LineTypeId, BABYLON.Color3>;
  /** Un matériau par type de ligne extrudé (couleur de la légende). */
  beadMaterials: Map<LineTypeId, BABYLON.StandardMaterial>;
  /** Matériau partagé des cordons en mode « colorer par » continu : couleur par sommet, sans éclairage. */
  vertexColorBeadMat: BABYLON.StandardMaterial;
  /** Onglet Édition : cordons d'un gris neutre éclairé. */
  neutralBeadMat: BABYLON.StandardMaterial;
  /** Tronçon vivant en mode continu : couleur plate recalculée chaque image. */
  liveColorByMat: BABYLON.StandardMaterial;
  offPlateMat: BABYLON.StandardMaterial;
  offPlateHazardMat: BABYLON.ShaderMaterial;
}

/**
 * Un matériau par type de ligne extrudé ; seul l'éclairage varie le long du cordon. Faces arrière
 * dessinées pour ne pas dépendre du sens des triangles, les normales explicites (vers l'extérieur)
 * donnant l'éclairage.
 */
function createBeadMaterials(scene: BABYLON.Scene, colors: Record<LineTypeId, BABYLON.Color3>) {
  const beadMaterials = new Map<LineTypeId, BABYLON.StandardMaterial>();
  for (const t of LINE_TYPES) {
    if (t.kind !== 'extrusion') continue;
    const mat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}BeadMat_${t.id}`, scene);
    mat.diffuseColor = colors[t.id];
    mat.emissiveColor = colors[t.id].scale(0.18);
    mat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
    mat.specularPower = 48;
    mat.backFaceCulling = false;
    attachEditDeform(mat);
    beadMaterials.set(t.id, mat);
  }
  // Couleur par sommet (VertexData.colors), éclairage désactivé pour qu'elle ne soit pas teintée —
  // remplace, maillage par maillage, le matériau par type ci-dessus sans reconstruire la géométrie.
  const vertexColorBeadMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}BeadMatVertexColor`, scene);
  vertexColorBeadMat.disableLighting = true;
  vertexColorBeadMat.emissiveColor = BABYLON.Color3.White();
  vertexColorBeadMat.backFaceCulling = false;
  attachEditDeform(vertexColorBeadMat);
  // Onglet Édition : gris neutre éclairé (le relief se lit, la teinte violette des zones
  // contraintes par les nœuds ressort), quel que soit le mode « colorer par ».
  const neutralBeadMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}BeadMatNeutral`, scene);
  neutralBeadMat.diffuseColor = new BABYLON.Color3(0.62, 0.63, 0.65);
  neutralBeadMat.emissiveColor = new BABYLON.Color3(0.07, 0.07, 0.08);
  neutralBeadMat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
  neutralBeadMat.specularPower = 48;
  neutralBeadMat.backFaceCulling = false;
  attachEditDeform(neutralBeadMat);
  const liveColorByMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}LiveBeadMatColorBy`, scene);
  liveColorByMat.disableLighting = true;
  liveColorByMat.backFaceCulling = false;
  return { beadMaterials, vertexColorBeadMat, neutralBeadMat, liveColorByMat };
}

// Clignotement pendant une conversion en cours (cf. setOffPlateBlinking) : bandes « chantier »
// rouge/jaune en diagonale, défilant dans l'espace monde (comme des puces qui se déplacent),
// plutôt qu'une simple pulsation de couleur uniforme — motif procédural (pas de texture/UV
// requis) basé sur vPositionW.
const HAZARD_VERTEX_SHADER = `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    uniform mat4 worldViewProjection;
    uniform mat4 world;
    varying vec3 vPositionW;
    varying vec3 vNormalW;
    void main(void) {
        gl_Position = worldViewProjection * vec4(position, 1.0);
        vPositionW = vec3(world * vec4(position, 1.0));
        vNormalW = normalize(vec3(world * vec4(normal, 0.0)));
    }
  `;
const HAZARD_FRAGMENT_SHADER = `
    precision highp float;
    varying vec3 vPositionW;
    varying vec3 vNormalW;
    uniform float time;
    void main(void) {
        // Ruban de signalisation chantier : jaune citron vif / rouge sang profond, bandes larges et
        // nettes à 45°.
        vec3 red = vec3(0.65, 0.03, 0.02);
        vec3 yellow = vec3(0.98, 0.92, 0.05);
        // Diagonale à 45° dans le plan du plateau (X + Z), défilée par time pour l'effet de
        // déplacement continu (comme des puces qui glissent).
        float diag = (vPositionW.x + vPositionW.z) * 0.22 - time;
        // Bande nette (pas de dégradé lissé, pour l'aspect « bande de signalisation ») : la partie
        // fractionnaire de diag bascule rouge/jaune à mi-cycle.
        float band = step(0.5, fract(diag));
        vec3 stripeColor = mix(red, yellow, band);
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float diffuse = max(dot(normalize(vNormalW), lightDir), 0.6);
        gl_FragColor = vec4(stripeColor * diffuse + stripeColor * 0.35, 1.0);
    }
  `;

/** Traits hors plateau : cordon doublé rouge, rendu devant l'original (zOffset), et sa variante « chantier ». */
function createOffPlateMaterials(scene: BABYLON.Scene) {
  const offPlateMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}OffPlateMat`, scene);
  offPlateMat.diffuseColor = new BABYLON.Color3(1, 0.12, 0.12);
  offPlateMat.emissiveColor = new BABYLON.Color3(0.75, 0.05, 0.05);
  offPlateMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
  offPlateMat.backFaceCulling = false;
  offPlateMat.zOffset = -2;

  BABYLON.Effect.ShadersStore["offPlateHazardVertexShader"] = HAZARD_VERTEX_SHADER;
  BABYLON.Effect.ShadersStore["offPlateHazardFragmentShader"] = HAZARD_FRAGMENT_SHADER;
  const offPlateHazardMat = new BABYLON.ShaderMaterial(
    `${GCODE_MESH_PREFIX}OffPlateHazardMat`, scene,
    { vertex: "offPlateHazard", fragment: "offPlateHazard" },
    { attributes: ["position", "normal"], uniforms: ["worldViewProjection", "world", "time"] },
  );
  offPlateHazardMat.backFaceCulling = false;
  offPlateHazardMat.zOffset = -2;
  return { offPlateMat, offPlateHazardMat };
}

export function createLayerMaterials(scene: BABYLON.Scene): LayerMaterials {
  const colors = Object.fromEntries(
    LINE_TYPES.map((t) => [t.id, BABYLON.Color3.FromHexString(t.color)]),
  ) as Record<LineTypeId, BABYLON.Color3>;
  return { colors, ...createBeadMaterials(scene, colors), ...createOffPlateMaterials(scene) };
}
