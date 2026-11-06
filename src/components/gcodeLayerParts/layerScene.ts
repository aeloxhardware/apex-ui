// Issu de la découpe de createGCodeLayer (gcodeLayer.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (gcodeLayerState.ts).
import * as BABYLON from 'babylonjs';
import { LINE_TYPES, type LineTypeId } from '../gcodeLineTypes';
import { attachEditDeform } from '../gcodeEditDeform';
import { TUBE_SIDES } from '../gcodeLayerGeometry';
import { GCODE_MESH_PREFIX, loadHeadModel } from './gcodeLayerShared';
import type { GCodeLayerState } from './gcodeLayerState';

function setupRoot(st: GCodeLayerState) {
  const { parent, scene } = st;
  const root = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}Root`, scene);
  root.parent = parent;
  root.setEnabled(false);

  // Repère tournant du plateau : toute la matière déposée en est enfant.
  const plateNode = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}Plate`, scene);
  plateNode.parent = root;

  // Tête : pointe de buse à l'origine du noeud, corps qui monte le long de +Y local ; le noeud
  // est ensuite orienté pour que ce corps penche de B vers +R. Primitives provisoires, remplacées
  // par le vrai modèle (loadHeadModel) une fois chargé ; gardées en repli s'il échoue.
  const headNode = new BABYLON.TransformNode(`${GCODE_MESH_PREFIX}Head`, scene);
  headNode.parent = root;
  headNode.rotationQuaternion = BABYLON.Quaternion.Identity();

  // Tête complète ou buse seule (cf. `setFullHead`) : simple bascule de visibilité par maillage,
  // « NOZZLE » (nom du modèle réel, cf. loadHeadModel) faisant office de repère — pas de plan de
  // coupe : plus simple, et jamais de coquille ouverte à boucher puisque chaque maillage garde ses
  // propres faces fermées, jamais tronquées à mi-hauteur.
  st.fullHead = true;

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
  Object.assign(st, { root, plateNode, headNode, nozzle, bodyMat, body });
}

function setupApplyHeadVisibility(st: GCodeLayerState) {
  const { body, bodyMat, headNode, nozzle } = st;
  body.material = bodyMat;
  body.parent = headNode;
  nozzle.isPickable = false;
  body.isPickable = false;
  // `body` (le corps de la tête) n'a pas de contrepartie « NOZZLE » : c'est lui qu'il faut masquer
  // quand `fullHead` est faux, `nozzle` restant visible dans les deux cas (repli du modèle glTF,
  // où seuls les maillages nommés NOZZLE restent visibles — cf. le `.then` ci-dessous).
  body.setEnabled(st.fullHead);
  headNode.setEnabled(false);

  // Tête complète ou buse seule (cf. `setFullHead`), applicable aux deux états possibles de la
  // tête : primitives de repli (nozzle/body, avant chargement du modèle ou s'il échoue) ou vrai
  // modèle glTF (après, cf. le `.then` ci-dessous) — jamais les deux en même temps, l'un dispose
  // l'autre. Sur le modèle réel, seuls les maillages de `headModelNozzleMeshes` (repérés une fois
  // pour toutes à leur chargement par `loadHeadModel`, cf. plus bas — jamais reconstruits ici par
  // un `.includes('NOZZLE')` sur un nom déjà transformé) restent visibles ; le reste (corps,
  // radiateur, ventilateur, connecteurs…) est simplement désactivé — jamais de plan de coupe ni de
  // bouchon à poser, chaque maillage garde ses propres faces, déjà fermées, intactes.
  st.headModelNozzleMeshes = null;
  st.headModelReady = false;
  const applyHeadVisibility = () => {
    if (!st.headModelNozzleMeshes) {
      // Modèle glTF pas encore chargé (ou échec) : seules les primitives de repli existent.
      if (!body.isDisposed()) body.setEnabled(st.fullHead);
      return;
    }
    const nozzleSet = new Set<BABYLON.Node>(st.headModelNozzleMeshes);
    // `isEnabled()` d'un maillage suit toute sa chaîne d'ancêtres (cf. Node.isEnabled) : le loader
    // glTF parente souvent tout sous un noeud technique (`__root__`) — le désactiver, lui, masque
    // aussi ses enfants NOZZLE bien que LEUR propre drapeau reste actif. Jamais désactiver un
    // ancêtre d'un maillage NOZZLE, donc, seulement les branches qui n'en contiennent aucun.
    const ancestorsOfNozzle = new Set<BABYLON.Node>();
    for (const nozzleMesh of st.headModelNozzleMeshes) {
      for (let n: BABYLON.Node | null = nozzleMesh.parent; n && n !== headNode; n = n.parent) ancestorsOfNozzle.add(n);
    }
    for (const mesh of headNode.getChildMeshes()) {
      if (!nozzleSet.has(mesh) && !ancestorsOfNozzle.has(mesh)) mesh.setEnabled(st.fullHead);
    }
  };

  st.disposed = false;
  Object.assign(st, { applyHeadVisibility });
}

