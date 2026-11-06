// Issu de la découpe de createGCodeLayer (gcodeLayer.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (gcodeLayerState.ts).
import * as BABYLON from 'babylonjs';
import { LINE_TYPES, DEFAULT_LINE_VISIBILITY, type LineTypeId } from '../gcodeLineTypes';
import { colorForMode } from '../gcodeColormap';
import { isColorByDeferred } from '@/utils/gcodeColorByPrefs';
import { type ContinuousColorByMode, type ParsedGCode, DEG2RAD, nozzleTip, stateAt, toolAxisAt } from '../gcodeParse';
import { type PathSampler, BEAD_HEIGHT_MM, createSampler, runSliced, writeRing, buildBeadMesh, buildPathMesh, buildMarkerMesh, countUpTo } from '../gcodeLayerGeometry';
import { GCODE_MESH_PREFIX, type MarkerEntry, type PathEntry } from './gcodeLayerShared';
import type { GCodeLayerState } from './gcodeLayerState';

function setupParsed(st: GCodeLayerState) {
  const { scene } = st;
  st.parsed = null;
  st.sampler = null;
  st.segments = new Uint32Array(0);
  st.paths = [];
  st.markers = [];
  // Longueur max (mm) d'un sous-segment cartésien en mode continu (cf. createSampler, « Précision
  // du rendu » de la légende) ; null = comportement actuel (un anneau par mouvement), utilisé tant
  // que setRenderPrecision n'a jamais été appelé et toujours en mode catégoriel.
  st.renderPrecisionMm = null;
  // Traits hors plateau surlignés en rouge (proposition de suppression avant conversion) : cordon
  // doublé, rendu devant l'original (zOffset) plutôt qu'en remplaçant sa couleur.
  const offPlateMat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}OffPlateMat`, scene);
  const OFF_PLATE_EMISSIVE = new BABYLON.Color3(0.75, 0.05, 0.05);
  offPlateMat.diffuseColor = new BABYLON.Color3(1, 0.12, 0.12);
  offPlateMat.emissiveColor = OFF_PLATE_EMISSIVE.clone();
  offPlateMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
  offPlateMat.backFaceCulling = false;
  offPlateMat.zOffset = -2;

  // Clignotement pendant une conversion en cours (cf. setOffPlateBlinking) : bandes « chantier »
  // rouge/jaune en diagonale, défilant dans l'espace monde (comme des puces qui se déplacent),
  // plutôt qu'une simple pulsation de couleur uniforme — motif procédural (pas de texture/UV
  // requis) basé sur vPositionW, dans le même style que boundaryFragmentShader (Viewport3D.tsx).
  BABYLON.Effect.ShadersStore["offPlateHazardVertexShader"] = `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    uniform mat4 worldViewProjection;
    uniform mat4 world;
    varying vec3 vPositionW;
    varying vec3 vNormalW;
    void main(void) {
        gl_Position = worldViewProjection * vec4(position, 1.0);
        vPositionW = vec3(world * vec4(position, 1.0));
        vNormalW = normalize(vec3(world * vec4(normal, 0.0)));
    }
  `;
  Object.assign(st, { offPlateMat });
}

function setupOffPlateHazardMat(st: GCodeLayerState) {
  const { scene } = st;
  BABYLON.Effect.ShadersStore["offPlateHazardFragmentShader"] = `
    precision highp float;
    varying vec3 vPositionW;
    varying vec3 vNormalW;
    uniform float time;
    void main(void) {
        // Ruban de signalisation chantier : jaune citron vif / rouge sang profond, bandes larges et
        // nettes à 45°.
        vec3 red = vec3(0.65, 0.03, 0.02);
        vec3 yellow = vec3(0.98, 0.92, 0.05);
        // Diagonale à 45° dans le plan du plateau (X + Z), défilée par time pour l'effet de
        // déplacement continu (comme des puces qui glissent).
        float diag = (vPositionW.x + vPositionW.z) * 0.22 - time;
        // Bande nette (pas de dégradé lissé, pour l'aspect « bande de signalisation ») : la partie
        // fractionnaire de diag bascule rouge/jaune à mi-cycle.
        float band = step(0.5, fract(diag));
        vec3 stripeColor = mix(red, yellow, band);
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float diffuse = max(dot(normalize(vNormalW), lightDir), 0.6);
        gl_FragColor = vec4(stripeColor * diffuse + stripeColor * 0.35, 1.0);
    }
  `;
  const offPlateHazardMat = new BABYLON.ShaderMaterial(
    `${GCODE_MESH_PREFIX}OffPlateHazardMat`, scene,
    { vertex: "offPlateHazard", fragment: "offPlateHazard" },
    { attributes: ["position", "normal"], uniforms: ["worldViewProjection", "world", "time"] },
  );
  offPlateHazardMat.backFaceCulling = false;
  offPlateHazardMat.zOffset = -2;

  st.offPlatePath = null;
  st.highlightOffPlate = false;
  // N'anime (et n'assigne le matériau chantier) que quand nécessaire (posé/retiré par
  // setOffPlateBlinking), pas en permanence — coût nul le reste du temps.
  st.blinkingOffPlate = false;
  st.offPlateBlinkObserver = null;
  st.offPlateBlinkStart = 0;
  // Vitesse de défilement des bandes (unités de `diag` par seconde) — indépendante de la fréquence
  // de clignotement d'origine, purement visuelle ici : à ajuster au ressenti.
  const OFF_PLATE_HAZARD_SPEED = 1.5;
  st.time = 0;
  st.visibility = { ...DEFAULT_LINE_VISIBILITY };
  Object.assign(st, { offPlateHazardMat, OFF_PLATE_HAZARD_SPEED });
}

function setupColorBy(st: GCodeLayerState) {
  // Mode de coloration actif et sa portée affichée (cf. setColorBy). `lineType` restaure le
  // matériau catégoriel existant sans recalcul ; un mode continu recolore les sommets des cordons
  // (jamais travel/wipe) par le matériau partagé `vertexColorBeadMat`, sans reconstruire la
  // géométrie (cf. plan §3). `colorByScope` n'a de sens que pour un mode continu — recalculée par
  // `defaultColorByScope` sur les bornes du fichier tant que React n'en a pas fourni une (avant le
  // premier appel à `setColorBy` avec un mode continu, ou juste après `load()`).
  st.colorBy = 'lineType';
  st.colorByScope = { min: 0, max: 0, grayOutOfScope: false };
  // Couleur réutilisée à chaque sommet recoloré (évite une allocation par sommet, potentiellement
  // des dizaines de milliers par bascule de mode).
  const colorScratch = new BABYLON.Color3();

  const up = BABYLON.Vector3.Up();
  const headDir = new BABYLON.Vector3();
  const headTip = { r: 0, z: 0 };
  const toolAxis = { x: 0, y: 0, z: 1 };
  Object.assign(st, { colorScratch, up, headDir, headTip, toolAxis });
}

function setupApply(st: GCodeLayerState) {
  const { headDir, headNode, headTip, onPlateRotation, plateNode, toolAxis, up } = st;
  const apply = () => {
    if (!st.parsed || st.parsed.moves.length === 0) return;
    const last = st.parsed.moves.length - 1;
    const t = Math.max(0, Math.min(last, st.time));
    const state = stateAt(st.parsed.moves, t);

    if (st.parsed.kind === 'polar') {
      // Dans le repère main gauche de Babylon, rotation.y = ψ envoie un angle local θ
      // (x = cos θ, z = sin θ) sur θ − ψ. Avec ψ = C courant, un point déposé à C_dépôt est à
      // l'angle machine C_dépôt − C : pile sous la tête (angle 0) au moment de son dépôt, puis
      // entraîné avec le plateau. Le signe opposé ferait apparaître la pièce en miroir.
      plateNode.rotation.y = state.y * DEG2RAD;
      onPlateRotation?.(plateNode.rotation.y);

      const bRad = state.b * DEG2RAD;
      nozzleTip(state.x, state.z, bRad, headTip);
      headNode.position.set(headTip.r, headTip.z, 0);
      // headDir.x positif = tête penchée vers +X, donc vers +R (à l'opposé de l'axe de rotation,
      // situé en X=0) puisque le nœud de tête est lui-même posé en X=+R. Signe vérifié visuellement
      // contre le comportement réel de la machine (le signe opposé penchait la tête vers l'axe).
      headDir.set(Math.sin(bRad), Math.cos(bRad), 0);
      BABYLON.Quaternion.FromUnitVectorsToRef(up, headDir, headNode.rotationQuaternion!);
    } else {
      // Cartésien : plateau fixe, tête qui suit la buse en X/Y/Z (Y du G-code → z Babylon), droite
      // sauf si le fichier pilote l'orientation de l'outil (B/C) : la tête prend alors cet axe.
      plateNode.rotation.y = 0;
      onPlateRotation?.(0);
      headNode.position.set(state.x, state.z, state.y);
      if (st.parsed.toolOriented) {
        toolAxisAt(st.parsed.moves, t, toolAxis);
        headDir.set(toolAxis.x, toolAxis.z, toolAxis.y);
        BABYLON.Quaternion.FromUnitVectorsToRef(up, headDir, headNode.rotationQuaternion!);
      } else {
        headNode.rotationQuaternion!.set(0, 0, 0, 1);
      }
    }

    // Préfixe affiché : mouvements terminés + fraction du mouvement en cours, au sous-segment
    // près. Chaque mouvement a `segments[k]` sous-segments dans chaque maillage qui le contient.
    const i = Math.floor(t);
    const next = Math.min(last, i + 1);
    const partialSteps = next > i ? Math.floor((t - i) * st.segments[next]) : 0;
    for (const entry of st.offPlatePath ? [...st.paths, st.offPlatePath] : st.paths) {
      if (!entry.mesh) continue;
      let count = entry.cumIndices[i];
      if (next > i && entry.include(next)) count += partialSteps * entry.indicesPerStep;
      const sub = entry.mesh.subMeshes?.[0];
      if (sub) sub.indexCount = count;
      entry.mesh.isVisible = count > 0;
    }
    for (const entry of st.markers) {
      const count = countUpTo(entry.at, t);
      entry.mesh.thinInstanceCount = count;
      entry.mesh.isVisible = count > 0;
    }
    st.updateLive(i, next, t);
  };
  Object.assign(st, { apply });
}

function setupUpdateLive(st: GCodeLayerState) {
  const { beadMaterials, colorScratch, colors, liveA, liveAxA, liveAxB, liveB, liveBead, liveColorByMat, liveNormals, livePoints, livePositions } = st;
  /** Tronçon vivant du mouvement `next` en cours, de la fin du préfixe dessiné à la buse. */
  const updateLive = (i: number, next: number, t: number) => {
    let showBead = false;
    let showLine = false;
    if (st.parsed && st.sampler && next > i) {
      const m = st.parsed.moves[next];
      const seg = st.segments[next];
      const f = t - i;
      const f0 = Math.floor(f * seg) / seg;
      const type: LineTypeId = m.extruding ? m.type : m.type === 'wipe' ? 'wipe' : 'travel';
      if (f - f0 > 1e-6 && st.visibility[type]) {
        st.sampler.tip(next, f0, liveA);
        st.sampler.tip(next, f, liveB);
        if (m.extruding) {
          const dx = liveB.x - liveA.x, dy = liveB.y - liveA.y, dz = liveB.z - liveA.z;
          const len = Math.hypot(dx, dy, dz);
          if (len > 1e-6) {
            st.sampler.axis(next, f0, liveAxA);
            st.sampler.axis(next, f, liveAxB);
            const halfH = BEAD_HEIGHT_MM / 2;
            const tx = dx / len, ty = dy / len, tz = dz / len;
            writeRing(livePositions, liveNormals, 0,
              { x: liveA.x - liveAxA.x * halfH, y: liveA.y - liveAxA.y * halfH, z: liveA.z - liveAxA.z * halfH },
              { x: tx, y: ty, z: tz }, liveAxA);
            writeRing(livePositions, liveNormals, 1,
              { x: liveB.x - liveAxB.x * halfH, y: liveB.y - liveAxB.y * halfH, z: liveB.z - liveAxB.z * halfH },
              { x: tx, y: ty, z: tz }, liveAxB);
            liveBead.updateVerticesData(BABYLON.VertexBuffer.PositionKind, livePositions);
            liveBead.updateVerticesData(BABYLON.VertexBuffer.NormalKind, liveNormals);
            if (st.colorBy === 'lineType') {
              liveBead.material = beadMaterials.get(m.type) ?? null;
            } else {
              colorForMode(st.colorBy as ContinuousColorByMode, next, st.parsed, st.colorByScope, colorScratch);
              liveColorByMat.emissiveColor.copyFrom(colorScratch);
              liveBead.material = liveColorByMat;
            }
            showBead = true;
          }
        } else {
          livePoints[0].copyFrom(liveA);
          livePoints[1].copyFrom(liveB);
          st.liveLine = BABYLON.MeshBuilder.CreateLines(st.liveLine.name, { points: livePoints, instance: st.liveLine });
          st.liveLine.color = colors[type];
          showLine = true;
        }
      }
    }
    liveBead.setEnabled(showBead);
    st.liveLine.setEnabled(showLine);
  };
    st.updateLive = updateLive;
}

function setupApplyVisibility(st: GCodeLayerState) {
  const applyVisibility = () => {
    for (const entry of st.paths) entry.mesh?.setEnabled(st.visibility[entry.type]);
    for (const entry of st.markers) entry.mesh.setEnabled(st.visibility[entry.type]);
    st.offPlatePath?.mesh?.setEnabled(st.highlightOffPlate);
  };

  // Recalcul différé (réglage Paramètres, cf. utils/gcodeColorByPrefs.ts) : un changement de mode
  // qui arrive avant l'image différée annule la précédente, jamais deux recalculs empilés.
  st.deferredColorByRaf = 0;
  Object.assign(st, { applyVisibility });
}

function setupApplyColorBy(st: GCodeLayerState) {
  const { colorScratch, neutralBeadMat, vertexColorBeadMat } = st;
  /** Recolore (ou restaure) les cordons extrudés selon `colorBy`, sans reconstruire leur géométrie
   * (cf. plan §3) : `lineType` réapplique le matériau catégoriel déjà construit à `load()` ;
   * un mode continu bascule le maillage sur le matériau partagé `vertexColorBeadMat` et met à jour
   * son tampon de couleurs par sommet via `updateVerticesData`, jamais un `VertexData.applyToMesh`
   * complet (qui retoucherait aussi positions/indices/normales, inutile ici). */
  const applyColorBy = () => {
    if (st.deferredColorByRaf) {
      cancelAnimationFrame(st.deferredColorByRaf);
      st.deferredColorByRaf = 0;
    }
    const run = () => {
      if (!st.parsed) return;
      const isContinuous = st.colorBy !== 'lineType';
      for (const entry of st.paths) {
        if (!entry.isExtrusion || !entry.mesh) continue;
        if (st.editNeutral) {
          entry.mesh.material = neutralBeadMat;
          continue;
        }
        if (!isContinuous) {
          entry.mesh.material = entry.categoryMaterial ?? entry.mesh.material;
          continue;
        }
        entry.mesh.material = vertexColorBeadMat;
        const { vertexOwner } = entry;
        const vertexColors = new Float32Array(vertexOwner.length * 4);
        for (let v = 0; v < vertexOwner.length; v++) {
          colorForMode(st.colorBy as ContinuousColorByMode, vertexOwner[v], st.parsed, st.colorByScope, colorScratch);
          vertexColors[v * 4] = colorScratch.r;
          vertexColors[v * 4 + 1] = colorScratch.g;
          vertexColors[v * 4 + 2] = colorScratch.b;
          vertexColors[v * 4 + 3] = 1;
        }
        // `updateVerticesData` une fois le tampon de couleurs déjà créé (bascules suivantes entre
        // modes continus) ; sinon `setVerticesData` le crée la première fois (premier passage en
        // mode continu pour ce maillage) — ni l'un ni l'autre ne retouche positions/indices/normales.
        if (entry.mesh.isVerticesDataPresent(BABYLON.VertexBuffer.ColorKind)) {
          entry.mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind, vertexColors);
        } else {
          entry.mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, vertexColors, true);
        }
      }
    };
    if (isColorByDeferred()) {
      st.deferredColorByRaf = requestAnimationFrame(() => { st.deferredColorByRaf = 0; run(); });
    } else {
      run();
    }
  };
  Object.assign(st, { applyColorBy });
}

function setupDisposeAll(st: GCodeLayerState) {
  const disposeAll = () => {
    for (const entry of st.paths) entry.mesh?.dispose(false, false);
    for (const entry of st.markers) entry.mesh.dispose(false, true);
    st.offPlatePath?.mesh?.dispose(false, false);
    st.paths = [];
    st.markers = [];
    st.offPlatePath = null;
  };

  /** (Re)construit tous les maillages du calque pour `next`, avec la précision cartésienne
   * courante (`renderPrecisionMm`, ignorée en mode catégoriel — cf. createSampler). Utilisée par
   * `load()` (nouveau fichier) et `setRenderPrecision()` (même fichier, juste une géométrie plus
   * ou moins fine) — ne touche jamais `time`, laissé à l'appelant. */
  // Numéro de la construction en cours : une plus récente (nouveau fichier, autre précision)
  // annule la précédente à la prochaine tranche.
  st.buildSeq = 0;
  Object.assign(st, { disposeAll });
}

/** Maillages d'une construction terminée, publiés d'un bloc par `publishBuilt`. */
interface BuiltLayer {
  paths: PathEntry[];
  markers: MarkerEntry[];
  offPlate: PathEntry | null;
}

/**
 * Construit tous les maillages du tracé (cordons, trajets, marqueurs, traits hors plateau).
 * Renvoie null si la construction est annulée en route : ce qui avait été créé est alors libéré.
 */
async function buildLayerMeshes(
  st: GCodeLayerState,
  next: ParsedGCode,
  pathSampler: PathSampler,
  cancelled: () => boolean,
): Promise<BuiltLayer | null> {
  const { beadMaterials, colors, offPlateHazardMat, offPlateMat, plateNode, scene } = st;
  const { moves } = next;
  // Entrées accumulées localement et publiées d'un bloc en fin de construction : un setter
  // appelé entre deux tranches (visibilité, coloration) ne voit jamais un calque à moitié construit.
  const newPaths: PathEntry[] = [];
  const newMarkers: MarkerEntry[] = [];
  const abort = () => {
    for (const e of newPaths) e.mesh?.dispose(false, false);
    for (const e of newMarkers) e.mesh.dispose(false, true);
  };

  for (const t of LINE_TYPES) {
    if (t.kind !== 'extrusion') continue;
    const include = (k: number) => moves[k].type === t.id;
    const material = beadMaterials.get(t.id)!;
    const built = await runSliced(buildBeadMesh(`${GCODE_MESH_PREFIX}Bead_${t.id}`, next, pathSampler, include, material, scene), cancelled);
    if (!built) { abort(); return null; }
    newPaths.push({ ...built, type: t.id, include, isExtrusion: true, categoryMaterial: material });
  }
  // Trajets à vide : tout mouvement sans dépôt hors essuyage (rétractions sur place comprises,
  // de longueur nulle).
  const travelInclude = (k: number) => !moves[k].extruding && moves[k].type !== 'wipe';
  const wipeInclude = (k: number) => moves[k].type === 'wipe';
  for (const [type, include] of [['travel', travelInclude], ['wipe', wipeInclude]] as const) {
    const built = await runSliced(buildPathMesh(`${GCODE_MESH_PREFIX}Path_${type}`, next, pathSampler, include, colors[type], scene), cancelled);
    if (!built) { abort(); return null; }
    newPaths.push({ ...built, type, include, isExtrusion: false });
  }
  for (const [type, at] of Object.entries(next.markers) as [LineTypeId, Uint32Array][]) {
    const mesh = await runSliced(buildMarkerMesh(`${GCODE_MESH_PREFIX}Marker_${type}`, at, pathSampler, colors[type], scene), cancelled);
    if (cancelled()) { mesh?.dispose(false, true); abort(); return null; }
    if (mesh) newMarkers.push({ type, mesh, at });
  }
  let newOffPlate: PathEntry | null = null;
  if (next.offPlate.moves.length) {
    const flags = new Uint8Array(moves.length);
    for (const k of next.offPlate.moves) flags[k] = 1;
    const include = (k: number) => flags[k] === 1;
    const built = await runSliced(buildBeadMesh(`${GCODE_MESH_PREFIX}OffPlate`, next, pathSampler, include, offPlateMat, scene), cancelled);
    if (!built) { abort(); return null; }
    newOffPlate = { ...built, type: 'custom', include, isExtrusion: false };
    if (newOffPlate.mesh) {
      newOffPlate.mesh.parent = plateNode;
      // Un rechargement pendant un clignotement déjà en cours (rare) doit reconstruire avec le
      // bon matériau, pas retomber sur le rouge fixe de buildBeadMesh ci-dessus.
      if (st.blinkingOffPlate) newOffPlate.mesh.material = offPlateHazardMat;
    }
  }
  return { paths: newPaths, markers: newMarkers, offPlate: newOffPlate };
}

/** Un nouveau fichier est chargé : drapeaux, poids et aperçus d'édition décrivaient l'ancien. */
function resetEditState(st: GCodeLayerState) {
  st.moveFlags = null;
  st.flagSets.clear();
  st.lastWeights = null;
  st.travelPreviewKeys.clear();
}

/** Remplace l'affichage par la construction terminée, puis réapplique visibilité, couleurs et édition. */
function publishBuilt(
  st: GCodeLayerState,
  built: BuiltLayer,
  previous: { paths: PathEntry[]; markers: MarkerEntry[]; offPlatePath: PathEntry | null } | null,
  moveCount: number,
) {
  const { applyColorBy, applyVisibility, headNode, plateNode } = st;
  if (previous) {
    for (const entry of previous.paths) entry.mesh?.dispose(false, false);
    for (const entry of previous.markers) entry.mesh.dispose(false, true);
    previous.offPlatePath?.mesh?.dispose(false, false);
  }
  st.paths = built.paths;
  st.markers = built.markers;
  st.offPlatePath = built.offPlate;
  for (const entry of [...st.paths, ...st.markers]) {
    if (entry.mesh) entry.mesh.parent = plateNode;
  }
  applyVisibility();
  applyColorBy();
  headNode.setEnabled(moveCount > 0);
  if (st.pickWanted) void st.buildPickIndex();
  // Reconstruction du même fichier : les attributs d'édition sont à reposer sur les nouveaux maillages.
  if (st.flagSets.size > 0 || st.lastWeights) {
    st.setEditWeights(st.lastWeights?.indices ?? null, st.lastWeights?.weights, st.lastWeights?.slideNormals, st.lastWeights?.axes);
  }
}

function setupBuildAll(st: GCodeLayerState) {
  const { disposeAll } = st;
  const buildAll = async (next: ParsedGCode, keepOld = false): Promise<void> => {
    const seq = ++st.buildSeq;
    const cancelled = () => seq !== st.buildSeq;
    // Reconstruction « à chaud » : l'ancien affichage reste jusqu'à ce que le nouveau soit prêt.
    const previous = keepOld ? { paths: st.paths, markers: st.markers, offPlatePath: st.offPlatePath } : null;
    if (!keepOld) disposeAll();
    st.pickBuildSeq++; // l'index de sélection de l'ancienne géométrie n'est plus valable
    st.pickGrid = null;
    st.pickHighlight?.setEnabled(false);
    if (next !== st.parsed) resetEditState(st);
    st.parsed = next;
    const precisionMm = st.colorBy !== 'lineType' ? st.renderPrecisionMm : null;
    const pathSampler = await runSliced(createSampler(next, precisionMm), cancelled);
    if (!pathSampler) return;
    st.sampler = pathSampler;
    st.segments = pathSampler.segments;

    const built = await buildLayerMeshes(st, next, pathSampler, cancelled);
    if (!built) return;
    publishBuilt(st, built, previous, next.moves.length);
  };
  Object.assign(st, { buildAll });
}

export function setupGCodeLayerBuild(st: GCodeLayerState) {
  setupParsed(st);
  setupOffPlateHazardMat(st);
  setupColorBy(st);
  setupApply(st);
  setupUpdateLive(st);
  setupApplyVisibility(st);
  setupApplyColorBy(st);
  setupDisposeAll(st);
  setupBuildAll(st);
}
