import * as BABYLON from 'babylonjs';
import type { LineTypeId } from '../gcodeLineTypes';
import { colorForMode } from '../gcodeColormap';
import {
  DEG2RAD, nozzleTip, stateAt, toolAxisAt, type ContinuousColorByMode,
} from '../gcodeParse';
import type { LayerState } from './state';
import { BEAD_HEIGHT_MM, GCODE_MESH_PREFIX, TUBE_SIDES } from './constants';
import { newRingFrame, writeRing, type RingFrame } from './ring';
import { countUpTo } from './search';

/**
 * Tronçon « vivant » : portion du mouvement en cours entre la dernière jonction déjà dessinée
 * (préfixe des maillages, au sous-segment près) et la position exacte de la buse, recalculée à
 * chaque image — le tracé avance en continu sous la buse au lieu d'apparaître d'un bloc à la fin
 * de chaque mouvement (ou sous-segment), sans alourdir la géométrie des maillages complets.
 */
function createLiveTail(st: LayerState) {
  const { materials, plateNode, scene } = st;
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
  let liveLine = BABYLON.MeshBuilder.CreateLines(`${GCODE_MESH_PREFIX}LiveLine`, { points: livePoints, updatable: true }, scene);
  liveLine.alpha = 0.85;
  for (const mesh of [liveBead, liveLine]) {
    mesh.parent = plateNode;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
  }
  const liveA = new BABYLON.Vector3();
  const liveB = new BABYLON.Vector3();
  const liveAxA = new BABYLON.Vector3();
  const liveAxB = new BABYLON.Vector3();
  const colorScratch = new BABYLON.Color3();
  const frame = newRingFrame();
  const halfH = BEAD_HEIGHT_MM / 2;

  /** Anneau `ring` du tronçon : centre (pointe − demi-épaisseur le long de l'axe), tangente t. */
  const writeEnd = (ring: number, tip: BABYLON.Vector3, ax: BABYLON.Vector3, t: RingFrame) => {
    frame.cx = tip.x - ax.x * halfH; frame.cy = tip.y - ax.y * halfH; frame.cz = tip.z - ax.z * halfH;
    frame.tx = t.tx; frame.ty = t.ty; frame.tz = t.tz;
    frame.ax = ax.x; frame.ay = ax.y; frame.az = ax.z;
    writeRing(livePositions, liveNormals, ring, frame);
  };
  const tangent = newRingFrame();

  /** Cordon vivant : vrai si le tronçon a une longueur dessinable. */
  const showBeadTail = (move: { type: LineTypeId }, next: number, f0: number, f: number) => {
    const sampler = st.sampler!;
    const dx = liveB.x - liveA.x, dy = liveB.y - liveA.y, dz = liveB.z - liveA.z;
    const len = Math.hypot(dx, dy, dz);
    if (len <= 1e-6) return false;
    sampler.axis(next, f0, liveAxA);
    sampler.axis(next, f, liveAxB);
    tangent.tx = dx / len; tangent.ty = dy / len; tangent.tz = dz / len;
    writeEnd(0, liveA, liveAxA, tangent);
    writeEnd(1, liveB, liveAxB, tangent);
    liveBead.updateVerticesData(BABYLON.VertexBuffer.PositionKind, livePositions);
    liveBead.updateVerticesData(BABYLON.VertexBuffer.NormalKind, liveNormals);
    if (st.colorBy === 'lineType') {
      liveBead.material = materials.beadMaterials.get(move.type) ?? null;
    } else {
      colorForMode(st.colorBy as ContinuousColorByMode, next, st.parsed!, st.colorByScope, colorScratch);
      materials.liveColorByMat.emissiveColor.copyFrom(colorScratch);
      liveBead.material = materials.liveColorByMat;
    }
    return true;
  };

  /** Tronçon vivant du mouvement `next` en cours, de la fin du préfixe dessiné à la buse. */
  return (i: number, next: number, t: number) => {
    let showBead = false;
    let showLine = false;
    const { parsed, sampler, segments } = st;
    if (parsed && sampler && next > i) {
      const m = parsed.moves[next];
      const seg = segments[next];
      const f = t - i;
      const f0 = Math.floor(f * seg) / seg;
      const type: LineTypeId = m.extruding ? m.type : m.type === 'wipe' ? 'wipe' : 'travel';
      if (f - f0 > 1e-6 && st.visibility[type]) {
        sampler.tip(next, f0, liveA);
        sampler.tip(next, f, liveB);
        if (m.extruding) {
          showBead = showBeadTail(m, next, f0, f);
        } else {
          livePoints[0].copyFrom(liveA);
          livePoints[1].copyFrom(liveB);
          liveLine = BABYLON.MeshBuilder.CreateLines(liveLine.name, { points: livePoints, instance: liveLine });
          liveLine.color = materials.colors[type];
          showLine = true;
        }
      }
    }
    liveBead.setEnabled(showBead);
    liveLine.setEnabled(showLine);
  };
}

