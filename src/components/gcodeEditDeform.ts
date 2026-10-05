import * as BABYLON from 'babylonjs';

/**
 * Déformation en direct des cordons pendant l'édition (cf. CLAUDE.md « G-code editing ») : le noyau
 * C++ calcule une fois par pose de nœud le poids de chaque point ; il est copié en attribut par
 * sommet, et c'est le vertex shader qui déplace le cordon, p' = p + w·T, avec T en uniforme. Aucune
 * donnée par image hors de cet uniforme : le coût ne dépend pas de la taille de la zone influencée.
 * Le noyau reste seul maître des valeurs écrites dans le G-code (validées au relâchement).
 *
 * Le même poids teinte le cordon d'une seule teinte violette, d'autant plus marquée que le poids est
 * fort (jamais le dégradé bleu→rouge des modes « colorer par », réservé à ceux-ci).
 */

export const EDIT_WEIGHT_KIND = 'apexEditWeight';

/** Teinte de l'influence (violet) et opacité maximale du mélange. */
export const EDIT_TINT = new BABYLON.Color3(0.62, 0.32, 1.0);
export const EDIT_TINT_MAX = 0.65;

/** État partagé par tous les matériaux de cordon : translation en repère du plateau Babylon. */
export const editDeformState = {
  translation: new BABYLON.Vector3(),
  /** Teinte de l'influence affichée (0 : masquée). */
  tint: 1,
};

class EditDeformPlugin extends BABYLON.MaterialPluginBase {
  constructor(material: BABYLON.Material) {
    super(material, 'ApexEditDeform', 200, { APEX_EDIT_DEFORM: false }, true, true);
  }

  getClassName() {
    return 'ApexEditDeformPlugin';
  }

  isCompatible(shaderLanguage: BABYLON.ShaderLanguage) {
    return shaderLanguage === BABYLON.ShaderLanguage.GLSL;
  }

  prepareDefines(defines: BABYLON.MaterialDefines, _scene: BABYLON.Scene, mesh: BABYLON.AbstractMesh) {
    defines.APEX_EDIT_DEFORM = mesh.isVerticesDataPresent(EDIT_WEIGHT_KIND);
  }

  getAttributes(attributes: string[], _scene: BABYLON.Scene, mesh: BABYLON.AbstractMesh) {
    if (mesh.isVerticesDataPresent(EDIT_WEIGHT_KIND)) attributes.push(EDIT_WEIGHT_KIND);
  }

  getUniforms() {
    return {
      ubo: [
        { name: 'apexEditTranslation', size: 3, type: 'vec3' },
        { name: 'apexEditTint', size: 4, type: 'vec4' },
      ],
      vertex: `#ifdef APEX_EDIT_DEFORM
        uniform vec3 apexEditTranslation;
      #endif`,
      fragment: `#ifdef APEX_EDIT_DEFORM
        uniform vec4 apexEditTint;
      #endif`,
    };
  }

  bindForSubMesh(uniformBuffer: BABYLON.UniformBuffer) {
    const t = editDeformState.translation;
    uniformBuffer.updateFloat3('apexEditTranslation', t.x, t.y, t.z);
    uniformBuffer.updateFloat4('apexEditTint', EDIT_TINT.r, EDIT_TINT.g, EDIT_TINT.b, EDIT_TINT_MAX * editDeformState.tint);
  }

  getCustomCode(shaderType: string) {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef APEX_EDIT_DEFORM
          attribute float ${EDIT_WEIGHT_KIND};
          varying float vApexEditWeight;
        #endif`,
        CUSTOM_VERTEX_UPDATE_POSITION: `#ifdef APEX_EDIT_DEFORM
          positionUpdated += ${EDIT_WEIGHT_KIND} * apexEditTranslation;
          vApexEditWeight = ${EDIT_WEIGHT_KIND};
        #endif`,
      };
    }
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef APEX_EDIT_DEFORM
          varying float vApexEditWeight;
        #endif`,
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef APEX_EDIT_DEFORM
          color.rgb = mix(color.rgb, apexEditTint.rgb, clamp(vApexEditWeight, 0.0, 1.0) * apexEditTint.a);
        #endif`,
      };
    }
    return null;
  }
}

const attached = new WeakSet<BABYLON.Material>();

/** Ajoute (une fois) la déformation d'édition à un matériau de cordon. */
export function attachEditDeform(material: BABYLON.Material) {
  if (attached.has(material)) return;
  attached.add(material);
  new EditDeformPlugin(material);
}
