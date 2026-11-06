import { describe, expect, it } from 'vitest';
import * as BABYLON from 'babylonjs';
import { parseGCode } from './gcodeParse';
import { APEX_SIGNATURE_LINE } from '@/utils/apexSignature';
import {
  BEAD_HEIGHT_MM, BEAD_WIDTH_MM, TUBE_SIDES,
  buildBeadMesh, buildPathMesh, countUpTo, createSampler, runSliced, writeRing,
} from './gcodeLayerGeometry';

const drain = <T>(gen: Generator<void, T, void>): T => {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
};

const cartesian = (moves: Array<[number, number, number, number]>) =>
  parseGCode([
    APEX_SIGNATURE_LINE,
    '; apex_kinematics_json {"schema":"apex-kinematics/1","machine":"cartesian"}',
    'M82', 'G90',
    ...moves.map(([x, y, z, e]) => `G1 X${x} Y${y} Z${z} E${e} F1800`),
  ].join('\n'));

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

describe('writeRing : anneau du cordon', () => {
  const ring = (c: [number, number, number], t: [number, number, number], a: [number, number, number]) => {
    const positions = new Float32Array(TUBE_SIDES * 3);
    const normals = new Float32Array(TUBE_SIDES * 3);
    writeRing(positions, normals, 0, { x: c[0], y: c[1], z: c[2] }, { x: t[0], y: t[1], z: t[2] }, { x: a[0], y: a[1], z: a[2] });
    return { positions, normals };
  };
  const vertex = (arr: Float32Array, i: number) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];

  it('pose les sommets dans le plan perpendiculaire à la tangente, autour du centre', () => {
    const c: [number, number, number] = [5, 6, 7];
    const { positions } = ring(c, [1, 0, 0], [0, 0, 1]);
    for (let i = 0; i < TUBE_SIDES; i++) {
      expect(dot(sub(vertex(positions, i), c), [1, 0, 0])).toBeCloseTo(0, 5);
    }
  });

  it('écrase la section le long de l\'axe de buse : demi-largeur sur le côté, demi-hauteur sur l\'axe', () => {
    const { positions } = ring([0, 0, 0], [1, 0, 0], [0, 0, 1]);
    const alongAxis = Math.max(...Array.from({ length: TUBE_SIDES }, (_, i) => Math.abs(vertex(positions, i)[2])));
    const alongSide = Math.max(...Array.from({ length: TUBE_SIDES }, (_, i) => Math.abs(vertex(positions, i)[1])));
    expect(alongAxis).toBeLessThanOrEqual(BEAD_HEIGHT_MM / 2 + 1e-6);
    expect(alongSide).toBeCloseTo(BEAD_WIDTH_MM / 2, 5);
  });

  it('donne des normales unitaires, perpendiculaires à la tangente', () => {
    const { normals } = ring([0, 0, 0], [0, 1, 0], [0, 0, 1]);
    for (let i = 0; i < TUBE_SIDES; i++) {
      const n = vertex(normals, i);
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
      expect(dot(n, [0, 1, 0])).toBeCloseTo(0, 5);
    }
  });

  it('retombe sur une perpendiculaire valide quand l\'axe de buse est parallèle à la tangente', () => {
    const { positions, normals } = ring([0, 0, 0], [0, 0, 1], [0, 0, 1]);
    for (let i = 0; i < TUBE_SIDES; i++) {
      expect(vertex(positions, i).every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...vertex(normals, i))).toBeCloseTo(1, 5);
      expect(dot(vertex(positions, i), [0, 0, 1])).toBeCloseTo(0, 5);
    }
  });

  it('écrit l\'anneau demandé sans toucher aux autres', () => {
    const positions = new Float32Array(TUBE_SIDES * 3 * 2).fill(-99);
    const normals = new Float32Array(TUBE_SIDES * 3 * 2).fill(-99);
    writeRing(positions, normals, 1, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(Array.from(positions.subarray(0, TUBE_SIDES * 3)).every((v) => v === -99)).toBe(true);
    expect(Array.from(positions.subarray(TUBE_SIDES * 3)).every((v) => v !== -99)).toBe(true);
  });
});

describe('createSampler (cartésien)', () => {
  const parsed = cartesian([[0, 0, 0.2, 0], [10, 0, 0.2, 1], [10, 10, 0.2, 2]]);
  const last = parsed.moves.length - 1;

  it('garde un sous-segment par mouvement sans précision demandée', () => {
    const sampler = drain(createSampler(parsed, null));
    expect(Array.from(sampler.segments)).toEqual(new Array(parsed.moves.length).fill(1));
  });

  it('subdivise les longs mouvements selon la précision demandée', () => {
    const sampler = drain(createSampler(parsed, 2.5));
    expect(sampler.segments[last]).toBe(4);
    expect(sampler.segments[last - 1]).toBe(4);
  });

  it('convertit le repère machine (x, y, z) en repère plateau (x, z, y)', () => {
    const sampler = drain(createSampler(parsed, null));
    // Le parseur recentre les coordonnées : on compare aux mouvements parsés, pas aux valeurs du fichier.
    const a = parsed.moves[last - 1], m = parsed.moves[last];
    const out = new BABYLON.Vector3();
    sampler.tip(last, 1, out);
    expect([out.x, out.y, out.z]).toEqual([m.x, m.z, m.y]);
    sampler.tip(last, 0.5, out);
    expect(out.x).toBeCloseTo((a.x + m.x) / 2, 5);
    expect(out.y).toBeCloseTo(m.z, 5);
    expect(out.z).toBeCloseTo((a.y + m.y) / 2, 5);
    sampler.axis(last, 0.5, out);
    expect([out.x, out.y, out.z]).toEqual([0, 1, 0]);
  });
});

