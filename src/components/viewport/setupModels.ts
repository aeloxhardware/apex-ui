import * as BABYLON from 'babylonjs';
import { localPointOf, scaleKeepingPoint } from '@/utils/meshScale';
import { apexEase } from '@/utils/easing';
import { createOrcaModelMaterial } from '../orcaModelMaterial';
import { suggestModelUnit } from '@/utils/modelUnit';
import { showSuccess, showError, showWarning } from '@/utils/toast';
import { PlatePart, buildPlateStl } from '@/utils/plateStl';
import { arrange as arrangeOrca } from '@/utils/orcaArrange';
import type { InspectableMaterial } from './types';
import type { ViewportCtx } from './context';

/** Unité des modèles, import, sélection globale, tranchage, export STL, suppression et rangement. */
export function setupModels(c: ViewportCtx) {
  const { scene, updateHighlight, updateSelectedPosition, selectMesh, applyModelShading, updateSelectedRotation, gizmoManager, applyCustomGizmoColors, setupGizmoDragEnd, modelsRef, RADIUS, PLATE_SURFACE_Y, setUnitSuggestion, selectedMeshesRef, setSelectedMeshName, currentToolRef } = c;


  // Unité d'un modèle : « Pouces » = le fichier est lu en pouces (×25,4 par rapport aux
  // millimètres), « Millimètres » le ramène. Le modèle garde son centre et reste posé sur le plateau
  // (axe Z de l'imprimante = Y de Babylon).
  const INCH_TO_MM = 25.4;

  // Croissance du modèle pendant la pastille du sélecteur (même instant, durée courte) : l'animation reste
  // brève, sur la courbe de l'application.
  const UNIT_GROW_DELAY_MS = 0;

  const UNIT_GROW_MS = 320;

  // Une bascule en cours par modèle : `finish` la termine (échelle finale posée), `observer` l'anime.
  const unitTweens = new WeakMap<BABYLON.AbstractMesh, { observer: BABYLON.Observer<BABYLON.Scene>; finish: () => void }>();

  const finishUnitTween = (mesh: BABYLON.AbstractMesh) => {
    const tween = unitTweens.get(mesh);
    if (!tween) return;
    scene.onBeforeRenderObservable.remove(tween.observer);
    unitTweens.delete(mesh);
  };

  // Mise à l'échelle uniforme autour du centre de la base, pour que la pièce reste posée sur le plateau
  // (scaleKeepingPoint : fonctionne même si le pivot du maillage est décalé). Le facteur est appliqué
  // géométriquement (k^e), donc la croissance paraît régulière à l'œil.
  const animateUnitScale = (mesh: BABYLON.AbstractMesh, factor: number) => {
    // Une bascule encore en cours est terminée d'abord, pour que le facteur s'applique à l'échelle finale.
    unitTweens.get(mesh)?.finish();
    finishUnitTween(mesh);
    mesh.computeWorldMatrix(true);
    const base = { position: mesh.position.clone(), scaling: mesh.scaling.clone() };
    const box = mesh.getHierarchyBoundingVectors(true);
    const anchor = new BABYLON.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    const localAnchor = localPointOf(mesh, anchor);
    const placeAt = (f: number) => scaleKeepingPoint(
      mesh,
      { position: base.position, scaling: base.scaling.scale(f) },
      localAnchor,
      anchor,
    );
    const finish = () => {
      placeAt(factor);
      finishUnitTween(mesh);
    };
    const start = performance.now() + UNIT_GROW_DELAY_MS;
    const observer = scene.onBeforeRenderObservable.add(() => {
      if (mesh.isDisposed()) { finishUnitTween(mesh); return; }
      const t = Math.min(1, Math.max(0, (performance.now() - start) / UNIT_GROW_MS));
      if (t >= 1) {
        finish();
        updateHighlight();
        updateSelectedPosition();
        return;
      }
      placeAt(Math.pow(factor, apexEase(t)));
      updateSelectedPosition();
    });
    unitTweens.set(mesh, { observer, finish });
  };

  const onSetModelUnit = (e: Event) => {
    const { name, unit } = (e as CustomEvent<{ name: string; unit: 'mm' | 'in' }>).detail ?? {};
    const mesh = Array.from(modelsRef.current).find((m) => m.name === name);
    if (!mesh || (unit !== 'mm' && unit !== 'in')) return;
    const current: 'mm' | 'in' = mesh.metadata?.apexUnit === 'in' ? 'in' : 'mm';
    if (current === unit) return;
    const k = unit === 'in' ? INCH_TO_MM : 1 / INCH_TO_MM;
    mesh.metadata = { ...(mesh.metadata ?? {}), apexUnit: unit };
    animateUnitScale(mesh, k);
    updateHighlight();
    updateSelectedPosition();
  };
  c.onSetModelUnit = onSetModelUnit;

  window.addEventListener('apex-set-model-unit', onSetModelUnit);


  const onSelectModel = (e: Event) => {
    const customEvent = e as CustomEvent<{ name: string; additive?: boolean }>;
    const name = customEvent.detail?.name;
    if (!name) return;
    const mesh = Array.from(modelsRef.current).find((m) => m.name === name);
    if (mesh) selectMesh(mesh, !!customEvent.detail?.additive);
  };
  c.onSelectModel = onSelectModel;

  window.addEventListener('apex-select-model', onSelectModel);


  // Trouve, sur le plateau circulaire, la position libre la plus proche du centre pour un
  // nouveau modèle (approximé par son cercle englobant en X/Z), par circle-packing : en
  // configuration optimale, une position libre la plus proche est toujours tangente soit au
  // bord du plateau, soit à un modèle existant, soit à deux modèles existants à la fois — on
  // génère donc ces candidats géométriques précis plutôt que d'échantillonner au hasard, avec
  // une recherche par grille fine en filet de sécurité si aucun candidat n'est valide.
  const findFreeSpot = (
    footprintRadius: number,
    obstacles: Iterable<BABYLON.AbstractMesh> = modelsRef.current,
  ): { x: number; z: number } => {
    const existing = Array.from(obstacles).map((m) => {
      m.computeWorldMatrix(true);
      const b = m.getHierarchyBoundingVectors(true);
      const c = b.min.add(b.max).scale(0.5);
      const fr = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
      return { x: c.x, z: c.z, r: fr };
    });

    const margin = 5;
    const maxReach = RADIUS - footprintRadius - 2;
    if (maxReach <= 0) return { x: 0, z: 0 };

    const collides = (x: number, z: number) =>
      existing.some((e) => Math.hypot(x - e.x, z - e.z) < footprintRadius + e.r + margin);

    if (existing.length === 0 || !collides(0, 0)) return { x: 0, z: 0 };

    const candidates: { x: number; z: number }[] = [];
    const ANGLE_STEPS = 180;

    // Tangent à chaque modèle existant, dans toutes les directions
    existing.forEach((e) => {
      const rr = footprintRadius + e.r + margin;
      for (let i = 0; i < ANGLE_STEPS; i++) {
        const a = (i / ANGLE_STEPS) * Math.PI * 2;
        candidates.push({ x: e.x + rr * Math.cos(a), z: e.z + rr * Math.sin(a) });
      }
    });

    // Tangent à deux modèles existants simultanément (intersection des deux cercles de
    // sécurité) — c'est là que se trouvent les emplacements les plus compacts en packing.
    for (let i = 0; i < existing.length; i++) {
      for (let j = i + 1; j < existing.length; j++) {
        const a = existing[i];
        const b = existing[j];
        const ra = footprintRadius + a.r + margin;
        const rb = footprintRadius + b.r + margin;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d === 0 || d > ra + rb) continue;
        const aDist = (ra * ra - rb * rb + d * d) / (2 * d);
        const h2 = ra * ra - aDist * aDist;
        if (h2 < 0) continue;
        const h = Math.sqrt(h2);
        const mx = a.x + (aDist * dx) / d;
        const mz = a.z + (aDist * dz) / d;
        candidates.push({ x: mx + (h * dz) / d, z: mz - (h * dx) / d });
        candidates.push({ x: mx - (h * dz) / d, z: mz + (h * dx) / d });
      }
    }

    const valid = candidates
      .filter((c) => Math.hypot(c.x, c.z) <= maxReach && !collides(c.x, c.z))
      .sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));

    if (valid.length > 0) return valid[0];

    // Filet de sécurité : balayage fin de tout le plateau, on garde le point valide le
    // plus proche du centre rencontré.
    const step = 2;
    let best: { x: number; z: number } | null = null;
    let bestDist = Infinity;
    for (let x = -maxReach; x <= maxReach; x += step) {
      for (let z = -maxReach; z <= maxReach; z += step) {
        const d = Math.hypot(x, z);
        if (d > maxReach || d >= bestDist || collides(x, z)) continue;
        best = { x, z };
        bestDist = d;
      }
    }
    return best ?? { x: 0, z: 0 };
  };
  c.findFreeSpot = findFreeSpot;


  const onImportModel = async (e: Event) => {
    const file = (e as CustomEvent<File>).detail;
    if (scene.isDisposed) return;
    
    const fileName = file.name.toLowerCase();
    const isGlbOrGltf = fileName.endsWith('.glb') || fileName.endsWith('.gltf');
    const pluginExtension = isGlbOrGltf ? fileName.substring(fileName.lastIndexOf('.')) : ".stl";

    try {
      const res = await BABYLON.SceneLoader.ImportMeshAsync("", "", file, scene, null, pluginExtension);
      if (scene.isDisposed) return;

      const r = res.meshes[0];
      if (r) {
        // Autorise l'import de plusieurs exemplaires du même fichier : suffixe le nom
        // (2), (3)... s'il est déjà utilisé par un modèle présent sur le plateau.
        const existingNames = new Set(Array.from(modelsRef.current).map((m) => m.name));
        let uniqueName = file.name;
        let copyIndex = 2;
        while (existingNames.has(uniqueName)) {
          const dotIndex = file.name.lastIndexOf('.');
          uniqueName = dotIndex > 0
            ? `${file.name.slice(0, dotIndex)} (${copyIndex})${file.name.slice(dotIndex)}`
            : `${file.name} (${copyIndex})`;
          copyIndex++;
        }
        r.name = uniqueName;

        if (isGlbOrGltf) {
          // Les fichiers glTF/GLB utilisent le mètre par convention, alors que la scène et
          // le volume d'impression sont en millimètres (RADIUS/HEIGHT) — sans cette mise à
          // l'échelle, un modèle réel de quelques cm devient un point microscopique invisible.
          r.scaling.scaleInPlace(1000);
        }

        r.computeWorldMatrix(true);
        // Pivot au centre de la boîte englobante : le gizmo de rotation se place sur le pivot et
        // la rotation se fait autour de lui. Sans cela, il reste à l'origine du fichier (le STL
        // peut être modélisé loin de (0,0,0)) : gizmo décalé et rotation autour d'un point
        // sans rapport avec la pièce. Posé avant le calcul du centre ci-dessous, qui est refait après
        // (le pivot déplace la pièce si l'échelle n'est pas 1) : le placement reste exact.
        {
          const b0 = r.getHierarchyBoundingVectors(true);
          const worldCenter = b0.min.add(b0.max).scale(0.5);
          const localCenter = BABYLON.Vector3.TransformCoordinates(worldCenter, r.getWorldMatrix().clone().invert());
          r.setPivotPoint(localCenter);
          r.computeWorldMatrix(true);
        }
        const boundingInfo = r.getHierarchyBoundingVectors(true);
        const center = boundingInfo.min.add(boundingInfo.max).scale(0.5);
        const footprintRadius = Math.max(boundingInfo.max.x - boundingInfo.min.x, boundingInfo.max.z - boundingInfo.min.z) / 2;
        const spot = findFreeSpot(footprintRadius);

        // Place le modèle sur un emplacement libre du plateau (au lieu de toujours l'origine,
        // ce qui le superposerait aux modèles déjà présents) et pose sa base sur la surface du
        // plateau (PLATE_SURFACE_Y, pas y=0 qui n'est que le fond quadrillé — cf. son
        // commentaire), sans passer par bakeCurrentTransformIntoVertices : pour les GLB/GLTF,
        // meshes[0] est souvent le nœud racine __root__ sans géométrie propre, sur lequel le
        // bake échoue silencieusement et interrompt l'import avant que le modèle ne soit
        // positionné/rendu visible.
        r.position.addInPlace(new BABYLON.Vector3(spot.x - center.x, PLATE_SURFACE_Y - boundingInfo.min.y, spot.z - center.z));

        if (!isGlbOrGltf) {
          // Les STL ne portent aucune info de matériau : on applique une teinte neutre par
          // défaut (le shader de zone d'exclusion de l'imprimante est réservé aux parois du
          // volume et culle les faces arrière, ce qui rend invisible tout STL aux normales
          // inversées — cas fréquent selon le logiciel d'export).
          // Rendu d'OrcaSlicer (ombrage de Gouraud à deux lumières fixées à la caméra), cf. orcaModelMaterial.ts.
          r.material = createOrcaModelMaterial("stlDefaultMat", scene, new BABYLON.Color3(0.6, 0.65, 0.7));
        }

        modelsRef.current.add(r);
        // Un import est lu en millimètres ; si la plus grande dimension suggère les pouces (ou l'inverse),
        // la carte propose le changement. La taille est celle de la boîte avant placement (la translation ne la change pas).
        {
          const sizeMm = Math.max(
            boundingInfo.max.x - boundingInfo.min.x,
            boundingInfo.max.y - boundingInfo.min.y,
            boundingInfo.max.z - boundingInfo.min.z,
          );
          const unit = suggestModelUnit(sizeMm, 'mm');
          setUnitSuggestion(unit ? { name: r.name, unit, sizeMm } : null);
        }
        applyModelShading();
        selectedMeshesRef.current.clear();
        selectedMeshesRef.current.add(r);
        setSelectedMeshName(r.name || "Modèle 3D");
        updateHighlight();
        updateSelectedPosition();
        updateSelectedRotation();

        const subMeshesList: { id: string; name: string; color: string }[] = [];
        const childMeshes = [r, ...r.getChildMeshes()];
        childMeshes.forEach((cm, idx) => {
          let hex = '#00f0ff';
          if (cm.material) {
            const mat = cm.material as InspectableMaterial;
            if (mat.albedoColor) hex = mat.albedoColor.toHexString();
            else if (mat.diffuseColor) hex = mat.diffuseColor.toHexString();
          }
          subMeshesList.push({
            id: `${r.name}-${idx}`,
            name: cm.name || `Partie ${idx + 1}`,
            color: hex
          });
        });

        window.dispatchEvent(
          new CustomEvent('apex-mesh-selected', {
            detail: {
              name: r.name || "Modèle 3D",
              subMeshes: subMeshesList
            }
          })
        );
        showSuccess(`Modèle importé : ${uniqueName}.`);

        if (currentToolRef.current === 'move') {
          gizmoManager.rotationGizmoEnabled = false;
          gizmoManager.scaleGizmoEnabled = false;
          gizmoManager.positionGizmoEnabled = true;
          applyCustomGizmoColors();
          gizmoManager.attachToMesh(r);
          setupGizmoDragEnd();
        } else if (currentToolRef.current === 'rotate') {
          gizmoManager.rotationGizmoEnabled = false;
          gizmoManager.scaleGizmoEnabled = false;
          gizmoManager.rotationGizmoEnabled = true;
          applyCustomGizmoColors();
          gizmoManager.attachToMesh(r);
        } else if (currentToolRef.current === 'scale') {
          gizmoManager.positionGizmoEnabled = false;
          gizmoManager.rotationGizmoEnabled = false;
          gizmoManager.scaleGizmoEnabled = true;
          gizmoManager.attachToMesh(r);
        }
      }
    } catch (err) {
      console.error("Failed to import 3D model:", err);
      showError(`Échec de l'import du modèle : ${file.name}.`);
    } finally {
      // Fin de l'import (succès ou échec) : l'import de plusieurs fichiers déposés s'enchaîne dessus.
      window.dispatchEvent(new Event('apex-import-model-settled'));
    }
  };
  c.onImportModel = onImportModel;


  window.addEventListener('apex-import-model', onImportModel);


  const onSelectAll = () => {
    const all = Array.from(modelsRef.current);
    if (all.length === 0) return;
    selectedMeshesRef.current = new Set(all);
    updateHighlight();
    const last = all[all.length - 1];
    setSelectedMeshName(last.name || "Modèle 3D");
    window.dispatchEvent(new CustomEvent('apex-mesh-selected', {
      detail: { name: last.name, names: all.map((m) => m.name), subMeshes: [] }
    }));
  };
  c.onSelectAll = onSelectAll;

  window.addEventListener('apex-select-all-models', onSelectAll);


  const onRequestSliceModels = () => {
    const models = Array.from(modelsRef.current);
    const names = models.map((mesh) => mesh.name);
    // Triangles réels du plateau (fenêtre « Lancer la découpe », seuil de sécurité), hiérarchie comprise.
    let triangles = 0;
    for (const root of models) {
      if (root.isDisposed()) continue;
      for (const mesh of [root, ...root.getChildMeshes(false)]) {
        if (mesh.isVisible && mesh.getTotalVertices() > 0) triangles += Math.floor(mesh.getTotalIndices() / 3);
      }
    }
    window.dispatchEvent(new CustomEvent('apex-slice-models', { detail: { names, triangles } }));
  };
  c.onRequestSliceModels = onRequestSliceModels;


  const onSliceAllModels = () => {
    const allModels = Array.from(modelsRef.current);
    if (allModels.length === 0) return;

    selectedMeshesRef.current = new Set(allModels);
    updateHighlight();
    window.dispatchEvent(new CustomEvent('apex-slicing-started', {
      detail: { names: allModels.map((mesh) => mesh.name) }
    }));
  };
  c.onSliceAllModels = onSliceAllModels;


  // Plateau exporté en STL pour le moteur (cf. utils/plateStl.ts) : géométrie en repère monde.
  const onExportPlateStl = (e: Event) => {
    const resolve = (e as CustomEvent<{ resolve: (stl: Uint8Array | null) => void }>).detail?.resolve;
    if (!resolve) return;
    try {
      const parts: PlatePart[] = [];
      modelsRef.current.forEach((root) => {
        if (root.isDisposed()) return;
        for (const mesh of [root, ...root.getChildMeshes(false)]) {
          if (!mesh.isVisible || mesh.getTotalVertices() === 0) continue;
          const world = mesh.computeWorldMatrix(true);
          const local = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
          const indices = mesh.getIndices();
          if (!local || !indices) continue;
          const positions = new Float32Array(local.length);
          const v = new BABYLON.Vector3();
          for (let i = 0; i < local.length; i += 3) {
            BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(local[i], local[i + 1], local[i + 2], world, v);
            positions[i] = v.x; positions[i + 1] = v.y; positions[i + 2] = v.z;
          }
          parts.push({ positions, indices, mirrored: world.determinant() < 0 });
        }
      });
      // Un modèle sous le plateau est coupé à sa surface avant le tranchage (section rebouchée).
      resolve(buildPlateStl(parts, {
        clipBelowZ: PLATE_SURFACE_Y,
        onClipped: () => showSuccess('Partie du modèle sous le plateau coupée avant le tranchage.'),
      }));
    } catch (err) {
      console.error('Export du plateau en STL échoué :', err);
      resolve(null);
    }
  };
  c.onExportPlateStl = onExportPlateStl;

  window.addEventListener('apex-export-plate-stl', onExportPlateStl);


  window.addEventListener('apex-request-slice-models', onRequestSliceModels);

  window.addEventListener('apex-slice-all-models', onSliceAllModels);


  const onDeleteAll = () => {
    const all = Array.from(modelsRef.current);
    if (all.length === 0) return;
    if (!window.confirm(`Voulez-vous vraiment supprimer les ${all.length} modèle(s) du plateau ?`)) return;
    all.forEach((mesh) => {
      if (mesh && !mesh.isDisposed()) {
        const meshName = mesh.name;
        modelsRef.current.delete(mesh);
        mesh.dispose();
        window.dispatchEvent(new CustomEvent('apex-mesh-deleted', { detail: { name: meshName } }));
      }
    });
    showSuccess(`${all.length} modèle(s) supprimé(s) du plateau.`);
    selectedMeshesRef.current.clear();
    setSelectedMeshName(null);
    updateHighlight();
    gizmoManager.positionGizmoEnabled = false;
    gizmoManager.rotationGizmoEnabled = false;
    gizmoManager.scaleGizmoEnabled = false;
    gizmoManager.attachToMesh(null);
    window.dispatchEvent(new CustomEvent('apex-mesh-selected', { detail: { name: null, names: [], subMeshes: [] } }));
  };
  c.onDeleteAll = onDeleteAll;

  window.addEventListener('apex-delete-all-models', onDeleteAll);


  // Disposition automatique à la OrcaSlicer (utils/orcaArrange.ts) : empreinte convexe gonflée de
  // l'écart, tri du plus grand au plus petit, rotations {0, 45°, 90°, 135°} et placement par NFP.
  const onArrangeModels = () => {
    const meshes = Array.from(modelsRef.current);
    if (meshes.length === 0) return;
    const inputs = meshes.map((mesh) => {
      mesh.computeWorldMatrix(true);
      const outline: { x: number; z: number }[] = [];
      [mesh, ...mesh.getChildMeshes()].forEach((m) => {
        const pos = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        if (!pos) return;
        const world = m.getWorldMatrix();
        const v = new BABYLON.Vector3();
        for (let i = 0; i < pos.length; i += 3) {
          BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], world, v);
          outline.push({ x: v.x, z: v.z });
        }
      });
      return { outline };
    });
    const results = arrangeOrca(inputs, { binRadius: RADIUS, spacing: 5, allowRotations: true });
    let skipped = 0;
    results.forEach((r, i) => {
      if (!r.center) { skipped++; return; }
      const mesh = meshes[i];
      // Babylon tourne dans l'autre sens que orcaArrange (axe Y vers le haut, repère main gauche).
      if (Math.abs(r.angle) > 1e-9) mesh.rotate(BABYLON.Axis.Y, -r.angle, BABYLON.Space.WORLD);
      mesh.computeWorldMatrix(true);
      const b = mesh.getHierarchyBoundingVectors(true);
      mesh.position.x += r.center.x - (b.min.x + b.max.x) / 2;
      mesh.position.z += r.center.z - (b.min.z + b.max.z) / 2;
      mesh.computeWorldMatrix(true);
    });
    if (skipped > 0) showWarning(`${skipped} modèle(s) ne tiennent pas sur le plateau et n'ont pas été déplacés.`);
    updateSelectedPosition();
  };
  c.onArrangeModels = onArrangeModels;

  window.addEventListener('apex-arrange-models', onArrangeModels);
}
