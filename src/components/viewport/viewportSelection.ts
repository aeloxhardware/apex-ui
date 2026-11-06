// Issu de la découpe de l'ancien useLayoutEffect de Viewport3D.tsx : le texte des instructions est
// conservé ; les variables partagées entre morceaux passent par `st` (viewportState.ts).
import * as BABYLON from 'babylonjs';
import type { InspectableMaterial } from './viewportTypes';
import { attachGizmoForTool, clearSelection, describeSubMeshes } from './viewportSelectionActions';
import { recordCreatedModels, removeModels } from './viewportHistory';
import type { ViewportState } from './viewportState';

import { emitApex } from '@/events/apexEvents';
function setupCloneModelToPlate(st: ViewportState) {
  const { PLATE_SURFACE_Y, applyModelShading, modelsRef } = st;
  // Duplique un modèle du plateau (clone profond de sa hiérarchie) : nom unique à la Explorer
  // ("(copie)", puis "(copie 2)"...), matériaux partagés avec l'original (comme un vrai clone),
  // posé sur un emplacement libre du plateau plutôt que superposé à la source. Reprend les mêmes
  // briques que `onImportModel` (findFreeSpot, PLATE_SURFACE_Y, construction de subMeshesList)
  // pour qu'un modèle collé se comporte à l'identique d'un modèle importé.
  const cloneModelToPlate = (source: BABYLON.AbstractMesh): BABYLON.AbstractMesh | null => {
    const existingNames = new Set(Array.from(modelsRef.current).map((m) => m.name));
    const baseName = source.name.replace(/ \(copie(?: \d+)?\)$/, '');
    let uniqueName = `${baseName} (copie)`;
    let copyIndex = 2;
    while (existingNames.has(uniqueName)) {
      uniqueName = `${baseName} (copie ${copyIndex})`;
      copyIndex++;
    }

    const clone = source.clone(uniqueName, null, false);
    if (!clone) return null;
    clone.setEnabled(true);

    clone.computeWorldMatrix(true);
    const boundingInfo = clone.getHierarchyBoundingVectors(true);
    const center = boundingInfo.min.add(boundingInfo.max).scale(0.5);
    const footprintRadius = Math.max(boundingInfo.max.x - boundingInfo.min.x, boundingInfo.max.z - boundingInfo.min.z) / 2;
    const spot = st.findFreeSpot(footprintRadius);
    clone.position.addInPlace(new BABYLON.Vector3(spot.x - center.x, PLATE_SURFACE_Y - boundingInfo.min.y, spot.z - center.z));

    modelsRef.current.add(clone);
    applyModelShading();
    return clone;
  };
  Object.assign(st, { cloneModelToPlate });
}

function setupPasteClipboard(st: ViewportState) {
  const { applyCustomGizmoColors, clipboardMeshNamesRef, cloneModelToPlate, currentToolRef, gizmoManager, modelsRef, selectedMeshesRef, setSelectedMeshName, setupGizmoDragEnd, updateHighlight, updateSelectedPosition, updateSelectedRotation } = st;
  const pasteClipboard = () => {
    const names = clipboardMeshNamesRef.current;
    if (names.length === 0) return;
    const sources = names
      .map((name) => Array.from(modelsRef.current).find((m) => m.name === name))
      .filter((m): m is BABYLON.AbstractMesh => !!m && !m.isDisposed());
    if (sources.length === 0) return;

    const clones = sources
      .map((source) => cloneModelToPlate(source))
      .filter((m): m is BABYLON.AbstractMesh => !!m);
    if (clones.length === 0) return;
    recordCreatedModels(st, clones);

    selectedMeshesRef.current.clear();
    clones.forEach((m) => selectedMeshesRef.current.add(m));
    const last = clones[clones.length - 1];
    setSelectedMeshName(last.name || "Modèle 3D");
    updateHighlight();
    updateSelectedPosition();
    updateSelectedRotation();

    const subMeshesList: { id: string; name: string; color: string }[] = [];
    if (clones.length === 1) {
      const childMeshes = [last, ...last.getChildMeshes()];
      childMeshes.forEach((cm, idx) => {
        let hex = '#00f0ff';
        if (cm.material) {
          const mat = cm.material as InspectableMaterial;
          if (mat.albedoColor) hex = mat.albedoColor.toHexString();
          else if (mat.diffuseColor) hex = mat.diffuseColor.toHexString();
        }
        subMeshesList.push({ id: `${last.name}-${idx}`, name: cm.name || `Partie ${idx + 1}`, color: hex });
      });
    }

    emitApex('apex-mesh-selected', {
          name: last.name || "Modèle 3D",
          names: clones.map((m) => m.name),
          subMeshes: subMeshesList,
        });

    // Le presse-papier retient la copie collée (pas la source d'origine) : coller plusieurs
    // fois de suite empile les copies l'une après l'autre plutôt que de reproduire toujours la
    // même sélection d'origine, comme dans un logiciel de CAO classique.
    clipboardMeshNamesRef.current = clones.map((m) => m.name);

    if (currentToolRef.current === 'move') {
      gizmoManager.rotationGizmoEnabled = false;
      gizmoManager.scaleGizmoEnabled = false;
      gizmoManager.positionGizmoEnabled = true;
      applyCustomGizmoColors();
      gizmoManager.attachToMesh(last);
      setupGizmoDragEnd();
    } else if (currentToolRef.current === 'rotate') {
      gizmoManager.positionGizmoEnabled = false;
      gizmoManager.scaleGizmoEnabled = false;
      gizmoManager.rotationGizmoEnabled = true;
      applyCustomGizmoColors();
      gizmoManager.attachToMesh(last);
    } else if (currentToolRef.current === 'scale') {
      gizmoManager.positionGizmoEnabled = false;
      gizmoManager.rotationGizmoEnabled = false;
      gizmoManager.scaleGizmoEnabled = true;
      gizmoManager.attachToMesh(last);
    }
  };
  Object.assign(st, { pasteClipboard });
}