describe('buildBeadMesh / buildPathMesh', () => {
  const scene = new BABYLON.Scene(new BABYLON.NullEngine());
  const material = new BABYLON.StandardMaterial('m', scene);
  const parsed = cartesian([[0, 0, 0.2, 0], [10, 0, 0.2, 1], [10, 10, 0.2, 2], [0, 10, 0.2, 3]]);
  const sampler = drain(createSampler(parsed, null));
  const indicesPerStep = TUBE_SIDES * 6;

  it('ne produit aucun maillage quand aucun mouvement n\'est retenu', () => {
    const built = drain(buildBeadMesh('none', parsed, sampler, () => false, material, scene));
    expect(built.mesh).toBeNull();
    expect(built.cumIndices.length).toBe(parsed.moves.length);
  });

  it('chaîne les mouvements consécutifs en un seul tube : un anneau de plus que de mouvements', () => {
    const built = drain(buildBeadMesh('all', parsed, sampler, (k) => k >= 1, material, scene));
    const moves = parsed.moves.length;
    const samples = built.sampleOwner!.length;
    expect(built.mesh).not.toBeNull();
    expect(samples).toBe(moves);
    expect(built.mesh!.getTotalVertices()).toBe(samples * TUBE_SIDES);
    expect(built.mesh!.getTotalIndices()).toBe((samples - 1) * indicesPerStep);
    expect(built.cumIndices[moves - 1]).toBe((samples - 1) * indicesPerStep);
  });

  it('cumule les indices par mouvement, de façon croissante, un pas par mouvement', () => {
    const built = drain(buildBeadMesh('cum', parsed, sampler, (k) => k >= 1, material, scene));
    for (let k = 2; k < parsed.moves.length; k++) {
      expect(built.cumIndices[k] - built.cumIndices[k - 1]).toBe(indicesPerStep);
    }
  });

  it('ouvre un nouveau tube après un mouvement exclu, sans raccord entre les deux', () => {
    const last = parsed.moves.length - 1;
    const built = drain(buildBeadMesh('gap', parsed, sampler, (k) => k >= 1 && k !== last - 1, material, scene));
    expect(Array.from(built.stripStart!).filter((s) => s === 1).length).toBe(2);
    // Le mouvement exclu garde le compte du précédent.
    expect(built.cumIndices[last - 1]).toBe(built.cumIndices[last - 2]);
  });

  it('associe chaque sommet au mouvement de son échantillon', () => {
    const built = drain(buildBeadMesh('own', parsed, sampler, (k) => k >= 1, material, scene));
    built.sampleOwner!.forEach((k, j) => {
      for (let i = 0; i < TUBE_SIDES; i++) expect(built.vertexOwner[j * TUBE_SIDES + i]).toBe(k);
    });
  });

  it('construit un trajet en segments : deux indices par pas', () => {
    const built = drain(buildPathMesh('path', parsed, sampler, (k) => k >= 1, BABYLON.Color3.White(), scene));
    expect(built.indicesPerStep).toBe(2);
    expect(built.cumIndices[parsed.moves.length - 1]).toBe((parsed.moves.length - 1) * 2);
  });
});

describe('countUpTo', () => {
  const sorted = Uint32Array.from([2, 4, 4, 9]);
  it.each([[0, 0], [2, 1], [3, 1], [4, 3], [8, 3], [9, 4], [100, 4]])('t = %i → %i', (t, expected) => {
    expect(countUpTo(sorted, t)).toBe(expected);
  });
  it('vaut 0 sur un tableau vide', () => {
    expect(countUpTo(new Uint32Array(0), 5)).toBe(0);
  });
});

describe('runSliced', () => {
  function* counter(n: number): Generator<void, string, void> {
    for (let i = 0; i < n; i++) yield;
    return 'fini';
  }
  it('renvoie le résultat du générateur', async () => {
    await expect(runSliced(counter(5), () => false)).resolves.toBe('fini');
  });
  it('rend null et arrête le générateur dès que la construction est annulée', async () => {
    const gen = counter(5);
    await expect(runSliced(gen, () => true)).resolves.toBeNull();
    expect(gen.next().done).toBe(true);
  });
});
