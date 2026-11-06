import * as BABYLON from 'babylonjs';
import { DEFAULT_PRINTER_PROFILE } from '@/utils/machineProfile';
import { toolheadModelUrl } from '@/utils/toolheadModels';
import { GCODE_MESH_PREFIX } from './constants';

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
async function loadHeadModel(scene: BABYLON.Scene, headNode: BABYLON.TransformNode, isDisposed: () => boolean) {
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

export interface LayerHead {
  node: BABYLON.TransformNode;
  /** Tête complète (défaut) ou buse seule — cf. `apex-gcode-show-full-head`. */
  setFullHead(show: boolean): void;
  /** Modèle de la tête échantillonné pour les collisions ; null tant que le modèle n'est pas chargé. */
  getSamples(spacingMm?: number): Float32Array | null;
}

/** Primitives provisoires (buse + corps), remplacées par le vrai modèle une fois chargé. */
function createFallbackHead(scene: BABYLON.Scene, headNode: BABYLON.TransformNode) {
  const nozzleMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}NozzleMat`, scene);
  nozzleMat.diffuseColor = new BABYLON.Color3(1, 0.55, 0.05);
  nozzleMat.emissiveColor = new BABYLON.Color3(0.35, 0.17, 0);
  const nozzle = BABYLON.MeshBuilder.CreateCylinder(`${GCODE_MESH_PREFIX}Nozzle`, { diameterTop: 7, diameterBottom: 0.6, height: 9, tessellation: 20 }, scene);
  nozzle.position.y = 4.5;
  nozzle.material = nozzleMat;
  nozzle.parent = headNode;
  const bodyMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}HeadBodyMat`, scene);
  bodyMat.diffuseColor = new BABYLON.Color3(0.55, 0.58, 0.64);
  bodyMat.alpha = 0.55;
  const body = BABYLON.MeshBuilder.CreateCylinder(`${GCODE_MESH_PREFIX}HeadBody`, { diameter: 14, height: 26, tessellation: 24 }, scene);
  body.position.y = 9 + 13;
  body.material = bodyMat;
  body.parent = headNode;
  nozzle.isPickable = false;
  body.isPickable = false;
  return { nozzle, body };
}

/** Points de la surface de la tête (repère tête, pointe à l'origine), un par cellule de `spacingMm`. */
function sampleHeadSurface(headNode: BABYLON.TransformNode, spacingMm: number): Float32Array {
  headNode.computeWorldMatrix(true);
  const toHead = new BABYLON.Matrix();
  const invHead = headNode.getWorldMatrix().clone().invert();
  const cells = new Map<string, [number, number, number]>();
  const MAX_SAMPLES = 4000;
  const keep = (p: BABYLON.Vector3) => {
    if (cells.size >= MAX_SAMPLES) return;
    const key = `${Math.floor(p.x / spacingMm)},${Math.floor(p.y / spacingMm)},${Math.floor(p.z / spacingMm)}`;
    if (!cells.has(key)) cells.set(key, [p.x, p.y, p.z]);
  };
  const v = new BABYLON.Vector3();
  const a = new BABYLON.Vector3();
  const b = new BABYLON.Vector3();
  const edge = new BABYLON.Vector3();
  for (const mesh of headNode.getChildMeshes()) {
    if (!(mesh instanceof BABYLON.Mesh) || mesh.name.includes('NOZZLE origin')) continue;
    const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    if (!pos) continue;
    mesh.computeWorldMatrix(true);
    mesh.getWorldMatrix().multiplyToRef(invHead, toHead);
    const idx = mesh.getIndices();
    const at = (i: number, out: BABYLON.Vector3) => {
      v.set(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      BABYLON.Vector3.TransformCoordinatesToRef(v, toHead, out);
    };
    if (idx) {
      // Arêtes subdivisées au pas : une tête a de grandes faces dont les sommets seuls laisseraient des trous.
      for (let t = 0; t + 2 < idx.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          at(idx[t + e], a);
          at(idx[t + ((e + 1) % 3)], b);
          const len = BABYLON.Vector3.Distance(a, b);
          const steps = Math.min(40, Math.max(1, Math.ceil(len / spacingMm)));
          for (let s = 0; s <= steps; s++) {
            BABYLON.Vector3.LerpToRef(a, b, s / steps, edge);
            keep(edge);
          }
        }
      }
    } else {
      for (let i = 0; i < pos.length / 3; i++) { at(i, a); keep(a); }
    }
  }
  const out = new Float32Array(cells.size * 3);
  let i = 0;
  for (const p of cells.values()) { out[i++] = p[0]; out[i++] = p[1]; out[i++] = p[2]; }
  return out;
}

