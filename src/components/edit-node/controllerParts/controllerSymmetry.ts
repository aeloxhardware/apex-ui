// Issu de la découpe de createGCodeEditController (gcodeEditController.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (controllerState.ts).
import * as BABYLON from 'babylonjs';
import { editKernel, type EditInfluence, type EditTransform } from '@/utils/editKernelClient';
import { currentValues } from '../editJournal';
import { type EditNodeHandle } from '../EditNode';
import type { SymmetryMap, Vec3k } from './controllerTypes';
import { REFUSAL_MESSAGES } from './controllerShared';
import type { EditControllerState } from './controllerState';

function setupSymmetryMaps(st: EditControllerState) {
  /** Applications du repère du noyau (droit, z vers le haut) qui envoient le nœud sur ses copies. */
  const symmetryMaps = (): SymmetryMap[] => {
    const out: SymmetryMap[] = [];
    if (st.symmetry.mode === 'cyclic') {
      const count = Math.max(2, Math.min(12, Math.round(st.symmetry.count)));
      for (let i = 1; i < count; i++) {
        const a = (2 * Math.PI * i) / count, c = Math.cos(a), sn = Math.sin(a);
        const rot = (v: Vec3k): Vec3k => [c * v[0] - sn * v[1], sn * v[0] + c * v[1], v[2]];
        out.push({ point: rot, axis: rot });
      }
    } else if (st.symmetry.mode === 'mirror') {
      // Réflexion par rapport au plan vertical d'angle C0 qui contient l'axe du plateau. Une réflexion
      // envoie un axe de rotation sur l'opposé de son image (pseudo-vecteur), l'angle est conservé.
      const a = (st.symmetry.mirrorDeg * Math.PI) / 180, c2 = Math.cos(2 * a), s2 = Math.sin(2 * a);
      const mirror = (v: Vec3k): Vec3k => [c2 * v[0] + s2 * v[1], s2 * v[0] - c2 * v[1], v[2]];
      out.push({ point: mirror, axis: (v) => { const m = mirror(v); return [-m[0], -m[1], -m[2]]; } });
    }
    return out;
  };

  const mapInfluence = (infl: EditInfluence, m: SymmetryMap): EditInfluence => {
    const quad = (src: Float64Array | undefined, transform: (v: Vec3k) => Vec3k) => {
      if (!src) return src;
      const out = new Float64Array(src.length);
      for (let i = 0; i + 3 < src.length; i += 4) {
        const v = transform([src[i], src[i + 1], src[i + 2]]);
        out[i] = v[0]; out[i + 1] = v[1]; out[i + 2] = v[2]; out[i + 3] = src[i + 3];
      }
      return out;
    };
    const drag = infl.dragDirection ? m.point([infl.dragDirection[0], infl.dragDirection[1], infl.dragDirection[2]]) : null;
    return {
      ...infl,
      directions: quad(infl.directions, m.point),
      anchors: quad(infl.anchors, m.point),
      dragDirection: drag ? Float64Array.from(drag) : infl.dragDirection,
    };
  };
  Object.assign(st, { symmetryMaps, mapInfluence });
}

function setupApplySymmetry(st: EditControllerState) {
  const { applySplice, emit, hold, journalCommit, layer, mapInfluence, nodes, requestWeights, symmetryMaps, updateView } = st;
  const applySymmetry = async (tr: EditTransform, infl: EditInfluence, anchorKernel: readonly number[], group: string) => {
    const maps = symmetryMaps();
    if (maps.length === 0) return;
    st.symmetryBusy = true;
    let made = 0;
    const skipped: string[] = [];
    try {
      for (const m of maps) {
        const q = m.point([anchorKernel[0], anchorKernel[1], anchorKernel[2]]);
        // Nœud sur le plan de symétrie (ou copie confondue avec lui) : rien à répéter.
        if (Math.hypot(q[0] - anchorKernel[0], q[1] - anchorKernel[1], q[2] - anchorKernel[2]) < 0.25) continue;
        const index = await editKernel.nearest(q[0], q[1], q[2], 1.5);
        if (index < 0) { skipped.push('aucune trajectoire à moins de 1,5 mm'); continue; }
        const infl2 = mapInfluence(infl, m);
        const res = await editKernel.setHandle(index, infl2);
        if ('refused' in res) { skipped.push(REFUSAL_MESSAGES[res.refused]); continue; }
        const tr2: EditTransform = {
          translation: Float64Array.from(m.point([tr.translation[0], tr.translation[1], tr.translation[2]])),
          axis: Float64Array.from(m.axis([tr.axis[0], tr.axis[1], tr.axis[2]])),
          angleRad: tr.angleRad,
        };
        const change = await editKernel.commit(tr2);
        const parsed = layer.getParsed();
        if (!change.ok || !change.indices || !change.values || !parsed) { skipped.push('copie sans effet'); continue; }
        if (change.splice?.inserted) await applySplice(change.splice);
        if (!parsed.insertedBlocks?.length) {
          const before = currentValues(parsed, change.indices);
          void journalCommit(parsed, {
            node: index, transform: tr2, influence: infl2,
            indices: change.indices, before, after: change.values, trimmed: change.trimmed, group,
          });
        }
        layer.applyMoveEdits(change.indices, change.values, change.trimmed, change.trimState);
        st.undoDepth = change.undoDepth;
        st.redoDepth = change.redoDepth;
        if (st.undoGroups.length === 0) st.undoGroups.push(0);
        st.undoGroups[st.undoGroups.length - 1]++;
        made++;
      }
    } catch (error) {
      st.message = error instanceof Error ? error.message : String(error);
    } finally {
      st.symmetryBusy = false;
    }
    for (const m of nodes.values()) m.anchor = layer.getMoveTip(m.index, new BABYLON.Vector3());
    if (made > 0) hold(`Symétrie : ${made} copie(s) de la déformation.`);
    else if (skipped.length > 0) hold(`Symétrie : aucune copie (${skipped[0]}).`);
    requestWeights();
    updateView(true);
    emit();
  };
    st.applySymmetry = applySymmetry;
}

