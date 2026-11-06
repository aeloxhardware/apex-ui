import * as BABYLON from 'babylonjs';
import { createScreenLines } from '../screenLine';
import { isFlatUi } from '@/utils/interfaceMode';
import type { PyramidPhase } from './types';
import type { ViewportCtx } from './context';

/** Outil primitive : pyramide. */
export function setupPyramidTool(c: ViewportCtx) {
  const { groundPickPlane, scene, LINE_WIDTH_PX, voxelBodyMaterial, glowEdgesMaterial, addGlowEdges, resetBoxTool, pickPlatePoint, camera, engine, modelsRef, PLATE_SURFACE_Y, HEIGHT } = c;

  let pyramidPhase: PyramidPhase = 'idle';

  let pyramidBaseStart: BABYLON.Vector3 | null = null;

  let pyramidBaseCorner: BABYLON.Vector3 | null = null;

  let pyramidPreviewRings: BABYLON.Mesh | null = null;

  let pyramidHeight = 0;


  const disposePyramidPreview = () => {
    pyramidPreviewRings?.dispose(false, true);
    pyramidPreviewRings = null;
  };


  const resetPyramidTool = () => {
    pyramidPhase = 'idle';
    pyramidBaseStart = null;
    pyramidBaseCorner = null;
    pyramidHeight = 0;
    groundPickPlane.isPickable = false;
    disposePyramidPreview();
  };
  c.resetPyramidTool = resetPyramidTool;


  /** Nombre d'étages/anneaux imbriqués : dérivé à la fois de la taille du rectangle (pour
   * la phase de dessin, où la hauteur est encore nulle) et de la hauteur choisie (pour la
   * phase d'extrusion), en visant la même épaisseur de couche cible dans les deux cas —
   * sans quoi une pyramide plus haute aurait des couches de plus en plus épaisses au lieu
   * de rester à densité constante. */
  const pyramidRingCount = (min: BABYLON.Vector3, max: BABYLON.Vector3, height: number) => {
    const targetLayerSize = 12;
    const base = Math.min(max.x - min.x, max.z - min.z);
    const fromBase = Math.round(base / targetLayerSize);
    const fromHeight = Math.round(height / targetLayerSize);
    return Math.min(14, Math.max(2, Math.max(fromBase, fromHeight)));
  };


  /** Rectangles imbriqués (l'aperçu « ressort ») : l'anneau 0 est la base pleine taille à
   * y=0, le dernier est réduit au centre à y=`height` (le sommet). Un seul LinesMesh pour
   * tous les anneaux, régénéré à chaque frame comme `buildBoxOutline`. */
  const buildPyramidPreview = (
    min: BABYLON.Vector3, max: BABYLON.Vector3, height: number, previous?: BABYLON.Mesh | null,
  ) => {
    const ringCount = pyramidRingCount(min, max, height);
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;
    const lines: BABYLON.Vector3[][] = [];

    for (let i = 0; i < ringCount; i++) {
      const t = ringCount === 1 ? 0 : i / (ringCount - 1);
      const scale = 1 - t; // 1 = pleine base, 0 = point central (le sommet)
      const y = min.y + height * t;
      const x0 = cx + (min.x - cx) * scale;
      const x1 = cx + (max.x - cx) * scale;
      const z0 = cz + (min.z - cz) * scale;
      const z1 = cz + (max.z - cz) * scale;
      lines.push([
        new BABYLON.Vector3(x0, y, z0), new BABYLON.Vector3(x1, y, z0),
        new BABYLON.Vector3(x1, y, z1), new BABYLON.Vector3(x0, y, z1),
        new BABYLON.Vector3(x0, y, z0),
      ]);
    }
    // Pas d'arêtes reliant les coins d'un anneau au suivant : sur une pyramide à plusieurs
    // étages, ces 4 lignes diagonales se multiplient visuellement en un maillage triangulé
    // dense qui masque les couches — on ne garde que les rectangles empilés eux-mêmes.

    // Contrairement à `buildBoxOutline` (toujours 6 segments fixes), le nombre d'anneaux
    // ici dépend de la taille du rectangle et change donc à chaque frame pendant le
    // dessin — réutiliser `instance` suppose une topologie identique à l'original, et un
    // nombre de lignes différent corrompt le buffer au lieu d'échouer proprement (c'est
    // ce qui produisait le motif décalé/« en escalier » au lieu d'anneaux concentriques).
    // On recrée donc le mesh à chaque appel plutôt que de tenter une mise à jour en place.
    previous?.dispose(false, true);
    const mesh = createScreenLines(scene, "pyramidDrawPreview", lines, new BABYLON.Color3(0, 0.94, 1), LINE_WIDTH_PX);
    mesh.isPickable = false;
    return mesh;
  };


  /** Remplit chaque étage de la pyramide avec UNE SEULE cellule (mêmes matériaux que les
   * voxels de Boîte) — pas une grille subdivisée : un étage, une cellule, comme demandé.
   * Des étages larges/bas vers les étages étroits/hauts, puis lance le scan qui les
   * résout en un vrai maillage pyramidal. */
  const runPyramidFillAnimation = (min: BABYLON.Vector3, max: BABYLON.Vector3, height: number) => {
    const ringCount = pyramidRingCount(min, max, height);
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;

    const layerRoot = new BABYLON.TransformNode("pyramidDrawLayerRoot", scene);
    const cellMat = voxelBodyMaterial();
    const cellEdgeMat = glowEdgesMaterial();
    const cellHeight = height / ringCount;

    const cellMeshes: BABYLON.Mesh[] = [];
    const spawnStagger = isFlatUi() ? 0 : Math.min(90, Math.max(40, 700 / ringCount));

    Array.from({ length: ringCount }, (_, i) => {
      const t = ringCount === 1 ? 0 : i / (ringCount - 1);
      const scale = 1 - t;
      const w = (max.x - min.x) * scale;
      const d = (max.z - min.z) * scale;
      const y = min.y + height * t;
      return { w, d, y };
    }).forEach((ring, i) => {
      setTimeout(() => {
        if (scene.isDisposed) return;
        const cell = BABYLON.MeshBuilder.CreateBox(
          `pyramidDrawCell_${i}`,
          { width: Math.max(0.1, ring.w * 0.92), height: cellHeight * 0.92, depth: Math.max(0.1, ring.d * 0.92) },
          scene,
        );
        cell.position.set(cx, ring.y + cellHeight / 2, cz);
        cell.material = cellMat;
        cell.parent = layerRoot;
        cell.isPickable = false;
        addGlowEdges(cell, ring.w * 0.92, cellHeight * 0.92, ring.d * 0.92, cellEdgeMat);
        cell.scaling.setAll(0.001);
        BABYLON.Animation.CreateAndStartAnimation(
          "pyramidCellPop", cell, "scaling", 30, 6,
          new BABYLON.Vector3(0.001, 0.001, 0.001), new BABYLON.Vector3(1, 1, 1),
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
        );
        cellMeshes.push(cell);

        // Le compte doit être incrémenté DANS le callback asynchrone, pas avant : un
        // compteur incrémenté au moment de planifier les `setTimeout` atteindrait déjà
        // son total avant qu'aucun ne se déclenche, faisant répéter cette condition à
        // chaque cellule au lieu de la dernière seule — c'est ce qui multipliait le scan
        // (et donc le pavé final) par le nombre de cellules au lieu de le lancer une fois.
        if (cellMeshes.length === ringCount) {
          setTimeout(() => runPyramidScanResolve(min, max, height, layerRoot, cellMeshes), 260);
        }
      }, i * spawnStagger);
    });
  };


  /** Résout le nuage de cellules en un vrai maillage pyramidal (5 sommets, 4 faces
   * triangulaires + une base carrée) — contrairement à Boîte, pas un simple pavé : les
   * faces latérales sont planes et inclinées, sans escalier visible de près. */
  const runPyramidScanResolve = (
    min: BABYLON.Vector3, max: BABYLON.Vector3, height: number,
    layerRoot: BABYLON.TransformNode, cellMeshes: BABYLON.Mesh[],
  ) => {
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;

    const apex = new BABYLON.Vector3(cx, min.y + height, cz);
    const base = [
      new BABYLON.Vector3(min.x, min.y, min.z), new BABYLON.Vector3(max.x, min.y, min.z),
      new BABYLON.Vector3(max.x, min.y, max.z), new BABYLON.Vector3(min.x, min.y, max.z),
    ];
    const positions = [...base.flatMap((v) => [v.x, v.y, v.z]), apex.x, apex.y, apex.z];
    // Base (2 triangles, face vers le bas) + 4 faces latérales vers le sommet (index 4).
    const indices = [
      0, 2, 1, 0, 3, 2,
      0, 1, 4,
      1, 2, 4,
      2, 3, 4,
      3, 0, 4,
    ];
    const vertexData = new BABYLON.VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, vertexData.normals);

    const finalPyramid = new BABYLON.Mesh("primitivePyramid", scene);
    vertexData.applyToMesh(finalPyramid);
    const finalMat = new BABYLON.StandardMaterial("primitivePyramidMat", scene);
    finalMat.diffuseColor = new BABYLON.Color3(0.75, 0.78, 0.82);
    // Aucun reflet spéculaire : un rendu mat plutôt que le léger brillant par défaut.
    finalMat.specularColor = new BABYLON.Color3(0, 0, 0);
    finalMat.backFaceCulling = false;
    finalPyramid.material = finalMat;
    finalPyramid.visibility = 0;
    modelsRef.current.add(finalPyramid);

    const scanPlane = BABYLON.MeshBuilder.CreatePlane("pyramidDrawScanPlane", {
      width: (max.x - min.x) * 1.15, height: (max.z - min.z) * 1.15,
    }, scene);
    scanPlane.rotation.x = Math.PI / 2;
    const scanMat = new BABYLON.StandardMaterial("pyramidDrawScanMat", scene);
    scanMat.emissiveColor = new BABYLON.Color3(0, 0.94, 1);
    scanMat.alpha = 0.55;
    scanMat.disableLighting = true;
    scanMat.backFaceCulling = false;
    scanPlane.material = scanMat;
    scanPlane.isPickable = false;

    const duration = isFlatUi() ? 1 : 550; // interface classique : aucune animation
    const start = performance.now();
    const step = () => {
      if (scene.isDisposed) return;
      const t = Math.min(1, (performance.now() - start) / duration);
      const y = min.y + height * t;
      // L'anneau du scan rétrécit avec la hauteur, comme la silhouette de la pyramide,
      // pour que le plan lumineux épouse visuellement la forme qu'il révèle.
      const scale = 1 - t;
      scanPlane.scaling.set(Math.max(0.001, scale), 1, Math.max(0.001, scale));
      scanPlane.position.set(cx, y, cz);

      cellMeshes.forEach((c) => {
        if (c.position.y <= y) c.setEnabled(false);
      });
      finalPyramid.visibility = t;

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        scanPlane.dispose();
        layerRoot.dispose();
        cellMeshes.forEach((c) => c.dispose());
        finalPyramid.visibility = 1;
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
      }
    };
    requestAnimationFrame(step);
  };


  const onPyramidDrawStart = () => {
    if (scene.isDisposed) return;
    resetBoxTool(); // un seul outil de dessin actif à la fois sur `groundPickPlane`
    resetPyramidTool();
    pyramidPhase = 'drawing-base';
    groundPickPlane.isPickable = true;
  };
  c.onPyramidDrawStart = onPyramidDrawStart;

  window.addEventListener('apex-primitive-pyramid-start', onPyramidDrawStart);


  const pyramidDrawObserver = scene.onPointerObservable.add((pointerInfo) => {
    if (pyramidPhase === 'idle') return;

    if (pyramidPhase === 'drawing-base') {
      const pick = pickPlatePoint(pyramidBaseStart);
      if (!pick?.hit || !pick.pickedPoint) return;

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        const corner = pyramidBaseStart ?? pick.pickedPoint;
        const min = new BABYLON.Vector3(Math.min(corner.x, pick.pickedPoint.x), PLATE_SURFACE_Y, Math.min(corner.z, pick.pickedPoint.z));
        const max = new BABYLON.Vector3(Math.max(corner.x, pick.pickedPoint.x), PLATE_SURFACE_Y, Math.max(corner.z, pick.pickedPoint.z));
        pyramidPreviewRings = buildPyramidPreview(min, max, 0, pyramidPreviewRings);
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
        if (!pyramidBaseStart) {
          pyramidBaseStart = pick.pickedPoint.clone();
          return;
        }
        const corner = pick.pickedPoint.clone();
        if (corner.subtract(pyramidBaseStart).length() < 2) {
          resetPyramidTool();
          return;
        }
        pyramidBaseCorner = corner;
        pyramidPhase = 'extruding';
      }
      return;
    }

    if (pyramidPhase === 'extruding' && pyramidBaseStart && pyramidBaseCorner) {
      const min = new BABYLON.Vector3(Math.min(pyramidBaseStart.x, pyramidBaseCorner.x), PLATE_SURFACE_Y, Math.min(pyramidBaseStart.z, pyramidBaseCorner.z));
      const max = new BABYLON.Vector3(Math.max(pyramidBaseStart.x, pyramidBaseCorner.x), PLATE_SURFACE_Y, Math.max(pyramidBaseStart.z, pyramidBaseCorner.z));

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        // Même dérivation écran→hauteur que Boîte, indépendante du pick au sol pour ne
        // pas geler quand le curseur sort de l'étendue finie du plan de pick.
        const originScreen = BABYLON.Vector3.Project(
          new BABYLON.Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2),
          BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
          camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
        );
        const pixelsPerMm = 3;
        const rawHeight = Math.max(0, (originScreen.y - scene.pointerY) / pixelsPerMm);
        pyramidHeight = Math.min(HEIGHT, rawHeight);
        pyramidPreviewRings = buildPyramidPreview(min, max, pyramidHeight, pyramidPreviewRings);
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
        if (pyramidHeight < 1) return;
        pyramidPhase = 'filling';
        groundPickPlane.isPickable = false;
        disposePyramidPreview();
        runPyramidFillAnimation(min, max, pyramidHeight);
      }
    }
  });
  c.pyramidDrawObserver = pyramidDrawObserver;
}