/**
 * Tête sous `root` : pointe de buse à l'origine du noeud, corps qui monte le long de +Y local ; le
 * noeud est ensuite orienté pour que ce corps penche de B vers +R. Primitives de repli tant que le
 * vrai modèle n'est pas chargé (et si son chargement échoue).
 */
export function createHead(scene: BABYLON.Scene, root: BABYLON.TransformNode, isDisposed: () => boolean): LayerHead {
  const headNode = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}Head`, scene);
  headNode.parent = root;
  headNode.rotationQuaternion = BABYLON.Quaternion.Identity();

  // Tête complète ou buse seule : simple bascule de visibilité par maillage, « NOZZLE » (nom du
  // modèle réel) faisant office de repère — pas de plan de coupe, chaque maillage garde ses
  // propres faces fermées.
  let fullHead = true;
  const { nozzle, body } = createFallbackHead(scene, headNode);
  // `body` n'a pas de contrepartie « NOZZLE » : c'est lui qu'il faut masquer quand `fullHead` est
  // faux, `nozzle` restant visible dans les deux cas.
  body.setEnabled(fullHead);
  headNode.setEnabled(false);

  // Sur le modèle réel, seuls les maillages de `headModelNozzleMeshes` (repérés une fois pour
  // toutes à leur chargement par `loadHeadModel`) restent visibles ; le reste est désactivé.
  let headModelNozzleMeshes: BABYLON.AbstractMesh[] | null = null;
  let headModelReady = false;
  const applyHeadVisibility = () => {
    if (!headModelNozzleMeshes) {
      // Modèle glTF pas encore chargé (ou échec) : seules les primitives de repli existent.
      if (!body.isDisposed()) body.setEnabled(fullHead);
      return;
    }
    const nozzleSet = new Set<BABYLON.Node>(headModelNozzleMeshes);
    // `isEnabled()` d'un maillage suit toute sa chaîne d'ancêtres (cf. Node.isEnabled) : le loader
    // glTF parente souvent tout sous un noeud technique (`__root__`) — le désactiver, lui, masque
    // aussi ses enfants NOZZLE bien que LEUR propre drapeau reste actif. Jamais désactiver un
    // ancêtre d'un maillage NOZZLE, donc, seulement les branches qui n'en contiennent aucun.
    const ancestorsOfNozzle = new Set<BABYLON.Node>();
    for (const nozzleMesh of headModelNozzleMeshes) {
      for (let n: BABYLON.Node | null = nozzleMesh.parent; n && n !== headNode; n = n.parent) ancestorsOfNozzle.add(n);
    }
    for (const mesh of headNode.getChildMeshes()) {
      if (!nozzleSet.has(mesh) && !ancestorsOfNozzle.has(mesh)) mesh.setEnabled(fullHead);
    }
  };

  loadHeadModel(scene, headNode, isDisposed)
    .then((result) => {
      if (!result.loaded) return;
      nozzle.dispose(false, true);
      body.dispose(false, true);
      headModelNozzleMeshes = result.nozzleMeshes;
      headModelReady = true;
      applyHeadVisibility();
    })
    .catch((err) => console.warn('Modèle de tête G-code non chargé, primitives conservées :', err));

  return {
    node: headNode,
    setFullHead(show) {
      fullHead = show;
      applyHeadVisibility();
    },
    getSamples: (spacingMm = 3) => (headModelReady ? sampleHeadSurface(headNode, spacingMm) : null),
  };
}
