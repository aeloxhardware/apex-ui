// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';
import { GCODE_MESH_PREFIX } from '../gcodeLayer';
import { LINE_TYPE_BY_ID } from '../gcodeLineTypes';
import { attachGizmoForTool, clearSelection } from './viewportSelectionActions';
import type { ViewportState } from './viewportState';

import { emitApex } from '@/events/apexEvents';
function setupCanvasRectForSelection(st: ViewportState) {
  const { canvas, setSelectionBox } = st;
  // ---------------------------------------------------------------------------------
  // Fenêtre de sélection (clic gauche + drag) : le clic gauche ne pilote plus la caméra
  // (cf. remap des boutons plus haut) et sert désormais exclusivement à ouvrir un
  // rectangle de sélection façon CAO, comme le clic droit dans la plupart des logiciels
  // 3D. En dessous du seuil de drag, on retombe sur la sélection simple par clic.
  // ---------------------------------------------------------------------------------
  const SELECTION_BOX_DRAG_THRESHOLD_PX = 5;
  st.selectionDragStart = null;
  st.selectionDragging = false;
  const canvasRectForSelection = () => canvas.getBoundingClientRect();

  // Description du rectangle de sélection affichée dans le bandeau du bas (TopRightMenu),
  // qui change selon le sens du drag (cf. règle « window »/« crossing » plus bas) — pour
  // ne pas redispatcher à chaque pointermove, on ne le fait qu'au changement de mode.
  const SELECTION_BOX_TOOLTIPS: Record<'window' | 'crossing', { title: string; desc: string }> = {
    window: {
      title: 'Sélection fenêtre',
      desc: 'Sélectionnez tous les objets compris en entier dans la fenêtre de sélection.',
    },
    crossing: {
      title: 'Sélection croisement',
      desc: 'Sélectionnez tous les objets touchés partiellement ou en entier par la fenêtre de sélection.',
    },
  };
  st.lastTooltipMode = null;
  const clearSelectionTooltip = () => {
    if (st.lastTooltipMode !== null) {
      st.lastTooltipMode = null;
      emitApex('apex-reset-tooltip');
    }
  };

  // Filet de sécurité : si le bouton est relâché hors du canvas, Babylon ne redéclenche pas
  // toujours POINTERUP dessus — on efface quand même le rectangle et l'état de drag pour ne
  // pas rester bloqué en sélection au prochain survol du canvas.
  const onWindowPointerUpSafety = () => {
    if (st.selectionDragStart) {
      st.selectionDragStart = null;
      st.selectionDragging = false;
      setSelectionBox(null);
      clearSelectionTooltip();
    }
  };
  window.addEventListener('pointerup', onWindowPointerUpSafety);
  Object.assign(st, { SELECTION_BOX_DRAG_THRESHOLD_PX, canvasRectForSelection, SELECTION_BOX_TOOLTIPS,
    clearSelectionTooltip, onWindowPointerUpSafety });
}

function setupPointerPart2(st: ViewportState) {
  const { onWindowPointerUpSafety } = st;
  window.addEventListener('pointercancel', onWindowPointerUpSafety);
}

/** Prédicat des maillages visables par le survol et le clic simple (jamais repères ni aperçu G-code). */
function uiPickPredicate(st: ViewportState): (mesh: BABYLON.AbstractMesh) => boolean {
  const { backdrop, glassDisc, groundPickPlane, modelingGrid, outline, topOutline } = st;
  const excluded: BABYLON.AbstractMesh[] = [glassDisc, outline, topOutline, backdrop, groundPickPlane, ...modelingGrid];
  // Repères de mise en scène (axes d'origine, éléments du plan d'esquisse) : jamais
  // sélectionnables ni ce qui alimente l'infobulle au survol.
  return (mesh) => !excluded.includes(mesh)
    && !mesh.name.includes("Gizmo")
    && !mesh.name.startsWith("boxDraw")
    && !mesh.name.startsWith("pyramidDraw")
    && !mesh.name.startsWith("sketchPlane")
    && !mesh.name.startsWith("originAxis")
    && !mesh.name.startsWith("plateAction")
    // Calque de prévisualisation G-code (tête, buse, trajets) : jamais un modèle du
    // plateau. Un prédicat passé à `scene.pick` court-circuite `isPickable`, d'où ce filtre.
    && !mesh.name.startsWith(GCODE_MESH_PREFIX);
}

