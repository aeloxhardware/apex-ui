// Éclairage propre au tracé G-code, calqué sur la visionneuse d'Orca : une lumière ambiante douce
// plus une lumière « de casque » fixée à la caméra, légèrement au-dessus et à gauche de l'axe de
// visée. Chaque cordon est un tube aplati : face à la caméra il est pleinement éclairé, et ses bords
// haut et bas (normales inclinées) s'assombrissent, d'où le trait sombre net entre deux couches.
// Les lumières ne touchent que les maillages du tracé (masque de calque), jamais le reste de la scène.
import * as BABYLON from 'babylonjs';

/** Bit réservé aux maillages du tracé : hors du masque des caméras (0x0FFFFFFF), donc sans effet sur la visibilité. */
const GCODE_LIGHT_BIT = 0x10000000;
/** Masque de calque d'un maillage du tracé : visible par les caméras, éclairé par les lumières du tracé. */
const GCODE_MESH_LAYER_MASK = 0x0fffffff | GCODE_LIGHT_BIT;

const AMBIENT_INTENSITY = 0.4;
const HEADLIGHT_INTENSITY = 0.62;
/** Décalage de la lumière de casque vers le haut et la gauche de la caméra (fraction de l'axe de visée). */
const HEADLIGHT_UP = 0.35;
const HEADLIGHT_LEFT = 0.25;

export interface GCodeLighting {
  /** Marque un maillage du tracé : éclairé par les lumières du tracé, plus par celle de la scène. */
  tag: (mesh: BABYLON.AbstractMesh) => void;
  /** À rappeler après avoir marqué des maillages : Babylon recalcule alors les lumières de chacun. */
  refresh: () => void;
  dispose: () => void;
}

export function createGCodeLighting(scene: BABYLON.Scene): GCodeLighting {
  const ambient = new BABYLON.HemisphericLight('gcodeAmbient', new BABYLON.Vector3(0, 1, 0), scene);
  ambient.intensity = AMBIENT_INTENSITY;
  ambient.diffuse = BABYLON.Color3.White();
  ambient.groundColor = new BABYLON.Color3(0.45, 0.45, 0.48);
  ambient.specular = BABYLON.Color3.Black();

  const headlight = new BABYLON.DirectionalLight('gcodeHeadlight', new BABYLON.Vector3(0, -0.3, 1), scene);
  headlight.intensity = HEADLIGHT_INTENSITY;
  // Pas de reflet spéculaire : sur des centaines de cordons parallèles il scintille et crée du moiré.
  headlight.specular = BABYLON.Color3.Black();

  const follow = scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera;
    if (!cam) return;
    const forward = cam.getDirection(BABYLON.Axis.Z);
    const up = cam.getDirection(BABYLON.Axis.Y);
    const right = cam.getDirection(BABYLON.Axis.X);
    // La lumière voyage vers l'avant, un peu vers le bas et vers la droite : elle vient du haut gauche.
    headlight.direction.copyFrom(forward).subtractInPlace(up.scale(HEADLIGHT_UP)).addInPlace(right.scale(HEADLIGHT_LEFT)).normalize();
  });

  const sceneLight = () => scene.getLightByName('light');
  const refresh = () => {
    // Réaffecter le masque est ce qui force Babylon à recalculer la liste des lumières de chaque maillage.
    ambient.includeOnlyWithLayerMask = GCODE_LIGHT_BIT;
    headlight.includeOnlyWithLayerMask = GCODE_LIGHT_BIT;
    const base = sceneLight();
    if (base) base.excludeWithLayerMask = GCODE_LIGHT_BIT;
  };
  refresh();

  return {
    tag(mesh) {
      mesh.layerMask = GCODE_MESH_LAYER_MASK;
    },
    refresh,
    dispose() {
      scene.onBeforeRenderObservable.remove(follow);
      const base = sceneLight();
      if (base) base.excludeWithLayerMask = 0;
      ambient.dispose();
      headlight.dispose();
    },
  };
}
