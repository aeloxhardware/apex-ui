import * as BABYLON from 'babylonjs';
import { colorForMode } from '../gcodeColormap';
import { isColorByDeferred } from '@/utils/gcodeColorByPrefs';
import type { ContinuousColorByMode } from '../gcodeParse';
import type { LayerState } from './state';
import type { PathEntry } from './types';

export interface ColorByApplier {
  /** Recolore (ou restaure) les cordons extrudés selon `st.colorBy`. */
  apply(): void;
  /** Annule un recalcul différé en attente. */
  cancelPending(): void;
}

/** Couleur par sommet d'un cordon selon le mode continu courant, écrite dans le tampon de couleurs. */
function writeVertexColors(st: LayerState, entry: PathEntry, scratch: BABYLON.Color3) {
  const { vertexOwner, mesh } = entry;
  const vertexColors = new Float32Array(vertexOwner.length * 4);
  for (let v = 0; v < vertexOwner.length; v++) {
    colorForMode(st.colorBy as ContinuousColorByMode, vertexOwner[v], st.parsed!, st.colorByScope, scratch);
    vertexColors[v * 4] = scratch.r;
    vertexColors[v * 4 + 1] = scratch.g;
    vertexColors[v * 4 + 2] = scratch.b;
    vertexColors[v * 4 + 3] = 1;
  }
  // `updateVerticesData` une fois le tampon de couleurs déjà créé (bascules suivantes entre
  // modes continus) ; sinon `setVerticesData` le crée la première fois (premier passage en
  // mode continu pour ce maillage) — ni l'un ni l'autre ne retouche positions/indices/normales.
  if (mesh!.isVerticesDataPresent(BABYLON.VertexBuffer.ColorKind)) {
    mesh!.updateVerticesData(BABYLON.VertexBuffer.ColorKind, vertexColors);
  } else {
    mesh!.setVerticesData(BABYLON.VertexBuffer.ColorKind, vertexColors, true);
  }
}

/**
 * Recolore (ou restaure) les cordons extrudés selon `colorBy`, sans reconstruire leur géométrie :
 * `lineType` réapplique le matériau catégoriel déjà construit au chargement ; un mode continu
 * bascule le maillage sur le matériau partagé `vertexColorBeadMat` et met à jour son tampon de
 * couleurs par sommet via `updateVerticesData`, jamais un `VertexData.applyToMesh` complet.
 * Le recalcul peut être différé (réglage Paramètres, cf. utils/gcodeColorByPrefs.ts) : un
 * changement de mode qui arrive avant l'image différée annule la précédente.
 */
export function createColorBy(st: LayerState): ColorByApplier {
  const scratch = new BABYLON.Color3();
  let deferredRaf = 0;

  const cancelPending = () => {
    if (deferredRaf) {
      cancelAnimationFrame(deferredRaf);
      deferredRaf = 0;
    }
  };

  const run = () => {
    if (!st.parsed) return;
    const isContinuous = st.colorBy !== 'lineType';
    for (const entry of st.paths) {
      if (!entry.isExtrusion || !entry.mesh) continue;
      if (st.editNeutral) {
        entry.mesh.material = st.materials.neutralBeadMat;
      } else if (!isContinuous) {
        entry.mesh.material = entry.categoryMaterial ?? entry.mesh.material;
      } else {
        entry.mesh.material = st.materials.vertexColorBeadMat;
        writeVertexColors(st, entry, scratch);
      }
    }
  };

  return {
    cancelPending,
    apply() {
      cancelPending();
      if (isColorByDeferred()) deferredRaf = requestAnimationFrame(() => { deferredRaf = 0; run(); });
      else run();
    },
  };
}
