import * as BABYLON from 'babylonjs';
import { createScreenLines } from '../screenLine';
import { isFlatUi } from '@/utils/interfaceMode';
import type { BoxDrawPhase } from './types';
import type { ViewportCtx } from './context';

/** Outil primitive : boîte. */
export function setupBoxTool(c: ViewportCtx) {
  const { scene, LINE_WIDTH_PX, camera, engine, HEIGHT, PLATE_SURFACE_Y, RADIUS, modelsRef } = c;

  let boxPhase: BoxDrawPhase = 'idle';

  let boxBaseStart: BABYLON.Vector3 | null = null;

  let boxBaseCorner: BABYLON.Vector3 | null = null;

  let boxPreviewOutline: BABYLON.Mesh | null = null;

  let boxExtrudeHeight = 0;


  // Plan invisible au niveau du plateau : seul mesh pickable en mode dessin, il donne un
  // point d'intersection stable même quand le curseur ne survole aucun autre mesh.
  const groundPickPlane = BABYLON.MeshBuilder.CreatePlane(
    "boxDrawGroundPlane",
    { size: 4000 }, // largement au-delà du plateau : sert seulement de plan d'intersection
    scene,
  );
  c.groundPickPlane = groundPickPlane;

  groundPickPlane.rotation.x = Math.PI / 2;

  groundPickPlane.position.y = HEIGHT * 0.5;
 // suit l'élévation du plateau (volumeRoot)
  // `isVisible = false` exclurait ce mesh du picking en plus du rendu — on veut l'inverse
  // (invisible à l'écran mais pickable) : c'est `visibility = 0` qu'il faut utiliser, avec
  // `isPickable` comme seul verrou pour n'entrer en jeu que pendant le dessin.
  groundPickPlane.visibility = 0;

  groundPickPlane.isPickable = false;

  // Un plan sans matériau garde le backFaceCulling par défaut : selon le sens dans lequel
  // la rotation retourne sa normale, la caméra (qui regarde vers le bas) peut ne voir que
  // sa face arrière et manquer tout pick. On lui donne un matériau à double face pour
  // que l'intersection fonctionne quel que soit le sens de la normale.
  const groundPickPlaneMat = new BABYLON.StandardMaterial("boxDrawGroundPlaneMat", scene);

  groundPickPlaneMat.backFaceCulling = false;

  groundPickPlane.material = groundPickPlaneMat;


  // Les primitives ne se tracent que sur le plateau : le point visé est ramené à la surface du
  // plateau (PLATE_SURFACE_Y, jamais le niveau du sol) et contenu dans le disque. Avec un coin
  // d'ancrage, le coin mobile est rapproché de l'ancrage jusqu'à ce que le rectangle entier
  // (ses quatre coins) tienne sur le plateau.
  const pickPlatePoint = (anchor: BABYLON.Vector3 | null): { hit: boolean; pickedPoint: BABYLON.Vector3 | null } => {
    const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh === groundPickPlane);
    if (!pick?.hit || !pick.pickedPoint) return { hit: false, pickedPoint: null };
    const target = new BABYLON.Vector3(pick.pickedPoint.x, PLATE_SURFACE_Y, pick.pickedPoint.z);
    const fits = (corner: BABYLON.Vector3) =>
      [
        corner,
        new BABYLON.Vector3(anchor!.x, PLATE_SURFACE_Y, corner.z),
        new BABYLON.Vector3(corner.x, PLATE_SURFACE_Y, anchor!.z),
      ].every((c) => Math.hypot(c.x, c.z) <= RADIUS);

    let point = target;
    if (!anchor) {
      const r = Math.hypot(target.x, target.z);
      if (r > RADIUS) point = new BABYLON.Vector3(target.x * RADIUS / r, PLATE_SURFACE_Y, target.z * RADIUS / r);
    } else if (!fits(target)) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (fits(BABYLON.Vector3.Lerp(anchor, target, mid))) lo = mid;
        else hi = mid;
      }
      point = BABYLON.Vector3.Lerp(anchor, target, lo);
    }
    return { hit: true, pickedPoint: point };
  };
  c.pickPlatePoint = pickPlatePoint;


  const disposeBoxPreview = () => {
    boxPreviewOutline?.dispose(false, true);
    boxPreviewOutline = null;
  };


  const resetBoxTool = () => {
    boxPhase = 'idle';
    boxBaseStart = null;
    boxBaseCorner = null;
    boxExtrudeHeight = 0;
    groundPickPlane.isPickable = false;
    disposeBoxPreview();
  };
  c.resetBoxTool = resetBoxTool;


  /** Corps bleu sombre (non lumineux) pour chaque voxel — le contour, lui, reste vif. */
  const voxelBodyMaterial = () => {
    const mat = new BABYLON.StandardMaterial("boxDrawVoxelBodyMat", scene);
    mat.diffuseColor = new BABYLON.Color3(0.03, 0.09, 0.16);
    mat.emissiveColor = new BABYLON.Color3(0.02, 0.06, 0.11);
    mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    return mat;
  };
  c.voxelBodyMaterial = voxelBodyMaterial;


  /** Contour bleu lumineux d'un voxel, construit en tubes 3D réels plutôt qu'avec
   * `enableEdgesRendering` : ce dernier a un plafond d'épaisseur interne au shader
   * (quelques dixièmes de pixel) qu'aucune valeur de `edgesWidth` ne dépasse — pour un
   * contour visiblement épais, il faut de la vraie géométrie. */
  const glowEdgesMaterial = () => {
    const mat = new BABYLON.StandardMaterial("boxDrawVoxelEdgeMat", scene);
    mat.emissiveColor = new BABYLON.Color3(0, 0.94, 1);
    mat.disableLighting = true;
    return mat;
  };
  c.glowEdgesMaterial = glowEdgesMaterial;


  const addGlowEdges = (mesh: BABYLON.Mesh, width: number, height: number, depth: number, mat: BABYLON.Material) => {
    const half = new BABYLON.Vector3(width / 2, height / 2, depth / 2);
    const corners = [
      new BABYLON.Vector3(-half.x, -half.y, -half.z), new BABYLON.Vector3(half.x, -half.y, -half.z),
      new BABYLON.Vector3(half.x, -half.y, half.z), new BABYLON.Vector3(-half.x, -half.y, half.z),
      new BABYLON.Vector3(-half.x, half.y, -half.z), new BABYLON.Vector3(half.x, half.y, -half.z),
      new BABYLON.Vector3(half.x, half.y, half.z), new BABYLON.Vector3(-half.x, half.y, half.z),
    ];
    const edgePairs: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const tubeRadius = Math.min(width, height, depth) * 0.04;
    edgePairs.forEach(([a, b], i) => {
      const tube = BABYLON.MeshBuilder.CreateTube(
        `${mesh.name}_edge_${i}`,
        { path: [corners[a], corners[b]], radius: tubeRadius, tessellation: 6, cap: BABYLON.Mesh.CAP_ALL },
        scene,
      );
      tube.material = mat;
      tube.parent = mesh;
      tube.isPickable = false;
    });
  };
  c.addGlowEdges = addGlowEdges;


  /** Contour d'un pavé droit (8 sommets) en lignes bleu lumineux — pas de faces pleines. */
  const buildBoxOutline = (min: BABYLON.Vector3, max: BABYLON.Vector3, previous?: BABYLON.Mesh | null) => {
    const corners = [
      new BABYLON.Vector3(min.x, min.y, min.z), new BABYLON.Vector3(max.x, min.y, min.z),
      new BABYLON.Vector3(max.x, min.y, max.z), new BABYLON.Vector3(min.x, min.y, max.z),
      new BABYLON.Vector3(min.x, max.y, min.z), new BABYLON.Vector3(max.x, max.y, min.z),
      new BABYLON.Vector3(max.x, max.y, max.z), new BABYLON.Vector3(min.x, max.y, max.z),
    ];
    const lines = [
      [corners[0], corners[1], corners[2], corners[3], corners[0]],
      [corners[4], corners[5], corners[6], corners[7], corners[4]],
      [corners[0], corners[4]], [corners[1], corners[5]], [corners[2], corners[6]], [corners[3], corners[7]],
    ];
    // Recréé à chaque appel (6 polylignes, coût négligeable) : un ruban écran n'a pas de mise à
    // jour en place par `instance` comme un LinesMesh.
    previous?.dispose(false, true);
    const mesh = createScreenLines(scene, "boxDrawOutline", lines, new BABYLON.Color3(0, 0.94, 1), LINE_WIDTH_PX);
    mesh.isPickable = false;
    return mesh;
  };


  /** Remplit le pavé de petits voxels apparaissant un par un, puis les fond en un scan. */
  const runVoxelFillAnimation = (min: BABYLON.Vector3, max: BABYLON.Vector3) => {
    const size = max.subtract(min);
    // Diviseur plus petit = voxels plus gros = grille moins dense (et animation de
    // remplissage plus lisible/rapide sur un gros pavé).
    const voxelSize = Math.max(3, Math.min(size.x, size.y, size.z) / 3);
    const counts = {
      x: Math.max(1, Math.round(size.x / voxelSize)),
      y: Math.max(1, Math.round(size.y / voxelSize)),
      z: Math.max(1, Math.round(size.z / voxelSize)),
    };

    const voxelRoot = new BABYLON.TransformNode("boxDrawVoxelRoot", scene);
    const voxelMat = voxelBodyMaterial();
    const voxelEdgeMat = glowEdgesMaterial();
    const cellX = size.x / counts.x;
    const cellY = size.y / counts.y;
    const cellZ = size.z / counts.z;

    const positions: BABYLON.Vector3[] = [];
    for (let ix = 0; ix < counts.x; ix++) {
      for (let iy = 0; iy < counts.y; iy++) {
        for (let iz = 0; iz < counts.z; iz++) {
          positions.push(new BABYLON.Vector3(
            min.x + cellX * (ix + 0.5),
            min.y + cellY * (iy + 0.5),
            min.z + cellZ * (iz + 0.5),
          ));
        }
      }
    }
    // Ordre de pose : couche par couche en hauteur, pour lire clairement le remplissage.
    positions.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);

    const voxelMeshes: BABYLON.Mesh[] = [];
    const spawnStagger = isFlatUi() ? 0 : Math.min(28, Math.max(6, 900 / positions.length));

    positions.forEach((pos, i) => {
      setTimeout(() => {
        if (scene.isDisposed) return;
        const voxel = BABYLON.MeshBuilder.CreateBox(
          `boxDrawVoxel_${i}`,
          { width: cellX * 0.82, height: cellY * 0.82, depth: cellZ * 0.82 },
          scene,
        );
        voxel.position = pos;
        voxel.material = voxelMat;
        voxel.parent = voxelRoot;
        voxel.isPickable = false;
        addGlowEdges(voxel, cellX * 0.82, cellY * 0.82, cellZ * 0.82, voxelEdgeMat);
        voxel.scaling.setAll(0.001);
        BABYLON.Animation.CreateAndStartAnimation(
          "voxelPop", voxel, "scaling", 30, 6,
          new BABYLON.Vector3(0.001, 0.001, 0.001), new BABYLON.Vector3(1, 1, 1),
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
        );
        voxelMeshes.push(voxel);

        if (i === positions.length - 1) {
          // Dernier voxel posé : on laisse le remplissage se lire un instant, puis on
          // lance le scan qui résout le nuage de voxels en un unique pavé plein.
          setTimeout(() => runScanResolve(min, max, voxelRoot, voxelMeshes), 260);
        }
      }, i * spawnStagger);
    });
  };


  /** Animation de « scan » : un plan lumineux balaie le pavé, les voxels s'estompent
   * derrière lui à mesure qu'il passe, et le solide final apparaît à sa place. */
  const runScanResolve = (
    min: BABYLON.Vector3, max: BABYLON.Vector3, voxelRoot: BABYLON.TransformNode, voxelMeshes: BABYLON.Mesh[],
  ) => {
    const height = max.y - min.y;
    const finalBox = BABYLON.MeshBuilder.CreateBox("primitiveBox", {
      width: max.x - min.x, height, depth: max.z - min.z,
    }, scene);
    finalBox.position.set((min.x + max.x) / 2, min.y + height / 2, (min.z + max.z) / 2);
    const finalMat = new BABYLON.StandardMaterial("primitiveBoxMat", scene);
    finalMat.diffuseColor = new BABYLON.Color3(0.75, 0.78, 0.82);
    finalMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    finalBox.material = finalMat;
    finalBox.visibility = 0;
    modelsRef.current.add(finalBox);

    const scanPlane = BABYLON.MeshBuilder.CreatePlane("boxDrawScanPlane", {
      width: (max.x - min.x) * 1.15, height: (max.z - min.z) * 1.15,
    }, scene);
    scanPlane.rotation.x = Math.PI / 2;
    const scanMat = new BABYLON.StandardMaterial("boxDrawScanMat", scene);
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
      scanPlane.position.set((min.x + max.x) / 2, y, (min.z + max.z) / 2);

      voxelMeshes.forEach((v) => {
        if (v.position.y <= y) v.setEnabled(false);
      });
      finalBox.visibility = t;

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        scanPlane.dispose();
        voxelRoot.dispose();
        voxelMeshes.forEach((v) => v.dispose());
        finalBox.visibility = 1;
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
      }
    };
    requestAnimationFrame(step);
  };


  const onBoxDrawStart = () => {
    if (scene.isDisposed) return;
    c.resetPyramidTool(); // un seul outil de dessin actif à la fois sur `groundPickPlane`
    resetBoxTool();
    boxPhase = 'drawing-base';
    groundPickPlane.isPickable = true;
  };
  c.onBoxDrawStart = onBoxDrawStart;

  window.addEventListener('apex-primitive-box-start', onBoxDrawStart);


  const boxDrawObserver = scene.onPointerObservable.add((pointerInfo) => {
    if (boxPhase === 'idle') return;

    if (boxPhase === 'drawing-base') {
      // Cette phase a besoin du point d'intersection avec le plateau : elle reste donc
      // dépendante du pick sur `groundPickPlane`, qui a une étendue finie mais couvre
      // Point visé ramené sur le plateau (cf. pickPlatePoint).
      const pick = pickPlatePoint(boxBaseStart);
      if (!pick?.hit || !pick.pickedPoint) return;

      // Interaction en deux clics façon Fusion 360 (clic-relâche à un coin, clic-relâche
      // à l'autre), pas un cliquer-glisser continu : un clic bref donne un déplacement
      // souris quasi nul entre down et up, ce qui annulait systématiquement le rectangle
      // si on se basait sur la distance parcourue *pendant* le clic. On distingue plutôt
      // le premier clic (pose le coin de départ) du second (valide le coin opposé), et le
      // survol entre les deux prévisualise le rectangle.
      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        const corner = boxBaseStart ?? pick.pickedPoint;
        const min = new BABYLON.Vector3(Math.min(corner.x, pick.pickedPoint.x), PLATE_SURFACE_Y, Math.min(corner.z, pick.pickedPoint.z));
        const max = new BABYLON.Vector3(Math.max(corner.x, pick.pickedPoint.x), PLATE_SURFACE_Y + 0.01, Math.max(corner.z, pick.pickedPoint.z));
        boxPreviewOutline = buildBoxOutline(min, max, boxPreviewOutline);
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
        if (!boxBaseStart) {
          // Premier clic : pose le coin de départ, le rectangle reste à dessiner.
          boxBaseStart = pick.pickedPoint.clone();
          return;
        }
        const corner = pick.pickedPoint.clone();
        if (corner.subtract(boxBaseStart).length() < 2) {
          // Second clic quasi au même endroit que le premier : rectangle dégénéré, on
          // annule plutôt que d'extruder un plat.
          resetBoxTool();
          return;
        }
        boxBaseCorner = corner;
        boxPhase = 'extruding';
      }
      return;
    }

    if (boxPhase === 'extruding' && boxBaseStart && boxBaseCorner) {
      // Cette phase ne dépend plus du pick au sol : `groundPickPlane` a une étendue finie
      // (300mm de côté), et viser au-delà de ses bords pour extruder plus haut ou selon un
      // angle de caméra rasant est un geste normal — un pick manqué gelait alors la
      // hauteur. La hauteur ne dépend donc que de la position écran du curseur, projetée
      // depuis un point de référence fixe au sol, sans jamais retester d'intersection.
      const min = new BABYLON.Vector3(Math.min(boxBaseStart.x, boxBaseCorner.x), PLATE_SURFACE_Y, Math.min(boxBaseStart.z, boxBaseCorner.z));
      const max = new BABYLON.Vector3(Math.max(boxBaseStart.x, boxBaseCorner.x), PLATE_SURFACE_Y, Math.max(boxBaseStart.z, boxBaseCorner.z));

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        const originScreen = BABYLON.Vector3.Project(
          new BABYLON.Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2),
          BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
          camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
        );
        const pixelsPerMm = 3;
        const rawHeight = Math.max(0, (originScreen.y - scene.pointerY) / pixelsPerMm);
        boxExtrudeHeight = Math.min(HEIGHT, rawHeight);
        const extrudedMax = new BABYLON.Vector3(max.x, PLATE_SURFACE_Y + boxExtrudeHeight, max.z);
        boxPreviewOutline = buildBoxOutline(min, extrudedMax, boxPreviewOutline);
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
        if (boxExtrudeHeight < 1) return; // évite un pavé nul sur double-clic accidentel
        boxPhase = 'filling';
        groundPickPlane.isPickable = false;
        disposeBoxPreview();
        runVoxelFillAnimation(min, new BABYLON.Vector3(max.x, PLATE_SURFACE_Y + boxExtrudeHeight, max.z));
      }
    }
  });
  c.boxDrawObserver = boxDrawObserver;
}
