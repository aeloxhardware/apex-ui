// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';
import { createAirContourCallout } from '../airContourCallout';
import { createGCodeLayer, type ParsedGCode, type ColorByMode } from '../gcodeLayer';
import { createGCodeEditController, type GCodeEditController } from '../edit-node/gcodeEditController';
import { type ColorByScope } from '../gcodeColormap';
import { type LineTypeVisibility } from '../gcodeLineTypes';
import { isPreviewSpace } from '@/utils/previewSpace';
import type { ViewportState } from './viewportState';

import { emitApex } from '@/events/apexEvents';
function setupSyncGCodePicking(st: ViewportState) {
  const { camera, canvas, engine, glassDisc, modelsRef, originAxesRoot, scene, setEditController, volumeRoot } = st;
  // Espace Prévisualisation : trajectoire G-code polaire (cf. gcodeLayer.ts) posée sur le
  // plateau de cette même scène, pour garder exactement le décor de Préparation. Les modèles
  // de préparation sont masqués le temps de l'espace, sans être touchés. Le chargement de
  // fichier, la lecture et les réglages vivent dans GCodePreview, qui pilote ce calque.
  const gcodeAnchor = new BABYLON.TransformNode("gcodeAnchor", scene);
  gcodeAnchor.parent = volumeRoot;
  gcodeAnchor.position.y = glassDisc.position.y + 0.05; // Z = 0 du G-code : juste sur le disque
  st.gcodePreviewActive = false;
  st.syncGCodePicking = () => {};
  const gcodeLayer = createGCodeLayer(scene, gcodeAnchor, (rotationY) => {
    if (st.gcodePreviewActive) originAxesRoot.rotation.y = rotationY;
  });
  // Onglet Édition : nœud d'édition du G-code (cf. edit-node/gcodeEditController.ts).
  const editController = createGCodeEditController({
    scene, engine, camera, canvas, layer: gcodeLayer, isPreviewActive: () => st.gcodePreviewActive,
  });
  setEditController(editController);
  const airCallout = createAirContourCallout({
    scene, engine, camera, canvas, layer: gcodeLayer, isPreviewActive: () => st.gcodePreviewActive,
  });
  if (import.meta.env.DEV) (window as unknown as { __apexEdit?: GCodeEditController }).__apexEdit = editController;
  const onGCodePreviewToggled = (e: Event) => {
    const active = !!(e as CustomEvent<{ active: boolean }>).detail?.active;
    st.gcodePreviewActive = active;
    st.syncGCodePicking();
    // L'infobulle d'un espace ne doit pas survivre au passage dans l'autre.
    emitApex('apex-model-hover', { visible: false, x: 0, y: 0, modelName: '', hasTexture: false });
    originAxesRoot.rotation.y = active ? gcodeLayer.getPlateRotation() : 0;
    gcodeLayer.setEnabled(active);
    modelsRef.current.forEach((m) => { if (!m.isDisposed()) m.setEnabled(!active); });
    editController.refresh();
    airCallout.setPreviewActive();
  };
  Object.assign(st, { gcodeLayer, editController, airCallout, onGCodePreviewToggled });
}

function setupOnGCodeLoaded(st: ViewportState) {
  const { airCallout, editController, gcodeLayer } = st;
  const onGCodeLoaded = (e: Event) => {
    const detail = (e as CustomEvent<{ parsed: ParsedGCode; handled?: boolean; onBuilt?: () => void }>).detail;
    if (!detail?.parsed) return;
    // Maillage construit par tranches (UI non gelée) : on prévient l'émetteur à la fin pour que
    // le rideau de chargement reste affiché jusque-là.
    detail.handled = true;
    void gcodeLayer.load(detail.parsed).finally(() => {
      detail.onBuilt?.();
      editController.refresh();
      airCallout.setParsed(detail.parsed);
    });
  };
  const onGCodeTime = (e: Event) => {
    const t = (e as CustomEvent<{ t: number }>).detail?.t;
    if (typeof t === 'number') gcodeLayer.setTime(t);
  };
  const onGCodeLineVisibility = (e: Event) => {
    const visibility = (e as CustomEvent<{ visibility: LineTypeVisibility }>).detail?.visibility;
    if (visibility) { gcodeLayer.setLineTypeVisibility(visibility); airCallout.setLineVisibility(visibility); }
  };
  const onGCodeHighlightOffPlate = (e: Event) => {
    const detail = (e as CustomEvent<{ show: boolean; blinking?: boolean }>).detail;
    gcodeLayer.setOffPlateHighlight(!!detail?.show);
    gcodeLayer.setOffPlateBlinking(!!detail?.blinking);
  };
  const onGCodeShowFullHead = (e: Event) => {
    gcodeLayer.setFullHead(!!(e as CustomEvent<{ show: boolean }>).detail?.show);
  };
  const onGCodeColorBy = (e: Event) => {
    const detail = (e as CustomEvent<{ mode: ColorByMode; scope?: ColorByScope }>).detail;
    if (detail?.mode) gcodeLayer.setColorBy(detail.mode, detail.scope);
  };
  const onGCodeRenderPrecision = (e: Event) => {
    const mm = (e as CustomEvent<{ mm: number | null }>).detail?.mm;
    gcodeLayer.setRenderPrecision(mm ?? null);
  };
  // Sélection d'un point de trajectoire (`apex-gcode-pick-mode { active }`, cf. use-gcode-preview.ts) :
  // survol = point surligné sous le curseur ; clic (sans glisser, pour ne pas voler l'orbite de la
  // caméra) = `apex-gcode-point-picked { t }`, l'index de mouvement où la tête dépose ce point.
  st.gcodePickMode = false;
  st.gcodePickDown = null;
  Object.assign(st, { onGCodeLoaded, onGCodeTime, onGCodeLineVisibility, onGCodeHighlightOffPlate,
    onGCodeShowFullHead, onGCodeColorBy, onGCodeRenderPrecision });
}

