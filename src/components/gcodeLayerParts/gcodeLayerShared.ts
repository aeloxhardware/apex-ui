// Issu de la découpe de createGCodeLayer (gcodeLayer.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (gcodeLayerState.ts).
import * as BABYLON from 'babylonjs';
import { DEFAULT_PRINTER_PROFILE } from '@/utils/machineProfile';
import { toolheadModelUrl } from '@/utils/toolheadModels';
import { type LineTypeId } from '../gcodeLineTypes';
import { type PathMesh } from '../gcodeLayerGeometry';

/** Tolérance de visée (pixels) en plus du rayon du cordon, pour sélectionner un point de trajectoire. */
export const PICK_TOLERANCE_PX = 6;

/** Préfixe de nom de tous les maillages du calque (cf. exclusion de la capture du flou). */
export const GCODE_MESH_PREFIX = 'gcode';

/** Le glTF est en mètres, la scène en millimètres. */
const GLTF_TO_MM = 1000;

/** Rotation du modèle de tête autour de l'axe de sa buse (radians) : tel qu'exporté, son axe de
 * basculement B est perpendiculaire à celui de la machine (Z du repère tête, la tête penchant
 * dans le plan radial XY). */
const HEAD_MODEL_YAW = Math.PI / 2;

/**
 * Charge le modèle de la tête (aetheris-4.glb) sous `headNode`, pointe de buse à l'origine du
 * noeud et corps vers +Y local. Le fichier est déjà posé debout sur la buse, mais le centre de
 * la face de sortie de la buse (maillage « NOZZLE origin ») est légèrement décalé de son
 * origine : on recale le modèle sur ce point plutôt que de faire confiance à l'origine.
 * Chargé dans un conteneur et renommé AVANT l'ajout à la scène : Viewport3D trie les maillages
 * par nom dès leur arrivée (capture du flou, sélection de modèles) et doit ignorer ceux du calque.
 */
export async function loadHeadModel(scene: BABYLON.Scene, headNode: BABYLON.TransformNode, isDisposed: () => boolean) {
  const headModelUrl = toolheadModelUrl(DEFAULT_PRINTER_PROFILE);
  if (!headModelUrl) return { loaded: false as const };
  const container = await BABYLON.SceneLoader.LoadAssetContainerAsync('', headModelUrl, scene, null, '.glb');
  if (isDisposed()) {
    container.dispose();
    return { loaded: false as const };
  }
  // Repérés AVANT le renommage ci-dessous (sur le nom d'origine du glTF, jamais reconstruit à
  // partir du nom préfixé/modifié) et renvoyés tels quels à l'appelant (cf. `setFullHead`) : plus
  // sûr qu'un `.includes('NOZZLE')` a posteriori sur des noms qui ont pu être transformés.
  const nozzleMeshes = container.meshes.filter((m) => m.name.includes('NOZZLE'));
  const prefix = `${GCODE_MESH_PREFIX}HeadModel_`;
  for (const mesh of container.meshes) {
    mesh.name = prefix + mesh.name;
    mesh.isPickable = false;
  }
  for (const node of container.transformNodes) node.name = prefix + node.name;

  const model = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}HeadModel`, scene);
  model.scaling.setAll(GLTF_TO_MM);
  for (const node of container.rootNodes) node.parent = model;

  // Pointe de buse mesurée avec le modèle seul (non encore rattaché à la tête) : son repère
  // monde n'est alors que l'échelle, donc la boîte monde est directement en repère tête.
  const nozzle = container.meshes.find((m) => m.name.includes('NOZZLE origin'));
  if (nozzle) {
    const chain: BABYLON.Node[] = [];
    for (let n: BABYLON.Node | null = nozzle; n; n = n.parent) chain.unshift(n);
    for (const n of chain) (n as BABYLON.TransformNode).computeWorldMatrix(true);
    const { minimumWorld: min, maximumWorld: max } = nozzle.getBoundingInfo().boundingBox;
    model.position.set(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
  }
  // Rotation portée par un noeud intermédiaire, APRÈS le recalage : elle tourne autour de l'axe
  // vertical passant par la pointe de buse, qui reste donc à l'origine.
  const mount = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}HeadModelMount`, scene);
  mount.rotation.y = HEAD_MODEL_YAW;
  mount.parent = headNode;
  model.parent = mount;
  container.addAllToScene();
  return { loaded: true as const, nozzleMeshes };
}

export interface PathEntry extends PathMesh {
  type: LineTypeId;
  include: (k: number) => boolean;
  /** Cordon extrudé (bead) : seul recolorable par sommet en mode « colorer par » continu ; travel
   * et wipe gardent toujours leur couleur fixe (aucun critère ne s'applique à un déplacement à vide). */
  isExtrusion: boolean;
  /** Matériau catégoriel (type de ligne) à restaurer quand on revient au mode `lineType` — n'existe
   * que pour les entrées `isExtrusion`. */
  categoryMaterial?: BABYLON.Material;
}

export interface MarkerEntry {
  type: LineTypeId;
  mesh: BABYLON.Mesh;
  at: Uint32Array;
}
