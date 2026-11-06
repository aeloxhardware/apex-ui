import * as BABYLON from 'babylonjs';
import type { EditNodeHandle, HandleDragMode, HandleDragEvent } from '../EditNode';
import { editKernel } from '@/utils/editKernelClient';
import { rotateAbout, wrapPi } from './shared';
import type { EditCtx } from './context';

/** Saisie numérique, copier/coller, rognage, poignées et historique. */
export function setupNumericHandles(ctx: EditCtx) {
  const { updateView, tipOfFirmware, fromKernel, pushTransform, requestDelta, commitNode, layer, emit, hold, nodes, requestWeights, nodeLocal, project, unproject, camera, busy, applySplice, journalStep, applyChange, originalOf, afterEdit } = ctx;


// --- saisie numérique d'un déplacement exact (ΔR, ΔC, ΔZ, ΔB) ---------------------------------------

const setNumericDelta = (values: Partial<Record<'r' | 'c' | 'z' | 'b', number>>, commit: boolean) => {
  const n = ctx.node;
  if (!n || ctx.status !== 'ready') return;
  // Un déplacement exact déforme : le point d'attache est donc figé.
  if (!n.positionLocked) { n.positionLocked = true; updateView(true); }
  const o = n.original;
  const cur = ctx.delta ?? { r: 0, c: 0, z: 0, b: 0, eRatio: NaN };
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
  ctx.setNumericDelta = setNumericDelta;


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


const copyDeformation = () => {
  const n = ctx.node;
  if (!n || (n.translation.lengthSquared() === 0 && n.rotation.applied === 0)) {
    ctx.message = "Rien à copier : déformez d'abord le nœud (avant de valider).";
    emit();
    return;
  }
  const bs = headBasis(n.index);
  ctx.clipboard = {
    translation: toBasis(n.applied, bs),
    rotationAxis: toBasis(n.rotation.axis, bs),
    rotationAngle: n.rotation.applied,
  };
  hold('Déformation copiée (repère de la tête).');
  emit();
};
  ctx.copyDeformation = copyDeformation;


const pasteDeformation = () => {
  const n = ctx.node;
  if (!n || !ctx.clipboard || ctx.status !== 'ready') return;
  if (!n.positionLocked) { n.positionLocked = true; updateView(true); }
  const bs = headBasis(n.index);
  n.translation = fromBasis(ctx.clipboard.translation, bs);
  const axis = fromBasis(ctx.clipboard.rotationAxis, bs);
  if (axis.lengthSquared() > 1e-12) n.rotation.axis = axis.normalize();
  n.rotation.angle = ctx.clipboard.rotationAngle;
  n.rotation.applied = ctx.clipboard.rotationAngle;
  pushTransform(n);
  void requestDelta(n).then(() => commitNode(n));
};
  ctx.pasteDeformation = pasteDeformation;


const toggleTrimming = (id: number) => {
  const n = nodes.get(id);
  if (!n) return;
  n.trimming = !n.trimming;
  if (n.trimming) {
    hold(ctx.influence.trimLayers > 0
      ? `Rognage actif : seules la couche du nœud et ${ctx.influence.trimLayers} couche(s) de chaque côté se déforment ; la matière que la déformation envahit au-delà est rognée.`
      : 'Rognage actif : seule la couche du nœud se déforme ; la matière qu’elle envahit dessous (ou dessus) est rognée.');
  } else {
    ctx.message = null;
    ctx.heldUntil = 0;
  }
  updateView(true);
  if (n === ctx.node) requestWeights();
  emit();
};
  ctx.toggleTrimming = toggleTrimming;


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
    if (ctx.handleDrag && n === ctx.node && ctx.handleDrag.id === h.id && ctx.handleDrag.mode === 'rotate' && handles.has(h.id)) continue;
    const end = unproject(screen.x + h.dx, screen.y + h.dy, screen.z);
    const old = handles.get(h.id);
    if (ctx.influence.reachMode === 'auto' && old) {
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
  if (n === ctx.node) requestWeights();
};
  ctx.onHandlesChange = onHandlesChange;


// --- rotation par les poignées (D2) -------------------------------------------------------------
// Comme une tangente de Bézier : l'angle dont tourne la poignée saisie autour du nœud, dans le plan
// face à la caméra, fait tourner la déformation. Glisser seul tourne aussi le sens de l'influence
// (les autres poignées non verrouillées tournent avec) ; Ctrl : rotation seule ; Alt : influence
// seule. Seulement nœud verrouillé (déverrouillé, on choisit son point) et poignée non ancrée.
const MIN_LEVER_PX = 8;

ctx.handleDrag = null;

const screenAngle = (dx: number, dy: number) => Math.atan2(-dy, dx);


const onHandleDrag = (nodeId: number, e: HandleDragEvent) => {
  const n = ctx.node;
  if (!n || n.id !== nodeId) return;
  if (e.phase === 'start') {
    const center = nodeLocal(n);
    const screen = project(center);
    if (n.rotation.angle === 0) {
      const camLocal = BABYLON.Vector3.TransformCoordinates(
        camera.globalPosition, layer.getPlateWorldMatrix().clone().invert(),
      );
      n.rotation.axis = camLocal.subtract(center).normalize();
    }
    // Sens : une petite rotation positive autour de l'axe tourne-t-elle la poignée dans le sens
    // trigonométrique à l'écran ? (dépend de la main du repère et du côté de la caméra)
    const v = unproject(screen.x + e.dx, screen.y + e.dy, screen.z).subtract(center);
    const p1 = project(center.add(v));
    const p2 = project(center.add(rotateAbout(v, n.rotation.axis, 0.01)));
    const turn = wrapPi(screenAngle(p2.x - screen.x, p2.y - screen.y) - screenAngle(p1.x - screen.x, p1.y - screen.y));
    ctx.handleDrag = { id: e.id, lastAngle: screenAngle(e.dx, e.dy), sign: turn < 0 ? -1 : 1, mode: e.mode, rotated: false };
    return;
  }
  const drag = ctx.handleDrag;
  if (!drag || drag.id !== e.id) return;
  drag.mode = e.mode;
  const angleNow = screenAngle(e.dx, e.dy);
  const turn = wrapPi(angleNow - drag.lastAngle);
  drag.lastAngle = angleNow;
  const lever = Math.hypot(e.dx, e.dy) >= MIN_LEVER_PX;
  // Mode Auto : pas d'ancrage, une poignée verrouillée en Portée tourne comme les autres.
  const anchored = e.locked && ctx.influence.reachMode !== 'auto';
  if (e.phase === 'move' && n.positionLocked && !anchored && lever && e.mode !== 'influence' && turn !== 0) {
    const a = turn * drag.sign;
    n.rotation.angle += a;
    n.rotation.applied = n.rotation.angle * n.rotation.fraction;
    drag.rotated = true;
    if (e.mode === 'both') {
      for (const [id, h] of n.handles) {
        if (id !== e.id && !h.lockPoint) h.v = rotateAbout(h.v, n.rotation.axis, a);
      }
      requestWeights();
    }
    pushTransform(n);
    updateView(true);
    requestDelta(n);
  }
  if (e.phase === 'end') {
    ctx.handleDrag = null;
    if (drag.rotated && n.positionLocked) commitNode(n);
    else updateView(true);
  }
};
  ctx.onHandleDrag = onHandleDrag;


let historyBusy = false;

const historyStep = (step: 'undo' | 'redo') => {
  if (ctx.status !== 'ready' || historyBusy || ctx.committing) return;
  // Une validation et ses copies par symétrie ne font qu'une étape.
  const groups = step === 'undo' ? ctx.undoGroups : ctx.redoGroups;
  const other = step === 'undo' ? ctx.redoGroups : ctx.undoGroups;
  const depth = step === 'undo' ? ctx.undoDepth : ctx.redoDepth;
  const count = Math.max(1, Math.min(groups.length ? groups[groups.length - 1] : 1, depth || 1));
  historyBusy = true;
  void busy((async () => {
    let touched: Uint32Array | undefined;
    let done = 0;
    for (let i = 0; i < count; i++) {
      const change = await (step === 'undo' ? editKernel.undo() : editKernel.redo());
      ctx.undoDepth = change.undoDepth;
      ctx.redoDepth = change.redoDepth;
      if (!change.ok) break;
      done++;
      // Couches inserées : rétablir les remet avant les valeurs, annuler les retire après.
      if (change.splice?.inserted) await applySplice(change.splice);
      const parsed = layer.getParsed();
      if (parsed) journalStep(parsed, step);
      applyChange(change.indices, change.values, change.trimmed, change.trimState);
      if (change.splice && !change.splice.inserted) await applySplice(change.splice);
      if (change.indices?.length) touched = change.indices;
    }
    if (done > 0) {
      groups.pop();
      other.push(done);
    }
    return touched;
  })()).then((touched) => {
    historyBusy = false;
    if (ctx.node) {
      ctx.node.original = originalOf(ctx.node.index);
      ctx.delta = null;
      requestWeights();
    }
    updateView(true);
    emit();
    void afterEdit(touched);
  }).catch(() => { historyBusy = false; });
};
  ctx.historyStep = historyStep;
}
