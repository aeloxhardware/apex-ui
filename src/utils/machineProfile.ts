// Profil d'imprimante → paramètres de la machine, une seule source : le fichier de profil
// (profiles/<fabricant>/<modèle>.json, bloc `apex`). Les limites de l'édition (machineLimits.ts,
// layerLimits.ts) et le `machine_profile` envoyé au moteur (requête de tranchage) en sont dérivés ;
// aucune valeur de machine n'est recopiée ailleurs. Une donnée « Inconnu » reste absente du résultat :
// on ne devine pas une donnée matérielle.
import aetheris4 from '../../profiles/Aelox Hardware/Aetheris-4.json';

/** Profil de l'imprimante utilisée tant que le menu Imprimantes ne permet pas d'en choisir une autre. */
export const DEFAULT_PRINTER_PROFILE: unknown = aetheris4;

/**
 * Rayon du plateau (mm) lu dans le profil de l'imprimante : seule source, pour le viewport, l'analyseur
 * G-code, l'arrangement et la validation. Le profil par défaut est embarqué : s'il n'a pas cette
 * donnée, c'est une erreur de donnée qu'on veut voir tout de suite, pas une valeur à deviner.
 */
export const PLATE_RADIUS_MM: number = (() => {
  const r = (DEFAULT_PRINTER_PROFILE as { apex?: { plate_radius_mm?: unknown } } | null)?.apex?.plate_radius_mm;
  if (typeof r !== 'number' || !(r > 0)) throw new Error("Le profil d'imprimante par défaut n'indique pas `apex.plate_radius_mm`.");
  return r;
})();

/** Nom de l'imprimante d'un profil (`apex.model`, sinon `printer_model`) ; `null` quand il n'en porte pas. */
function printerName(profile: unknown): string | null {
  const p = profile as { apex?: { model?: unknown }; printer_model?: unknown } | null;
  const name = p?.apex?.model ?? p?.printer_model;
  return typeof name === 'string' && name ? name : null;
}

/** Nom de l'imprimante active tant que le menu Imprimantes n'en a pas fait choisir une autre. */
export const DEFAULT_PRINTER_NAME: string = (() => {
  const name = printerName(DEFAULT_PRINTER_PROFILE);
  if (!name) throw new Error("Le profil d'imprimante par défaut n'indique pas son nom (`apex.model`).");
  return name;
})();

interface ProfileRotaryAxis {
  axis: string;
  role?: string;
  range_deg?: unknown;
  max_speed_deg_s?: unknown;
  max_acceleration_deg_s2?: unknown;
}

interface ProfileApexBlock {
  rotary_axes?: ProfileRotaryAxis[];
  pivot_distance_mm?: Record<string, unknown>;
  plate_radius_mm?: unknown;
  /** Identifiant du modèle 3D de la tête (`src/assets/models/<id>.glb`). */
  toolhead_model?: unknown;
  layer_height_limits_mm?: { min?: unknown; max?: unknown };
  default_nozzle_profile?: { length_mm?: unknown; angle_deg?: unknown; outer_width_mm?: unknown } | null;
}