/** Vrai si l'outil Rectangle ou un mode de face prend le clic : la sélection de modèle s'en abstient. */
function faceModeHandlesClick(st: ViewportState, pointerInfo: BABYLON.PointerInfo): boolean {
  const { edgeAt, extrudePointerRay, isExtrudeFaceMode, isFaceBrowseMode, isSolid, scene, sketchFaceMeshes } = st;
  if (st.sketchRectActive) return true; // outil Rectangle : le clic trace, il ne sélectionne pas
  if (isExtrudeFaceMode()) return true; // outil Extrusion en mode Face : le clic choisit une face
  // Modélisation (sélection de face hors Extrusion) : un clic sur une face plane la choisit
  // (onExtrudeDown) et ne sélectionne pas en plus le corps ; ailleurs, la sélection habituelle.
  const clicks = pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN
    || pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP
    || pointerInfo.type === BABYLON.PointerEventTypes.POINTERTAP;
  if (!isFaceBrowseMode() || !clicks) return false;
  const event = pointerInfo.event as PointerEvent;
  const { px, py } = extrudePointerRay(event.clientX, event.clientY);
  const facePick = scene.pick(px, py, (m) => (
    m.isPickable && m.isEnabled() && (sketchFaceMeshes.includes(m as BABYLON.Mesh) || isSolid(m))
  ));
  return !!facePick?.hit || !!edgeAt(event.clientX, event.clientY);
}

/** Rectangle de sélection en cours de tracé : met à jour son affichage. Vrai tant qu'on glisse. */
function updateSelectionDrag(st: ViewportState, evt: PointerEvent): boolean {
  const { SELECTION_BOX_DRAG_THRESHOLD_PX, SELECTION_BOX_TOOLTIPS, canvasRectForSelection, setSelectionBox } = st;
  if (!st.selectionDragStart) return false;
  const dx = evt.clientX - st.selectionDragStart.x;
  const dy = evt.clientY - st.selectionDragStart.y;
  if (!st.selectionDragging && Math.hypot(dx, dy) > SELECTION_BOX_DRAG_THRESHOLD_PX) {
    st.selectionDragging = true;
  }
  if (!st.selectionDragging) return false;
  const rect = canvasRectForSelection();
  const x0 = st.selectionDragStart.x - rect.left;
  const y0 = st.selectionDragStart.y - rect.top;
  const x1 = evt.clientX - rect.left;
  const y1 = evt.clientY - rect.top;
  // Sens du drag = direction depuis le point de départ, pas depuis le dernier move :
  // sinon un léger retour en arrière en cours de glisser ferait clignoter le mode.
  const dragMode: 'window' | 'crossing' = x1 >= x0 ? 'window' : 'crossing';
  setSelectionBox({
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
    mode: dragMode,
  });
  // Bandeau du bas : n'affiche/ne redispatche qu'au changement de mode, pas à
  // chaque pointermove.
  if (st.lastTooltipMode !== dragMode) {
    st.lastTooltipMode = dragMode;
    emitApex('apex-set-tooltip', SELECTION_BOX_TOOLTIPS[dragMode]);
  }
  return true; // Pendant le drag de sélection, on n'actualise pas le survol de modèle.
}

/** Prévisualisation : l'infobulle décrit le G-code sous le curseur (jamais un modèle du plateau,
 * masqué dans cet espace) — type de ligne, vitesse, couche, températures, position. */
