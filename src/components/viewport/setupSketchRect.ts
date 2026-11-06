import * as BABYLON from 'babylonjs';
import { createScreenLine } from '../screenLine';
import React from 'react';
import type { SketchDimField } from './types';
import type { ViewportCtx } from './context';

/** Outil d'esquisse : rectangle et ses champs de dimension. */
export function setupSketchRect(c: ViewportCtx) {
  const { gridFrameMatrix, scene, canvas, engine, camera, gridNormal, gridFrameOrigin, gridFrameInverse, sketchDimInputs, setSketchDimsShown, setSketchCursor, sketchDimsApi } = c;


  // ---------------------------------------------------------------------------------
  // Outil Rectangle de l'esquisse : curseur « + » blanc aimanté aux traits fins de la grille
  // (carré bleu autour quand il l'est), tracé au clic-clic ou au glisser. Le rectangle vit dans
  // le repère de la grille (aligné sur le plan d'esquisse) ; ses points sont envoyés à l'arbre
  // des features (`apex-sketch-entity-added`) en coordonnées locales du plan (x, z de la grille).
  // ---------------------------------------------------------------------------------
  const SKETCH_SNAP_RADIUS_PX = 7;

  const SKETCH_DRAG_FINISH_PX = 6;

  c.sketchRectActive = false;

  let sketchRectStart: { x: number; z: number } | null = null;

  let sketchRectDownClient: { x: number; y: number } | null = null;

  let sketchRectPreview: BABYLON.Mesh | null = null;

  let sketchRectCounter = 0;

  const sketchDrawnMeshes: BABYLON.Mesh[] = [];
  c.sketchDrawnMeshes = sketchDrawnMeshes;


  const sketchLocalToWorld = (x: number, z: number) =>
    BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(x, 0, z), gridFrameMatrix);

  const makeSketchRectMesh = (
    name: string, a: { x: number; z: number }, b: { x: number; z: number }, color: BABYLON.Color3,
  ) => {
    const loop = [
      sketchLocalToWorld(a.x, a.z), sketchLocalToWorld(b.x, a.z),
      sketchLocalToWorld(b.x, b.z), sketchLocalToWorld(a.x, b.z), sketchLocalToWorld(a.x, a.z),
    ];
    const mesh = createScreenLine(scene, name, loop, color, 2.5, 1);
    mesh.isPickable = false;
    mesh.renderingGroupId = 3;
    return mesh;
  };


  /** Point de la grille sous la souris : coordonnées locales, aimanté ou non, et position écran. */
  const sketchPointUnderPointer = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const sx = engine.getRenderWidth() / rect.width;
    const sy = engine.getRenderHeight() / rect.height;
    const ray = scene.createPickingRay(
      (clientX - rect.left) * sx, (clientY - rect.top) * sy, BABYLON.Matrix.Identity(), camera,
    );
    const denom = BABYLON.Vector3.Dot(ray.direction, gridNormal);
    if (Math.abs(denom) < 1e-6) return null;
    const t = BABYLON.Vector3.Dot(gridFrameOrigin.subtract(ray.origin), gridNormal) / denom;
    if (t <= 0) return null;
    const local = BABYLON.Vector3.TransformCoordinates(ray.origin.add(ray.direction.scale(t)), gridFrameInverse);
    // Aimantation sur les traits fins (pas principal / 5), si le sommet le plus proche est
    // à moins de SKETCH_SNAP_RADIUS_PX de la souris.
    const minor = Math.max(c.gridStepScale, 1e-9) / 5;
    const snapX = Math.round(local.x / minor) * minor;
    const snapZ = Math.round(local.z / minor) * minor;
    const projected = BABYLON.Vector3.Project(
      sketchLocalToWorld(snapX, snapZ), BABYLON.Matrix.IdentityReadOnly, scene.getTransformMatrix(),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    );
    const snapClientX = rect.left + projected.x / sx;
    const snapClientY = rect.top + projected.y / sy;
    const snapped = Math.hypot(snapClientX - clientX, snapClientY - clientY) <= SKETCH_SNAP_RADIUS_PX;
    return snapped
      ? { x: snapX, z: snapZ, snapped, clientX: snapClientX, clientY: snapClientY }
      : { x: local.x, z: local.z, snapped, clientX, clientY };
  };

  const newDimFields = (): SketchDimField[] =>
    [0, 1].map(() => ({ locked: false, value: 0, modified: false, lastGood: 0 }));

  let sketchDims = newDimFields();

  let sketchDimActive = 0;

  let sketchMouse: { x: number; z: number } | null = null;

  let sketchRectEnd: { x: number; z: number } | null = null;

  const sketchSign = { x: 1, z: 1 };

  const SKETCH_DIM_OFFSET_PX = 26;

  // Ombre portée des champs ; le contour rouge d'une valeur invalide s'y ajoute.
  const SKETCH_DIM_SHADOW = '0 4px 14px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.35)';

  const SKETCH_DIM_SHADOW_INVALID = `0 0 0 2px #ff453a, ${SKETCH_DIM_SHADOW}`;


  const parseDim = (text: string) => {
    const trimmed = text.trim();
    return trimmed === '' ? NaN : Number(trimmed.replace(',', '.'));
  };

  const isValidDim = (v: number) => Number.isFinite(v) && v > 0;

  const formatDim = (v: number) => String(Number(v.toFixed(3)));

  const dimInput = (i: number) => sketchDimInputs.current[i];


  const sketchClientOf = (x: number, z: number) => {
    const rect = canvas.getBoundingClientRect();
    const sx = engine.getRenderWidth() / Math.max(rect.width, 1);
    const sy = engine.getRenderHeight() / Math.max(rect.height, 1);
    const p = BABYLON.Vector3.Project(
      sketchLocalToWorld(x, z), BABYLON.Matrix.IdentityReadOnly, scene.getTransformMatrix(),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    );
    return { x: rect.left + p.x / sx, y: rect.top + p.y / sy };
  };


  const effectiveDim = (i: number, mouseDim: number) => {
    const f = sketchDims[i];
    if (f.modified) {
      const v = parseDim(dimInput(i)?.value ?? '');
      if (isValidDim(v)) return v;
    }
    return f.locked ? f.value : mouseDim;
  };


  const clearSketchRectPreview = () => {
    sketchRectPreview?.dispose();
    sketchRectPreview = null;
  };


  /** Recalcule le rectangle (souris + champs), son aperçu, les champs et leur position. */
  const updateSketchRect = () => {
    const start = sketchRectStart;
    if (!start || !sketchMouse) return;
    const dx = sketchMouse.x - start.x;
    const dz = sketchMouse.z - start.z;
    if (Math.abs(dx) > 1e-9) sketchSign.x = Math.sign(dx);
    if (Math.abs(dz) > 1e-9) sketchSign.z = Math.sign(dz);
    const lengthDim = effectiveDim(0, Math.abs(dx));
    const widthDim = effectiveDim(1, Math.abs(dz));
    const end = { x: start.x + sketchSign.x * lengthDim, z: start.z + sketchSign.z * widthDim };
    sketchRectEnd = end;

    clearSketchRectPreview();
    sketchRectPreview = makeSketchRectMesh('sketchRectPreview', start, end, new BABYLON.Color3(0.45, 0.8, 1));

    const shown = [lengthDim, widthDim];
    for (let i = 0; i < 2; i += 1) {
      const input = dimInput(i);
      const f = sketchDims[i];
      if (!f.modified && shown[i] > 0) f.lastGood = shown[i];
      if (!input) continue;
      if (!f.modified) input.value = formatDim(shown[i]);
      input.style.boxShadow = isValidDim(parseDim(input.value)) ? SKETCH_DIM_SHADOW : SKETCH_DIM_SHADOW_INVALID;
    }

    // Champs à côté des deux côtés « d'arrivée » (opposés au premier point), côté extérieur.
    const centre = sketchClientOf((start.x + end.x) / 2, (start.z + end.z) / 2);
    const place = (i: number, ex: number, ez: number, fallback: { x: number; y: number }) => {
      const input = dimInput(i);
      if (!input) return;
      const edge = sketchClientOf(ex, ez);
      let vx = edge.x - centre.x;
      let vy = edge.y - centre.y;
      const len = Math.hypot(vx, vy);
      if (len < 1e-3) { vx = fallback.x; vy = fallback.y; } else { vx /= len; vy /= len; }
      input.style.left = `${edge.x + vx * SKETCH_DIM_OFFSET_PX}px`;
      input.style.top = `${edge.y + vy * SKETCH_DIM_OFFSET_PX}px`;
    };
    place(0, (start.x + end.x) / 2, end.z, { x: 0, y: 1 });
    place(1, end.x, (start.z + end.z) / 2, { x: 1, y: 0 });
  };


  const focusDim = (i: number, selectAll = true) => {
    sketchDimActive = i;
    const el = dimInput(i);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (selectAll) el.select();
  };

  const hideSketchDims = () => {
    setSketchDimsShown(false);
    sketchDims = newDimFields();
    sketchDimActive = 0;
    sketchMouse = null;
    sketchRectEnd = null;
  };


  const setSketchRectActive = (active: boolean) => {
    c.sketchRectActive = active;
    sketchRectStart = null;
    sketchRectDownClient = null;
    clearSketchRectPreview();
    hideSketchDims();
    if (!active) setSketchCursor(null);
    canvas.style.cursor = active ? 'none' : '';
  };

  const cancelSketchRect = () => {
    sketchRectStart = null;
    sketchRectDownClient = null;
    clearSketchRectPreview();
    hideSketchDims();
  };

  const finishSketchRect = (end: { x: number; z: number }) => {
    const start = sketchRectStart;
    cancelSketchRect();
    if (!start) return;
    if (Math.abs(end.x - start.x) < 1e-9 || Math.abs(end.z - start.z) < 1e-9) return;
    sketchRectCounter += 1;
    const id = `sketchRect${sketchRectCounter}`;
    sketchDrawnMeshes.push(makeSketchRectMesh(id, start, end, BABYLON.Color3.White()));
    c.registerSketchFace(id, start, end); // profil sélectionnable par l'outil Extrusion
    window.dispatchEvent(new CustomEvent('apex-sketch-entity-added', {
      detail: {
        entity: {
          id, kind: 'rectangle',
          points: [{ x: start.x, y: start.z }, { x: end.x, y: end.z }],
        },
      },
    }));
  };


  const onSketchRectMove = (e: PointerEvent) => {
    if (!c.sketchRectActive) return;
    canvas.style.cursor = 'none';
    const pt = sketchPointUnderPointer(e.clientX, e.clientY);
    if (!pt) { setSketchCursor(null); return; }
    setSketchCursor({ x: pt.clientX, y: pt.clientY, snapped: pt.snapped });
    if (sketchRectStart) {
      sketchMouse = { x: pt.x, z: pt.z };
      updateSketchRect();
    }
  };
  c.onSketchRectMove = onSketchRectMove;

  const finishFromPoint = (pt: { x: number; z: number }) => {
    sketchMouse = { x: pt.x, z: pt.z };
    updateSketchRect();
    if (sketchRectEnd) finishSketchRect(sketchRectEnd);
  };

  const refocusDim = () => {
    if (!sketchRectStart) return;
    requestAnimationFrame(() => focusDim(sketchDimActive, !sketchDims[sketchDimActive].modified));
  };

  const onSketchRectDown = (e: PointerEvent) => {
    if (!c.sketchRectActive || e.button !== 0) return;
    const pt = sketchPointUnderPointer(e.clientX, e.clientY);
    if (!pt) return;
    if (!sketchRectStart) {
      sketchRectStart = { x: pt.x, z: pt.z };
      sketchRectDownClient = { x: e.clientX, y: e.clientY };
      sketchMouse = { x: pt.x, z: pt.z };
      sketchDims = newDimFields();
      sketchDimActive = 0;
      setSketchDimsShown(true);
      // Les champs sont montés au prochain rendu : on les positionne et focalise ensuite.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!sketchRectStart) return;
        updateSketchRect();
        focusDim(0);
      }));
    } else {
      finishFromPoint(pt); // second clic
    }
  };
  c.onSketchRectDown = onSketchRectDown;

  const onSketchRectUp = (e: PointerEvent) => {
    if (!c.sketchRectActive || e.button !== 0 || !sketchRectStart || !sketchRectDownClient) return;
    // Glisser : le relâchement loin du point de départ termine le rectangle.
    if (Math.hypot(e.clientX - sketchRectDownClient.x, e.clientY - sketchRectDownClient.y) > SKETCH_DRAG_FINISH_PX) {
      const pt = sketchPointUnderPointer(e.clientX, e.clientY);
      if (pt) { finishFromPoint(pt); return; }
    }
    refocusDim();
  };
  c.onSketchRectUp = onSketchRectUp;

  const onSketchRectLeave = () => { if (c.sketchRectActive) setSketchCursor(null); };
  c.onSketchRectLeave = onSketchRectLeave;

  const onSketchRectKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && c.sketchRectActive && sketchRectStart) cancelSketchRect();
  };
  c.onSketchRectKey = onSketchRectKey;


  const onDimInput = (i: number) => {
    sketchDims[i].modified = true;
    updateSketchRect();
  };

  const onDimKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    // Aucune touche saisie ici ne doit atteindre les raccourcis globaux (Suppr, Ctrl+Z…).
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); cancelSketchRect(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      updateSketchRect();
      if (sketchRectEnd) finishSketchRect(sketchRectEnd);
      return;
    }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const f = sketchDims[i];
    const el = dimInput(i);
    if (el && f.modified) {
      const v = parseDim(el.value);
      if (isValidDim(v)) {
        f.locked = true; // valeur modifiée et valide : verrouillée
        f.value = v;
        f.modified = false;
        el.value = formatDim(v);
      } else {
        f.modified = false; // invalide : on remet simplement l'ancienne valeur
        el.value = formatDim(f.locked ? f.value : f.lastGood);
      }
    }
    updateSketchRect();
    focusDim((i + 1) % 2);
  };

  sketchDimsApi.current = { onKey: onDimKey, onInput: onDimInput };


  canvas.addEventListener('pointermove', onSketchRectMove);

  canvas.addEventListener('pointerdown', onSketchRectDown);

  canvas.addEventListener('pointerup', onSketchRectUp);

  canvas.addEventListener('pointerleave', onSketchRectLeave);

  window.addEventListener('keydown', onSketchRectKey);


  const onSketchToolEvent = (e: Event) => {
    const entity = (e as CustomEvent<{ entity: string | null }>).detail?.entity ?? null;
    setSketchRectActive(entity === 'rectangle');
  };
  c.onSketchToolEvent = onSketchToolEvent;

  const onSketchRectDeactivate = () => setSketchRectActive(false);
  c.onSketchRectDeactivate = onSketchRectDeactivate;

  window.addEventListener('apex-sketch-tool', onSketchToolEvent);

  [
    'apex-tool-changed', 'apex-sketch-plane-pick-start', 'apex-sketch-plane-pick-cancel',
    'apex-mode-changed', 'apex-sketch-plane-selected',
  ].forEach((name) => window.addEventListener(name, onSketchRectDeactivate));
}