export interface MachineFacts {
  bRangeDeg: [number, number] | null;
  bSpeedDegS: number | null;
  bAccelDegS2: number | null;
  cRangeDeg: [number, number] | null;
  plateRadiusMm: number | null;
  pivotMm: number | null;
  layerMinMm: number | null;
  layerMaxMm: number | null;
  toolheadModel: string | null;
  /** Buse par défaut de l'imprimante (`apex.default_nozzle_profile`). */
  nozzleLengthMm: number | null;
  nozzleAngleDeg: number | null;
  nozzleOuterWidthMm: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function range(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [lo, hi] = [num(v[0]), num(v[1])];
  return lo !== null && hi !== null && hi >= lo ? [lo, hi] : null;
}

/** Données utiles de la machine lues dans un profil ; `null` quand le profil dit « Inconnu » ou se tait. */
export function machineFacts(profile: unknown): MachineFacts {
  const apex = ((profile as { apex?: ProfileApexBlock } | null)?.apex ?? {}) as ProfileApexBlock;
  const axes = Array.isArray(apex.rotary_axes) ? apex.rotary_axes : [];
  const b = axes.find((a) => a.axis === 'B');
  const c = axes.find((a) => a.axis === 'C');
  return {
    bRangeDeg: range(b?.range_deg),
    bSpeedDegS: num(b?.max_speed_deg_s),
    bAccelDegS2: num(b?.max_acceleration_deg_s2),
    cRangeDeg: range(c?.range_deg),
    plateRadiusMm: num(apex.plate_radius_mm),
    pivotMm: num(apex.pivot_distance_mm?.B),
    layerMinMm: num(apex.layer_height_limits_mm?.min),
    layerMaxMm: num(apex.layer_height_limits_mm?.max),
    toolheadModel: typeof apex.toolhead_model === 'string' && apex.toolhead_model ? apex.toolhead_model : null,
    nozzleLengthMm: num(apex.default_nozzle_profile?.length_mm),
    nozzleAngleDeg: num(apex.default_nozzle_profile?.angle_deg),
    nozzleOuterWidthMm: num(apex.default_nozzle_profile?.outer_width_mm),
  };
}

/** Nombre d'axes déclaré (`apex.axes_count`) ; `null` quand le profil se tait ou dit « Inconnu ». */
export function profileAxes(profile: unknown): number | null {
  return num((profile as { apex?: { axes_count?: unknown } } | null)?.apex?.axes_count);
}

const RAD = Math.PI / 180;

/**
 * `machine_profile` de la requête de tranchage (champs de `MachineProfile`, config/params.schema.json).
 * Ne contient que ce que le profil sait : le moteur garde ses valeurs pour le reste (tête, buse,
 * direction radiale). Axes : plateau C (Z) puis tête B (X), l'ordre que le moteur attend pour une
 * machine à C couplé à la position.
 */
export function engineMachineProfile(profile: unknown): Record<string, unknown> {
  const f = machineFacts(profile);
  const out: Record<string, unknown> = {};
  if (f.cRangeDeg && f.bRangeDeg) {
    out.rotation_axes = [
      { axis: [0, 0, 1], angle_range_deg: f.cRangeDeg },
      { axis: [1, 0, 0], angle_range_deg: f.bRangeDeg },
    ];
  }
  if (f.bSpeedDegS !== null) out.max_angular_velocity = f.bSpeedDegS * RAD;
  if (f.bAccelDegS2 !== null) out.max_angular_acceleration = f.bAccelDegS2 * RAD;
  if (f.plateRadiusMm !== null) out.platform_radius = f.plateRadiusMm;
  // Tête de collision de l'étape 9 : un identifiant, jamais un chemin (R-020) ; le moteur le résout dans ses ressources.
  if (f.toolheadModel !== null) out.toolhead_id = f.toolheadModel;
  return out;
}

/**
 * Plancher et plafond d'épaisseur de couche du profil, en racine `AeolisSliceParams` (R-024) : omis quand le profil
 * ne les donne pas, le moteur garde alors ses défauts (0,1 et 0,25 mm).
 */
export function engineLayerLimits(profile: unknown): { min_layer_height?: number; max_layer_height?: number } {
  const f = machineFacts(profile);
  return {
    ...(f.layerMinMm !== null ? { min_layer_height: f.layerMinMm } : {}),
    ...(f.layerMaxMm !== null ? { max_layer_height: f.layerMaxMm } : {}),
  };
}

/** Longueur pivot-pointe de la tête B (`gcode_params.pivot_to_tip`), si le profil la donne. */
export function enginePivotToTip(profile: unknown): number | null {
  return machineFacts(profile).pivotMm;
}