export interface Playback {
  /** Pose la tête, le plateau et le préfixe affiché à l'instant `st.time`. */
  apply(): void;
  applyVisibility(): void;
}

/** Position du plateau et de la tête à l'instant `t` (polaire : plateau qui tourne ; cartésien : tête qui suit la buse). */
function createHeadPose(st: LayerState, onPlateRotation?: (rotationY: number) => void) {
  const headNode = st.head.node;
  const up = BABYLON.Vector3.Up();
  const headDir = new BABYLON.Vector3();
  const headTip = { r: 0, z: 0 };
  const toolAxis = { x: 0, y: 0, z: 1 };
  return (t: number) => {
    const parsed = st.parsed!;
    const state = stateAt(parsed.moves, t);
    if (parsed.kind === 'polar') {
      // Dans le repère main gauche de Babylon, rotation.y = ψ envoie un angle local θ
      // (x = cos θ, z = sin θ) sur θ − ψ. Avec ψ = C courant, un point déposé à C_dépôt est à
      // l'angle machine C_dépôt − C : pile sous la tête (angle 0) au moment de son dépôt, puis
      // entraîné avec le plateau. Le signe opposé ferait apparaître la pièce en miroir.
      st.plateNode.rotation.y = state.y * DEG2RAD;
      onPlateRotation?.(st.plateNode.rotation.y);

      const bRad = state.b * DEG2RAD;
      nozzleTip(state.x, state.z, bRad, headTip);
      headNode.position.set(headTip.r, headTip.z, 0);
      // headDir.x positif = tête penchée vers +X, donc vers +R (à l'opposé de l'axe de rotation,
      // situé en X=0) puisque le nœud de tête est lui-même posé en X=+R. Signe vérifié visuellement
      // contre le comportement réel de la machine (le signe opposé penchait la tête vers l'axe).
      headDir.set(Math.sin(bRad), Math.cos(bRad), 0);
      BABYLON.Quaternion.FromUnitVectorsToRef(up, headDir, headNode.rotationQuaternion!);
    } else {
      // Cartésien : plateau fixe, tête qui suit la buse en X/Y/Z (Y du G-code → z Babylon), droite
      // sauf si le fichier pilote l'orientation de l'outil (B/C) : la tête prend alors cet axe.
      st.plateNode.rotation.y = 0;
      onPlateRotation?.(0);
      headNode.position.set(state.x, state.z, state.y);
      if (parsed.toolOriented) {
        toolAxisAt(parsed.moves, t, toolAxis);
        headDir.set(toolAxis.x, toolAxis.z, toolAxis.y);
        BABYLON.Quaternion.FromUnitVectorsToRef(up, headDir, headNode.rotationQuaternion!);
      } else {
        headNode.rotationQuaternion!.set(0, 0, 0, 1);
      }
    }
  };
}

export function createPlayback(st: LayerState, onPlateRotation?: (rotationY: number) => void): Playback {
  const pose = createHeadPose(st, onPlateRotation);
  const updateLive = createLiveTail(st);

  const apply = () => {
    const { parsed } = st;
    if (!parsed || parsed.moves.length === 0) return;
    const last = parsed.moves.length - 1;
    const t = Math.max(0, Math.min(last, st.time));
    pose(t);

    // Préfixe affiché : mouvements terminés + fraction du mouvement en cours, au sous-segment
    // près. Chaque mouvement a `segments[k]` sous-segments dans chaque maillage qui le contient.
    const i = Math.floor(t);
    const next = Math.min(last, i + 1);
    const partialSteps = next > i ? Math.floor((t - i) * st.segments[next]) : 0;
    for (const entry of st.offPlatePath ? [...st.paths, st.offPlatePath] : st.paths) {
      if (!entry.mesh) continue;
      let count = entry.cumIndices[i];
      if (next > i && entry.include(next)) count += partialSteps * entry.indicesPerStep;
      const sub = entry.mesh.subMeshes?.[0];
      if (sub) sub.indexCount = count;
      entry.mesh.isVisible = count > 0;
    }
    for (const entry of st.markers) {
      const count = countUpTo(entry.at, t);
      entry.mesh.thinInstanceCount = count;
      entry.mesh.isVisible = count > 0;
    }
    updateLive(i, next, t);
  };

  const applyVisibility = () => {
    for (const entry of st.paths) entry.mesh?.setEnabled(st.visibility[entry.type]);
    for (const entry of st.markers) entry.mesh.setEnabled(st.visibility[entry.type]);
    st.offPlatePath?.mesh?.setEnabled(st.highlightOffPlate);
  };

  return { apply, applyVisibility };
}