function setupColors(st: GCodeLayerState) {
  const { applyHeadVisibility, body, headNode, nozzle, scene } = st;
  loadHeadModel(scene, headNode, () => st.disposed)
    .then((result) => {
      if (!result.loaded) return;
      nozzle.dispose(false, true);
      body.dispose(false, true);
      st.headModelNozzleMeshes = result.nozzleMeshes;
      st.headModelReady = true;
      applyHeadVisibility();
    })
    .catch((err) => console.warn('Modèle de tête G-code non chargé, primitives conservées :', err));

  // Un matériau par type de ligne extrudé (couleur de la légende) ; seul l'éclairage varie le long
  // du cordon. Faces arrière dessinées pour ne pas dépendre du sens des triangles, les normales
  // explicites (vers l'extérieur) donnant l'éclairage.
  const colors = Object.fromEntries(
    LINE_TYPES.map((t) => [t.id, BABYLON.Color3.FromHexString(t.color)]),
  ) as Record<LineTypeId, BABYLON.Color3>;
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
  // Matériau partagé des cordons en mode « colorer par » continu (cf. setColorBy) : couleur par
  // sommet (VertexData.colors), éclairage désactivé pour qu'elle ne soit pas teintée — remplace,
  // maillage par maillage, le matériau par type ci-dessus sans reconstruire la géométrie.
  const vertexColorBeadMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}BeadMatVertexColor`, scene);
  vertexColorBeadMat.disableLighting = true;
  vertexColorBeadMat.emissiveColor = BABYLON.Color3.White();
  vertexColorBeadMat.backFaceCulling = false;
  attachEditDeform(vertexColorBeadMat);
  // Onglet Édition : cordons d'un gris neutre éclairé (le relief se lit, la teinte violette des
  // zones contraintes par les nœuds ressort), quel que soit le mode « colorer par ».
  const neutralBeadMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}BeadMatNeutral`, scene);
  neutralBeadMat.diffuseColor = new BABYLON.Color3(0.62, 0.63, 0.65);
  neutralBeadMat.emissiveColor = new BABYLON.Color3(0.07, 0.07, 0.08);
  Object.assign(st, { colors, beadMaterials, vertexColorBeadMat, neutralBeadMat });
}

function setupEditNeutral(st: GCodeLayerState) {
  const { neutralBeadMat, scene } = st;
  neutralBeadMat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
  neutralBeadMat.specularPower = 48;
  neutralBeadMat.backFaceCulling = false;
  attachEditDeform(neutralBeadMat);
  st.editNeutral = false;
  // Tronçon vivant en mode continu (cf. updateLive) : couleur plate recalculée chaque image, trop
  // petit pour justifier une mise à jour de couleurs par sommet à chaque frame (cf. plan §3).
  const liveColorByMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}LiveBeadMatColorBy`, scene);
  liveColorByMat.disableLighting = true;
  liveColorByMat.backFaceCulling = false;

  // Tronçon « vivant » : portion du mouvement en cours entre la dernière jonction déjà dessinée
  // (préfixe des maillages, au sous-segment près) et la position exacte de la buse, recalculée à
  // chaque image — le tracé avance en continu sous la buse au lieu d'apparaître d'un bloc à la fin
  // de chaque mouvement (ou sous-segment), sans alourdir la géométrie des maillages complets.
  const livePositions = new Float32Array(2 * TUBE_SIDES * 3);
  const liveNormals = new Float32Array(2 * TUBE_SIDES * 3);
  const liveIndices: number[] = [];
  for (let i = 0; i < TUBE_SIDES; i++) {
    const i1 = (i + 1) % TUBE_SIDES;
    liveIndices.push(i, TUBE_SIDES + i, i1, i1, TUBE_SIDES + i, TUBE_SIDES + i1);
  }
  const liveBead = new BABYLON.Mesh(`${GCODE_MESH_PREFIX}LiveBead`, scene);
  const liveData = new BABYLON.VertexData();
  liveData.positions = livePositions;
  liveData.normals = liveNormals;
  liveData.indices = liveIndices;
  liveData.applyToMesh(liveBead, true);
  const livePoints = [new BABYLON.Vector3(), new BABYLON.Vector3(0, 0, 1e-3)];
  st.liveLine = BABYLON.MeshBuilder.CreateLines(`${GCODE_MESH_PREFIX}LiveLine`, { points: livePoints, updatable: true }, scene);
  st.liveLine.alpha = 0.85;
  Object.assign(st, { liveColorByMat, livePositions, liveNormals, liveBead, livePoints });
}

function setupLiveA(st: GCodeLayerState) {
  const { liveBead, plateNode } = st;
  for (const mesh of [liveBead, st.liveLine]) {
    mesh.parent = plateNode;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
  }
  const liveA = new BABYLON.Vector3();
  const liveB = new BABYLON.Vector3();
  const liveAxA = new BABYLON.Vector3();
  const liveAxB = new BABYLON.Vector3();
  Object.assign(st, { liveA, liveB, liveAxA, liveAxB });
}

export function setupGCodeLayerScene(st: GCodeLayerState) {
  setupRoot(st);
  setupApplyHeadVisibility(st);
  setupColors(st);
  setupEditNeutral(st);
  setupLiveA(st);
}
