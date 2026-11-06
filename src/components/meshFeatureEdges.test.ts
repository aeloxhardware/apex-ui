import { describe, expect, it } from 'vitest';
import * as BABYLON from 'babylonjs';
import { MAX_FEATURE_INDICES, extractFeatureChains } from './meshFeatureEdges';

const scene = new BABYLON.Scene(new BABYLON.NullEngine());
const chainsOf = (mesh: BABYLON.Mesh) => extractFeatureChains(
  mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind),
  mesh.getIndices(),
  mesh.getBoundingInfo().boundingSphere.radius,
);
const pointCount = (chain: number[]) => chain.length / 3;

describe('extractFeatureChains', () => {
  it('trouve les 12 arêtes d\'une boîte, malgré ses sommets dupliqués par face', () => {
    const box = BABYLON.MeshBuilder.CreateBox('box', { size: 20 }, scene);
    expect(box.getTotalVertices()).toBe(24);
    const chains = chainsOf(box);
    expect(chains).toHaveLength(12);
    // Trois arêtes se rejoignent à chaque coin : aucune ne se prolonge, chaque chaîne a 2 points.
    chains.forEach((c) => expect(pointCount(c)).toBe(2));
  });

  it('ignore les diagonales de triangulation d\'une face plane', () => {
    const ground = BABYLON.MeshBuilder.CreateGround('g', { width: 10, height: 10, subdivisions: 4 }, scene);
    const chains = chainsOf(ground);
    // Seul le contour est franc : ses quatre côtés tournent à 90°, donc quatre chaînes.
    expect(chains).toHaveLength(4);
  });

  it('chaîne le contour d\'un cercle tessellé en une seule arête fermée', () => {
    const disc = BABYLON.MeshBuilder.CreateDisc('d', { radius: 8, tessellation: 32 }, scene);
    const chains = chainsOf(disc);
    expect(chains).toHaveLength(1);
    const [chain] = chains;
    expect(pointCount(chain)).toBe(33);
    // Fermée : le dernier point retombe sur le premier.
    expect(chain.slice(0, 3)).toEqual(chain.slice(-3));
  });

  it('ne trouve aucune arête franche sur une surface lisse', () => {
    const sphere = BABYLON.MeshBuilder.CreateSphere('s', { diameter: 12, segments: 12 }, scene);
    expect(chainsOf(sphere)).toEqual([]);
  });

  it('renvoie des coordonnées locales aplaties (multiples de 3)', () => {
    const box = BABYLON.MeshBuilder.CreateBox('box2', { size: 2 }, scene);
    chainsOf(box).forEach((c) => {
      expect(c.length % 3).toBe(0);
      c.forEach((v) => expect(Math.abs(v)).toBeCloseTo(1, 5));
    });
  });

  it('renvoie une liste vide sans données, sans indices, ou au-delà de la limite de taille', () => {
    expect(extractFeatureChains(null, [0, 1, 2], 1)).toEqual([]);
    expect(extractFeatureChains([0, 0, 0, 1, 0, 0, 0, 1, 0], undefined, 1)).toEqual([]);
    expect(extractFeatureChains([0, 0, 0, 1, 0, 0, 0, 1, 0], [], 1)).toEqual([]);
    expect(extractFeatureChains([0, 0, 0], new Array(MAX_FEATURE_INDICES + 3).fill(0), 1)).toEqual([]);
  });

  it('ignore les triangles dégénérés', () => {
    // Trois sommets alignés : normale nulle, aucune arête retenue.
    expect(extractFeatureChains([0, 0, 0, 1, 0, 0, 2, 0, 0], [0, 1, 2], 1)).toEqual([]);
  });

  it('traite un triangle isolé comme trois arêtes de bord, chacune une chaîne ouverte ou un contour', () => {
    const chains = extractFeatureChains([0, 0, 0, 10, 0, 0, 0, 10, 0], [0, 1, 2], 10);
    // Les trois côtés bordent une seule face (franches) ; les angles de 45°/90° les séparent.
    expect(chains.length).toBeGreaterThanOrEqual(1);
    expect(chains.reduce((n, c) => n + pointCount(c) - 1, 0)).toBe(3);
  });
});