function setupPickGCodePoint(st: ViewportState) {
  const { camera, canvas, engine, gcodeLayer, onGCodeHighlightOffPlate, onGCodeLineVisibility, onGCodeLoaded, onGCodePreviewToggled, onGCodeShowFullHead, onGCodeTime, scene } = st;
  const pickGCodePoint = () => {
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
    const pxPerUnit = (2 * Math.tan(camera.fov / 2)) / Math.max(1, engine.getRenderHeight());
    return gcodeLayer.pickAt(ray, pxPerUnit, st.orthoActive ? camera.radius : undefined);
  };
  // L'index spatial de sélection sert aussi à l'infobulle de survol du tracé (Prévisualisation) :
  // il reste donc construit tant que l'espace est affiché, pas seulement en mode « point de trajectoire ».
  st.syncGCodePicking = () => gcodeLayer.setPickingEnabled(st.gcodePickMode || st.gcodePreviewActive);
  const setGCodePickMode = (active: boolean) => {
    st.gcodePickMode = active;
    st.gcodePickDown = null;
    st.syncGCodePicking();
    if (!active) gcodeLayer.setPickHighlight(null);
    canvas.style.cursor = active ? 'crosshair' : '';
  };
  const onGCodePickMode = (e: Event) => setGCodePickMode(!!(e as CustomEvent<{ active: boolean }>).detail?.active);
  const gcodePickObserver = scene.onPointerObservable.add((pointerInfo) => {
    if (!st.gcodePickMode || !st.gcodePreviewActive) return;
    const evt = pointerInfo.event as PointerEvent;
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      if (evt.buttons !== 0) { gcodeLayer.setPickHighlight(null); return; }
      gcodeLayer.setPickHighlight(pickGCodePoint()?.local ?? null);
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN && evt.button === 0) {
      st.gcodePickDown = { x: evt.clientX, y: evt.clientY };
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP && evt.button === 0) {
      const down = st.gcodePickDown;
      st.gcodePickDown = null;
      if (!down || Math.hypot(evt.clientX - down.x, evt.clientY - down.y) > 5) return;
      const hit = pickGCodePoint();
      if (hit) emitApex('apex-gcode-point-picked', { t: hit.t });
    }
  });
  window.addEventListener('apex-gcode-pick-mode', onGCodePickMode);
  window.addEventListener('apex-preview-toggled', onGCodePreviewToggled);
  // Monté depuis l'Accueil / Paramètres, on arrive après le départ de l'événement : on rattrape l'état.
  if (isPreviewSpace()) onGCodePreviewToggled(new CustomEvent('apex-preview-toggled', { detail: { active: true } }));
  window.addEventListener('apex-gcode-loaded', onGCodeLoaded);
  window.addEventListener('apex-gcode-time', onGCodeTime);
  window.addEventListener('apex-gcode-line-visibility', onGCodeLineVisibility);
  window.addEventListener('apex-gcode-highlight-offplate', onGCodeHighlightOffPlate);
  window.addEventListener('apex-gcode-show-full-head', onGCodeShowFullHead);
  Object.assign(st, { pickGCodePoint, onGCodePickMode, gcodePickObserver });
}

function setupGCodePart4(st: ViewportState) {
  const { onGCodeColorBy, onGCodeRenderPrecision } = st;
  window.addEventListener('apex-gcode-color-by', onGCodeColorBy);
  window.addEventListener('apex-gcode-render-precision', onGCodeRenderPrecision);
}

export function setupViewportGCode(st: ViewportState) {
  setupSyncGCodePicking(st);
  setupOnGCodeLoaded(st);
  setupPickGCodePoint(st);
  setupGCodePart4(st);
}
