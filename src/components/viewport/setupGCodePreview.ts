import * as BABYLON from 'babylonjs';
import { createGCodeLayer, ParsedGCode, ColorByMode } from '../gcodeLayer';
import { createGCodeEditController, GCodeEditController } from '../edit-node/gcodeEditController';
import { createAirContourCallout } from '../airContourCallout';
import { LineTypeVisibility } from '../gcodeLineTypes';
import type { ColorByScope } from '../gcodeColormap';
import { isPreviewSpace } from '@/utils/previewSpace';
import type { ViewportCtx } from './context';

/** Calque de prévisualisation G-code, contrôleur d'édition et événements associés. */
export function setupGCodePreview(c: ViewportCtx) {
  const { scene, volumeRoot, glassDisc, originAxesRoot, engine, camera, canvas, setEditController, modelsRef } = c;


  // Espace Prévisualisation : trajectoire G-code polaire (cf. gcodeLayer.ts) posée sur le
  // plateau de cette même scène, pour garder exactement le décor de Préparation. Les modèles
  // de préparation sont masqués le temps de l'espace, sans être touchés. Le chargement de
  // fichier, la lecture et les réglages vivent dans GCodePreview, qui pilote ce calque.
  const gcodeAnchor = new BABYLON.TransformNode("gcodeAnchor", scene);

  gcodeAnchor.parent = volumeRoot;

  gcodeAnchor.position.y = glassDisc.position.y + 0.05;
 // Z = 0 du G-code : juste sur le disque
  c.gcodePreviewActive = false;

  let syncGCodePicking = () => {};

  const gcodeLayer = createGCodeLayer(scene, gcodeAnchor, (rotationY) => {
    if (c.gcodePreviewActive) originAxesRoot.rotation.y = rotationY;
  });
  c.gcodeLayer = gcodeLayer;

  // Onglet Édition : nœud d'édition du G-code (cf. edit-node/gcodeEditController.ts).
  const editController = createGCodeEditController({
    scene, engine, camera, canvas, layer: gcodeLayer, isPreviewActive: () => c.gcodePreviewActive,
  });
  c.editController = editController;

  setEditController(editController);

  const airCallout = createAirContourCallout({
    scene, engine, camera, canvas, layer: gcodeLayer, isPreviewActive: () => c.gcodePreviewActive,
  });
  c.airCallout = airCallout;

  if (import.meta.env.DEV) (window as unknown as { __apexEdit?: GCodeEditController }).__apexEdit = editController;

  const onGCodePreviewToggled = (e: Event) => {
    const active = !!(e as CustomEvent<{ active: boolean }>).detail?.active;
    c.gcodePreviewActive = active;
    syncGCodePicking();
    // L'infobulle d'un espace ne doit pas survivre au passage dans l'autre.
    window.dispatchEvent(new CustomEvent('apex-model-hover', {
      detail: { visible: false, x: 0, y: 0, modelName: '', hasTexture: false },
    }));
    originAxesRoot.rotation.y = active ? gcodeLayer.getPlateRotation() : 0;
    gcodeLayer.setEnabled(active);
    modelsRef.current.forEach((m) => { if (!m.isDisposed()) m.setEnabled(!active); });
    editController.refresh();
    airCallout.setPreviewActive();
  };
  c.onGCodePreviewToggled = onGCodePreviewToggled;

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
  c.onGCodeLoaded = onGCodeLoaded;

  const onGCodeTime = (e: Event) => {
    const t = (e as CustomEvent<{ t: number }>).detail?.t;
    if (typeof t === 'number') gcodeLayer.setTime(t);
  };
  c.onGCodeTime = onGCodeTime;

  const onGCodeLineVisibility = (e: Event) => {
    const visibility = (e as CustomEvent<{ visibility: LineTypeVisibility }>).detail?.visibility;
    if (visibility) { gcodeLayer.setLineTypeVisibility(visibility); airCallout.setLineVisibility(visibility); }
  };
  c.onGCodeLineVisibility = onGCodeLineVisibility;

  const onGCodeHighlightOffPlate = (e: Event) => {
    const detail = (e as CustomEvent<{ show: boolean; blinking?: boolean }>).detail;
    gcodeLayer.setOffPlateHighlight(!!detail?.show);
    gcodeLayer.setOffPlateBlinking(!!detail?.blinking);
  };
  c.onGCodeHighlightOffPlate = onGCodeHighlightOffPlate;

  const onGCodeShowFullHead = (e: Event) => {
    gcodeLayer.setFullHead(!!(e as CustomEvent<{ show: boolean }>).detail?.show);
  };
  c.onGCodeShowFullHead = onGCodeShowFullHead;

  const onGCodeColorBy = (e: Event) => {
    const detail = (e as CustomEvent<{ mode: ColorByMode; scope?: ColorByScope }>).detail;
    if (detail?.mode) gcodeLayer.setColorBy(detail.mode, detail.scope);
  };
  c.onGCodeColorBy = onGCodeColorBy;

  const onGCodeRenderPrecision = (e: Event) => {
    const mm = (e as CustomEvent<{ mm: number | null }>).detail?.mm;
    gcodeLayer.setRenderPrecision(mm ?? null);
  };
  c.onGCodeRenderPrecision = onGCodeRenderPrecision;

  // Sélection d'un point de trajectoire (`apex-gcode-pick-mode { active }`, cf. use-gcode-preview.ts) :
  // survol = point surligné sous le curseur ; clic (sans glisser, pour ne pas voler l'orbite de la
  // caméra) = `apex-gcode-point-picked { t }`, l'index de mouvement où la tête dépose ce point.
  let gcodePickMode = false;

  let gcodePickDown: { x: number; y: number } | null = null;

  const pickGCodePoint = () => {
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
    const pxPerUnit = (2 * Math.tan(camera.fov / 2)) / Math.max(1, engine.getRenderHeight());
    return gcodeLayer.pickAt(ray, pxPerUnit, c.orthoActive ? camera.radius : undefined);
  };
  c.pickGCodePoint = pickGCodePoint;

  // L'index spatial de sélection sert aussi à l'infobulle de survol du tracé (Prévisualisation) :
  // il reste donc construit tant que l'espace est affiché, pas seulement en mode « point de trajectoire ».
  syncGCodePicking = () => gcodeLayer.setPickingEnabled(gcodePickMode || c.gcodePreviewActive);

  const setGCodePickMode = (active: boolean) => {
    gcodePickMode = active;
    gcodePickDown = null;
    syncGCodePicking();
    if (!active) gcodeLayer.setPickHighlight(null);
    canvas.style.cursor = active ? 'crosshair' : '';
  };

  const onGCodePickMode = (e: Event) => setGCodePickMode(!!(e as CustomEvent<{ active: boolean }>).detail?.active);
  c.onGCodePickMode = onGCodePickMode;

  const gcodePickObserver = scene.onPointerObservable.add((pointerInfo) => {
    if (!gcodePickMode || !c.gcodePreviewActive) return;
    const evt = pointerInfo.event as PointerEvent;
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      if (evt.buttons !== 0) { gcodeLayer.setPickHighlight(null); return; }
      gcodeLayer.setPickHighlight(pickGCodePoint()?.local ?? null);
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN && evt.button === 0) {
      gcodePickDown = { x: evt.clientX, y: evt.clientY };
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP && evt.button === 0) {
      const down = gcodePickDown;
      gcodePickDown = null;
      if (!down || Math.hypot(evt.clientX - down.x, evt.clientY - down.y) > 5) return;
      const hit = pickGCodePoint();
      if (hit) window.dispatchEvent(new CustomEvent('apex-gcode-point-picked', { detail: { t: hit.t } }));
    }
  });
  c.gcodePickObserver = gcodePickObserver;

  window.addEventListener('apex-gcode-pick-mode', onGCodePickMode);

  window.addEventListener('apex-preview-toggled', onGCodePreviewToggled);

  // Monté depuis l'Accueil / Paramètres, on arrive après le départ de l'événement : on rattrape l'état.
  if (isPreviewSpace()) onGCodePreviewToggled(new CustomEvent('apex-preview-toggled', { detail: { active: true } }));

  window.addEventListener('apex-gcode-loaded', onGCodeLoaded);

  window.addEventListener('apex-gcode-time', onGCodeTime);

  window.addEventListener('apex-gcode-line-visibility', onGCodeLineVisibility);

  window.addEventListener('apex-gcode-highlight-offplate', onGCodeHighlightOffPlate);

  window.addEventListener('apex-gcode-show-full-head', onGCodeShowFullHead);

  window.addEventListener('apex-gcode-color-by', onGCodeColorBy);

  window.addEventListener('apex-gcode-render-precision', onGCodeRenderPrecision);
}
