// Modèles du plateau et changement d'espace : l'Accueil et les Paramètres démontent le viewport, donc la
// scène. Plutôt que de perdre le plateau, les modèles sont sérialisés dans un fichier temporaire au
// démontage (la RAM est libérée avec la scène) et relus au montage suivant : mêmes noms, poses, unités,
// matières. Seul l'historique Ctrl+Z (qui tient des maillages vivants) ne survit pas au démontage.
import * as BABYLON from 'babylonjs';
import { emitApex, onApex } from '@/events/apexEvents';
import { isProjectDirty, PROJECT_3MF_KEY } from '@/utils/projectSave';
import { stashDrop, stashPut, stashPutText, stashTake } from '@/utils/spaceStash';
import { buildThreeMf, type ThreeMfPart } from '@/utils/threeMf';
import { showWarning } from '@/utils/toast';
import { createOrcaModelMaterial } from '../orcaModelMaterial';
import { registerRestoredModels } from './viewportHistory';
import { describeSubMeshes } from './viewportSelectionActions';
import type { ViewportState } from './viewportState';

const MODELS_KEY = 'plate-models';
/** Couleur de la matière d'Apex (shader), gardée dans les métadonnées le temps de la sérialisation. */
const COLOR_KEY = 'apexOrcaColor';
const DEFAULT_COLOR: [number, number, number] = [0.6, 0.65, 0.7];

type StashedPlate = { counters: Record<string, number>; scene: object };

/** La matière d'Apex est un shader, non sérialisable : on garde sa couleur et on la recrée au retour. */
function detachShaderMaterials(root: BABYLON.AbstractMesh) {
  [root, ...root.getChildMeshes(false)].forEach((mesh) => {
    const material = mesh.material;
    if (!(material instanceof BABYLON.ShaderMaterial)) return;
    const color = (material as unknown as { diffuseColor?: BABYLON.Color3 }).diffuseColor;
    mesh.metadata = { ...(mesh.metadata ?? {}), [COLOR_KEY]: color ? [color.r, color.g, color.b] : DEFAULT_COLOR };
    mesh.material = null;
  });
}

/** Un objet 3MF par modèle du plateau (ses parties réunies), géométrie en repère monde. */
function plateParts(st: ViewportState): ThreeMfPart[] {
  const parts: ThreeMfPart[] = [];
  st.modelsRef.current.forEach((root) => {
    if (root.isDisposed()) return;
    for (const mesh of [root, ...root.getChildMeshes(false)]) {
      const local = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      const indices = mesh.getIndices();
      if (!mesh.isVisible || !local || !indices) continue;
      const world = mesh.computeWorldMatrix(true);
      const positions = new Float32Array(local.length);
      const v = new BABYLON.Vector3();
      for (let i = 0; i < local.length; i += 3) {
        BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(local[i], local[i + 1], local[i + 2], world, v);
        positions.set([v.x, v.y, v.z], i);
      }
      parts.push({
        name: mesh === root ? root.name : `${root.name} - ${mesh.name}`,
        positions,
        indices,
        mirrored: world.determinant() < 0,
      });
    }
  });
  return parts;
}

/** Projet modifié et viewport sur le point de disparaître : le 3MF est gardé pour l'enregistrement de fermeture. */
function stashProjectThreeMf(st: ViewportState) {
  if (!isProjectDirty()) return;
  void buildThreeMf({ parts: plateParts(st) })
    .then((bytes) => stashPut(PROJECT_3MF_KEY, bytes))
    .catch((err) => console.error('Mise en réserve du projet 3MF impossible :', err));
}

