import type * as BABYLON from 'babylonjs';

export type Vec3k = [number, number, number];

export interface SymmetryMap { point: (v: Vec3k) => Vec3k; axis: (v: Vec3k) => Vec3k }
