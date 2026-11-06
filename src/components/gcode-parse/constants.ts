import { DEG2RAD } from './geometry';

/** Avance (mm/min) supposée tant que le fichier n'a pas encore donné de F. */
export const DEFAULT_FEED_MM_MIN = 1500;
/** Durée plancher d'un mouvement (s) : un mouvement quasi immobile pour la buse (rotation autour
 * du centre, consigne répétée) prend tout de même un instant. */
export const MIN_MOVE_S = 1e-3;
/** Filament par défaut quand l'en-tête ne le précise pas : PLA 1,75 mm. */
export const DEFAULT_FILAMENT_DIAMETER_MM = 1.75;
export const DEFAULT_FILAMENT_DENSITY_G_CM3 = 1.24;
/** Longueur supposée d'une rétraction firmware (G10) quand l'en-tête ne donne pas `retraction_length`. */
export const DEFAULT_FIRMWARE_RETRACT_MM = 1;
/** Découpage des arcs G2/G3 en segments droits : corde et angle maximaux. */
export const ARC_MAX_CHORD_MM = 0.5;
export const ARC_MAX_STEP_RAD = 10 * DEG2RAD;
export const ARC_MAX_SEGMENTS = 720;
/** Variation de E (mm) en dessous de laquelle on la considère nulle (arrondis des fichiers). */
export const E_EPS = 1e-6;
/** Cinématique supposée (cartésien) tant que le fichier ne la fixe pas (M204, M205,
 * SET_VELOCITY_LIMIT) : accélération en mm/s², jerk / vitesse de coin en mm/s. */
export const DEFAULT_ACCEL = 1000;
export const DEFAULT_JERK = 8;
/** Tolérance angulaire (degrés) pour retrouver, en polaire, le dernier dépôt au même angle C
 * (modulo 360°) et en déduire l'épaisseur de couche locale — cf. `layerHeightMm`. */
export const POLAR_LAYER_ANGLE_TOLERANCE_DEG = 2;
/** Nombre de secteurs de l'historique angulaire polaire (360° / ce pas). */
export const POLAR_LAYER_BUCKETS = Math.round(360 / POLAR_LAYER_ANGLE_TOLERANCE_DEG);
/** Écart de Z (mm) en dessous duquel deux dépôts cartésiens successifs sont dans la même couche. */
export const LAYER_Z_EPS = 1e-4;

export const COMMAND_RE = /^([GM])(\d+)(?:\.\d+)?/;
export const WORD_RE = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
export const FEATURE_RE = /^\s*(?:TYPE|FEATURE)\s*[:\s]\s*(.+?)\s*$/i;
/** Largeur de cordon explicite (Orca/Bambu/PrusaSlicer) : `;WIDTH:0.42` ou `; WIDTH = 0.42`. */
export const TOOL_AXIS_RE = /^\s*TOOL_AXIS\s*:/i;
export const WIDTH_RE = /^\s*WIDTH\s*[:=]\s*([\d.]+)/i;
export const WIPE_START_RE = /^\s*WIPE_START/i;
export const WIPE_END_RE = /^\s*WIPE_END/i;
export const ICESL_LAYER_RE = /^\s*<\/?layer>\s*$/i;
// Réglage d'en-tête `; clé = valeur` (Orca, Prusa), `; clé: valeur` (en-tête Orca), `; clé : valeur`
// (IceSL) ou `;CLÉ:valeur` (Cura).
export const HEADER_RE = /^\s*([a-z][a-z0-9_.]*)\s*[:=]\s*(.*?)\s*$/i;
/** Signatures de slicer cherchées dans les commentaires précédant ce nombre de mouvements. */
export const GENERATOR_SCAN_MOVES = 200;
// Klipper : SET_VELOCITY_LIMIT [VELOCITY=] [ACCEL=] [SQUARE_CORNER_VELOCITY=].
export const VELOCITY_LIMIT_RE = /^SET_VELOCITY_LIMIT\b/i;
export const VELOCITY_PARAM_RE = /\b(VELOCITY|ACCEL|ACCEL_TO_DECEL|SQUARE_CORNER_VELOCITY)\s*=\s*([\d.]+)/gi;