function setupSetNumericDelta(st: EditControllerState) {
  const { commitNode, fromKernel, layer, pushTransform, requestDelta, tipOfFirmware, updateView } = st;
  // --- saisie numérique d'un déplacement exact (ΔR, ΔC, ΔZ, ΔB) ---------------------------------------

  const setNumericDelta = (values: Partial<Record<'r' | 'c' | 'z' | 'b', number>>, commit: boolean) => {
    const n = st.node;
    if (!n || st.status !== 'ready') return;
    // Un déplacement exact déforme : le point d'attache est donc figé.
    if (!n.positionLocked) { n.positionLocked = true; updateView(true); }
    const o = n.original;
    const cur = st.delta ?? { r: 0, c: 0, z: 0, b: 0, eRatio: NaN };
    const d = { r: values.r ?? cur.r, c: values.c ?? cur.c, z: values.z ?? cur.z, b: values.b ?? cur.b };
    const from = tipOfFirmware([o.r, o.c, o.z, o.b]);
    // ΔB saisi seul : la tête s'incline AUTOUR DE LA POINTE (la pointe reste où elle est, R et Z
    // s'ajustent et se lisent ensuite dans leurs champs). Sinon, valeurs firmware littérales : la pointe
    // suit R, C, Z et B saisis (B décrit un arc autour du pivot quand R et Z sont gardés).
    const onlyB = values.b !== undefined && values.r === undefined && values.z === undefined && values.c === undefined;
    const to = onlyB
      ? tipOfFirmware([o.r + cur.r, o.c + cur.c, o.z + cur.z, o.b + cur.b])
      : tipOfFirmware([o.r + d.r, o.c + d.c, o.z + d.z, o.b + d.b]);
    n.translation = to.subtract(from);
    // ΔB : l'axe de tête tourne de ΔB autour de la tangente au cercle du point (perpendiculaire au plan
    // radial), repère du noyau ; la pointe, elle, suit la translation ci-dessus.
    const c0 = (o.c * Math.PI) / 180;
    n.rotation.axis = fromKernel([-Math.sin(c0), Math.cos(c0), 0]);
    n.rotation.angle = -(d.b * Math.PI) / 180;
    n.rotation.applied = n.rotation.angle;
    pushTransform(n);
    // Validation : après la réponse du noyau, pour que le journal porte la translation réellement appliquée.
    if (commit) void requestDelta(n).then(() => commitNode(n));
    else void requestDelta(n);
  };

  // --- copier / coller une déformation, exprimée dans le repère de la tête --------------------------

  const headBasis = (index: number) => {
    const parsed = layer.getParsed()!;
    const m = parsed.moves[index];
    const c = (m.y * Math.PI) / 180, b = (m.b * Math.PI) / 180;
    const radial = new BABYLON.Vector3(Math.cos(c), 0, Math.sin(c));
    const tangent = new BABYLON.Vector3(-Math.sin(c), 0, Math.cos(c));
    const head = new BABYLON.Vector3(Math.sin(b) * Math.cos(c), Math.cos(b), Math.sin(b) * Math.sin(c));
    return { head, radial, tangent };
  };
  const toBasis = (v: BABYLON.Vector3, bs: ReturnType<typeof headBasis>): [number, number, number] =>
    [BABYLON.Vector3.Dot(v, bs.head), BABYLON.Vector3.Dot(v, bs.radial), BABYLON.Vector3.Dot(v, bs.tangent)];
  const fromBasis = (c: readonly number[], bs: ReturnType<typeof headBasis>) =>
    bs.head.scale(c[0]).add(bs.radial.scale(c[1])).add(bs.tangent.scale(c[2]));
  Object.assign(st, { setNumericDelta, headBasis, toBasis, fromBasis });
}

