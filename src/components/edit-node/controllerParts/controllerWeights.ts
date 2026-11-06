// Issu de la découpe de createGCodeEditController (gcodeEditController.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (controllerState.ts).
import * as BABYLON from 'babylonjs';
import { editKernel, type EditInfluence, type EditTransform } from '@/utils/editKernelClient';
import { type EditDelta } from '../editProtocol';
import { ANCHOR_MIN_RADIUS_MM, ANCHOR_RADIUS_FRACTION, REFUSAL_MESSAGES, type NodeState } from './controllerShared';
import type { EditControllerState } from './controllerState';

function setupToKernel(st: EditControllerState) {
  const { layer } = st;
  const toKernel = (v: BABYLON.Vector3) => [v.x, v.z, v.y] as const;
  const fromKernel = (v: ArrayLike<number>) => new BABYLON.Vector3(v[0], v[2], v[1]);

  // Repère du noyau = composantes Babylon y ↔ z échangées (une réflexion) : la même rotation s'y
  // écrit avec l'axe échangé et l'angle opposé.
  const transformOf = (n: NodeState): EditTransform => ({
    translation: Float64Array.from(toKernel(n.translation)),
    axis: Float64Array.from(toKernel(n.rotation.axis)),
    angleRad: -n.rotation.angle,
  });

  const pushTransform = (n: NodeState | null) => {
    layer.setEditTransform(n
      ? { translation: n.applied, pivot: n.anchor, axis: n.rotation.axis, angle: n.rotation.applied, stackAxis: n.stackAxis ?? undefined }
      : { translation: BABYLON.Vector3.Zero(), pivot: BABYLON.Vector3.Zero(), axis: BABYLON.Vector3.Up(), angle: 0 });
  };

  const buildInfluence = (n: NodeState): EditInfluence => {
    const dirs: number[] = [];
    const anchors: number[] = [];
    // Mode Auto : les poignées ne règlent que l'orientation de la rotation ; la portée part de la portée
    // minimale (toutes directions) et s'élargit.
    if (st.influence.reachMode === 'reach') for (const h of n.handles.values()) {
      const v = h.lockPoint ? h.lockPoint.subtract(n.anchor) : h.v;
      const reach = v.length();
      if (!(reach > 1e-6)) continue;
      const [x, y, z] = toKernel(v.scale(1 / reach));
      dirs.push(x, y, z, reach * n.reach.scale);
      if (h.lockPoint) {
        const [ax, ay, az] = toKernel(h.lockPoint);
        anchors.push(ax, ay, az, Math.max(ANCHOR_MIN_RADIUS_MM, ANCHOR_RADIUS_FRACTION * reach));
      }
    }
    return {
      ...st.influence,
      spatial: { ...st.influence.spatial, radiusMm: st.influence.spatial.radiusMm * n.reach.scale },
      dragDirection: Float64Array.from(toKernel(n.translation)),
      directions: Float64Array.from(dirs),
      anchors: Float64Array.from(anchors),
      trim: n.trimming ? { enabled: true, layers: st.influence.trimLayers } : undefined,
    };
  };
  Object.assign(st, { toKernel, fromKernel, transformOf, pushTransform, buildInfluence });
}

