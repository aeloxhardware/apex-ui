"use client";

import { importModelsOneByOne } from '@/utils/importModels';

import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import * as BABYLON from 'babylonjs';
import { installFlatBabylon } from '@/utils/flatBabylon';

import ScaleUnitPrompt,{ type ScaleUnitSuggestion } from './ScaleUnitPrompt';

// Interface classique : aucune animation Babylon (cf. utils/flatBabylon.ts).
installFlatBabylon(BABYLON);
import 'babylonjs-loaders';

import { type GCodeEditController } from './edit-node/gcodeEditController';
import GCodeEditOverlay from './edit-node/GCodeEditOverlay';

import { setupCamera } from './viewport/setupCamera';
import { setupBackdrop } from './viewport/setupBackdrop';
import { setupCameraViews } from './viewport/setupCameraViews';
import { setupGizmos } from './viewport/setupGizmos';
import { setupTransformPanel } from './viewport/setupTransformPanel';
import { setupPlateVisuals } from './viewport/setupPlateVisuals';
import { setupModelingGrid } from './viewport/setupModelingGrid';
import { setupModelingMode } from './viewport/setupModelingMode';
import { setupPlateActions } from './viewport/setupPlateActions';
import { setupGCodePreview } from './viewport/setupGCodePreview';
import { setupPlateActionsInput } from './viewport/setupPlateActionsInput';
import { setupBoxTool } from './viewport/setupBoxTool';
import { setupPyramidTool } from './viewport/setupPyramidTool';
import { setupClipboard } from './viewport/setupClipboard';
import { setupSketchPlanes } from './viewport/setupSketchPlanes';
import { setupSketchRect } from './viewport/setupSketchRect';
import { setupExtrudeFaces } from './viewport/setupExtrudeFaces';
import { setupExtrudeBody } from './viewport/setupExtrudeBody';
import { setupSelectionInput } from './viewport/setupSelectionInput';
import { setupModels } from './viewport/setupModels';
import { setupLifecycle } from './viewport/setupLifecycle';
import type { ViewportCtx } from './viewport/context';
import { ViewportContextMenu } from './viewport/ContextMenu';
import { CursorHint, ScaleBarOverlay, SelectionBoxOverlay, SketchCursorMark, SketchDimInputs } from './viewport/Overlays';
import { DEFAULT_BLUR_LEVEL } from './viewport/constants';
import type { ContextMenuSpace } from './viewport/menuTexts';

export type { ContextMenuSpace };

