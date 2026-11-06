import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as BABYLON from 'babylonjs';
import { readFileSync } from 'node:fs';
import { createGCodeLayer, parseGCode, type GCodeLayer } from './gcodeLayer';
import { DEFAULT_LINE_VISIBILITY } from './gcodeLineTypes';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const fixture = (path: string) => parseGCode(readFileSync(path, 'utf8'));

beforeAll(() => {
  // runSliced et la coloration différée passent par requestAnimationFrame, absent de Node.
  const g = globalThis as unknown as Record<string, unknown>;
  g.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  g.cancelAnimationFrame = (h: ReturnType<typeof setTimeout>) => clearTimeout(h);
});

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; });

async function setup(path: string) {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  new BABYLON.ArcRotateCamera('cam', 0, 1, 300, BABYLON.Vector3.Zero(), scene);
  const rotations: number[] = [];
  const layer: GCodeLayer = createGCodeLayer(scene, new BABYLON.TransformNode('plate', scene), (r) => rotations.push(r));
  const parsed = fixture(path);
  layer.setEnabled(true);
  await layer.load(parsed);
  cleanup = () => { layer.dispose(); scene.dispose(); engine.dispose(); };
  const mesh = (name: string) => scene.getMeshByName(name) as BABYLON.Mesh;
  return { scene, layer, parsed, rotations, mesh };
}

const POLAR = 'src/utils/__fixtures__/sample_apex_polar_4axis.gcode';
const CARTESIAN = 'src/utils/__fixtures__/sample_apex_nonplanar_cartesian.gcode';

describe('calque G-code (Babylon NullEngine)', () => {
  it('construit un cordon par type de ligne et affiche le préfixe lu', async () => {
    const { layer, parsed, scene } = await setup(CARTESIAN);
    const beads = scene.meshes.filter((m) => m.name.startsWith('gcodeBead_') && (m as BABYLON.Mesh).subMeshes?.length);
    expect(beads.length).toBeGreaterThan(0);
    const full = beads.map((m) => (m as BABYLON.Mesh).subMeshes[0].indexCount);
    layer.setTime(parsed.moves.length * 0.3);
    const part = beads.map((m) => (m as BABYLON.Mesh).subMeshes[0].indexCount);
    expect(part.reduce((a, b) => a + b, 0)).toBeLessThan(full.reduce((a, b) => a + b, 0));
  });

  it('fait tourner le plateau en polaire seulement', async () => {
    const polar = await setup(POLAR);
    polar.layer.setTime(polar.parsed.moves.length * 0.5);
    expect(polar.rotations.at(-1)).not.toBe(0);
    cleanup?.();
    const cart = await setup(CARTESIAN);
    cart.layer.setTime(cart.parsed.moves.length * 0.5);
    expect(cart.rotations.at(-1)).toBe(0);
  });

  it('bascule les cordons sur le matériau par sommet en mode continu, puis restaure', async () => {
    const { layer, scene } = await setup(CARTESIAN);
    const bead = scene.meshes.find((m) => m.name.startsWith('gcodeBead_') && (m as BABYLON.Mesh).subMeshes?.length) as BABYLON.Mesh;
    const original = bead.material!.name;
    layer.setColorBy('speed');
    await wait();
    expect(bead.material!.name).toBe('gcodeBeadMatVertexColor');
    expect(bead.isVerticesDataPresent(BABYLON.VertexBuffer.ColorKind)).toBe(true);
    layer.setColorBy('lineType');
    await wait();
    expect(bead.material!.name).toBe(original);
  });

  it('pose les poids d\'édition sur les sommets et les retire', async () => {
    const { layer, scene } = await setup(CARTESIAN);
    const bead = scene.meshes.find((m) => m.name.startsWith('gcodeBead_') && (m as BABYLON.Mesh).subMeshes?.length) as BABYLON.Mesh;
    layer.setEditWeights(Uint32Array.from([3, 4, 5]), Float32Array.from([0.25, 0.5, 1]));
    const weights = bead.getVerticesData('apexEditWeight')!;
    expect(Math.max(...weights)).toBeGreaterThan(0);
    layer.setEditWeights(null);
    expect(Math.max(...bead.getVerticesData('apexEditWeight')!)).toBe(0);
  });

  it('applique les valeurs du noyau aux mouvements et réécrit les segments touchés', async () => {
    const { layer, parsed } = await setup(CARTESIAN);
    const k = 5;
    const before = parsed.moves[k].x;
    layer.applyMoveEdits(Uint32Array.from([k]), Float64Array.from([before + 1, parsed.moves[k].y, parsed.moves[k].z, parsed.moves[k].b, 0.5]));
    expect(parsed.moves[k].x).toBe(before + 1);
    expect(parsed.eDelta[k]).toBe(0.5);
    expect([...parsed.editedMoves!]).toEqual([k]);
    expect(layer.getMoveTip(k, new BABYLON.Vector3()).x).toBeCloseTo(before + 1, 5);
  });

  it('retrouve un point de trajectoire visible sous le rayon, et aucun si son type est masqué', async () => {
    const { layer, parsed } = await setup(CARTESIAN);
    layer.setPickingEnabled(true);
    await wait(80);
    const k = parsed.moves.findIndex((m, i) => i > 2 && m.extruding);
    const tip = layer.getMoveTip(k, new BABYLON.Vector3());
    const ray = new BABYLON.Ray(new BABYLON.Vector3(tip.x, tip.y + 50, tip.z), new BABYLON.Vector3(0, -1, 0), 200);
    const hit = layer.pickAt(ray, 0.002);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.t - k)).toBeLessThanOrEqual(3);
    layer.setLineTypeVisibility(Object.fromEntries(Object.keys(DEFAULT_LINE_VISIBILITY).map((t) => [t, false])) as typeof DEFAULT_LINE_VISIBILITY);
    expect(layer.pickAt(ray, 0.002)).toBeNull();
  });
});