/** Au démontage, avant la libération de la scène : dépose les modèles du plateau dans la réserve. */
export function stashPlateModels(st: ViewportState) {
  if (st.disposed) return;
  const roots = Array.from(st.modelsRef.current).filter((mesh) => !mesh.isDisposed());
  // Un plateau vide ne touche pas à la réserve : un montage éphémère (préchargement) ne doit rien écraser.
  if (roots.length === 0) return;
  try {
    stashProjectThreeMf(st);
    roots.forEach(detachShaderMaterials);
    const plate: StashedPlate = {
      counters: st.primitiveCounters,
      scene: BABYLON.SceneSerializer.SerializeMesh(roots, false, true) as object,
    };
    void stashPutText(MODELS_KEY, JSON.stringify(plate)).catch((err) => {
      console.error('Écriture de la réserve des modèles impossible :', err);
      showWarning("Les modèles du plateau n'ont pas pu être mis en réserve.");
    });
  } catch (err) {
    console.error('Mise en réserve des modèles impossible :', err);
    showWarning("Les modèles du plateau n'ont pas pu être mis en réserve.");
  }
}

/** Remet la matière d'Apex sur les parties qui en avaient une. */
function restoreShaderMaterials(st: ViewportState, root: BABYLON.AbstractMesh) {
  [root, ...root.getChildMeshes(false)].forEach((mesh) => {
    const color = (mesh.metadata as Record<string, unknown> | null)?.[COLOR_KEY];
    if (!Array.isArray(color) || color.length !== 3) return;
    mesh.material = createOrcaModelMaterial('stlDefaultMat', st.scene, new BABYLON.Color3(color[0], color[1], color[2]));
    const { [COLOR_KEY]: _color, ...rest } = mesh.metadata as Record<string, unknown>;
    mesh.metadata = rest;
  });
}

/** Annonce les modèles à l'interface (arborescence, bouton SLICE) : un événement par modèle, sans sélection. */
function announceModels(st: ViewportState) {
  st.modelsRef.current.forEach((mesh) => {
    if (!mesh.isDisposed()) emitApex('apex-mesh-selected', { name: mesh.name, subMeshes: describeSubMeshes(mesh) });
  });
  emitApex('apex-mesh-selected', { name: null, names: [], subMeshes: [] });
  emitApex('apex-request-slice-models');
}

async function restorePlateModels(st: ViewportState) {
  const bytes = await stashTake(MODELS_KEY);
  if (!bytes) return;
  // La scène vivante répond désormais pour le projet : la copie 3MF déposée au démontage est périmée.
  void stashDrop(PROJECT_3MF_KEY);
  // Viewport déjà démonté (montage double du mode développement) : la réserve est rendue intacte.
  if (st.scene.isDisposed) {
    void stashPut(MODELS_KEY, bytes);
    return;
  }
  try {
    const plate = JSON.parse(new TextDecoder().decode(bytes)) as StashedPlate;
    const file = new File([JSON.stringify(plate.scene)], 'plateau.babylon');
    const result = await BABYLON.SceneLoader.ImportMeshAsync('', '', file, st.scene, null, '.babylon');
    if (st.scene.isDisposed) {
      void stashPut(MODELS_KEY, bytes);
      return;
    }
    Object.assign(st.primitiveCounters, plate.counters);
    const roots = result.meshes.filter((mesh) => !mesh.parent);
    roots.forEach((root) => {
      restoreShaderMaterials(st, root);
      // Le plateau peut être caché derrière la Prévisualisation : l'état d'activation suit l'espace affiché.
      root.setEnabled(!st.gcodePreviewActive);
      st.modelsRef.current.add(root);
    });
    st.applyModelShading();
    registerRestoredModels(st);
    announceModels(st);
  } catch (err) {
    console.error('Relecture des modèles du plateau impossible :', err);
    showWarning("Les modèles du plateau n'ont pas pu être restaurés.");
  }
}

export function setupViewportModelStash(st: ViewportState) {
  // Une arborescence montée après les modèles (Modélisation) demande la liste de ce qui est déjà sur le plateau.
  const offRequest = onApex('apex-request-mesh-list', () => announceModels(st));
  // Enregistrement du projet : réponse synchrone, comme l'export STL du tranchage.
  const offExport = onApex('apex-export-plate-3mf', ({ resolve }) => {
    const parts = plateParts(st);
    resolve(parts.length === 0 ? Promise.resolve(null) : buildThreeMf({ parts }).catch(() => null));
  });
  st.offModelStash = () => {
    offRequest();
    offExport();
  };
  void restorePlateModels(st);
}