function setupDeleteSelection(st: ViewportState) {
  const { selectedMeshesRef } = st;
  const deleteSelection = () => {
    const selection = selectedMeshesRef.current;
    if (selection.size === 0) return;
    let confirmed = true;
    if (selection.size > 1) {
      confirmed = window.confirm(`Voulez-vous vraiment supprimer les ${selection.size} modèles sélectionnés ?`);
    }
    if (!confirmed) return;
    removeModels(st, Array.from(selection));
  };
  Object.assign(st, { deleteSelection });
}

function setupHandleKeyDown(st: ViewportState) {
  const { clipboardMeshNamesRef, deleteSelection, modelsRef, pasteClipboard, selectedMeshesRef } = st;
  const handleKeyDown = (e: KeyboardEvent) => {
    // Raccourcis par défaut du système (copier/coller/tout sélectionner/couper, saisie de texte,
    // etc.) ne doivent jamais être volés ailleurs dans l'interface : dès que le focus est sur un
    // champ éditable (input, textarea, contentEditable), ce gestionnaire — attaché sur `window` et
    // donc traversé par toute frappe de l'appli — s'efface complètement, y compris pour
    // Suppr/Retour arrière (auparavant vérifié APRÈS, ce qui pouvait supprimer un modèle 3D
    // sélectionné pendant qu'on effaçait du texte ailleurs dans l'UI).
    const target = e.target as HTMLElement | null;
    const isTextField = !!target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);
    if (isTextField) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelection();
      return;
    }

    const ctrlOrCmd = e.ctrlKey || e.metaKey;
    if (!ctrlOrCmd) return;

    // Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A (Cmd sur Mac) : copier/coller/couper/tout sélectionner les
    // modèles du plateau. Rien n'est intercepté hors du plateau (garde ci-dessus), donc les mêmes
    // raccourcis restent disponibles pour le texte normal ailleurs dans l'interface.
    const key = e.key.toLowerCase();
    if (key === 'c') {
      const selection = Array.from(selectedMeshesRef.current);
      if (selection.length === 0) return;
      clipboardMeshNamesRef.current = selection.map((m) => m.name);
    } else if (key === 'v') {
      e.preventDefault();
      pasteClipboard();
    } else if (key === 'x') {
      const selection = Array.from(selectedMeshesRef.current);
      if (selection.length === 0) return;
      e.preventDefault();
      clipboardMeshNamesRef.current = selection.map((m) => m.name);
      deleteSelection();
    } else if (key === 'a') {
      if (modelsRef.current.size === 0) return;
      e.preventDefault();
      emitApex('apex-select-all-models');
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  Object.assign(st, { handleKeyDown });
}

function setupGetRootModel(st: ViewportState) {
  const getRootModel = (mesh: BABYLON.AbstractMesh): BABYLON.AbstractMesh => {
    let curr: BABYLON.Node | null = mesh;
    let topValid: BABYLON.AbstractMesh = mesh;
    while (curr && curr.parent) {
      curr = curr.parent;
      if (curr instanceof BABYLON.AbstractMesh) {
        topValid = curr;
      }
    }
    return topValid;
  };
  Object.assign(st, { getRootModel });
}

function setupSelectMesh(st: ViewportState) {
  const { selectedMeshesRef, setSelectedMeshName, updateHighlight, updateSelectedPosition, updateSelectedRotation } = st;
  // Sélectionne un modèle sur le plateau : remplace la sélection existante par défaut
  // (un seul modèle à la fois), ou l'ajoute/retire de la sélection si additive=true (Ctrl).
  const selectMesh = (targetMesh: BABYLON.AbstractMesh, additive: boolean) => {
    if (!additive && selectedMeshesRef.current.size === 1 && selectedMeshesRef.current.has(targetMesh)) {
      clearSelection(st);
      return;
    }

    if (additive) {
      if (selectedMeshesRef.current.has(targetMesh)) {
        selectedMeshesRef.current.delete(targetMesh);
      } else {
        selectedMeshesRef.current.add(targetMesh);
      }
    } else {
      selectedMeshesRef.current.clear();
      selectedMeshesRef.current.add(targetMesh);
    }

    setSelectedMeshName(targetMesh.name || "Modèle 3D");
    updateHighlight();
    updateSelectedPosition();
    updateSelectedRotation();

    const subMeshesList = describeSubMeshes(targetMesh);

    emitApex('apex-mesh-selected', {
          name: targetMesh.name || "Modèle 3D",
          names: Array.from(selectedMeshesRef.current).map((m) => m.name),
          subMeshes: subMeshesList
        });

    const gizmoTarget = selectedMeshesRef.current.size === 1 ? targetMesh : null;
    attachGizmoForTool(st, gizmoTarget);
  };
  Object.assign(st, { selectMesh });
}

export function setupViewportSelection(st: ViewportState) {
  setupCloneModelToPlate(st);
  setupPasteClipboard(st);
  setupDeleteSelection(st);
  setupHandleKeyDown(st);
  setupGetRootModel(st);
  setupSelectMesh(st);
}
