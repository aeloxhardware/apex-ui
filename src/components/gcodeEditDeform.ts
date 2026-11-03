import * as BABYLON from 'babylonjs';

/**
 * Déformation en direct des cordons pendant l'édition (cf. CLAUDE.md « G-code editing ») : le noyau
 * C++ calcule une fois par pose de nœud le poids de chaque point ; il est copié en attribut par
 * sommet, et c'est le vertex shader qui déplace le cordon, p' = p + w·T, avec T en uniforme. Aucune
 * donnée par image hors de cet uniforme : le coût ne dépend pas de la taille de la zone influencée.
 * Le noyau reste seul maître des valeurs écrites dans le G-code (validées au relâchement).
 *
 * Glissement le long de l'empilement (mode « empilement », cf. edit_kernel.hpp) : chaque sommet
 * avance le long de l'axe de tête de son point (3e attribut) de w·τ, τ = T·axe du nœud ; la part
 * latérale de T ne déplace que l'intérieur (pas les coques).
 *
 * L'objet garde sa forme : les points de coque glissent sur leur paroi. Leur normale de paroi est un
 * second attribut ; la composante du déplacement selon elle est retirée (même formule que le noyau,
 * plan tangent), au prorata de sa longueur là où elle est interpolée entre coque et intérieur.
 *
 * Le même poids teinte le cordon d'une seule teinte violette, d'autant plus marquée que le poids est
 * fort (jamais le dégradé bleu→rouge des modes « colorer par », réservé à ceux-ci).
 *
 * Drapeaux par sommet, dans le MÊME attribut que le poids (valeur = poids + 2 × drapeaux, le poids est
 * dans [0, 1]) : aucun attribut de plus, donc aucune mémoire de plus par sommet. Bits (EDIT_FLAG_*) :
 * limites ou collision (rouge vif, réservé aux alertes), zone verrouillée (gris hachuré), dépôt qui
 * serait rogné, épaisseur de couche modifiée (bleu : plus fine, orange : plus épaisse, rouge hachuré :
 * hors des bornes). Les attributs de glissement et d'axe ne sont alloués que pendant un nœud actif.
 */

export const EDIT_FLAG_VIOLATION = 1;    // hors des limites de la machine
export const EDIT_FLAG_COLLISION = 2;    // collision de la tête
export const EDIT_FLAG_LOCKED = 4;       // matière verrouillée
export const EDIT_FLAG_TRIM = 8;         // dépôt qui serait rogné
export const EDIT_FLAG_THINNER = 16;     // couche plus fine
export const EDIT_FLAG_THICKER = 32;     // couche plus épaisse
export const EDIT_FLAG_BOUNDS = 64;      // épaisseur hors bornes

export const EDIT_WEIGHT_KIND = 'apexEditWeight';
export const EDIT_SLIDE_KIND = 'apexEditSlide';
export const EDIT_AXIS_KIND = 'apexEditAxis';

/** Teinte de l'influence (violet) et opacité maximale du mélange. */
export const EDIT_TINT = new BABYLON.Color3(0.62, 0.32, 1.0);
export const EDIT_TINT_MAX = 0.65;

/**
 * État partagé par tous les matériaux de cordon, repère du plateau Babylon :
 * p' = pivot + R(w·angle, axe)(p − pivot) + w·translation (formule du noyau, cf. CLAUDE.md).
 * La rotation suit la formule de Rodrigues écrite sur les composantes Babylon.
 */
export const editDeformState = {
  translation: new BABYLON.Vector3(),
  pivot: new BABYLON.Vector3(),
  axis: new BABYLON.Vector3(0, 1, 0),
  angle: 0,
  /** Mode « empilement » : axe de tête du nœud (local) ; nul hors de ce mode. */
  stackAxis: new BABYLON.Vector3(),
  /** Teinte de l'influence affichée (0 : masquée). */
  tint: 1,
};

class EditDeformPlugin extends BABYLON.MaterialPluginBase {
  constructor(material: BABYLON.Material) {
    super(material, 'ApexEditDeform', 200, { APEX_EDIT_DEFORM: false, APEX_EDIT_SLIDE: false }, true, true);
  }

