// Issu de la découpe de createGCodeLayer (gcodeLayer.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (gcodeLayerState.ts).
import * as BABYLON from 'babylonjs';

// ---------------------------------------------------------------------------------------------
// Sélection d'un point de trajectoire. Un lancer de rayon Babylon parcourrait tous les triangles
// de chaque maillage (des millions) à chaque survol : on indexe donc les segments extrudés dans
// une grille 3D régulière (format CSR : `cellStart`/`items`), puis on ne parcourt que les
// cellules traversées par le rayon. Construite par tranches, invalidée à chaque reconstruction.
// ---------------------------------------------------------------------------------------------
export interface PickGrid {
  min: BABYLON.Vector3;
  cell: number;
  nx: number; ny: number; nz: number;
  cellStart: Uint32Array;
  items: Uint32Array;
  /** Dernière requête ayant testé le mouvement k (évite de le tester une fois par cellule). */
  seen: Uint32Array;
}
