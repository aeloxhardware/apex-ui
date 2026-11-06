import * as BABYLON from 'babylonjs';
import type { ParsedGCode } from '../gcodeParse';
import type { PathSampler } from './sampler';
import type { PathMesh } from './types';
import { MARKER_DIAMETER_MM, SLICE_MASK } from './constants';

/** Donne à un sous-maillage affiché par préfixe (`indexCount`) une boîte englobante propre. */
export function finalizePathMesh(mesh: BABYLON.Mesh) {
  // Tant que `indexCount` couvre toute la géométrie, Babylon traite le sous-maillage comme
  // « global » et lui prête la boîte englobante du maillage ; dès qu'on n'en affiche qu'un
  // préfixe, il lit sa boîte propre — jamais créée, d'où un crash dans le tri des objets
  // transparents qui arrêtait la boucle de rendu. On lui en donne une une fois pour toutes :
  // celle de la trajectoire complète, qui englobe n'importe quel préfixe (pas de
  // `refreshBoundingInfo`, qui reparcourrait les indices à chaque rotation du plateau).
  const { minimum, maximum } = mesh.getBoundingInfo();
  mesh.subMeshes[0].setBoundingInfo(new BABYLON.BoundingInfo(minimum.clone(), maximum.clone()));
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
}

/** Construit un LinesMesh (repère plateau) des mouvements retenus par `include`, dans l'ordre du
 * fichier. N'importe quel préfixe s'affiche ensuite en changeant `indexCount`. */
export function* buildPathMesh(
  name: string,
  parsed: ParsedGCode,
  sampler: PathSampler,
  include: (k: number) => boolean,
  color: BABYLON.Color3,
  scene: BABYLON.Scene,
): Generator<void, PathMesh, void> {
  const { moves } = parsed;
  const { segments } = sampler;
  let vertexTotal = 0;
  for (let k = 1; k < moves.length; k++) {
    if (include(k)) vertexTotal += segments[k] + 1;
  }

  const cumIndices = new Uint32Array(moves.length);
  // Travel/wipe restent en couleur fixe même en mode « colorer par » continu (pas de critère
  // applicable à un déplacement à vide) — jamais recolorés, vertexOwner n'a donc pas d'usage ici.
  if (vertexTotal === 0) return { mesh: null, cumIndices, indicesPerStep: 2, vertexOwner: new Uint32Array(0) };

  const positions = new Float32Array(vertexTotal * 3);
  const indices = new Uint32Array((vertexTotal - 1) * 2);
  const lineStart = new Uint32Array(moves.length);
  const tip = new BABYLON.Vector3();
  let v = 0;
  let idx = 0;

  for (let k = 1; k < moves.length; k++) {
    if ((k & SLICE_MASK) === 0) yield;
    if (include(k)) {
      lineStart[k] = v;
      const n = segments[k];
      for (let s = 0; s <= n; s++) {
        sampler.tip(k, s / n, tip);
        positions[v * 3] = tip.x;
        positions[v * 3 + 1] = tip.y;
        positions[v * 3 + 2] = tip.z;
        if (s > 0) {
          indices[idx++] = v - 1;
          indices[idx++] = v;
        }
        v++;
      }
    }
    cumIndices[k] = idx;
  }

  const mesh = new BABYLON.LinesMesh(name, scene);
  const data = new BABYLON.VertexData();
  data.positions = positions;
  data.indices = indices.subarray(0, idx);
  data.applyToMesh(mesh, true);
  mesh.color = color;
  mesh.alpha = 0.85;
  finalizePathMesh(mesh);
  return { mesh, cumIndices, indicesPerStep: 2, vertexOwner: new Uint32Array(0), lineStart, positions };
}

/** Sphères (instances légères) aux positions de fin des mouvements `at`. */
export function* buildMarkerMesh(
  name: string,
  at: Uint32Array,
  sampler: PathSampler,
  color: BABYLON.Color3,
  scene: BABYLON.Scene,
): Generator<void, BABYLON.Mesh | null, void> {
  if (!at.length) return null;
  const mesh = BABYLON.MeshBuilder.CreateSphere(name, { diameter: MARKER_DIAMETER_MM, segments: 6 }, scene);
  const material = new BABYLON.StandardMaterial(`${name}Mat`, scene);
  material.disableLighting = true;
  material.emissiveColor = color;
  mesh.material = material;
  const matrices = new Float32Array(at.length * 16);
  const p = new BABYLON.Vector3();
  const m = new BABYLON.Matrix();
  for (let j = 0; j < at.length; j++) {
    if ((j & SLICE_MASK) === 0) yield;
    sampler.tip(at[j], 1, p);
    BABYLON.Matrix.TranslationToRef(p.x, p.y, p.z, m);
    m.copyToArray(matrices, j * 16);
  }
  mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}
