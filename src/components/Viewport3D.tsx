"use client";import { importModelsOneByOne } from '@/utils/importModels';
import { setupViewportScene } from './viewport/viewportScene';
import { setupViewportGizmos } from './viewport/viewportGizmos';
import { setupViewportPlate } from './viewport/viewportPlate';
import { setupViewportGrid } from './viewport/viewportGrid';
import { setupViewportGridView } from './viewport/viewportGridView';
import { setupViewportPlateActions } from './viewport/viewportPlateActions';
import { setupViewportGCode } from './viewport/viewportGcode';
import { setupViewportPlateActionsPointer } from './viewport/viewportPlateActionsPointer';
import { setupViewportHistory } from './viewport/viewportHistory';
import { setupViewportBoxTool } from './viewport/viewportBoxTool';
import { setupViewportPyramidTool } from './viewport/viewportPyramidTool';
import { setupViewportSelection } from './viewport/viewportSelection';
import { setupViewportSketchPlanes } from './viewport/viewportSketchPlanes';
import { setupViewportSketchRect } from './viewport/viewportSketchRect';
import { setupViewportFaces } from './viewport/viewportFaces';
import { setupViewportExtrude } from './viewport/viewportExtrude';
import { setupViewportPointer } from './viewport/viewportPointer';
import { setupViewportModels } from './viewport/viewportModels';
import { setupViewportArrange } from './viewport/viewportArrange';
import { setupViewportLifecycle } from './viewport/viewportLifecycle';
import { setupViewportCleanup } from './viewport/viewportCleanup';
import { createViewportState } from './viewport/viewportState';
import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import * as BABYLON from 'babylonjs';
import { ViewportContextMenu, type ContextMenuSpace } from './viewport/ViewportContextMenu';
import { ViewportOverlays } from './viewport/ViewportOverlays';
import ScaleUnitPrompt, { type ScaleUnitSuggestion } from './ScaleUnitPrompt';
import 'babylonjs-loaders';
import { type GCodeEditController } from './edit-node/gcodeEditController';
import GCodeEditOverlay from './edit-node/GCodeEditOverlay';
import { PLATE_RADIUS_MM } from '@/utils/machineProfile';


import { emitApex } from '@/events/apexEvents';
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
  // Info-bulle qui suit le curseur pendant la sélection du plan d'esquisse.
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
  // Rectangle de la fenêtre de sélection (écran, relatif au conteneur) : drag vers la droite = « window » (objets
  // entièrement englobés), vers la gauche = « crossing » (tout objet touché).
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
  // Presse-papier de Ctrl+C / Ctrl+V : noms des modèles copiés, résolus contre `modelsRef` au coller.
  const clipboardMeshNamesRef = useRef<string[]>([]);
  const currentToolRef = useRef<string>("select");
  const [, setSelectedMeshName] = useState<string | null>(null);
  const RADIUS = PLATE_RADIUS_MM, HEIGHT = 130, VIEW_RADIUS = RADIUS * 2.4; // rayon du plateau : profil d'imprimante ; vue par défaut = 2,4 rayons (300 mm pour 125)
  const HOLE_RADIUS = 20;
  // Élévation MONDE de la surface du plateau (disque « verre dépoli », posé 0,1 mm au-dessus du socle à HEIGHT/2) :
  // les modèles, posés à la racine de la scène, reposent dessus et non sur y = 0 (fond quadrillé).
  const PLATE_SURFACE_Y = HEIGHT * 0.5 + 0.1;


  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const st = createViewportState({
      canvas: canvasRef.current, engineRef, sceneRef, VIEW_RADIUS, HEIGHT, RADIUS, cameraRef, hlRef,
      gizmoManagerRef, selectedMeshesRef, PLATE_SURFACE_Y, currentToolRef, modelsRef, HOLE_RADIUS,
      setScaleBar, setEditController, setPlateActionHint, plateImportInputRef, clipboardMeshNamesRef,
      setSelectedMeshName, setSketchPlaneHint, sketchDimInputs, setSketchDimsShown, setSketchCursor,
      sketchDimsApi, setSelectionBox, setContextModel, suppressNextBackdropContextMenuRef, setContextMenu,
      setUnitSuggestion,
    });
    setupViewportScene(st);
    setupViewportGizmos(st);
    setupViewportPlate(st);
    setupViewportGrid(st);
    setupViewportGridView(st);
    setupViewportPlateActions(st);
    setupViewportGCode(st);
    setupViewportPlateActionsPointer(st);
    setupViewportHistory(st);
    setupViewportBoxTool(st);
    setupViewportPyramidTool(st);
    setupViewportSelection(st);
    setupViewportSketchPlanes(st);
    setupViewportSketchRect(st);
    setupViewportFaces(st);
    setupViewportExtrude(st);
    setupViewportPointer(st);
    setupViewportModels(st);
    setupViewportArrange(st);
    setupViewportLifecycle(st);
    return setupViewportCleanup(st);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        id="babylon-canvas"
        ref={canvasRef}
        style={{ width: '100%', height: '100%', outline: 'none', touchAction: 'none' }}
        // L'ouverture du menu est pilotée depuis `scene.onPointerObservable` (cf. plus bas dans
        // l'effet) plutôt que depuis ce `contextmenu` DOM : Babylon attache ses propres
        // écouteurs natifs `pointerdown`/`contextmenu` directement sur ce canvas pour la caméra,
        // et un `stopPropagation()` de sa part empêcherait un handler React (délégué à la
        // racine) de jamais recevoir l'événement. On ne garde ici que le blocage du menu natif
        // du navigateur.
        onContextMenu={(e) => e.preventDefault()}
      />
      {editController && canvasRef.current && (
        <GCodeEditOverlay controller={editController} sceneCanvas={canvasRef.current} />
      )}

      <ViewportOverlays
        selectionBox={selectionBox} plateActionHint={plateActionHint} sketchDimsShown={sketchDimsShown}
        sketchDimInputs={sketchDimInputs} sketchDimsApi={sketchDimsApi} sketchCursor={sketchCursor}
        sketchPlaneHint={sketchPlaneHint} scaleBar={scaleBar}
      />


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


      <ViewportContextMenu
        contextMenu={contextMenu} setContextMenu={setContextMenu} contextModel={contextModel} setContextModel={setContextModel}
        contextSpace={contextSpace} modelsRef={modelsRef} suppressNextBackdropContextMenuRef={suppressNextBackdropContextMenuRef}
      />

      {unitSuggestion && (
        <ScaleUnitPrompt
          suggestion={unitSuggestion}
          onAccept={(suggestion) => {
            emitApex('apex-set-model-unit', { name: suggestion.name, unit: suggestion.unit });
            setUnitSuggestion(null);
          }}
          onDismiss={() => setUnitSuggestion(null)}
        />
      )}
    </div>
  );
};export type { ContextMenuSpace };