function setupMaxReachOf(st: EditControllerState) {
  const { layer } = st;
  /** Plus grande portée en cours du nœud (mm) : poignée la plus longue ou portée minimale, élargie. */
  const maxReachOf = (n: NodeState) => {
    let reach = st.influence.spatial.radiusMm;
    if (st.influence.reachMode === 'reach') for (const h of n.handles.values()) reach = Math.max(reach, (h.lockPoint ? h.lockPoint.subtract(n.anchor) : h.v).length());
    return reach * n.reach.scale;
  };

  // Diagonale de l'objet (mm), mesurée une fois par fichier : borne de l'élargissement du mode Auto.
  let extentOf: object | null = null;
  let extent = 0;
  const objectExtent = () => {
    const parsed = layer.getParsed();
    if (!parsed) return 0;
    if (extentOf !== parsed) {
      let rMax = 0, zMin = Infinity, zMax = -Infinity;
      // Polaire : X = rayon ; cartésien : X et Y recentrés sur le plateau.
      const cartesian = parsed.kind === 'cartesian';
      for (const m of parsed.moves) {
        const r = cartesian ? Math.hypot(m.x, m.y) : Math.abs(m.x);
        if (r > rMax) rMax = r;
        if (m.z < zMin) zMin = m.z;
        if (m.z > zMax) zMax = m.z;
      }
      extent = Math.hypot(2 * rMax, zMax > zMin ? zMax - zMin : 0);
      extentOf = parsed;
    }
    return extent;
  };

  // Poids : une requête en vol, la plus récente remplace celle qui attendait.
  st.weightsBusy = false;
  st.weightsDirty = false;
  // Pendant la répétition d'une déformation par symétrie, le noyau sert aux copies : pas de poids du nœud actif.
  st.symmetryBusy = false;
  // Message important (résultat d'une symétrie, copie…) : le recalcul des poids ne l'efface pas avant 5 s.
  st.heldUntil = 0;
  const hold = (text: string) => { st.message = text; st.heldUntil = performance.now() + 5000; };
  const requestWeights = () => {
    st.weightsDirty = true;
    void st.pumpWeights();
  };
    st.requestWeights = requestWeights;
  Object.assign(st, { maxReachOf, objectExtent, hold });
}

function setupPumpWeights(st: EditControllerState) {
  const { buildInfluence, busy, emit, fromKernel, layer, maxReachOf, objectExtent, pushTransform } = st;
  const pumpWeights = async () => {
    if (st.weightsBusy || !st.weightsDirty || st.symmetryBusy) return;
    const n = st.node;
    if (!n || st.status !== 'ready') { st.weightsDirty = false; return; }
    st.weightsBusy = true;
    st.weightsDirty = false;
    try {
      const res = await busy(editKernel.setHandle(n.index, buildInfluence(n)), false);
      if (st.node === n) {
        if (!('refused' in res)) {
          layer.setEditWeights(res.affected, res.weights, res.slideNormals, res.axes);
          n.affectedIdx = res.affected;
          n.dependentIdx = res.dependents;
          n.baseHeights = res.baseHeights;
          st.capacityMm = res.capacityMm;
          n.stackAxis = res.stackSign !== 0 ? fromKernel(res.handleAxis).normalize() : null;
          pushTransform(n);
          st.affected = res.affected.length;
          if (performance.now() > st.heldUntil) st.message = null;
          if (n.reach.growing) {
            // Plus aucun point gagné et la portée couvre tout l'objet : tout ce qui peut bouger bouge déjà.
            // (Sans gain mais plus courte que l'objet : un vide entre deux parties, on continue.)
            if (res.affected.length <= n.reach.affected && maxReachOf(n) >= objectExtent()) n.reach.saturated = true;
            n.reach.growing = false;
          }
          n.reach.affected = res.affected.length;
          // Nouvelle influence : le noyau a oublié la déformation en cours, la redemander.
          if (n.positionLocked && n.translation.lengthSquared() > 0) st.requestDelta(n);
        } else {
          layer.setEditWeights(null);
          st.capacityMm = null;
          st.affected = 0;
          st.message = REFUSAL_MESSAGES[res.refused];
        }
      }
    } catch (error) {
      st.message = error instanceof Error ? error.message : String(error);
    }
    st.weightsBusy = false;
    emit();
    void pumpWeights();
  };
    st.pumpWeights = pumpWeights;

  /** Valeurs validées du point (le champ `eRatio` y porte l'extrusion d'origine du segment). */
  const originalOf = (index: number): EditDelta => {
    const parsed = layer.getParsed()!;
    const m = parsed.moves[index];
    return { r: m.x, c: m.y, z: m.z, b: m.b, eRatio: parsed.eDelta[index] };
  };
  Object.assign(st, { originalOf });
}

export function setupEditControllerWeights(st: EditControllerState) {
  setupToKernel(st);
  setupMaxReachOf(st);
  setupPumpWeights(st);
}
