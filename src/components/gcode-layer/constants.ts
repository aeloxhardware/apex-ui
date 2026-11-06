/** Préfixe de nom de tous les maillages du calque (cf. exclusion de la capture du flou). */
export const GCODE_MESH_PREFIX = 'gcode';

/** Section du cordon déposé (mm) : largeur de part et d'autre de la trajectoire, et épaisseur le
 * long de l'axe de la buse. Valeurs nominales (pas de largeur/hauteur de couche lue). */
export const BEAD_WIDTH_MM = 0.6;
export const BEAD_HEIGHT_MM = 0.3;
/** Nombre de facettes de la section du cordon. */
export const TUBE_SIDES = 6;
/** Diamètre des sphères des marqueurs ponctuels (rétractions, coutures). */
export const MARKER_DIAMETER_MM = 0.8;

/**
 * Construction du maillage par TRANCHES : les générateurs `yield` toutes les SLICE_MASK+1
 * itérations, et `runSliced` ne rend la main au navigateur (image suivante) que quand la tranche en
 * cours dépasse SLICE_BUDGET_MS — un fichier énorme se construit donc en plusieurs dizaines
 * d'images au lieu de figer l'interface (et le rideau de chargement continue d'animer).
 */
export const SLICE_MASK = 0x1fff;
export const SLICE_BUDGET_MS = 6;
/** Tolérance de visée (pixels) en plus du rayon du cordon, pour sélectionner un point de trajectoire. */
export const PICK_TOLERANCE_PX = 6;
