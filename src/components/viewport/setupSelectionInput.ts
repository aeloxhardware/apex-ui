import * as BABYLON from 'babylonjs';
import { GCODE_MESH_PREFIX } from '../gcodeLayer';
import { LINE_TYPE_BY_ID } from '../gcodeLineTypes';
import type { ViewportCtx } from './context';

/** Sélection au pointeur (clic, fenêtre) et menu contextuel. */
export function setupSelectionInput(c: ViewportCtx) {
  const { canvas, scene, isExtrudeFaceMode, isFaceBrowseMode, extrudePointerRay, sketchFaceMeshes, isSolid, edgeAt, glassDisc, outline, topOutline, backdrop, groundPickPlane, modelingGrid, gcodeLayer, pickGCodePoint, getRootModel, camera, engine, updateHighlight, updateSelectedPosition, updateSelectedRotation, gizmoManager, applyCustomGizmoColors, setupGizmoDragEnd, selectMesh, setSelectionBox, currentToolRef, modelsRef, selectedMeshesRef, setSelectedMeshName, setContextModel, suppressNextBackdropContextMenuRef, setContextMenu } = c;


  // ---------------------------------------------------------------------------------
  // Fenêtre de sélection (clic gauche + drag) : le clic gauche ne pilote plus la caméra
  // (cf. remap des boutons plus haut) et sert désormais exclusivement à ouvrir un
  // rectangle de sélection façon CAO, comme le clic droit dans la plupart des logiciels
  // 3D. En dessous du seuil de drag, on retombe sur la sélection simple par clic.
  // ---------------------------------------------------------------------------------
  const SELECTION_BOX_DRAG_THRESHOLD_PX = 5;

  let selectionDragStart: { x: number; y: number } | null = null;

  let selectionDragging = false;

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

  let lastTooltipMode: 'window' | 'crossing' | null = null;

  const clearSelectionTooltip = () => {
    if (lastTooltipMode !== null) {
      lastTooltipMode = null;
      window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));
    }
  };


  // Filet de sécurité : si le bouton est relâché hors du canvas, Babylon ne redéclenche pas
  // toujours POINTERUP dessus — on efface quand même le rectangle et l'état de drag pour ne
  // pas rester bloqué en sélection au prochain survol du canvas.
  const onWindowPointerUpSafety = () => {
    if (selectionDragStart) {
      selectionDragStart = null;
      selectionDragging = false;
      setSelectionBox(null);
      clearSelectionTooltip();
    }
  };
  c.onWindowPointerUpSafety = onWindowPointerUpSafety;

  window.addEventListener('pointerup', onWindowPointerUpSafety);

  window.addEventListener('pointercancel', onWindowPointerUpSafety);


  const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
    if (c.sketchRectActive) return; // outil Rectangle : le clic trace, il ne sélectionne pas
    if (isExtrudeFaceMode()) return; // outil Extrusion en mode Face : le clic choisit une face
    // Modélisation (sélection de face hors Extrusion) : un clic sur une face plane la choisit
    // (onExtrudeDown) et ne sélectionne pas en plus le corps ; ailleurs, la sélection habituelle.
    if (
      isFaceBrowseMode()
      && (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN
        || pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP
        || pointerInfo.type === BABYLON.PointerEventTypes.POINTERTAP)
    ) {
      const downEvent = pointerInfo.event as PointerEvent;
      const { px, py } = extrudePointerRay(downEvent.clientX, downEvent.clientY);
      const facePick = scene.pick(px, py, (m) => (
        m.isPickable && m.isEnabled() && (sketchFaceMeshes.includes(m as BABYLON.Mesh) || isSolid(m))
      ));
      if (facePick?.hit) return;
      const clientEvent = pointerInfo.event as PointerEvent;
      if (edgeAt(clientEvent.clientX, clientEvent.clientY)) return;
    }
    const excluded: BABYLON.AbstractMesh[] = [glassDisc, outline, topOutline, backdrop, groundPickPlane, ...modelingGrid];
    // Repères de mise en scène (axes d'origine, éléments du plan d'esquisse) : jamais
    // sélectionnables ni ce qui alimente l'infobulle au survol.
    const isPickableForUi = (mesh: BABYLON.AbstractMesh) =>
      !excluded.includes(mesh)
      && !mesh.name.includes("Gizmo")
      && !mesh.name.startsWith("boxDraw")
      && !mesh.name.startsWith("pyramidDraw")
      && !mesh.name.startsWith("sketchPlane")
      && !mesh.name.startsWith("originAxis")
      && !mesh.name.startsWith("plateAction")
      // Calque de prévisualisation G-code (tête, buse, trajets) : jamais un modèle du
      // plateau. Un prédicat passé à `scene.pick` court-circuite `isPickable`, d'où ce filtre.
      && !mesh.name.startsWith(GCODE_MESH_PREFIX);

    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      const evt = pointerInfo.event as PointerEvent;

      if (selectionDragStart) {
        const dx = evt.clientX - selectionDragStart.x;
        const dy = evt.clientY - selectionDragStart.y;
        if (!selectionDragging && Math.hypot(dx, dy) > SELECTION_BOX_DRAG_THRESHOLD_PX) {
          selectionDragging = true;
        }
        if (selectionDragging) {
          const rect = canvasRectForSelection();
          const x0 = selectionDragStart.x - rect.left;
          const y0 = selectionDragStart.y - rect.top;
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
          if (lastTooltipMode !== dragMode) {
            lastTooltipMode = dragMode;
            window.dispatchEvent(
              new CustomEvent('apex-set-tooltip', { detail: SELECTION_BOX_TOOLTIPS[dragMode] }),
            );
          }
          return; // Pendant le drag de sélection, on n'actualise pas le survol de modèle.
        }
      }

      const clientX = evt.clientX;
      const clientY = evt.clientY;

      // Prévisualisation : l'infobulle décrit le G-code sous le curseur (jamais un modèle du plateau,
      // masqué dans cet espace) — type de ligne, vitesse, couche, températures, position.
      if (c.gcodePreviewActive) {
        const parsed = gcodeLayer.getParsed();
        const hit = parsed && evt.buttons === 0 ? pickGCodePoint() : null;
        if (parsed && hit) {
          const k = Math.min(parsed.moves.length - 1, Math.max(0, Math.ceil(hit.t)));
          const mv = parsed.moves[k];
          const lineType = LINE_TYPE_BY_ID[mv.type];
          const at = (arr: ArrayLike<number> | undefined) => (arr && arr.length > k ? arr[k] : null);
          window.dispatchEvent(new CustomEvent('apex-model-hover', {
            detail: {
              visible: true, x: clientX, y: clientY, modelName: '', hasTexture: false,
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
            },
          }));
        } else {
          window.dispatchEvent(new CustomEvent('apex-model-hover', {
            detail: { visible: false, x: 0, y: 0, modelName: '', hasTexture: false },
          }));
        }
        return;
      }

      const pick = scene.pick(scene.pointerX, scene.pointerY, isPickableForUi);

      if (pick?.hit && pick.pickedMesh) {
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
        window.dispatchEvent(
          new CustomEvent('apex-model-hover', {
            detail: {
              visible: true,
              x: clientX,
              y: clientY,
              modelName: hoveredMesh.name || "Modèle 3D",
              hasTexture: !!hasTexture,
              triangles,
            }
          })
        );
      } else {
        window.dispatchEvent(
          new CustomEvent('apex-model-hover', {
            detail: { visible: false, x: 0, y: 0, modelName: '', hasTexture: false }
          })
        );
      }
    }

    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
      const evt = pointerInfo.event as PointerEvent;
      // Un clic gauche sur une poignée de gizmo (déplacer/tourner/redimensionner) doit la
      // faire glisser normalement, pas ouvrir un rectangle de sélection par-dessus.
      const hitsGizmo = !!pointerInfo.pickInfo?.hit && !!pointerInfo.pickInfo.pickedMesh?.name.includes("Gizmo");
      if (evt.button === 0 && !hitsGizmo) {
        selectionDragStart = { x: evt.clientX, y: evt.clientY };
        selectionDragging = false;
      }
    }

    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
      const evt = pointerInfo.event as PointerEvent;

      if (evt.button === 0 && selectionDragStart) {
        const wasDragging = selectionDragging;
        const dragStart = selectionDragStart;
        selectionDragStart = null;
        selectionDragging = false;

        if (wasDragging) {
          setSelectionBox(null);
          clearSelectionTooltip();
          const rect = canvasRectForSelection();
          const x0 = dragStart.x - rect.left;
          const y0 = dragStart.y - rect.top;
          const x1 = evt.clientX - rect.left;
          const y1 = evt.clientY - rect.top;
          const minX = Math.min(x0, x1);
          const maxX = Math.max(x0, x1);
          const minY = Math.min(y0, y1);
          const maxY = Math.max(y0, y1);
          // Même règle de sens que l'aperçu pendant le drag (cf. plus haut) : vers la droite =
          // fenêtre (ne retient que les objets ENTIÈREMENT englobés), vers la gauche =
          // croisement (retient tout objet TOUCHÉ, même partiellement).
          const mode: 'window' | 'crossing' = x1 >= x0 ? 'window' : 'crossing';

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
              // « window » (drag vers la droite) : les 8 coins doivent tomber dans le rectangle
              // — l'objet doit être entièrement englobé. « crossing » (drag vers la gauche) :
              // un seul coin suffit — l'objet est retenu dès qu'il est simplement touché.
              return mode === 'window' ? screenCorners.every(inRect) : screenCorners.some(inRect);
            });
            if (inside) hits.push(mesh);
          });

          const additive = evt.ctrlKey || evt.metaKey;
          if (hits.length > 0) {
            const nextSelection = additive ? new Set(selectedMeshesRef.current) : new Set<BABYLON.AbstractMesh>();
            hits.forEach((m) => nextSelection.add(m));
            selectedMeshesRef.current = nextSelection;
            const all = Array.from(nextSelection);
            const last = all[all.length - 1];
            setSelectedMeshName(last.name || "Modèle 3D");
            updateHighlight();
            updateSelectedPosition();
            updateSelectedRotation();
            window.dispatchEvent(new CustomEvent('apex-mesh-selected', {
              detail: { name: last.name, names: all.map((m) => m.name), subMeshes: [] }
            }));
            const gizmoTarget = all.length === 1 ? all[0] : null;
            if (currentToolRef.current === 'move') {
              gizmoManager.rotationGizmoEnabled = false;
              gizmoManager.scaleGizmoEnabled = false;
              gizmoManager.positionGizmoEnabled = !!gizmoTarget;
              if (gizmoTarget) { applyCustomGizmoColors(); setupGizmoDragEnd(); }
              gizmoManager.attachToMesh(gizmoTarget);
            } else if (currentToolRef.current === 'rotate') {
              gizmoManager.positionGizmoEnabled = false;
              gizmoManager.scaleGizmoEnabled = false;
              gizmoManager.rotationGizmoEnabled = !!gizmoTarget;
              if (gizmoTarget) applyCustomGizmoColors();
              gizmoManager.attachToMesh(gizmoTarget);
            } else if (currentToolRef.current === 'scale') {
              gizmoManager.positionGizmoEnabled = false;
              gizmoManager.rotationGizmoEnabled = false;
              gizmoManager.scaleGizmoEnabled = !!gizmoTarget;
              gizmoManager.attachToMesh(gizmoTarget);
            } else {
              gizmoManager.positionGizmoEnabled = false;
              gizmoManager.rotationGizmoEnabled = false;
              gizmoManager.scaleGizmoEnabled = false;
              gizmoManager.attachToMesh(null);
            }
          } else if (!additive) {
            selectedMeshesRef.current.clear();
            setSelectedMeshName(null);
            updateHighlight();
            gizmoManager.positionGizmoEnabled = false;
            gizmoManager.rotationGizmoEnabled = false;
            gizmoManager.scaleGizmoEnabled = false;
            gizmoManager.attachToMesh(null);
            window.dispatchEvent(new CustomEvent('apex-mesh-selected', { detail: { name: null, names: [], subMeshes: [] } }));
          }
          return; // Le rectangle a déjà tranché la sélection : pas de pick ponctuel en plus.
        }
      }

      const pick = scene.pick(scene.pointerX, scene.pointerY, isPickableForUi);
      if (pick?.hit && pick.pickedMesh) {
        let targetMesh = pick.pickedMesh;

        if (currentToolRef.current !== 'texture') {
          targetMesh = getRootModel(targetMesh);
        }

        const additive = evt.ctrlKey || evt.metaKey;
        selectMesh(targetMesh, additive);
      }
    }
  });
  c.pointerObserver = pointerObserver;


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
  c.contextMenuPointerObserver = contextMenuPointerObserver;
}
