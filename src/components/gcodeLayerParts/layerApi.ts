// Issu de la découpe de createGCodeLayer (gcodeLayer.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (gcodeLayerState.ts).
import * as BABYLON from 'babylonjs';
import { defaultColorByScope } from '../gcodeColormap';
import { editDeformState } from '../gcodeEditDeform';
import type { GCodeLayer } from '../gcodeLayer';
import { GCODE_MESH_PREFIX } from './gcodeLayerShared';
import type { GCodeLayerState } from './gcodeLayerState';

/** Une tranche de l'API publique du calque : le compilateur vérifie que l'assemblage est complet. */
type ApiPart<K extends keyof GCodeLayer> = Pick<GCodeLayer, K>;

/** Chargement du tracé et position de lecture. */
function loadingApi(st: GCodeLayerState): ApiPart<'replaceMoves' | 'load' | 'setRenderPrecision' | 'setTime'> {
  const { apply, buildAll, flagSets, travelPreviewKeys } = st;
  return {
    async replaceMoves(next) {
      st.moveFlags = null;
      flagSets.clear();
      st.lastWeights = null;
      travelPreviewKeys.clear();
      const last = next.moves.length - 1;
      const wasAtEnd = st.time >= (st.parsed?.moves.length ?? 1) - 1;
      await buildAll(next, true);
      if (st.parsed !== next) return;
      if (wasAtEnd) st.time = last;
      st.time = Math.min(st.time, last);
      apply();
    },
    async load(next) {
      await buildAll(next);
      if (st.parsed !== next) return; // supplanté par un chargement plus récent
      st.time = next.moves.length - 1;
      apply();
    },
    setRenderPrecision(mm) {
      st.renderPrecisionMm = mm;
      if (!st.parsed || st.colorBy === 'lineType') return;
      const current = st.parsed;
      void buildAll(current).then(() => { if (st.parsed === current) apply(); });
    },
    setTime(t) {
      st.time = t;
      apply();
    },
  };
}

/** Types de ligne affichés, coloration, surlignage hors plateau, tête et édition « neutre ». */
function displayApi(st: GCodeLayerState): ApiPart<'setLineTypeVisibility' | 'setColorBy' | 'setOffPlateHighlight' | 'setFullHead' | 'setEditNeutral'> {
  const { apply, applyColorBy, applyHeadVisibility, applyVisibility, buildAll } = st;
  return {
    setLineTypeVisibility(next) {
      st.visibility = { ...next };
      applyVisibility();
    },
    setColorBy(mode, scope) {
      // Un réglage de précision cartésienne (renderPrecisionMm) change la géométrie elle-même
      // (plus de sous-segments par mouvement, cf. createSampler) SEULEMENT en mode continu — passer
      // de/vers `lineType` alors qu'une précision est déjà réglée doit donc reconstruire, pas
      // seulement recolorer, sans quoi le mode catégoriel hériterait de la géométrie subdivisée (ou
      // l'inverse) au lieu de celle qui lui correspond.
      const needsRebuild = st.renderPrecisionMm != null && (mode === 'lineType') !== (st.colorBy === 'lineType');
      st.colorBy = mode;
      if (scope) st.colorByScope = scope;
      else if (mode !== 'lineType' && st.parsed) st.colorByScope = defaultColorByScope(st.parsed.ranges[mode]);
      if (needsRebuild && st.parsed) {
        const current = st.parsed;
        void buildAll(current).then(() => { if (st.parsed === current) apply(); });
      } else {
        applyColorBy();
      }
    },
    setOffPlateHighlight(show) {
      st.highlightOffPlate = show;
      applyVisibility();
    },
    setFullHead(show) {
      st.fullHead = show;
      applyHeadVisibility();
    },
    setEditNeutral(neutral: boolean) {
      if (st.editNeutral === neutral) return;
      st.editNeutral = neutral;
      applyColorBy();
    },
  };
}

/** Clignotement du surlignage hors plateau. */
function blinkingApi(st: GCodeLayerState): ApiPart<'setOffPlateBlinking'> {
  const { OFF_PLATE_HAZARD_SPEED, offPlateHazardMat, offPlateMat, scene } = st;
  return {
    setOffPlateBlinking(blinking) {
      st.blinkingOffPlate = blinking;
      if (blinking && !st.offPlateBlinkObserver) {
        // Bascule vers le matériau « chantier » (bandes diagonales défilantes) tant que le
        // clignotement est actif ; jamais de trou (ni éteint ni immobile) — cf. demande d'origine
        // (« les laisser en rouge... mais les faire clignoter »), étendue à un motif qui se déplace
        // sur toute la surface visible plutôt qu'une simple pulsation de couleur uniforme.
        if (st.offPlatePath?.mesh) st.offPlatePath.mesh.material = offPlateHazardMat;
        st.offPlateBlinkStart = performance.now();
        st.offPlateBlinkObserver = scene.onBeforeRenderObservable.add(() => {
          const elapsed = (performance.now() - st.offPlateBlinkStart) / 1000;
          offPlateHazardMat.setFloat('time', elapsed * OFF_PLATE_HAZARD_SPEED);
        });
      } else if (!blinking && st.offPlateBlinkObserver) {
        scene.onBeforeRenderObservable.remove(st.offPlateBlinkObserver);
        st.offPlateBlinkObserver = null;
        if (st.offPlatePath?.mesh) st.offPlatePath.mesh.material = offPlateMat;
      }
    },
  };
}