function showGCodeHover(st: ViewportState, evt: PointerEvent) {
  const { gcodeLayer, pickGCodePoint } = st;
  const parsed = gcodeLayer.getParsed();
  const hit = parsed && evt.buttons === 0 ? pickGCodePoint() : null;
  if (!parsed || !hit) {
    emitApex('apex-model-hover', { visible: false, x: 0, y: 0, modelName: '', hasTexture: false });
    return;
  }
  const k = Math.min(parsed.moves.length - 1, Math.max(0, Math.ceil(hit.t)));
  const mv = parsed.moves[k];
  const lineType = LINE_TYPE_BY_ID[mv.type];
  const at = (arr: ArrayLike<number> | undefined) => (arr && arr.length > k ? arr[k] : null);
  emitApex('apex-model-hover', {
      visible: true, x: evt.clientX, y: evt.clientY, modelName: '', hasTexture: false,
      gcode: {
        kind: parsed.kind,
        lineLabel: lineType?.label ?? mv.type,
        lineColor: lineType?.color ?? '#ffffff',
        move: k + 1,
        moves: parsed.moves.length,
        x: mv.x, y: mv.y, z: mv.z, b: mv.b, c: mv.c,
        speedMmS: at(parsed.speedMmS),
        // Couches détectées par palier Z : sans sens dans un fichier non planaire (chaque
        // changement de Z ouvrirait une « couche »).
        layer: parsed.kind === 'cartesian' && !parsed.nonPlanar ? at(parsed.layerIndex) : null,
        layerHeightMm: at(parsed.layerHeightMm),
        widthMm: at(parsed.widthMm),
        nozzleTempC: at(parsed.nozzleTempC),
        fanPct: at(parsed.fanPct),
      },
    });
}

/** Infobulle du modèle survolé (nom, texture, nombre de triangles) ; masquée hors de tout modèle. */
function showModelHover(st: ViewportState, evt: PointerEvent, isPickable: (mesh: BABYLON.AbstractMesh) => boolean) {
  const { currentToolRef, getRootModel, scene } = st;
  const pick = scene.pick(scene.pointerX, scene.pointerY, isPickable);
  if (!pick?.hit || !pick.pickedMesh) {
    emitApex('apex-model-hover', { visible: false, x: 0, y: 0, modelName: '', hasTexture: false });
    return;
  }
  let hoveredMesh = pick.pickedMesh;
  if (currentToolRef.current !== 'texture') {
    hoveredMesh = getRootModel(hoveredMesh);
  }
  const hasTexture = hoveredMesh.material && hoveredMesh.material.name !== "boundaryMat";
  // Triangles du modèle survolé, parties comprises (le total de l'indexation, pas ceux du seul morceau pointé).
  let triangles = 0;
  for (const part of [hoveredMesh, ...hoveredMesh.getChildMeshes(false)]) {
    if (part.getTotalVertices() > 0) triangles += Math.floor(part.getTotalIndices() / 3);
  }
  emitApex('apex-model-hover', {
        visible: true,
        x: evt.clientX,
        y: evt.clientY,
        modelName: hoveredMesh.name || "Modèle 3D",
        hasTexture: !!hasTexture,
        triangles,
      });
}

function onPointerMove(st: ViewportState, evt: PointerEvent, isPickable: (mesh: BABYLON.AbstractMesh) => boolean) {
  if (updateSelectionDrag(st, evt)) return;
  if (st.gcodePreviewActive) {
    showGCodeHover(st, evt);
    return;
  }
  showModelHover(st, evt, isPickable);
}

function onPointerDown(st: ViewportState, pointerInfo: BABYLON.PointerInfo) {
  const evt = pointerInfo.event as PointerEvent;
  // Un clic gauche sur une poignée de gizmo (déplacer/tourner/redimensionner) doit la
  // faire glisser normalement, pas ouvrir un rectangle de sélection par-dessus.
  const hitsGizmo = !!pointerInfo.pickInfo?.hit && !!pointerInfo.pickInfo.pickedMesh?.name.includes("Gizmo");
  if (evt.button === 0 && !hitsGizmo) {
    st.selectionDragStart = { x: evt.clientX, y: evt.clientY };
    st.selectionDragging = false;
  }
}

