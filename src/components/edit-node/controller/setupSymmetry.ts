import { EditInfluence, EditTransform, editKernel } from '@/utils/editKernelClient';
import * as BABYLON from 'babylonjs';
import { REFUSAL_MESSAGES } from './shared';
import type { SymmetryMap, Vec3k } from './types';
import type { EditCtx } from './context';

/** Symétrie : la déformation validée est répétée en d'autres points. */
export function setupSymmetry(ctx: EditCtx) {
  const { layer, applySplice, currentValues, journalCommit, nodes, hold, requestWeights, updateView, emit } = ctx;


/** Applications du repère du noyau (droit, z vers le haut) qui envoient le nœud sur ses copies. */
const symmetryMaps = (): SymmetryMap[] => {
  const out: SymmetryMap[] = [];
  if (ctx.symmetry.mode === 'cyclic') {
    const count = Math.max(2, Math.min(12, Math.round(ctx.symmetry.count)));
    for (let i = 1; i < count; i++) {
      const a = (2 * Math.PI * i) / count, c = Math.cos(a), sn = Math.sin(a);
      const rot = (v: Vec3k): Vec3k => [c * v[0] - sn * v[1], sn * v[0] + c * v[1], v[2]];
      out.push({ point: rot, axis: rot });
    }
  } else if (ctx.symmetry.mode === 'mirror') {
    // Réflexion par rapport au plan vertical d'angle C0 qui contient l'axe du plateau. Une réflexion
    // envoie un axe de rotation sur l'opposé de son image (pseudo-vecteur), l'angle est conservé.
    const a = (ctx.symmetry.mirrorDeg * Math.PI) / 180, c2 = Math.cos(2 * a), s2 = Math.sin(2 * a);
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


const applySymmetry = async (tr: EditTransform, infl: EditInfluence, anchorKernel: readonly number[], group: string) => {
  const maps = symmetryMaps();
  if (maps.length === 0) return;
  ctx.symmetryBusy = true;
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
        void journalCommit(parsed, index, tr2, infl2, change.indices, before, change.values, change.trimmed, group);
      }
      layer.applyMoveEdits(change.indices, change.values, change.trimmed, change.trimState);
      ctx.undoDepth = change.undoDepth;
      ctx.redoDepth = change.redoDepth;
      if (ctx.undoGroups.length === 0) ctx.undoGroups.push(0);
      ctx.undoGroups[ctx.undoGroups.length - 1]++;
      made++;
    }
  } catch (error) {
    ctx.message = error instanceof Error ? error.message : String(error);
  } finally {
    ctx.symmetryBusy = false;
  }
  for (const m of nodes.values()) m.anchor = layer.getMoveTip(m.index, new BABYLON.Vector3());
  if (made > 0) hold(`Symétrie : ${made} copie(s) de la déformation.`);
  else if (skipped.length > 0) hold(`Symétrie : aucune copie (${skipped[0]}).`);
  requestWeights();
  updateView(true);
  emit();
};
  ctx.applySymmetry = applySymmetry;
}