function setupCopyDeformation(st: EditControllerState) {
  const { commitNode, emit, fromBasis, headBasis, hold, nodes, pushTransform, requestDelta, requestWeights, toBasis, updateView } = st;
  const copyDeformation = () => {
    const n = st.node;
    if (!n || (n.translation.lengthSquared() === 0 && n.rotation.applied === 0)) {
      st.message = "Rien à copier : déformez d'abord le nœud (avant de valider).";
      emit();
      return;
    }
    const bs = headBasis(n.index);
    st.clipboard = {
      translation: toBasis(n.applied, bs),
      rotationAxis: toBasis(n.rotation.axis, bs),
      rotationAngle: n.rotation.applied,
    };
    hold('Déformation copiée (repère de la tête).');
    emit();
  };

  const pasteDeformation = () => {
    const n = st.node;
    if (!n || !st.clipboard || st.status !== 'ready') return;
    if (!n.positionLocked) { n.positionLocked = true; updateView(true); }
    const bs = headBasis(n.index);
    n.translation = fromBasis(st.clipboard.translation, bs);
    const axis = fromBasis(st.clipboard.rotationAxis, bs);
    if (axis.lengthSquared() > 1e-12) n.rotation.axis = axis.normalize();
    n.rotation.angle = st.clipboard.rotationAngle;
    n.rotation.applied = st.clipboard.rotationAngle;
    pushTransform(n);
    void requestDelta(n).then(() => commitNode(n));
  };

  const toggleTrimming = (id: number) => {
    const n = nodes.get(id);
    if (!n) return;
    n.trimming = !n.trimming;
    if (n.trimming) {
      hold(st.influence.trimLayers > 0
        ? `Rognage actif : seules la couche du nœud et ${st.influence.trimLayers} couche(s) de chaque côté se déforment ; la matière que la déformation envahit au-delà est rognée.`
        : 'Rognage actif : seule la couche du nœud se déforme ; la matière qu’elle envahit dessous (ou dessus) est rognée.');
    } else {
      st.message = null;
      st.heldUntil = 0;
    }
    updateView(true);
    if (n === st.node) requestWeights();
    emit();
  };
  Object.assign(st, { copyDeformation, pasteDeformation, toggleTrimming });
}

function setupOnHandlesChange(st: EditControllerState) {
  const { nodeLocal, nodes, project, requestWeights, unproject } = st;
  const onHandlesChange = (nodeId: number, list: EditNodeHandle[]) => {
    const n = nodes.get(nodeId);
    if (!n) return;
    const handles = n.handles;
    const center = nodeLocal(n);
    const screen = project(center);
    const seen = new Set<number>();
    for (const h of list) {
      seen.add(h.id);
      // Rotation seule (Ctrl) : la poignée sert de levier, l'influence ne bouge pas.
      if (st.handleDrag && n === st.node && st.handleDrag.id === h.id && st.handleDrag.mode === 'rotate' && handles.has(h.id)) continue;
      const end = unproject(screen.x + h.dx, screen.y + h.dy, screen.z);
      const old = handles.get(h.id);
      if (st.influence.reachMode === 'auto' && old) {
        // Auto : l'écartement affiché est fixe ; seule l'orientation change, la longueur (portée du
        // mode Portée) et le verrouillage sont conservés.
        const prev = old.lockPoint ? old.lockPoint.subtract(center) : old.v;
        const dir = end.subtract(center);
        if (dir.lengthSquared() < 1e-12) continue;
        const v = dir.normalize().scale(prev.length());
        handles.set(h.id, old.lockPoint ? { v: old.v, lockPoint: center.add(v) } : { v, lockPoint: null });
        continue;
      }
      handles.set(h.id, { v: end.subtract(center), lockPoint: h.locked ? end : null });
    }
    for (const id of [...handles.keys()]) if (!seen.has(id)) handles.delete(id);
    if (n === st.node) requestWeights();
  };
  Object.assign(st, { onHandlesChange });
}

export function setupEditControllerSymmetry(st: EditControllerState) {
  setupSymmetryMaps(st);
  setupApplySymmetry(st);
  setupSetNumericDelta(st);
  setupCopyDeformation(st);
  setupOnHandlesChange(st);
}