/** Modèles retenus par le rectangle (coordonnées canvas) : « window » (drag vers la droite) exige
 * que les 8 coins du modèle tombent dans le rectangle, « crossing » (vers la gauche) un seul. */
function boxSelectionHits(
  st: ViewportState,
  rect: { minX: number; maxX: number; minY: number; maxY: number },
  mode: 'window' | 'crossing',
): BABYLON.AbstractMesh[] {
  const { camera, engine, modelsRef, scene } = st;
  const { minX, maxX, minY, maxY } = rect;
  const hits: BABYLON.AbstractMesh[] = [];
  modelsRef.current.forEach((mesh) => {
    if (mesh.isDisposed()) return;
    const meshes = [mesh, ...mesh.getChildMeshes()];
    const inside = meshes.some((m) => {
      if (!m.isEnabled() || !m.isVisible) return false;
      const bounding = m.getBoundingInfo();
      const min = bounding.boundingBox.minimumWorld;
      const max = bounding.boundingBox.maximumWorld;
      const corners = [
        new BABYLON.Vector3(min.x, min.y, min.z), new BABYLON.Vector3(max.x, min.y, min.z),
        new BABYLON.Vector3(min.x, max.y, min.z), new BABYLON.Vector3(max.x, max.y, min.z),
        new BABYLON.Vector3(min.x, min.y, max.z), new BABYLON.Vector3(max.x, min.y, max.z),
        new BABYLON.Vector3(min.x, max.y, max.z), new BABYLON.Vector3(max.x, max.y, max.z),
      ];
      const screenCorners = corners.map((corner) => BABYLON.Vector3.Project(
        corner, BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
        camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
      ));
      const inRect = (s: BABYLON.Vector3) =>
        s.z > 0 && s.z < 1 && s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY;
      return mode === 'window' ? screenCorners.every(inRect) : screenCorners.some(inRect);
    });
    if (inside) hits.push(mesh);
  });
  return hits;
}

/** Applique le résultat du rectangle : remplace (ou, avec Ctrl, complète) la sélection ; un
 * rectangle vide désélectionne, sauf avec Ctrl. */
function applyBoxSelection(st: ViewportState, hits: BABYLON.AbstractMesh[], additive: boolean) {
  const { selectedMeshesRef, setSelectedMeshName, updateHighlight, updateSelectedPosition, updateSelectedRotation } = st;
  if (hits.length === 0) {
    if (!additive) clearSelection(st);
    return;
  }
  const nextSelection = additive ? new Set(selectedMeshesRef.current) : new Set<BABYLON.AbstractMesh>();
  hits.forEach((m) => nextSelection.add(m));
  selectedMeshesRef.current = nextSelection;
  const all = Array.from(nextSelection);
  const last = all[all.length - 1];
  setSelectedMeshName(last.name || "Modèle 3D");
  updateHighlight();
  updateSelectedPosition();
  updateSelectedRotation();
  emitApex('apex-mesh-selected', { name: last.name, names: all.map((m) => m.name), subMeshes: [] });
  attachGizmoForTool(st, all.length === 1 ? all[0] : null);
}

/** Fin d'un glisser de sélection : retient les modèles du rectangle. */
function finishSelectionDrag(st: ViewportState, evt: PointerEvent, dragStart: { x: number; y: number }) {
  const { canvasRectForSelection, clearSelectionTooltip, setSelectionBox } = st;
  setSelectionBox(null);
  clearSelectionTooltip();
  const rect = canvasRectForSelection();
  const x0 = dragStart.x - rect.left;
  const y0 = dragStart.y - rect.top;
  const x1 = evt.clientX - rect.left;
  const y1 = evt.clientY - rect.top;
  // Même règle de sens que l'aperçu pendant le drag : vers la droite = fenêtre (ne retient que
  // les objets ENTIÈREMENT englobés), vers la gauche = croisement (tout objet TOUCHÉ, même
  // partiellement).
  const mode: 'window' | 'crossing' = x1 >= x0 ? 'window' : 'crossing';
  const hits = boxSelectionHits(st, {
    minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minY: Math.min(y0, y1), maxY: Math.max(y0, y1),
  }, mode);
  applyBoxSelection(st, hits, evt.ctrlKey || evt.metaKey);
}

