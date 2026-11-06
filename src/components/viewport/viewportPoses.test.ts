import { describe, expect, it } from 'vitest';
import { poseChanged, type Pose } from './viewportPoses';

const v = (x: number, y: number, z: number) => ({ x, y, z });

function pose(over: Partial<Record<keyof Pose, unknown>> = {}): Pose {
  return {
    mesh: {},
    position: v(0, 0, 0),
    rotation: v(0, 0, 0),
    quaternion: null,
    scaling: v(1, 1, 1),
    unit: 'mm',
    ...over,
  } as unknown as Pose;
}

describe('poseChanged', () => {
  it('ignore les écarts de flottant', () => {
    expect(poseChanged(pose(), pose({ position: v(0.00001, 0, 0) }))).toBe(false);
  });
  it("voit un déplacement, une rotation, une échelle et un changement d'unité", () => {
    expect(poseChanged(pose(), pose({ position: v(1, 0, 0) }))).toBe(true);
    expect(poseChanged(pose(), pose({ rotation: v(0, 0.5, 0) }))).toBe(true);
    expect(poseChanged(pose(), pose({ scaling: v(2, 2, 2) }))).toBe(true);
    expect(poseChanged(pose(), pose({ unit: 'in' }))).toBe(true);
  });
  it('voit le passage de la rotation en angles à la rotation en quaternion', () => {
    expect(poseChanged(pose(), pose({ quaternion: { x: 0, y: 0, z: 0, w: 1 } }))).toBe(true);
  });
});