export const Viewport3D = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // Modèle sous le clic droit (null = clic dans le vide) et son unité courante.
  const [contextModel, setContextModel] = useState<{ name: string; unit: 'mm' | 'in' } | null>(null);
  // Proposition de changer l'unité de lecture d'un modèle trop petit ou trop grand, après son import.
  const [unitSuggestion, setUnitSuggestion] = useState<ScaleUnitSuggestion | null>(null);
  // Espace courant, pour choisir le menu contextuel (événement `apex-space-changed`, émis par Index).
  const [contextSpace, setContextSpace] = useState<ContextMenuSpace>('preparation');
  useEffect(() => {
    const onSpaceChanged = (e: Event) => setContextSpace((e as CustomEvent<{ space: ContextMenuSpace }>).detail.space);
    window.addEventListener('apex-space-changed', onSpaceChanged);
    return () => window.removeEventListener('apex-space-changed', onSpaceChanged);
  }, []);
  // Le clic droit qui ouvre le menu déclenche ensuite, sur ce même clic, l'événement DOM natif
  // `contextmenu` : au moment où celui-ci se déclenche, le rideau de fermeture (qui couvre tout
  // l'écran) est déjà monté sous le curseur et en reçoit la cible — sans ce garde-fou, son
  // propre `onContextMenu` referme le menu qui vient tout juste de s'ouvrir. On l'arme juste
  // avant d'ouvrir et on l'ignore une seule fois, côté rideau.
  const suppressNextBackdropContextMenuRef = useRef(false);
  const [blurLevel, setBlurLevel] = useState(DEFAULT_BLUR_LEVEL);
  // Info-bulle qui suit le curseur pendant la sélection du plan d'esquisse (façon Fusion 360).
  const [sketchPlaneHint, setSketchPlaneHint] = useState<{ x: number; y: number } | null>(null);
  // Curseur « + » de l'outil Rectangle (position écran, aimanté ou non à la grille).
  const [sketchCursor, setSketchCursor] = useState<{ x: number; y: number; snapped: boolean } | null>(null);
  // Champs « longueur » / « largeur » de l'outil Rectangle (affichés après le premier clic).
  const [sketchDimsShown, setSketchDimsShown] = useState(false);
  const sketchDimInputs = useRef<(HTMLInputElement | null)[]>([null, null]);
  const sketchDimsApi = useRef<{
    onKey: (index: number, event: React.KeyboardEvent<HTMLInputElement>) => void;
    onInput: (index: number) => void;
  }>({ onKey: () => {}, onInput: () => {} });
  const [plateActionHint, setPlateActionHint] = useState<{ title: string; x: number; y: number } | null>(null);
  // Rectangle de la fenêtre de sélection (clic gauche + drag), en coordonnées écran relatives
  // au conteneur — `null` quand aucun drag de sélection n'est en cours. `mode` dépend du sens du
  // drag, comme dans la plupart des logiciels de CAO : vers la droite = « window » (ne retient
  // que les objets entièrement englobés, contour plein) ; vers la gauche = « crossing » (retient
  // tout objet touché, contour pointillé animé + surlignage blanc).
  const [editController, setEditController] = useState<GCodeEditController | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number; mode: 'window' | 'crossing' } | null>(null);
  const plateImportInputRef = useRef<HTMLInputElement>(null);
  // Échelle dynamique du mode modélisation : largeur du repère en px + distance réelle qu'il
  // représente. `null` hors mode modélisation, où la barre n'est pas affichée.
  const [scaleBar, setScaleBar] = useState<{ px: number; label: string } | null>(null);
  const engineRef = useRef<BABYLON.Engine | null>(null);
  const sceneRef = useRef<BABYLON.Scene | null>(null);
  const cameraRef = useRef<BABYLON.ArcRotateCamera | null>(null);
  const hlRef = useRef<BABYLON.HighlightLayer | null>(null);
  const gizmoManagerRef = useRef<BABYLON.GizmoManager | null>(null);
  const selectedMeshesRef = useRef<Set<BABYLON.AbstractMesh>>(new Set());
  const modelsRef = useRef<Set<BABYLON.AbstractMesh>>(new Set());
  // Presse-papier interne pour Ctrl+C / Ctrl+V sur les modèles du plateau : noms des modèles
  // sélectionnés au moment du copier (pas les meshes eux-mêmes, qui peuvent être supprimés entre
  // temps) — résolus à nouveau contre `modelsRef` au moment du coller.
  const clipboardMeshNamesRef = useRef<string[]>([]);
  const currentToolRef = useRef<string>("select");
  const [, setSelectedMeshName] = useState<string | null>(null);
  // Dimensions : 250mm de diamètre (rayon 125) et 130mm de haut
  const RADIUS = 125;
  const HEIGHT = 130;
  const HOLE_RADIUS = 20;
  // Élévation MONDE de la surface réelle du plateau (le disque "verre dépoli", cf. glassDisc) :
  // volumeRoot (le socle du plateau) est à HEIGHT * 0.5, et glassDisc est posé 0.1mm au-dessus de
  // ce socle, dans son repère local. Les modèles importés/déplacés (posés directement à la racine
  // de la scène, jamais parentés à volumeRoot) doivent reposer sur cette élévation plutôt que sur
  // y = 0 (qui n'est que le niveau du fond quadrillé, cf. backdrop) — sans quoi ils tombent à
  // travers le plateau jusqu'à la grille de fond, ~65mm plus bas.
  const PLATE_SURFACE_Y = HEIGHT * 0.5 + 0.1;

  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const c = {
      canvasRef,
      setContextMenu,
      setContextModel,
      setUnitSuggestion,
      suppressNextBackdropContextMenuRef,
      setSketchPlaneHint,
      setSketchCursor,
      setSketchDimsShown,
      sketchDimInputs,
      sketchDimsApi,
      setPlateActionHint,
      setEditController,
      setSelectionBox,
      plateImportInputRef,
      setScaleBar,
      engineRef,
      sceneRef,
      cameraRef,
      hlRef,
      gizmoManagerRef,
      selectedMeshesRef,
      modelsRef,
      clipboardMeshNamesRef,
      currentToolRef,
      setSelectedMeshName,
      RADIUS,
      HEIGHT,
      HOLE_RADIUS,
      PLATE_SURFACE_Y,
    } as ViewportCtx;
    setupCamera(c);
    setupBackdrop(c);
    setupCameraViews(c);
    setupGizmos(c);
    setupTransformPanel(c);
    setupPlateVisuals(c);
    setupModelingGrid(c);
    setupModelingMode(c);
    setupPlateActions(c);
    setupGCodePreview(c);
    setupPlateActionsInput(c);
    setupBoxTool(c);
    setupPyramidTool(c);
    setupClipboard(c);
    setupSketchPlanes(c);
    setupSketchRect(c);
    setupExtrudeFaces(c);
    setupExtrudeBody(c);
    setupSelectionInput(c);
    setupModels(c);
    return setupLifecycle(c);
  }, []);

  const pendingTestNames = useRef(new Set<string>());

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        id="babylon-canvas"
        ref={canvasRef}
        style={{ width: '100%', height: '100%', outline: 'none', touchAction: 'none' }}
        // L'ouverture du menu est pilotée depuis `scene.onPointerObservable` (cf. `setupSelectionInput`)
        // plutôt que depuis ce `contextmenu` DOM : Babylon attache ses propres écouteurs natifs
        // `pointerdown`/`contextmenu` directement sur ce canvas pour la caméra, et un `stopPropagation()`
        // de sa part empêcherait un handler React (délégué à la racine) de jamais recevoir l'événement.
        // On ne garde ici que le blocage du menu natif du navigateur.
        onContextMenu={(e) => e.preventDefault()}
      />
      {editController && canvasRef.current && (
        <GCodeEditOverlay controller={editController} sceneCanvas={canvasRef.current} />
      )}
      {selectionBox && <SelectionBoxOverlay box={selectionBox} />}
      {plateActionHint && (
        <CursorHint x={plateActionHint.x} y={plateActionHint.y} offset={16} textAlpha={0.92}>{plateActionHint.title}</CursorHint>
      )}

      {/* Sélecteur de fichier du bouton « Importer » de la rangée d'actions du plateau. */}
      <input
        type="file"
        ref={plateImportInputRef}
        style={{ display: 'none' }}
        accept=".stl,.glb,.gltf"
        multiple
        onChange={(e) => {
          if (e.target.files?.length) {
            void importModelsOneByOne(Array.from(e.target.files));
          }
          e.target.value = '';
        }}
      />

      {sketchDimsShown && <SketchDimInputs inputs={sketchDimInputs} api={sketchDimsApi} />}
      {sketchCursor && <SketchCursorMark cursor={sketchCursor} />}
      {sketchPlaneHint && (
        <CursorHint x={sketchPlaneHint.x} y={sketchPlaneHint.y} offset={18} textAlpha={0.9}>
          Sélectionner un plan ou une face plane
        </CursorHint>
      )}
      {scaleBar && <ScaleBarOverlay bar={scaleBar} />}

      {contextMenu && (
        <ViewportContextMenu
          position={contextMenu}
          space={contextSpace}
          model={contextModel}
          blurLevel={blurLevel}
          modelsRef={modelsRef}
          pendingTestNames={pendingTestNames}
          suppressNextBackdropContextMenuRef={suppressNextBackdropContextMenuRef}
          onClose={() => setContextMenu(null)}
          onReopen={setContextMenu}
          onModelChange={setContextModel}
          onBlurChange={setBlurLevel}
        />
      )}

      {unitSuggestion && (
        <ScaleUnitPrompt
          suggestion={unitSuggestion}
          onAccept={(suggestion) => {
            window.dispatchEvent(new CustomEvent('apex-set-model-unit', { detail: { name: suggestion.name, unit: suggestion.unit } }));
            setUnitSuggestion(null);
          }}
          onDismiss={() => setUnitSuggestion(null)}
        />
      )}
    </div>
  );
};
