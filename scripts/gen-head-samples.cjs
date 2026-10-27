// Echantillons du modele de tete (native/data/head-samples.bin) pour l evitement des collisions du convertisseur
// polaire natif : meme algorithme que `getHeadSamples` de src/components/gcodeLayer.ts (pas 3 mm), rejoue hors
// navigateur avec Babylon sans moteur de rendu. Format : float32 x, y, z (repere de la tete, pointe a l origine).
//   node scripts/gen-head-samples.cjs [pas_mm] [sortie]
const fs = require('fs');
const BABYLON = require('babylonjs');
require('babylonjs-loaders');
(async () => {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  const headNode = new BABYLON.TransformNode('Head', scene);
  headNode.rotationQuaternion = BABYLON.Quaternion.Identity();
  const glb = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'assets', 'models', 'aetheris-4.glb'));
  const url = 'data:application/octet-stream;base64,' + glb.toString('base64');
  const container = await BABYLON.SceneLoader.LoadAssetContainerAsync('', url, scene, null, '.glb');
  const prefix = 'gcodeHeadModel_';
  for (const mesh of container.meshes) mesh.name = prefix + mesh.name;
  for (const node of container.transformNodes) node.name = prefix + node.name;
  const model = new BABYLON.TransformNode('gcodeHeadModel', scene);
  model.scaling.setAll(1000);
  for (const node of container.rootNodes) node.parent = model;
  const nozzle = container.meshes.find((m) => m.name.includes('NOZZLE origin'));
  if (nozzle) {
    const chain = [];
    for (let n = nozzle; n; n = n.parent) chain.unshift(n);
    for (const n of chain) n.computeWorldMatrix(true);
    const { minimumWorld: min, maximumWorld: max } = nozzle.getBoundingInfo().boundingBox;
    model.position.set(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
  } else console.error('NOZZLE origin introuvable');
  const mount = new BABYLON.TransformNode('mount', scene);
  mount.rotation.y = Math.PI / 2;
  mount.parent = headNode;
  model.parent = mount;
  container.addAllToScene();

  const spacingMm = Number(process.argv[2] || 3);
  headNode.computeWorldMatrix(true);
  const toHead = new BABYLON.Matrix();
  const invHead = headNode.getWorldMatrix().clone().invert();
  const cells = new Map();
  const keep = (p) => {
    if (cells.size >= 4000) return;
    const key = `${Math.floor(p.x / spacingMm)},${Math.floor(p.y / spacingMm)},${Math.floor(p.z / spacingMm)}`;
    if (!cells.has(key)) cells.set(key, [p.x, p.y, p.z]);
  };
  const v = new BABYLON.Vector3(), a = new BABYLON.Vector3(), b = new BABYLON.Vector3(), edge = new BABYLON.Vector3();
  for (const mesh of headNode.getChildMeshes()) {
    if (!(mesh instanceof BABYLON.Mesh) || mesh.name.includes('NOZZLE origin')) continue;
    const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    if (!pos) continue;
    mesh.computeWorldMatrix(true);
    mesh.getWorldMatrix().multiplyToRef(invHead, toHead);
    const idx = mesh.getIndices();
    const at = (i, out) => { v.set(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]); BABYLON.Vector3.TransformCoordinatesToRef(v, toHead, out); };
    if (idx) {
      for (let t = 0; t + 2 < idx.length; t += 3) for (let e = 0; e < 3; e++) {
        at(idx[t + e], a); at(idx[t + ((e + 1) % 3)], b);
        const len = BABYLON.Vector3.Distance(a, b);
        const steps = Math.min(40, Math.max(1, Math.ceil(len / spacingMm)));
        for (let s = 0; s <= steps; s++) { BABYLON.Vector3.LerpToRef(a, b, s / steps, edge); keep(edge); }
      }
    } else for (let i = 0; i < pos.length / 3; i++) { at(i, a); keep(a); }
  }
  const out = new Float32Array(cells.size * 3);
  let i = 0;
  for (const p of cells.values()) { out[i++] = p[0]; out[i++] = p[1]; out[i++] = p[2]; }
  fs.writeFileSync(process.argv[3] || require('path').join(__dirname, '..', 'native', 'data', 'head-samples.bin'), Buffer.from(out.buffer));
  let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  for (let k = 0; k < out.length; k += 3) for (let d = 0; d < 3; d++) { mn[d] = Math.min(mn[d], out[k + d]); mx[d] = Math.max(mx[d], out[k + d]); }
  console.log('samples', out.length / 3, 'min', mn.map((x) => x.toFixed(1)), 'max', mx.map((x) => x.toFixed(1)));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