  getClassName() {
    return 'ApexEditDeformPlugin';
  }

  isCompatible(shaderLanguage: BABYLON.ShaderLanguage) {
    return shaderLanguage === BABYLON.ShaderLanguage.GLSL;
  }

  prepareDefines(defines: BABYLON.MaterialDefines, _scene: BABYLON.Scene, mesh: BABYLON.AbstractMesh) {
    defines.APEX_EDIT_DEFORM = mesh.isVerticesDataPresent(EDIT_WEIGHT_KIND);
    defines.APEX_EDIT_SLIDE = defines.APEX_EDIT_DEFORM && mesh.isVerticesDataPresent(EDIT_SLIDE_KIND);
  }

  getAttributes(attributes: string[], _scene: BABYLON.Scene, mesh: BABYLON.AbstractMesh) {
    if (mesh.isVerticesDataPresent(EDIT_WEIGHT_KIND)) attributes.push(EDIT_WEIGHT_KIND);
    if (mesh.isVerticesDataPresent(EDIT_SLIDE_KIND)) attributes.push(EDIT_SLIDE_KIND, EDIT_AXIS_KIND);
  }

  getUniforms() {
    return {
      ubo: [
        { name: 'apexEditTranslation', size: 3, type: 'vec3' },
        { name: 'apexEditPivot', size: 3, type: 'vec3' },
        { name: 'apexEditAxisAngle', size: 4, type: 'vec4' },
        { name: 'apexEditStackAxis', size: 3, type: 'vec3' },
        { name: 'apexEditTint', size: 4, type: 'vec4' },
      ],
      vertex: `#ifdef APEX_EDIT_DEFORM
        uniform vec3 apexEditTranslation;
        uniform vec3 apexEditPivot;
        uniform vec4 apexEditAxisAngle;
        uniform vec3 apexEditStackAxis;
      #endif`,
      fragment: `#ifdef APEX_EDIT_DEFORM
        uniform vec4 apexEditTint;
      #endif`,
    };
  }

  bindForSubMesh(uniformBuffer: BABYLON.UniformBuffer) {
    const { translation: t, pivot: p, axis: a, angle } = editDeformState;
    uniformBuffer.updateFloat3('apexEditTranslation', t.x, t.y, t.z);
    uniformBuffer.updateFloat3('apexEditPivot', p.x, p.y, p.z);
    uniformBuffer.updateFloat4('apexEditAxisAngle', a.x, a.y, a.z, angle);
    const sa = editDeformState.stackAxis;
    uniformBuffer.updateFloat3('apexEditStackAxis', sa.x, sa.y, sa.z);
    uniformBuffer.updateFloat4('apexEditTint', EDIT_TINT.r, EDIT_TINT.g, EDIT_TINT.b, EDIT_TINT_MAX * editDeformState.tint);
  }

  getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef APEX_EDIT_DEFORM
          attribute float ${EDIT_WEIGHT_KIND};
          #ifdef APEX_EDIT_SLIDE
            attribute vec3 ${EDIT_SLIDE_KIND};
            attribute vec3 ${EDIT_AXIS_KIND};
          #endif
          varying float vApexEditWeight;
          flat varying float vApexEditFlags;
          vec3 apexEditRotate(vec3 v, vec3 k, float a) {
            float c = cos(a), s = sin(a);
            return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
          }
          // Valeur d'attribut = poids (dans [0, 1]) + 2 x drapeaux. Les drapeaux sont en flat : interpolés,
          // leurs bits se mélangeraient (une valeur entre 0 et 4 passerait par 1 et 2 = alertes).
          float apexEditWeightOf(float raw) { return raw - 2.0 * floor(raw * 0.5); }
        #endif`,
        CUSTOM_VERTEX_UPDATE_POSITION: `#ifdef APEX_EDIT_DEFORM
          {
            float apexW = apexEditWeightOf(${EDIT_WEIGHT_KIND});
            vApexEditFlags = floor(${EDIT_WEIGHT_KIND} * 0.5);
            float apexA = apexW * apexEditAxisAngle.w;
            // Rotation, puis glissement des coques sur leur paroi (au prorata de la normale).
            vec3 apexD = apexEditPivot + apexEditRotate(positionUpdated - apexEditPivot, apexEditAxisAngle.xyz, apexA)
              - positionUpdated;
            vec3 apexT = apexW * apexEditTranslation;
            #ifdef APEX_EDIT_SLIDE
              float apexL = length(${EDIT_SLIDE_KIND});
              float apexShell = min(apexL, 1.0);
              vec3 apexN = apexL > 1e-4 ? ${EDIT_SLIDE_KIND} / apexL : vec3(0.0);
              apexD -= dot(apexD, apexN) * apexN * apexShell;
              if (dot(apexEditStackAxis, apexEditStackAxis) > 0.5) {
                // Empilement : le long de l'axe du point ; latéral pour l'intérieur seulement.
                float apexTau = dot(apexEditTranslation, apexEditStackAxis);
                vec3 apexLat = apexEditTranslation - apexTau * apexEditStackAxis;
                float apexAL = length(${EDIT_AXIS_KIND});
                vec3 apexAxis = apexAL > 1e-6 ? ${EDIT_AXIS_KIND} / apexAL : apexEditStackAxis;
                apexD += apexW * (apexTau * apexAxis + (1.0 - apexShell) * apexLat);
              } else {
                apexD += apexT - dot(apexT, apexN) * apexN * apexShell;
              }
            #else
              apexD += apexT;
            #endif
            positionUpdated += apexD;
            vApexEditWeight = apexW;
          }
        #endif`,
        CUSTOM_VERTEX_UPDATE_NORMAL: `#ifdef APEX_EDIT_DEFORM
          normalUpdated = apexEditRotate(normalUpdated, apexEditAxisAngle.xyz, apexEditWeightOf(${EDIT_WEIGHT_KIND}) * apexEditAxisAngle.w);
        #endif`,
      };
    }
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef APEX_EDIT_DEFORM
          varying float vApexEditWeight;
          flat varying float vApexEditFlags;
          bool apexEditFlag(float bit) { return mod(floor(vApexEditFlags / bit + 0.01), 2.0) > 0.5; }
        #endif`,
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef APEX_EDIT_DEFORM
          color.rgb = mix(color.rgb, apexEditTint.rgb, clamp(vApexEditWeight, 0.0, 1.0) * apexEditTint.a);
          if (vApexEditFlags > 0.5) {
            // Hachures larges (période d'environ 1,3 mm) : plus fines, elles battraient avec l'empilement des couches.
            float apexStripe = step(0.5, fract((vPositionW.x + vPositionW.y + vPositionW.z) * 0.75));
            // Épaisseur de couche modifiée : plus fine (bleu), plus épaisse (orange), hors bornes (rouge hachuré).
            if (apexEditFlag(16.0)) color.rgb = mix(color.rgb, vec3(0.22, 0.58, 1.0), 0.6);
            if (apexEditFlag(32.0)) color.rgb = mix(color.rgb, vec3(1.0, 0.62, 0.16), 0.6);
            if (apexEditFlag(64.0)) color.rgb = mix(color.rgb, mix(vec3(0.55, 0.05, 0.04), vec3(1.0, 0.18, 0.1), apexStripe), 0.85);
            // Matière verrouillée : gris hachuré.
            if (apexEditFlag(4.0)) color.rgb = mix(color.rgb, mix(vec3(0.26, 0.27, 0.30), vec3(0.62, 0.63, 0.67), apexStripe), 0.88);
            // Dépôt qui serait rogné : rouge sombre hachuré.
            if (apexEditFlag(8.0)) color.rgb = mix(color.rgb, mix(vec3(0.30, 0.03, 0.03), vec3(0.85, 0.12, 0.08), apexStripe), 0.75);
            // Alertes (limites de la machine, collision) : rouge vif, réservé à cet usage.
            if (apexEditFlag(1.0) || apexEditFlag(2.0)) color.rgb = mix(color.rgb, vec3(1.0, 0.05, 0.05), 0.93);
          }
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