function onPointerUp(st: ViewportState, pointerInfo: BABYLON.PointerInfo, isPickable: (mesh: BABYLON.AbstractMesh) => boolean) {
  const { currentToolRef, getRootModel, scene, selectMesh } = st;
  const evt = pointerInfo.event as PointerEvent;
  if (evt.button === 0 && st.selectionDragStart) {
    const wasDragging = st.selectionDragging;
    const dragStart = st.selectionDragStart;
    st.selectionDragStart = null;
    st.selectionDragging = false;
    if (wasDragging) {
      finishSelectionDrag(st, evt, dragStart);
      return; // Le rectangle a déjà tranché la sélection : pas de pick ponctuel en plus.
    }
  }
  const pick = scene.pick(scene.pointerX, scene.pointerY, isPickable);
  if (!pick?.hit || !pick.pickedMesh) return;
  const targetMesh = currentToolRef.current !== 'texture' ? getRootModel(pick.pickedMesh) : pick.pickedMesh;
  selectMesh(targetMesh, evt.ctrlKey || evt.metaKey);
}

function setupPointerObserver(st: ViewportState) {
  const { scene } = st;
  const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
    if (faceModeHandlesClick(st, pointerInfo)) return;
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      onPointerMove(st, pointerInfo.event as PointerEvent, uiPickPredicate(st));
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
      onPointerDown(st, pointerInfo);
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
      onPointerUp(st, pointerInfo, uiPickPredicate(st));
    }
  });
  Object.assign(st, { pointerObserver });
}

function setupRightPointerDownPos(st: ViewportState) {
  const { getRootModel, modelsRef, scene, setContextMenu, setContextModel, suppressNextBackdropContextMenuRef } = st;
  // Menu contextuel : piloté depuis Babylon plutôt que depuis l'événement DOM `contextmenu`
  // du canvas (cf. le commentaire sur `onContextMenu` dans le JSX) — Babylon attache déjà ses
  // propres écouteurs natifs pointerdown/pointerup sur ce même canvas pour la caméra, donc
  // `scene.onPointerObservable` est le seul point d'écoute garanti de recevoir l'événement.
  // On ne l'ouvre que sur un clic droit franc, pas sur un clic-drag-relâche (orbite/pan).
  const RIGHT_CLICK_DRAG_THRESHOLD_PX = 5;
  let rightPointerDownPos: { x: number; y: number } | null = null;
  const contextMenuPointerObserver = scene.onPointerObservable.add((pointerInfo) => {
    const evt = pointerInfo.event as PointerEvent;
    if (evt.button !== 2) return;

    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
      rightPointerDownPos = { x: evt.clientX, y: evt.clientY };
    } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
      const down = rightPointerDownPos;
      rightPointerDownPos = null;
      if (down) {
        const dx = evt.clientX - down.x;
        const dy = evt.clientY - down.y;
        if (Math.hypot(dx, dy) > RIGHT_CLICK_DRAG_THRESHOLD_PX) return;
      }
      // Clic droit sur un modèle (et non dans le vide) : le menu ajoute le sélecteur d'échelle.
      const hit = scene.pick(scene.pointerX, scene.pointerY, (m) => modelsRef.current.has(getRootModel(m)));
      const hitRoot = hit?.hit && hit.pickedMesh ? getRootModel(hit.pickedMesh) : null;
      setContextModel(hitRoot ? { name: hitRoot.name, unit: hitRoot.metadata?.apexUnit === 'in' ? 'in' : 'mm' } : null);
      suppressNextBackdropContextMenuRef.current = true;
      setContextMenu({ x: evt.clientX, y: evt.clientY });
    }
  });
  Object.assign(st, { contextMenuPointerObserver });
}

export function setupViewportPointer(st: ViewportState) {
  setupCanvasRectForSelection(st);
  setupPointerPart2(st);
  setupPointerObserver(st);
  setupRightPointerDownPos(st);
}