/** Sélection d'un point de trajectoire. */
function pickingApi(st: GCodeLayerState): ApiPart<'setPickingEnabled' | 'pickAt' | 'setPickHighlight'> {
  const { buildPickIndex, pickAt, plateNode, scene } = st;
  return {
    setPickingEnabled(enabled) {
      st.pickWanted = enabled;
      if (enabled) { if (!st.pickGrid) void buildPickIndex(); } else { st.pickBuildSeq++; st.pickGrid = null; }
    },
    pickAt,
    setPickHighlight(local) {
      if (!local) { st.pickHighlight?.setEnabled(false); return; }
      if (!st.pickHighlight) {
        st.pickHighlight = BABYLON.MeshBuilder.CreateSphere(`${GCODE_MESH_PREFIX}PickHighlight`, { diameter: 1.8, segments: 12 }, scene);
        const mat = new BABYLON.StandardMaterial(`${GCODE_MESH_PREFIX}PickHighlightMat`, scene);
        mat.disableLighting = true;
        mat.emissiveColor = new BABYLON.Color3(0.9608, 0.6196, 0.0431);
        mat.alpha = 0.9;
        mat.disableDepthWrite = true;
        st.pickHighlight.material = mat;
        st.pickHighlight.parent = plateNode;
        st.pickHighlight.isPickable = false;
        st.pickHighlight.renderingGroupId = 1; // par-dessus le tracé, même caché derrière une paroi
      }
      st.pickHighlight.position.copyFrom(local);
      st.pickHighlight.setEnabled(true);
    },
  };
}

/** Accès à la scène du calque (repère du plateau, tracé analysé) et libération. */
function sceneApi(st: GCodeLayerState): ApiPart<'setEnabled' | 'getPlateRotation' | 'getParsed' | 'getPlateWorldMatrix' | 'getMoveTip' | 'dispose'> {
  const { disposeAll, plateNode, root, scene } = st;
  return {
    setEnabled(enabled) {
      root.setEnabled(enabled);
    },
    getPlateRotation() {
      return plateNode.rotation.y;
    },
    getParsed() {
      return st.parsed;
    },
    getPlateWorldMatrix() {
      return plateNode.computeWorldMatrix(true);
    },
    getMoveTip(k, out) {
      if (st.sampler) st.sampler.tip(k, 1, out);
      return out;
    },
    dispose() {
      st.disposed = true;
      if (st.deferredColorByRaf) cancelAnimationFrame(st.deferredColorByRaf);
      if (st.offPlateBlinkObserver) scene.onBeforeRenderObservable.remove(st.offPlateBlinkObserver);
      disposeAll();
      root.dispose(false, true);
    },
  };
}

/** Édition du G-code : poids, transformation en direct, déplacements, aperçu des trajets à vide. */
function editApi(st: GCodeLayerState): ApiPart<'setEditWeights' | 'setEditTransform' | 'applyMoveEdits' | 'setEditFlagBit' | 'setTravelPreview' | 'getHeadSamples'> {
  const { applyMoveEdits, getHeadSamples, setEditFlagBit, setEditWeights, setTravelPreview } = st;
  return {
    setEditWeights,
    setEditTransform({ translation, pivot, axis, angle, stackAxis }) {
      editDeformState.translation.copyFrom(translation);
      editDeformState.pivot.copyFrom(pivot);
      editDeformState.axis.copyFrom(axis);
      editDeformState.angle = angle;
      if (stackAxis) editDeformState.stackAxis.copyFrom(stackAxis);
      else editDeformState.stackAxis.setAll(0);
    },
    applyMoveEdits,
    setEditFlagBit,
    setTravelPreview,
    getHeadSamples,
  };
}

function composeApi(st: GCodeLayerState): GCodeLayer {
  return {
    ...loadingApi(st),
    ...displayApi(st),
    ...blinkingApi(st),
    ...pickingApi(st),
    ...sceneApi(st),
    ...editApi(st),
  };
}

export function setupGCodeLayerApi(st: GCodeLayerState) {
  return composeApi(st);
}
